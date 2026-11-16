import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../tools/orc.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORC = path.join(REPO, 'tools', 'orc.mjs');
const tempDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `orc-${name}-`));
const now = () => new Date(2026, 10, 15, 13, 5, 9);

async function run(argv) {
  const out = [];
  const err = [];
  const code = await main(argv, { out: (s) => out.push(s), err: (s) => err.push(s), stdin: () => '', now });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

function copyRepo() {
  const copy = tempDir('repo');
  for (const p of ['AGENTS.md', 'models.json', 'roles', 'adapters', 'profiles', 'tools/lib']) fs.cpSync(path.join(REPO, p), path.join(copy, p), { recursive: true });
  return copy;
}

// Every file under dir, home-relative with forward slashes.
function tree(dir) {
  return fs.readdirSync(dir, { recursive: true }).map((f) => f.replace(/\\/g, '/')).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort();
}

const agy = (home, repo, ...rest) => run(['install', '--tool', 'antigravity', '--home', home, '--repo', repo, ...rest]);

test('manifest: written on apply; a role edit re-installs without --force; a hand edit is refused, then forced', async () => {
  const home = tempDir('mf');
  const repo = copyRepo();
  assert.equal((await agy(home, repo, '--apply')).code, 0);
  const mf = JSON.parse(fs.readFileSync(path.join(home, '.gemini', '.orc-manifest.antigravity.json'), 'utf8'));
  assert.equal(mf.tool, 'antigravity');
  assert.equal(mf.version, 1);
  assert.ok(mf.files['.gemini/config/agents/scout.md'].sha256.match(/^[0-9a-f]{64}$/));
  assert.deepEqual(tree(home).filter((f) => f.includes('.tmp-')), [], 'no temp file left');
  fs.appendFileSync(path.join(repo, 'roles', 'scout.md'), '\nOne more line.\n');
  const re = await agy(home, repo, '--apply');
  assert.equal(re.code, 0, re.err);
  assert.match(re.out, /applied replace: .*scout\.md/);
  const scout = path.join(home, '.gemini', 'config', 'agents', 'scout.md');
  fs.writeFileSync(scout, `${fs.readFileSync(scout, 'utf8')}hand edit\n`);
  const before = tree(home);
  const refused = await agy(home, repo, '--apply');
  assert.equal(refused.code, 1);
  assert.match(refused.err, /refused \(edited since install; pass --force/);
  assert.deepEqual(tree(home), before, 'nothing written');
  assert.match((await agy(home, repo)).out, /would REPLACE EDITED .*scout\.md/);
  assert.equal((await agy(home, repo, '--apply', '--force')).code, 0);
  assert.doesNotMatch(fs.readFileSync(scout, 'utf8'), /hand edit/);
  assert.ok(tree(home).some((f) => /scout\.md\.orc-backup-20261115-130509/.test(f)));
  const st = await run(['status', '--tool', 'antigravity', '--home', home, '--repo', repo]);
  assert.equal(st.code, 0, st.out);
});

test('manifest: a removed role is deleted on re-install, kept when edited; status names both', async () => {
  const home = tempDir('mf-rm');
  const repo = copyRepo();
  assert.equal((await agy(home, repo, '--apply')).code, 0);
  const agents = path.join(home, '.gemini', 'config', 'agents');
  fs.rmSync(path.join(repo, 'roles', 'scout.md'));
  fs.rmSync(path.join(repo, 'roles', 'researcher.md'));
  fs.appendFileSync(path.join(agents, 'researcher.md'), 'mine\n');
  const st = await run(['status', '--tool', 'antigravity', '--home', home, '--repo', repo]);
  assert.equal(st.code, 1);
  assert.match(st.out, /stale \(role removed\): .*scout\.md/);
  const dry = await agy(home, repo);
  assert.match(dry.out, /would delete \(role removed\): .*scout\.md/);
  assert.match(dry.out, /would keep \(role removed, edited since install\): .*researcher\.md/);
  assert.ok(fs.existsSync(path.join(agents, 'scout.md')), 'dry run deletes nothing');
  const ap = await agy(home, repo, '--apply');
  assert.equal(ap.code, 0, ap.err);
  assert.ok(!fs.existsSync(path.join(agents, 'scout.md')));
  assert.ok(fs.existsSync(path.join(agents, 'researcher.md')));
});

test('status: one extra file alone makes it out of date and says not installed by orc', async () => {
  const home = tempDir('mf-extra');
  assert.equal((await run(['install', '--tool', 'antigravity', '--home', home, '--apply'])).code, 0);
  fs.writeFileSync(path.join(home, '.gemini', 'config', 'agents', 'mine.md'), 'x\n');
  const st = await run(['status', '--tool', 'antigravity', '--home', home]);
  assert.equal(st.code, 1, st.out);
  assert.match(st.out, /extra: .*mine\.md \(not installed by orc\)/);
  assert.doesNotMatch(st.out, /differs|missing|stale/);
});

test('uninstall: shared .gemini keeps two manifests; uninstalling one leaves the other; HOME stays empty', async () => {
  const home = tempDir('mf-un');
  const fakeHome = tempDir('fakehome');
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
  const cli = (...a) => spawnSync(process.execPath, [ORC, ...a, '--home', home], { env, encoding: 'utf8' });
  assert.match(cli('uninstall', '--tool', 'antigravity').stderr, /no install manifest .*by hand/);
  assert.equal(cli('install', '--tool', 'antigravity', '--apply').status, 0);
  assert.equal(cli('install', '--tool', 'gemini-cli', '--apply').status, 0);
  assert.ok(fs.existsSync(path.join(home, '.gemini', '.orc-manifest.antigravity.json')));
  assert.ok(fs.existsSync(path.join(home, '.gemini', '.orc-manifest.gemini-cli.json')));
  const gemini = tree(home).filter((f) => f.includes('GEMINI.md') || f.startsWith('.gemini/agents/') || f.includes('gemini-cli'));
  fs.appendFileSync(path.join(home, '.gemini', 'config', 'agents', 'refuter.md'), 'mine\n');
  const before = tree(home);
  const dry = cli('uninstall', '--tool', 'antigravity');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /would delete: .*scout\.md/);
  assert.match(dry.stdout, /would keep \(edited since install.*refuter\.md/);
  assert.deepEqual(tree(home), before, 'dry run deletes nothing');
  const ap = cli('uninstall', '--tool', 'antigravity', '--apply');
  assert.equal(ap.status, 0, ap.stderr);
  assert.deepEqual(tree(home), [...gemini, '.gemini/config/agents/refuter.md'].sort());
  assert.ok(!fs.existsSync(path.join(home, '.gemini', '.orc-manifest.antigravity.json')));
  assert.equal(cli('status', '--tool', 'gemini-cli').status, 0);
  assert.match(spawnSync(process.execPath, [ORC, 'uninstall', '--tool', 'claude-code'], { env, encoding: 'utf8' }).stderr, /without --home/);
  assert.deepEqual(fs.readdirSync(fakeHome), [], 'the isolated HOME stays empty');
});

test('uninstall --force deletes edited files after a backup and removes the empty dirs it created', async () => {
  const home = tempDir('mf-force');
  assert.equal((await run(['install', '--tool', 'codex', '--home', home, '--apply'])).code, 0);
  fs.writeFileSync(path.join(home, 'keep.txt'), 'x');
  const rule = path.join(home, '.codex', 'AGENTS.md');
  fs.appendFileSync(rule, 'mine\n');
  const r = await run(['uninstall', '--tool', 'codex', '--home', home, '--apply', '--force']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(tree(home), ['.codex/AGENTS.md.orc-backup-20261115-130509', 'keep.txt']);
  assert.ok(!fs.existsSync(path.join(home, '.codex', 'agents')), 'empty agents dir removed');
});

test('a corrupt or foreign manifest is rejected and nothing is deleted or followed outside --home', async () => {
  const outside = tempDir('victim');
  const victim = path.join(outside, 'victim.md');
  const bad = [
    'not json',
    JSON.stringify({ tool: 'codex', version: 1, files: {} }),
    ...['../victim.md', '.gemini/../../victim.md', victim.replace(/\\/g, '/'), 'C:/x.md', '.gemini\\..\\..\\victim.md', '/etc/x', 'other/x.md'].map((p) =>
      JSON.stringify({ tool: 'antigravity', version: 1, files: { [p]: { sha256: '0'.repeat(64) } } })),
  ];
  for (const text of bad) {
    const home = tempDir('mf-bad');
    assert.equal((await run(['install', '--tool', 'antigravity', '--home', home, '--apply'])).code, 0);
    fs.writeFileSync(victim, 'keep me\n');
    const mfile = path.join(home, '.gemini', '.orc-manifest.antigravity.json');
    fs.writeFileSync(mfile, text);
    const before = tree(home);
    for (const argv of [['uninstall', '--apply', '--force'], ['install', '--apply', '--force']]) {
      const r = await run([...argv, '--tool', 'antigravity', '--home', home]);
      assert.equal(r.code, 1, `${text}: ${argv[0]}`);
    }
    assert.deepEqual(tree(home), before, text);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'keep me\n');
    assert.match((await run(['status', '--tool', 'antigravity', '--home', home])).err, /WARN .*ignoring it/);
  }
});
