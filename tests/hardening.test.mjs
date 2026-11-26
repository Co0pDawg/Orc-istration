import { test } from 'node:test';
import { isolateHome } from './helpers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse, serialize, normalizeEol } from '../tools/lib/frontmatter.mjs';
import { main, loadRoles, loadModels, loadAdapters, buildTool, firstDiffLine, decodeText } from '../tools/orc.mjs';

// No test in this file can reach the real home folder: commands that default --home use this scratch one.
isolateHome();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORC = path.join(REPO, 'tools', 'orc.mjs');
const read = (f) => normalizeEol(fs.readFileSync(f, 'utf8'));
const tempDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `orc-${name}-`));
// No test reads this machine's ~/.orc: the shared state home is an empty scratch folder, which children inherit.
process.env.ORC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'orc-data-'));

async function run(argv, stdin = '', extra = {}) {
  const out = [];
  const err = [];
  const code = await main(argv, { out: (s) => out.push(s), err: (s) => err.push(s), stdin: () => stdin, ...extra });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

function copyRepo(name) {
  const copy = tempDir(name);
  for (const p of ['core', 'models.json', 'adapters', 'tools/lib', 'tests/golden']) {
    fs.cpSync(path.join(REPO, p), path.join(copy, p), { recursive: true });
  }
  return copy;
}

// Runs the CLI in a child whose HOME and USERPROFILE point at an empty scratch dir.
function isolated(argv) {
  const fakeHome = tempDir('fakehome');
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
  const r = spawnSync(process.execPath, [ORC, ...argv], { env, encoding: 'utf8' });
  return { code: r.status, err: r.stderr, fakeHome };
}

test('V1: a value option without a value fails and writes nothing', async () => {
  for (const argv of [
    ['install', '--tool', 'claude-code', '--home', '--apply'],
    ['install', '--tool', 'codex', '--home', '--apply'],
    ['install', '--tool', 'codex', '--home', '', '--apply'],
  ]) {
    const r = isolated(argv);
    assert.equal(r.code, 1, argv.join(' '));
    assert.match(r.err, /--home needs a value/);
    assert.deepEqual(fs.readdirSync(r.fakeHome), [], 'scratch home stays empty');
  }
  for (const key of ['tool', 'out', 'board', 'board-repo']) {
    const r = await run(['build', `--${key}`]);
    assert.equal(r.code, 1);
    assert.match(r.err, new RegExp(`--${key} needs a value`));
  }
});

test('V1: --key=value is honoured, an empty or unknown option is an error, and the real home is never the fallback', () => {
  const target = tempDir('eqhome');
  const ok = isolated(['install', '--tool', 'codex', `--home=${target}`, '--apply']);
  assert.equal(ok.code, 0, ok.err);
  assert.ok(fs.existsSync(path.join(target, '.codex', 'AGENTS.md')), '--home=<dir> is the install target');
  assert.deepEqual(fs.readdirSync(ok.fakeHome), [], 'scratch home stays empty');
  for (const argv of [
    ['install', '--tool', 'codex', '--home=', '--apply'],
    ['install', '--tool', 'codex', '--home=--apply'],
    ['install', '--tool', 'codex', '--hoem', target, '--apply'],
    ['install', '--tool', 'codex', '--apply=yes', '--home', target],
    ['install', '--tool=', '--home', target, '--apply'],
  ]) {
    const r = isolated(argv);
    assert.equal(r.code, 1, argv.join(' '));
    assert.match(r.err, /needs a value|unknown option/);
    assert.deepEqual(fs.readdirSync(r.fakeHome), [], `scratch home stays empty: ${argv.join(' ')}`);
  }
});

test('V6: one hand-written file refuses the whole install; nothing is half applied', async () => {
  const home = tempDir('atomic');
  const mine = path.join(home, '.codex', 'agents', 'builder.toml');
  fs.mkdirSync(path.dirname(mine), { recursive: true });
  fs.writeFileSync(mine, 'name = "builder"\n');
  const dry = await run(['install', '--tool', 'codex', '--home', home]);
  assert.equal(dry.code, 0);
  assert.match(dry.out, /--apply would refuse: 1 hand-written file/);
  const r = await run(['install', '--tool', 'codex', '--home', home, '--apply']);
  assert.equal(r.code, 1);
  assert.match(r.err, /nothing written: 1 hand-written file/);
  assert.deepEqual(fs.readdirSync(path.join(home, '.codex')), ['agents'], 'no rulebook written');
  assert.deepEqual(fs.readdirSync(path.dirname(mine)), ['builder.toml'], 'no other agent written');
  assert.equal(read(mine), 'name = "builder"\n');
});

test('V2: the read-only guard finds roles for every file type', async () => {
  const roles = loadRoles(REPO);
  const models = loadModels(REPO, { local: false });
  const agentsMd = read(path.join(REPO, 'core', 'AGENTS.md'));
  const copilot = (await loadAdapters(REPO)).find((a) => a.id === 'copilot');
  const leaky = {
    ...copilot,
    renderAgent: (role, tier) => {
      const f = copilot.renderAgent(role, tier);
      const { data, body } = parse(f.content);
      return { ...f, content: serialize({ ...data, tools: [...data.tools, 'edit'] }, body) };
    },
  };
  const { errors } = buildTool(leaky, roles, models, agentsMd);
  assert.match(errors.join('\n'), /read-only scout gets edit/);
  assert.match(errors.join('\n'), /read-only refuter gets edit/);
});

test('V3: a tool missing from models.json reports its message, no crash', async () => {
  const copy = copyRepo('nomodel');
  const m = JSON.parse(read(path.join(copy, 'models.json')));
  delete m.cursor;
  fs.writeFileSync(path.join(copy, 'models.json'), JSON.stringify(m));
  const b = await run(['build', '--repo', copy, '--tool', 'cursor', '--out', path.join(copy, 'dist')]);
  assert.equal(b.code, 1);
  assert.match(b.err, /cursor: no entry in models\.json/);
  const c = await run(['check', '--repo', copy]);
  assert.equal(c.code, 1);
  assert.match(c.err, /FAIL cursor: no entry in models\.json/);
});

test('V5: a golden agent file with no role fails check; sync never writes into the checkout', async () => {
  const copy = copyRepo('stale');
  const old = path.join(copy, 'tests', 'golden', 'claude-code', '.claude', 'agents', 'old.md');
  fs.writeFileSync(old, '---\nname: old\ndescription: gone\nmodel: haiku\n---\n\nbody\n');
  const c = await run(['check', '--repo', copy]);
  assert.equal(c.code, 1);
  assert.match(c.err, /^FAIL tests\/golden\/claude-code\/\.claude\/agents\/old\.md: stale \(no source generates it; run node tools\/orc\.mjs golden\)$/m);
  // This file's state home is an empty scratch folder (no config.json), so sync refuses and writes nothing anywhere.
  const home = tempDir('stale-home');
  const listing = (dir) => fs.readdirSync(dir, { recursive: true }).sort();
  const before = listing(copy);
  const s = await run(['sync', '--repo', copy, '--home', home, '--apply']);
  assert.equal(s.code, 1);
  assert.match(s.err, /sync needs activeTools in /);
  assert.deepEqual(listing(copy), before);
  assert.ok(fs.existsSync(old), 'sync deletes nothing from the goldens');
  assert.deepEqual(fs.readdirSync(home), []);
});

test('V6: hand-written targets need --force; generated ones replace normally', async () => {
  const home = tempDir('handwritten');
  const rule = path.join(home, '.codex', 'AGENTS.md');
  fs.mkdirSync(path.dirname(rule), { recursive: true });
  fs.writeFileSync(rule, 'my own rules\n');
  const dry = await run(['install', '--tool', 'codex', '--home', home]);
  assert.match(dry.out, /would REPLACE HAND-WRITTEN .*AGENTS\.md/);
  const refused = await run(['install', '--tool', 'codex', '--home', home, '--apply']);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /refused \(hand-written; pass --force/);
  assert.equal(read(rule), 'my own rules\n');
  const forced = await run(['install', '--tool', 'codex', '--home', home, '--apply', '--force']);
  assert.equal(forced.code, 0);
  assert.match(read(rule), /^<!-- generated by orc\.mjs: codex\. Do not edit: /);
  const backup = fs.readdirSync(path.dirname(rule)).find((f) => f.startsWith('AGENTS.md.orc-backup-'));
  assert.equal(read(path.join(path.dirname(rule), backup)), 'my own rules\n');
  // A generated TOML agent (it carries the marker comment) with no manifest entry replaces without --force.
  fs.rmSync(path.join(home, '.codex', '.orc-manifest.codex.json'));
  const scout = path.join(home, '.codex', 'agents', 'scout.toml');
  fs.writeFileSync(scout, '# generated by orc.mjs: codex\nname = "scout"\n');
  const again = await run(['install', '--tool', 'codex', '--home', home, '--apply']);
  assert.equal(again.code, 0);
  assert.match(again.out, /applied replace: .*scout\.toml/);
});

test('V7: serialize quotes YAML-ambiguous scalars and writes empty lists as []', () => {
  const tricky = ['yes', 'No', 'ON', 'off', 'Y', 'true', 'FALSE', 'null', 'Null', '~', '42', '-7', '3.14', '1e3', '0x1F', '0o17', '012', '.inf',
    'ends:', '-lead', '?q', '*star', '&amp', '!bang', '|pipe', '>gt', '%pct', '@at', '`tick', "'sq", '"dq', 'a #b', 'a: b'];
  for (const s of tricky) {
    const out = serialize({ k: s }, '');
    assert.match(out, /^---\nk: "/, s);
    assert.equal(parse(out).data.k, s, s);
  }
  for (const s of ['haiku', 'gpt-6.2-sol', 'anthropic/claude-sonnet-5-5#high', 'Glob, Grep, Read, Bash', 'path:line']) {
    assert.match(serialize({ k: s }, ''), new RegExp(`k: ${s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\n`), s);
  }
  assert.match(serialize({ subagent: true, tools: [] }, ''), /subagent: true\ntools: \[\]\n/);
  assert.deepEqual(parse(serialize({ tools: [] }, '')).data.tools, []);
  // No golden has a bare `key:` line that is not followed by a list item.
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(REPO, 'tests', 'golden')).filter((f) => f.endsWith('.md'))) {
    const text = read(f);
    if (!text.startsWith('---\n')) continue;
    const lines = text.slice(4, text.indexOf('\n---\n', 3)).split('\n');
    lines.forEach((l, i) => {
      if (/^[\w-]+:$/.test(l)) assert.match(lines[i + 1] ?? '', /^ {2}- /, `${f}: bare ${l}`);
    });
  }
});

test('V8: the CLI runs through a directory junction', (t) => {
  const link = path.join(tempDir('junction'), 'repo');
  try {
    fs.symlinkSync(REPO, link, 'junction');
  } catch (e) {
    if (e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
    t.skip(`cannot create a directory link here (${e.code})`);
    return;
  }
  const r = spawnSync(process.execPath, [path.join(link, 'tools', 'orc.mjs'), 'check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /check ok/);
});

test('V9: BOM and UTF-16 input', async () => {
  const sample = 'gemini-3.8-flash-high  x\ngemini-3.8-flash-medium  x\ngemini-3.8-flash-low  x\n';
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(sample, 'utf16le')]);
  const be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(sample, 'utf16le').swap16()]);
  assert.equal(decodeText(le), sample);
  assert.equal(decodeText(be), sample);
  assert.equal(decodeText(Buffer.from(`﻿${sample}`)), sample);
  const r = await run(['models', '--tool', 'antigravity', '--from-stdin'], le);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).antigravity.headless.low, 'gemini-3.8-flash-low');

  const copy = copyRepo('bom');
  const local = JSON.stringify({ copilot: { high: { model: 'x-high' } } });
  fs.writeFileSync(path.join(copy, 'models.local.json'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(local, 'utf16le')]));
  assert.deepEqual(loadModels(copy).copilot.high, { model: 'x-high' });
  const scoutRole = path.join(copy, 'core', 'roles', 'scout.md');
  fs.writeFileSync(scoutRole, `﻿${read(scoutRole)}`);
  assert.equal(loadRoles(copy).find((x) => x.name === 'scout').tier, 'low');
});

test('V10: first differing line, including prefixes', () => {
  assert.equal(firstDiffLine('a\nb\nc', 'a\nb\nc'), 0);
  assert.equal(firstDiffLine('a\nb', 'a\nb\nc'), 3);
  assert.equal(firstDiffLine('a\nb\nc', 'a\nb'), 3);
  assert.equal(firstDiffLine('a\nx\nc', 'a\nb\nc'), 2);
  assert.equal(firstDiffLine('', 'a'), 1);
});

test('V10: check names the line when a golden file is a prefix of the build', async () => {
  const copy = copyRepo('prefix');
  const scout = path.join(copy, 'tests', 'golden', 'claude-code', '.claude', 'agents', 'scout.md');
  const lines = read(scout).split('\n');
  fs.writeFileSync(scout, lines.slice(0, 5).join('\n'));
  const r = await run(['check', '--repo', copy]);
  assert.match(r.err, /tests\/golden\/claude-code\/\.claude\/agents\/scout\.md: differs from the build at line 6 \(generated from core\/roles\/scout\.md; edit that, then run node tools\/orc\.mjs golden\)/);
});

test('D10: check reports a tests/golden/<id>/ folder that no adapter owns as stale', async () => {
  const copy = copyRepo('stale-golden-dir');
  fs.mkdirSync(path.join(copy, 'tests', 'golden', 'retired-tool'), { recursive: true });
  fs.writeFileSync(path.join(copy, 'tests', 'golden', 'retired-tool', 'AGENTS.md'), 'old\n');
  fs.mkdirSync(path.join(copy, 'tests', 'golden', 'empty-orphan'), { recursive: true });
  const r = await run(['check', '--repo', copy]);
  assert.equal(r.code, 1);
  assert.match(r.err, /^FAIL tests\/golden\/empty-orphan\/: stale \(no adapter owns it; remove it by hand\)$/m);
  assert.match(r.err, /^FAIL tests\/golden\/retired-tool\/: stale \(no adapter owns it; remove it by hand\)$/m);
});

test('D10: every test file importing main from tools/orc.mjs or spawning tools/orc.mjs calls isolateHome()', () => {
  // Files that run only home-independent commands (every path passed explicitly; never install/uninstall/sync/status/doctor/hooks).
  const HOME_INDEPENDENT = {
    'review-tools.test.mjs': 'runs only calibration, corpus and metrics with explicit --logs/--transcript/--out/--dir paths',
    'guard.test.mjs': 'imports only loadRoles from tools/orc.mjs and spawns the guard scripts, never an orc command; its git commits need the real home for the git identity',
  };
  const testsDir = path.join(REPO, 'tests');
  const files = fs.readdirSync(testsDir).filter((f) => f.endsWith('.test.mjs')).sort();
  assert.ok(files.length >= 10, 'found test files');
  const missing = [];
  for (const f of files) {
    if (Object.hasOwn(HOME_INDEPENDENT, f)) continue;
    const src = read(path.join(testsDir, f));
    const importsMain = /import\s*\{[^}]*\bmain\b[^}]*\}\s*from\s*['"][^'"]*tools\/orc\.mjs['"]/.test(src);
    const spawnsOrc = /\b(?:spawn|execFile)(?:Sync)?\b/.test(src) && /['"`]orc\.mjs['"`]|tools[\\/]orc\.mjs/.test(src);
    if ((importsMain || spawnsOrc) && !/^\s*(?:const\s+\w+\s*=\s*)?isolateHome\(\s*\)\s*;?/m.test(src)) {
      missing.push(f);
    }
  }
  assert.deepEqual(missing, [], `missing isolateHome() call: ${missing.join(', ')}`);
  for (const f of Object.keys(HOME_INDEPENDENT)) assert.ok(files.includes(f), `stale allow-list entry: ${f}`);
});
