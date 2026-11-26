import { test } from 'node:test';
import { isolateHome } from './helpers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { main, loadModels, loadRoles } from '../tools/orc.mjs';
import { parseMarchingOrders, briefTemplate, lintBrief } from '../tools/lib/brief.mjs';
import { classify } from '../tools/lib/reviewtier.mjs';
import { costlog, dispatchRows } from '../tools/lib/costlog.mjs';
import { mergeHooks, formatLike, setAntigravityGuard, antigravityGuardScript, antigravityGuardEntry } from '../tools/lib/hooks.mjs';
import { killTree, runDispatch } from '../tools/lib/dispatch.mjs';
import { run as reminder } from '../tools/board-reminder.mjs';
import { q } from './helpers.mjs';

// No test in this file can reach the real home folder: commands that default --home use this scratch one.
isolateHome();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORC = path.join(REPO, 'tools', 'orc.mjs');
const AGENTS = fs.readFileSync(path.join(REPO, 'core', 'AGENTS.md'), 'utf8').replace(/\r\n/g, '\n');
const tempDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `orc-${name}-`));
// No test reads this machine's ~/.orc: the shared state home is an empty scratch folder, which children inherit.
process.env.ORC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'orc-data-'));

async function run(argv) {
  const out = [];
  const err = [];
  const code = await main(argv, { out: (s) => out.push(s), err: (s) => err.push(s), stdin: () => '' });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

// An environment in which dispatch can never start a real claude, agy or codex: PATH holds no agent CLI (System32
// stays for taskkill), the Antigravity install folder (%LOCALAPPDATA%/agy/bin) is scratch, and no ORC_TOOL_BIN_* is
// inherited; the stubs come in through `extra`.
function agentFree(env, extra = {}) {
  const out = { ...env };
  const set = (key, value) => {
    for (const k of Object.keys(out)) if (k.toLowerCase() === key.toLowerCase()) delete out[k];
    out[key] = value;
  };
  for (const k of Object.keys(out)) if (k.startsWith('ORC_TOOL_BIN_') || k === 'ORC_HEADLESS') delete out[k];
  set('PATH', [tempDir('nopath'), ...(process.platform === 'win32' ? [path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32')] : [])].join(path.delimiter));
  set('LOCALAPPDATA', tempDir('localappdata'));
  for (const [k, v] of Object.entries(extra)) set(k, v);
  return out;
}

// A child CLI with HOME and USERPROFILE on an empty scratch dir that must stay empty. A dispatch runs agent-free.
function isolated(argv, extraEnv = {}) {
  const fakeHome = tempDir('fakehome');
  const base = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
  const env = argv[0] === 'dispatch' ? agentFree(base, extraEnv) : { ...base, ...extraEnv };
  const r = spawnSync(process.execPath, [ORC, ...argv], { env, encoding: 'utf8', timeout: 60000 });
  assert.deepEqual(fs.readdirSync(fakeHome), [], 'scratch home stays empty');
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// The same as `isolated`, without blocking, so several runs can wait side by side; killed after `killMs`. Resolves to
// {code, out, err, ms}, `ms` being how long the run took.
function isolatedAsync(argv, extraEnv = {}, killMs = 20000) {
  const fakeHome = tempDir('fakehome');
  const base = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
  const env = argv[0] === 'dispatch' ? agentFree(base, extraEnv) : { ...base, ...extraEnv };
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ORC, ...argv], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (c) => (out += c));
    child.stderr.setEncoding('utf8').on('data', (c) => (err += c));
    const timer = setTimeout(() => child.kill(), killMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      assert.deepEqual(fs.readdirSync(fakeHome), [], 'scratch home stays empty');
      resolve({ code, out, err, ms: Date.now() - t0 });
    });
  });
}

// A brief that passes lint for any role: every rulebook item, filled.
function goodBrief(extra = {}) {
  const fill = {
    1: 'Find where the session doc is written.',
    2: 'tools/orc.mjs',
    3: 'May change nothing; must not change anything.',
    4: 'Run `npm test`.',
    5: 'Do not edit files.',
    6: 'Paths only, cap 20 lines.',
    7: 'The board CLI is local/board.js.',
    8: 'scratch/scout-board.md',
    9: 'none: a tooling change with no ticket.',
    10: 'The real sessions collection.',
    11: 'BOARD: http://localhost:8377 card cards/c1 stage Build',
    ...extra,
  };
  return parseMarchingOrders(AGENTS)
    .map((it, i) => `${i + 1}. ${it.text}\n   ${fill[i + 1]}`)
    .join('\n');
}

// ---------- brief ----------

test('brief new follows the core/AGENTS.md list, also after the list changes', async () => {
  const items = parseMarchingOrders(AGENTS);
  assert.equal(items.length, 11);
  const r = await run(['brief', 'new', '--role', 'builder']);
  assert.equal(r.code, 0, r.err);
  for (const it of items) assert.ok(r.out.includes(`${it.n}. ${it.text}`), it.label);
  const scout = await run(['brief', 'new', '--role', 'scout']);
  assert.ok(!scout.out.includes('Intent') && !scout.out.includes('Data precondition') && !scout.out.includes('BOARD:'), 'items 9 to 11 only for writers');
  const refuter = await run(['brief', 'new', '--role', 'refuter']);
  assert.match(refuter.out, /^9\. \*\*Intent\*\* \(refuters; builders and debuggers write `n\/a`\)/m);
  assert.match(refuter.out, /^9\. .*\n {3}<fill in>$/m);
  assert.match(refuter.out, /^10\. \*\*Data precondition\*\*/m);
  assert.match(r.out, /^9\. .*\n {3}n\/a$/m, 'a builder template prefills Intent with n/a');
  assert.match(scout.out, /^8\. \*\*Scratch path\*\*/m);

  const copy = tempDir('brief');
  fs.cpSync(path.join(REPO, 'core', 'roles'), path.join(copy, 'core', 'roles'), { recursive: true });
  // The root AGENTS.md is the contributor file with no "Marching orders": brief never reads it.
  fs.writeFileSync(path.join(copy, 'AGENTS.md'), '# Contributing\n\nShort rules for this repo.\n');
  fs.writeFileSync(path.join(copy, 'core', 'AGENTS.md'), AGENTS.replace('5. **Do not**: known traps.', '5. **Do not**: known traps and the new rule.\n6. **Budget**: one line.').replace(/^6\. \*\*Output/m, '7. **Output'));
  const mutated = await run(['brief', 'new', '--repo', copy]);
  assert.equal(mutated.code, 0, mutated.err);
  assert.match(mutated.out, /5\. \*\*Do not\*\*: known traps and the new rule\./);
  assert.match(mutated.out, /6\. \*\*Budget\*\*: one line\./);
  assert.equal(await run(['brief', 'new', '--role', 'nobody']).then((x) => x.code), 1);
});

test('brief lint: a filled brief passes; one test per rule', async () => {
  const items = parseMarchingOrders(AGENTS);
  assert.deepEqual(lintBrief(goodBrief(), items, 'builder'), []);
  assert.deepEqual(lintBrief(goodBrief(), items), []);
  // The template itself is empty everywhere.
  assert.match(lintBrief(briefTemplate(items, 'builder'), items, 'builder').join('\n'), /item 1 \(Goal\) is empty/);
  // Missing item.
  const noKnown = goodBrief().split('\n').filter((l, i, a) => !/^7\. /.test(l) && !(i > 0 && /^7\. /.test(a[i - 1]))).join('\n');
  assert.match(lintBrief(noKnown, items, 'builder').join('\n'), /item 7 \(Known\) should be Known|numbered/);
  const short = goodBrief().split('\n').slice(0, 10).join('\n');
  assert.match(lintBrief(short, items, 'scout').join('\n'), /item 6 \(Output format and cap\) is missing/);
  // Out of order.
  const swapped = goodBrief().replace(/^2\. /m, '3. ').replace(/^3\. \*\*May/m, '2. **May');
  assert.match(lintBrief(swapped, items, 'builder').join('\n'), /item 2 .*numbered 3/);
  // Empty item.
  assert.match(lintBrief(goodBrief({ 5: '<fill in>' }), items).join('\n'), /item 5 \(Do not\) is empty/);
  // Item 4 names no command.
  assert.match(lintBrief(goodBrief({ 4: 'confirm it works' }), items).join('\n'), /item 4 \(Must verify\) names no command/);
  // Item 6 states no cap.
  assert.match(lintBrief(goodBrief({ 6: 'a short report' }), items).join('\n'), /item 6 \(Output format and cap\) states no cap/);
  // BOARD line shape.
  assert.match(lintBrief(goodBrief({ 11: 'BOARD: http://localhost:8377 card c1 stage Build' }), items).join('\n'), /BOARD line does not match/);
  assert.deepEqual(lintBrief(goodBrief({ 11: 'BOARD: https://claude.ai/artifact/x slug 1234 card cards/imp-i3 stage Build' }), items), []);
  // Writer roles require items 9 to 11.
  const eight = goodBrief().split('\n').slice(0, 16).join('\n');
  assert.deepEqual(lintBrief(eight, items, 'scout'), []);
  assert.match(lintBrief(eight, items, 'builder').join('\n'), /item 9 \(Intent\) is missing/);
  // Intent: a refuter needs a value; builders and debuggers may write n/a.
  assert.deepEqual(lintBrief(goodBrief({ 9: 'n/a' }), items, 'builder'), []);
  assert.deepEqual(lintBrief(goodBrief({ 9: 'n/a' }), items, 'debugger'), []);
  assert.match(lintBrief(goodBrief({ 9: 'n/a' }), items, 'refuter').join('\n'), /item 9 \(Intent\) needs a value for a refuter/);
  assert.match(lintBrief(goodBrief({ 9: 'none' }), items, 'refuter').join('\n'), /item 9 \(Intent\) needs a value for a refuter/);
  assert.match(lintBrief(goodBrief({ 9: 'none:' }), items, 'refuter').join('\n'), /item 9 \(Intent\) needs a value for a refuter/);
  assert.match(lintBrief(goodBrief({ 9: '<fill in>' }), items, 'refuter').join('\n'), /item 9 \(Intent\) is empty/);
  assert.deepEqual(lintBrief(goodBrief(), items, 'refuter'), [], 'none: <why> passes');
  const inline = (v) => goodBrief().replace(/^9\. .*\n.*$/m, `9. **Intent** (refuters): ${v}`);
  assert.match(lintBrief(inline('n/a'), items, 'refuter').join('\n'), /item 9 \(Intent\) needs a value for a refuter/, 'inline label form');
  assert.match(lintBrief(inline(''), items, 'refuter').join('\n'), /item 9 \(Intent\) needs a value for a refuter/, 'label kept, value empty');
  assert.deepEqual(lintBrief(inline('none: no ticket'), items, 'refuter'), []);
  assert.deepEqual(lintBrief(inline('n/a'), items, 'builder'), []);
  assert.deepEqual(lintBrief(goodBrief({ 9: 'scratch/ticket-brief.md' }), items, 'refuter'), []);
  const noIntent = goodBrief().split('\n').filter((l, i, a) => !/^9\. /.test(l) && !(i > 0 && /^9\. /.test(a[i - 1])))
    .join('\n').replace(/^10\. /m, '9. ').replace(/^11\. /m, '10. ');
  assert.match(lintBrief(noIntent, items, 'refuter').join('\n'), /item 9 should be Intent, found "[^"]*"; Intent is new at item 9, so renumber the items after it/);
  assert.match(lintBrief(noIntent, items, 'builder').join('\n'), /Intent is new at item 9/);
  for (const v of ['TBD', 'todo', 'none - no ticket', 'None no ticket']) {
    assert.match(lintBrief(goodBrief({ 9: v }), items, 'refuter').join('\n'), /item 9 \(Intent\) needs a value for a refuter/, v);
    assert.deepEqual(lintBrief(goodBrief({ 9: v }), items, 'builder'), [], `builder: ${v}`);
  }
  assert.deepEqual(lintBrief(goodBrief({ 9: 'None: tooling only' }), items, 'refuter'), []);
  const doubleColon = goodBrief().replace(/^9\. .*\n.*$/m, '9. **Intent**: (refuters): TBD');
  assert.match(lintBrief(doubleColon, items, 'refuter').join('\n'), /item 9 \(Intent\) needs a value for a refuter/, 'label colon, then "(refuters):"');
  assert.match(lintBrief(goodBrief({ 9: 'TBD - later' }), items, 'refuter').join('\n'), /item 9 \(Intent\) needs a value for a refuter/, 'placeholder with a trailing note');
  assert.deepEqual(lintBrief(goodBrief({ 9: 'todo/ticket-brief.md' }), items, 'refuter'), [], 'a path that starts with a placeholder word');
  for (const v of ['todo-app/ticket-brief.md', 'tbd-notes/brief.md', 'tba.md', 'n/a-cases/brief.md']) {
    assert.deepEqual(lintBrief(goodBrief({ 9: v }), items, 'refuter'), [], `a path that starts with a placeholder word: ${v}`);
  }
  for (const v of ['TBD.', 'todo:', 'tba - later', 'n/a, no ticket']) {
    assert.match(lintBrief(goodBrief({ 9: v }), items, 'refuter').join('\n'), /item 9 \(Intent\) needs a value for a refuter/, v);
  }
  // Free-form labels in the orders' own style pass.
  const caps = goodBrief().replace(/^1\. .*$/m, '1. GOAL').replace(/^ {3}Find where.*$/m, '   Find it.');
  assert.deepEqual(lintBrief(caps, items), []);
  // CLI exit codes.
  const dir = tempDir('lint');
  fs.writeFileSync(path.join(dir, 'bad.md'), goodBrief({ 4: 'nothing' }));
  const bad = await run(['brief', 'lint', path.join(dir, 'bad.md')]);
  assert.equal(bad.code, 1);
  assert.equal(bad.err.split('\n').length, 1, 'one line per problem');
});

// ---------- review-tier ----------

function git(dir, ...a) {
  const r = spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, `${a.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
function repoWith(files) {
  const dir = tempDir('tier');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'core.autocrlf', 'false');
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'branch', 'base');
  return dir;
}
function commit(dir, change) {
  change(dir);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'change');
}

test('review-tier on real git repositories', async () => {
  const start = { 'src/app.js': 'x\n', 'tests/a.test.js': 'a\n', 'README.md': 'r\n', 'docs/guide.txt': 'g\n' };
  const tier = async (dir) => run(['review-tier', '--base', 'base', '--repo-dir', dir]);

  const tests = repoWith(start);
  commit(tests, (d) => {
    fs.writeFileSync(path.join(d, 'tests/a.test.js'), 'b\n');
    fs.writeFileSync(path.join(d, 'src/b.spec.ts'), 's\n');
    fs.writeFileSync(path.join(d, 'pkg_test.go'), 't\n');
  });
  let r = await tier(tests);
  assert.match(r.out, /^Light-eligible: all 3 changed path\(s\) are tests or docs/);
  assert.match(r.out, /refuter ACCEPT after mutation checks/);

  const docs = repoWith(start);
  commit(docs, (d) => {
    fs.writeFileSync(path.join(d, 'README.md'), 'r2\n');
    fs.writeFileSync(path.join(d, 'docs/guide.txt'), 'g2\n');
  });
  assert.match((await tier(docs)).out, /^Light-eligible/);

  const mixed = repoWith(start);
  commit(mixed, (d) => {
    fs.writeFileSync(path.join(d, 'tests/a.test.js'), 'b\n');
    fs.writeFileSync(path.join(d, 'src/app.js'), 'y\n');
  });
  r = await tier(mixed);
  assert.match(r.out, /^Full: not tests or docs: src\/app\.js$/m);
  assert.doesNotMatch(r.out, /ACCEPT/);

  const deleted = repoWith(start);
  commit(deleted, (d) => fs.rmSync(path.join(d, 'src/app.js')));
  assert.match((await tier(deleted)).out, /^Full: not tests or docs: src\/app\.js/);

  const renamed = repoWith(start);
  commit(renamed, (d) => {
    fs.mkdirSync(path.join(d, 'tests/moved'), { recursive: true });
    fs.renameSync(path.join(d, 'src/app.js'), path.join(d, 'tests/moved/app.js'));
  });
  assert.match((await tier(renamed)).out, /^Full: not tests or docs: src\/app\.js/, 'a rename counts its old path');

  assert.match(classify(['a', 'b', 'c', 'd', 'e']).reason, /a, b, c and 2 more/);
  assert.equal((await run(['review-tier', '--base', 'nope', '--repo-dir', tests])).code, 1);
});

// ---------- costlog ----------

// Real shapes from the Dashboard README "Data contract": two cards, a rework and a commit.
const SID = '2026-11-15-orc-improvements';
const EXPORT = {
  sessions: {
    [SID]: {
      title: 'Orc improvements', ticket: '', branch: 'generic-core', status: 'Done', started: '2026-11-15T09:00:00-05:00',
      updated: '2026-11-15T12:00:00-05:00', now: 'done', completed: '2026-11-15T12:00:00-05:00',
      events: [
        { at: '2026-11-15T09:00:00-05:00', text: 'Plan: two tasks' },
        { at: '2026-11-15T09:05:00-05:00', text: 'builder dispatched on #i2', card: 'imp-i2' },
        { at: '2026-11-15T09:10:00-05:00', text: 'scout dispatched on #i3', card: 'imp-i3', sub: [{ at: '2026-11-15T09:12:00-05:00', text: 'check-in' }] },
        { at: '2026-11-15T09:20:00-05:00', text: 'scout done: 4 paths', card: 'imp-i3' },
        { at: '2026-11-15T09:50:00-05:00', text: 'builder done: 39 tests pass', card: 'imp-i2' },
        { at: '2026-11-15T09:55:00-05:00', text: 'refuter dispatched on #i2', card: 'imp-i2' },
        { at: '2026-11-15T10:25:00-05:00', text: 'refuter REWORK: 2 must-fixes', card: 'imp-i2' },
        { at: '2026-11-15T10:30:00-05:00', text: 'builder dispatched on #i2', card: 'imp-i2' },
        { at: '2026-11-15T10:45:00-05:00', text: 'builder rework done', card: 'imp-i2' },
        { at: '2026-11-15T10:50:00-05:00', text: 'Commit 1ee6591', card: 'imp-i2' },
        { at: '2026-11-15T11:00:00-05:00', text: 'builder dispatched on #i3', card: 'imp-i3' },
        { bad: true },
      ],
    },
    other: { title: 'x', events: [{ at: '2026-11-15T09:00:00-05:00', text: 'builder dispatched on #z', card: 'z' }] },
  },
  cards: {
    'imp-i2': {
      session: SID, order: 1, ticket: '', task: 'i2', kind: 'Task', title: 'Install manifest', agent: 'builder', tokens: 120000,
      commit: '1ee6591', note: 'done', updated: '2026-11-15T10:50:00-05:00',
      stages: [{ label: 'Build', state: 'done' }, { label: 'Refute', state: 'rework', started: '2026-11-15T10:25:00-05:00' }, { label: 'Commit', state: 'done' }],
      progress: [{ at: '2026-11-15T09:30:00-05:00', text: 'build green' }],
    },
    'imp-i3': {
      session: SID, order: 2, task: 'i3', kind: 'Task', title: 'Method tooling', agent: 'builder', tokens: 30000,
      stages: [{ label: 'Build', state: 'active', started: '2026-11-15T11:00:00-05:00' }], progress: [],
    },
    z: { session: 'other', order: 1, title: 'not this session', tokens: 999 },
  },
};

test('costlog rows, spans and per-card tokens from a real-shaped export', async () => {
  const rows = dispatchRows(EXPORT.sessions[SID]);
  assert.deepEqual(rows.map((r) => [r.agent, r.card, r.minutes, r.result]), [
    ['builder', 'imp-i2', 45, 'builder done: 39 tests pass'],
    ['scout', 'imp-i3', 10, 'scout done: 4 paths'],
    ['refuter', 'imp-i2', 30, 'refuter REWORK: 2 must-fixes'],
    ['builder', 'imp-i2', 15, 'builder rework done'],
    ['builder', 'imp-i3', null, null],
  ]);
  const dir = tempDir('cost');
  const file = path.join(dir, 'export.json');
  fs.writeFileSync(file, JSON.stringify(EXPORT));
  const out = path.join(dir, 'draft.md');
  const r = await run(['costlog', '--session', SID, '--board-export', file, '--out', out]);
  assert.equal(r.code, 0, r.err);
  const md = fs.readFileSync(out, 'utf8');
  for (const h of ['- Date: 2026-11-15', '- Project: TODO', '- Branch: generic-core', '- Task: Orc improvements', '- Outcome: TODO']) assert.ok(md.includes(h), h);
  assert.match(md, /\| # \| Agent \| Model \| Purpose \| Card \| Start \| Tokens \| Tools \| Time \| Result \| Value \|/);
  assert.match(md, /\| 1 \| builder \| TODO \| Install manifest \| imp-i2 \| 2026-11-15T09:05:00-05:00 \| see card \| TODO \| 45 \| builder done: 39 tests pass \| TODO \|/);
  assert.match(md, /\| 5 \| builder \| TODO \| Method tooling \| imp-i3 .* \| TODO \(no end event\) \|/);
  assert.match(md, /per card, not per dispatch/);
  assert.match(md, /\| imp-i2 \| Install manifest \| builder \| 3 \| 120000 \| 1ee6591 \| Build: done, Refute: rework, Commit: done \|/);
  assert.match(md, /\| imp-i3 \| Method tooling \| builder \| 2 \| 30000 \|/);
  assert.doesNotMatch(md, /999|not this session/);
  assert.doesNotMatch(md, /\b60000\b|\b40000\b/, 'tokens are never split across dispatches');
  assert.match(md, /- Tokens: 150000/);
  assert.match(md, /- Wall clock: 100 min across 5 dispatch\(es\); 1 without an end event/);
  assert.match(md, /Orchestrator context: TODO/);
  assert.match(md, /## Loop signal\n\nTODO \(board events mentioning rework: 2\)/);
  assert.match(md, /## Loop signal\n\nTODO [^\n]*\n\n- Escaped defects: TODO \(one line per defect found after the loop accepted: what, who caught it, why the loop missed it; or none\)\n\n## Spec misses/);
  assert.match(md, /## Spec misses\n\nTODO/);
  assert.equal((await run(['costlog', '--session', 'missing', '--board-export', file])).code, 1);
  assert.equal((await run(['costlog', '--session', SID])).code, 1);
  assert.equal((await run(['costlog', '--session', SID, '--board-export', file, '--board', 'http://localhost:1'])).code, 1);
  assert.equal(costlog(EXPORT, SID).includes('TODO'), true);
});

test('the cost-log template follows the Record format in orchestration/README.md', () => {
  const readme = fs.readFileSync(path.join(REPO, 'orchestration', 'README.md'), 'utf8').replace(/\r\n/g, '\n');
  const template = fs.readFileSync(path.join(REPO, 'orchestration', 'log', 'TEMPLATE.md'), 'utf8').replace(/\r\n/g, '\n');
  const record = readme.split('## Record format')[1].split('\n## ')[0];
  const columns = [...record.matchAll(/^\| (.+?) \| .+ \|$/gm)].map((m) => m[1].replace(/`/g, '')).filter((c) => c !== 'Column' && !/^-+$/.test(c));
  const header = template.split('\n').find((l) => l.startsWith('| # |'));
  assert.deepEqual(header.split('|').slice(1, -1).map((c) => c.trim()), columns, 'one column per Record format column, in order');
  assert.doesNotMatch(header, /\bCard\b|\bStart\b/, 'Card and Start are draft-only columns from costlog');
  for (const h of ['- Date:', '- Project:', '- Branch:', '- Task:', '- Outcome:', '## Totals', 'Orchestrator context:', '## Loop signal', 'Escaped defects:', '## Spec misses']) assert.ok(template.includes(h), h);
});

test('.gitignore: a standard deny-list; the cost-log template and every source stay tracked', () => {
  // --no-index judges the rules alone, whatever the index holds; exit 0 = ignored, 1 = not ignored.
  const ignored = (p) => {
    const r = spawnSync('git', ['check-ignore', '--no-index', '-q', p], { cwd: REPO, encoding: 'utf8' });
    assert.ok(r.status === 0 || r.status === 1, `git check-ignore ${p}: exit ${r.status} ${r.stderr}`);
    return r.status === 0;
  };
  assert.equal(ignored('orchestration/log/TEMPLATE.md'), false, 'the template is tracked');
  assert.equal(ignored('orchestration/log/2026-01-01-x.md'), true, 'a cost log stays local');
  assert.equal(ignored('orchestration/log/anomalies.md'), true, 'the anomaly log stays local');
  for (const p of ['node_modules/x/index.js', 'tools/node_modules/x.js', 'dist/codex/.codex/AGENTS.md', 'models.local.json', 'board.local.md', 'CLAUDE.local.md', 'docs/CLAUDE.local.md', '.env', '.env.local', 'sub/.env.production', '.orc/reviews/run.md', 'orchestration/board/index.html',
    '.claude/settings.local.json', '.claude/worktrees/a/x.md', '.claude/skills/mine/SKILL.md', '.agents/settings.json', '.agents/skills/mine/SKILL.md', '.vscode/settings.json', '.idea/x.xml', 'a.swp', 'notes.md~', '.DS_Store', 'docs/Thumbs.db', 'desktop.ini']) {
    assert.equal(ignored(p), true, `${p} is ignored`);
  }
  for (const p of ['AGENTS.md', 'CLAUDE.md', 'core/AGENTS.md', 'core/roles/scout.md', '.claude/skills/ship-prompts/SKILL.md', '.agents/skills/ship-prompts/SKILL.md', 'tests/golden/claude-code/.claude/CLAUDE.md',
    'tests/golden/claude-code/.claude/agents/scout.md', 'core/procedures.mjs', 'adapters/claude-code/skills/orc-permissions/SKILL.md', 'extras/worklog/worklog.ps1', 'orchestration/brief.md', 'orchestration/sprint/make-story.mjs', 'tools/orc.mjs', 'orchestration/README.md', 'docs/board.local.md', 'new-top-level-file.md']) {
    assert.equal(ignored(p), false, `${p} can be tracked`);
  }
  // No tracked file is matched by an ignore rule.
  const tracked = spawnSync('git', ['ls-files', '-ci', '--exclude-standard'], { cwd: REPO, encoding: 'utf8' });
  assert.equal(tracked.status, 0, tracked.stderr);
  assert.equal(tracked.stdout, '');
});

test('costlog --board reads through the board CLI export', async () => {
  const boardRepo = tempDir('boardrepo');
  fs.mkdirSync(path.join(boardRepo, 'local'));
  // A stand-in CLI: prints the export only for `export` with the port from --board.
  fs.writeFileSync(path.join(boardRepo, 'local', 'board.js'),
    `if (process.argv[2] !== 'export' || process.env.ORC_BOARD_PORT !== '8399') { console.error('bad call'); process.exit(1); }\nprocess.stdout.write(${JSON.stringify(JSON.stringify(EXPORT))});\n`);
  const r = await run(['costlog', '--session', SID, '--board', 'http://localhost:8399', '--board-repo', boardRepo]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /\| 1 \| builder \|/);
});

// ---------- dispatch ----------

function briefFile(text = goodBrief()) {
  const f = path.join(tempDir('brief'), 'brief.md');
  fs.writeFileSync(f, text);
  return f;
}

test('dispatch --dry-run prints the argv for antigravity and claude-code', () => {
  const brief = briefFile();
  const models = loadModels(REPO);
  const agy = isolated(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', brief, '--dry-run']);
  assert.equal(agy.code, 0, agy.err);
  const slug = models.antigravity.headless.low;
  assert.ok(agy.out.includes(` -p ${JSON.stringify(fs.readFileSync(brief, 'utf8'))} --agent scout --model ${slug} --output-format json --disable-slash-commands\n`), agy.out);
  assert.match(agy.out, /stdin: none/);
  const cc = isolated(['dispatch', '--tool', 'claude-code', '--role', 'builder', '--brief', brief, '--dry-run']);
  assert.equal(cc.code, 0, cc.err);
  assert.match(cc.out, new RegExp(` -p --agent builder --model ${models['claude-code'].high.model}\\n`));
  assert.match(cc.out, /stdin: \d+ bytes \(the brief\)\n/);
});

test('dispatch refuses a tool without a recipe and a failing brief', () => {
  const good = briefFile();
  for (const tool of ['cursor', 'copilot', 'gemini-cli', 'opencode']) {
    const r = isolated(['dispatch', '--tool', tool, '--role', 'scout', '--brief', good, '--dry-run']);
    assert.equal(r.code, 1);
    assert.match(r.err, new RegExp(`no headless recipe for ${tool}`));
  }
  const bad = briefFile(goodBrief({ 4: 'just check' }));
  const r = isolated(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', bad, '--dry-run']);
  assert.equal(r.code, 1);
  assert.match(r.err, /names no command[\s\S]*dispatch refused: the brief fails lint/);
  assert.equal(isolated(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', bad, '--dry-run', '--no-lint']).code, 0);
  assert.match(isolated(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', good, '--timeout', 'x', '--dry-run']).err, /--timeout needs a whole number of seconds from 1 to 86400, got x/);
});

// The stub stands in for agy/claude: it records argv and stdin, then exits with a chosen code or sleeps.
function stub(dir) {
  const file = path.join(dir, 'stub.mjs');
  fs.writeFileSync(file, `import fs from 'node:fs';
import { spawn } from 'node:child_process';
const dir = ${JSON.stringify(dir)};
const stdin = process.stdin.isTTY ? '' : await new Promise((r) => { let s = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => r(s)); process.stdin.on('error', () => r(s)); });
fs.writeFileSync(dir + '/argv.json', JSON.stringify(process.argv.slice(2)));
fs.writeFileSync(dir + '/stdin.txt', stdin);
fs.writeFileSync(dir + '/stub.pid', String(process.pid));
fs.writeFileSync(dir + '/env.json', JSON.stringify({ ORC_HEADLESS: process.env.ORC_HEADLESS ?? null }));
if (process.env.STUB_SLEEP) {
  const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  fs.writeFileSync(dir + '/grandchild.pid', String(g.pid));
  setTimeout(() => {}, 60000);
} else {
  process.stdout.write('stub output\\n');
  process.exit(Number(process.env.STUB_EXIT ?? 0));
}
`);
  return file;
}

const NASTY = 'line one "; rm -rf ~ #\n`whoami` $(echo pwned) %PATH% \\ trailing\\\n\'single\' & | > < ^\n';

test('dispatch real run passes the brief byte-identical, with no shell, and returns the exit code', () => {
  const brief = briefFile(goodBrief({ 7: NASTY.replace(/\n/g, '\n   ') }));
  const text = fs.readFileSync(brief, 'utf8');
  for (const [tool, role] of [['antigravity', 'scout'], ['claude-code', 'builder']]) {
    const dir = tempDir('stub');
    const env = { [`ORC_TOOL_BIN_${tool.toUpperCase().replace('-', '_')}`]: stub(dir), STUB_EXIT: '3' };
    const r = isolated(['dispatch', '--tool', tool, '--role', role, '--brief', brief], env);
    assert.equal(r.code, 3, r.err);
    assert.match(r.out, /stub output/);
    // The tool runs with ORC_HEADLESS=1 (absent from orc's own environment), so its hooks know nobody can answer.
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'env.json'), 'utf8')), { ORC_HEADLESS: '1' }, tool);
    const argv = JSON.parse(fs.readFileSync(path.join(dir, 'argv.json'), 'utf8'));
    const stdin = fs.readFileSync(path.join(dir, 'stdin.txt'), 'utf8');
    if (tool === 'antigravity') {
      assert.equal(argv[0], '-p');
      assert.equal(argv[1], text, 'brief arrives byte-identical as one argument');
      assert.ok(argv.includes('--disable-slash-commands'), 'antigravity headless passes --disable-slash-commands');
      assert.equal(stdin, '');
    } else {
      assert.deepEqual(argv.slice(0, 3), ['-p', '--agent', 'builder']);
      assert.equal(stdin, text, 'brief arrives byte-identical on stdin');
    }
  }
});

// A stub agy that prints STUB_PAD bytes of plain lines, then the contents of STUB_STDOUT_FILE, and exits STUB_EXIT
// (with STUB_HANG, it then writes STUB_READY_FILE, when given, and stays running instead).
function resultStub(dir) {
  const file = path.join(dir, 'result-stub.mjs');
  fs.writeFileSync(file, `import fs from 'node:fs';
const pad = Number(process.env.STUB_PAD ?? 0);
const line = 'x'.repeat(99) + '\\n';
let out = line.repeat(Math.floor(pad / 100));
if (process.env.STUB_STDOUT_FILE) out += fs.readFileSync(process.env.STUB_STDOUT_FILE, 'utf8');
const hang = () => {
  if (process.env.STUB_READY_FILE) fs.writeFileSync(process.env.STUB_READY_FILE, 'printed');
  setTimeout(() => {}, 60000);
};
process.stdout.write(out, () => (process.env.STUB_HANG ? hang() : process.exit(Number(process.env.STUB_EXIT ?? 0))));
`);
  return file;
}

// The two result objects recorded from real agy runs on 2026-11-24 (issue 51), and a normal success.
const AGY_DENIED = '{"conversation_id":"x","status":"SUCCESS","response":"","duration_seconds":80.4,"num_turns":1,"usage":{"total_tokens":40019},"denied_actions":[{"action":"command","display_name":"Bash"}]}';
const AGY_ERROR = '{"conversation_id":"y","status":"ERROR","response":"","duration_seconds":236,"num_turns":1,"usage":{"total_tokens":349212}}';
const AGY_OK = '{"conversation_id":"z","status":"SUCCESS","response":"STATUS: DONE\\nCHANGED: a.mjs","duration_seconds":12,"num_turns":3,"usage":{"total_tokens":900},"denied_actions":[]}';

test('dispatch antigravity: exit 1 with one stderr line when agy reports ERROR or a denied permission and no report (issue 51)', () => {
  const dir = tempDir('stub-result');
  const brief = briefFile();
  const runWith = (stdout, extra = {}) => {
    const outFile = path.join(dir, 'stdout.txt');
    fs.writeFileSync(outFile, stdout);
    return isolated(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', brief], { ORC_TOOL_BIN_ANTIGRAVITY: resultStub(dir), STUB_STDOUT_FILE: outFile, ...extra });
  };
  const command = (out) => out.split('\n').slice(2).join('\n');

  const denied = runWith(`${AGY_DENIED}\n`);
  assert.strictEqual(denied.code, 1);
  assert.strictEqual(denied.err, 'dispatch: antigravity ended with a denied permission and no report\n');
  assert.strictEqual(command(denied.out), `${AGY_DENIED}\n`, 'the output passes through unchanged');

  const error = runWith(AGY_ERROR);
  assert.strictEqual(error.code, 1);
  assert.strictEqual(error.err, 'dispatch: antigravity reported ERROR: no response\n');
  assert.strictEqual(command(error.out), AGY_ERROR);
  // A pretty-printed ERROR object after other lines, with a reason in its response, and a non-zero tool exit.
  const pretty = runWith(`working...\n${JSON.stringify({ ...JSON.parse(AGY_ERROR), response: 'quota reached\nmore' }, null, 2)}\n`, { STUB_EXIT: '2' });
  assert.strictEqual(pretty.code, 1);
  assert.strictEqual(pretty.err, 'dispatch: antigravity reported ERROR: quota reached\n');

  // A denied permission with a report is not a failure: the agent worked around it and said so.
  const deniedWithReport = JSON.stringify({ ...JSON.parse(AGY_DENIED), response: 'STATUS: DONE\nCHANGED: a.mjs' });
  const worked = runWith(`${deniedWithReport}\n`);
  assert.strictEqual(worked.code, 0, worked.err);
  assert.strictEqual(worked.err, '');

  const ok = runWith(`${AGY_OK}\n`);
  assert.strictEqual(ok.code, 0, ok.err);
  assert.strictEqual(ok.err, '');
  assert.strictEqual(command(ok.out), `${AGY_OK}\n`);
  // A successful run keeps the tool's own exit code; output that is not a result object keeps it too.
  assert.strictEqual(runWith(`${AGY_OK}\n`, { STUB_EXIT: '3' }).code, 3);
  const plain = runWith('no json here\n{"status": broken\n', { STUB_EXIT: '0' });
  assert.strictEqual(plain.code, 0);
  assert.strictEqual(plain.err, '');
});

test('dispatch antigravity: a large output streams through whole before the result object is read', () => {
  const dir = tempDir('stub-result-big');
  const outFile = path.join(dir, 'stdout.txt');
  fs.writeFileSync(outFile, `${AGY_ERROR}\n`);
  const pad = 600 * 1024;
  const r = isolated(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', briefFile()], { ORC_TOOL_BIN_ANTIGRAVITY: resultStub(dir), STUB_STDOUT_FILE: outFile, STUB_PAD: String(pad) });
  assert.strictEqual(r.code, 1, r.err);
  const body = r.out.split('\n').slice(2).join('\n');
  assert.strictEqual(body.length, pad + AGY_ERROR.length + 1, 'every byte arrives, in order');
  assert.ok(body.endsWith(`x\n${AGY_ERROR}\n`));
  assert.strictEqual(r.err, 'dispatch: antigravity reported ERROR: no response\n');
});

test('dispatch: a tool with no headlessResult keeps its own exit code and stream, whatever it prints', () => {
  const dir = tempDir('stub-result-nojson');
  const outFile = path.join(dir, 'stdout.txt');
  fs.writeFileSync(outFile, `${AGY_ERROR}\n${AGY_DENIED}\n`);
  for (const [tool, role] of [['claude-code', 'builder'], ['codex', 'builder']]) {
    const env = { [`ORC_TOOL_BIN_${tool.toUpperCase().replace('-', '_')}`]: resultStub(dir), STUB_STDOUT_FILE: outFile };
    const r = isolated(['dispatch', '--tool', tool, '--role', role, '--brief', briefFile()], env);
    assert.strictEqual(r.code, 0, `${tool}: ${r.err}`);
    assert.strictEqual(r.err, '', tool);
    assert.ok(r.out.endsWith(`${AGY_ERROR}\n${AGY_DENIED}\n`), tool);
    assert.strictEqual(isolated(['dispatch', '--tool', tool, '--role', role, '--brief', briefFile()], { ...env, STUB_EXIT: '4' }).code, 4, tool);
  }
});

test('dispatch antigravity: a timeout wins over a result object already printed', async () => {
  // The three runs wait side by side, so the 4-second timeout leaves the stub time to start and print on a loaded
  // runner without the test waiting 3 x 4 seconds; the ready file shows the stub printed before it was killed.
  const runs = [AGY_ERROR, AGY_DENIED, AGY_OK].map(async (printed) => {
    const dir = tempDir('stub-result-hang');
    const outFile = path.join(dir, 'stdout.txt');
    const ready = path.join(dir, 'ready');
    fs.writeFileSync(outFile, `${printed}\n`);
    const r = await isolatedAsync(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', briefFile(), '--timeout', '4'], { ORC_TOOL_BIN_ANTIGRAVITY: resultStub(dir), STUB_STDOUT_FILE: outFile, STUB_HANG: '1', STUB_READY_FILE: ready });
    assert.ok(fs.existsSync(ready), 'the stub was up and had printed before the timeout');
    assert.strictEqual(r.code, 124, r.err);
    assert.match(r.err, /^dispatch: timed out after 4s; killing the process tree\n$/);
    assert.ok(r.out.endsWith(`${printed}\n`));
  });
  await Promise.all(runs);
});

test('dispatch antigravity: a tool that exits while a grandchild still holds stdout returns its code and result within seconds', async () => {
  const dir = tempDir('stub-grandchild');
  const pidFile = path.join(dir, 'grandchild.pid');
  const file = path.join(dir, 'gc-stub.mjs');
  // The grandchild inherits the stub's stdout (the pipe orc reads) and outlives it, detached.
  fs.writeFileSync(file, `import fs from 'node:fs';
import { spawn } from 'node:child_process';
const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { detached: true, stdio: ['ignore', 'inherit', 'ignore'], windowsHide: true });
fs.writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));
g.unref();
process.stdout.write(process.env.STUB_RESULT + '\\n', () => process.exit(Number(process.env.STUB_EXIT)));
`);
  const kill = () => {
    try {
      process.kill(Number(fs.readFileSync(pidFile, 'utf8')));
    } catch {
      // already gone, or never started
    }
  };
  try {
    const brief = briefFile();
    const ok = AGY_OK;
    const code = await isolatedAsync(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', brief], { ORC_TOOL_BIN_ANTIGRAVITY: file, STUB_RESULT: ok, STUB_EXIT: '3' }, 15000);
    kill();
    assert.strictEqual(code.code, 3, code.err);
    assert.ok(code.out.endsWith(`${ok}\n`));
    assert.ok(code.ms < 6000, `returned after ${code.ms} ms`);
    // The result object is still read: an ERROR result exits 1 with its line.
    const failed = await isolatedAsync(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', brief], { ORC_TOOL_BIN_ANTIGRAVITY: file, STUB_RESULT: AGY_ERROR, STUB_EXIT: '0' }, 15000);
    kill();
    assert.strictEqual(failed.code, 1, failed.err);
    assert.strictEqual(failed.err, 'dispatch: antigravity reported ERROR: no response\n');
    assert.ok(failed.ms < 6000, `returned after ${failed.ms} ms`);
  } finally {
    kill();
  }
});

test('dispatch antigravity: a reader that closes early stops the pass-through, not the run (no EPIPE stack trace)', async () => {
  const dir = tempDir('stub-result-epipe');
  const outFile = path.join(dir, 'stdout.txt');
  fs.writeFileSync(outFile, `${AGY_ERROR}\n`);
  const fakeHome = tempDir('fakehome');
  const env = agentFree({ ...process.env, HOME: fakeHome, USERPROFILE: fakeHome }, { ORC_TOOL_BIN_ANTIGRAVITY: resultStub(dir), STUB_STDOUT_FILE: outFile, STUB_PAD: String(2 * 1024 * 1024) });
  const child = spawn(process.execPath, [ORC, 'dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', briefFile()], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let read = 0;
  let stderr = '';
  child.stderr.on('data', (c) => (stderr += c));
  child.stdout.on('data', (c) => {
    read += c.length;
    if (read >= 100 * 1024) child.stdout.destroy();
  });
  const code = await new Promise((resolve) => child.on('close', (c) => resolve(c)));
  assert.ok(read >= 100 * 1024 && read < 2 * 1024 * 1024, `the reader closed early (${read} bytes)`);
  assert.strictEqual(stderr, 'dispatch: antigravity reported ERROR: no response\n', 'the tail was still read; no stack trace');
  assert.strictEqual(code, 1);
});

test('antigravity headlessResult reads the last result object; null when there is none', async () => {
  const agy = (await import('../adapters/antigravity.mjs')).default;
  assert.deepStrictEqual(agy.headlessResult(`${AGY_DENIED}\n`), { ok: true, status: 'SUCCESS', response: '', denied: 1 });
  assert.deepStrictEqual(agy.headlessResult(`log line\r\n${AGY_ERROR}\r\n`), { ok: false, status: 'ERROR', response: '', denied: 0 });
  assert.deepStrictEqual(agy.headlessResult(`{"note":1}\n${JSON.stringify(JSON.parse(AGY_OK), null, 2)}`), { ok: true, status: 'SUCCESS', response: 'STATUS: DONE\nCHANGED: a.mjs', denied: 0 });
  // Lines after the result object are ignored; of two objects the last wins; an object written inside the response
  // text is part of that string, not a result.
  assert.deepStrictEqual(agy.headlessResult(`${AGY_ERROR}\nshutdown noise\n`), { ok: false, status: 'ERROR', response: '', denied: 0 });
  assert.deepStrictEqual(agy.headlessResult(`${AGY_ERROR}\n{"oops":1}\n{"status": cut`), { ok: false, status: 'ERROR', response: '', denied: 0 });
  assert.deepStrictEqual(agy.headlessResult(`${AGY_OK}\n${AGY_ERROR}\n`).status, 'ERROR');
  assert.deepStrictEqual(agy.headlessResult(`${AGY_ERROR}\n${AGY_OK}\n`).status, 'SUCCESS');
  const nested = JSON.stringify({ status: 'SUCCESS', response: 'saw\n{"status":"ERROR","response":""}\nand {"status":"ERROR"} in a log', usage: { inner: { status: 'ERROR' } } }, null, 2);
  assert.deepStrictEqual(agy.headlessResult(`${nested}\n`), { ok: true, status: 'SUCCESS', response: 'saw\n{"status":"ERROR","response":""}\nand {"status":"ERROR"} in a log', denied: 0 });
  for (const none of ['', 'plain text\n', '{"status": cut off', '[1,2]', '{"no_status":true}', AGY_ERROR.slice(10)]) {
    assert.strictEqual(agy.headlessResult(none), null, JSON.stringify(none));
  }
});

test('dispatch codex: read-only sandbox only for scout and researcher, effort only when the tier has one, role body and brief on stdin', () => {
  const brief = briefFile(goodBrief({ 7: NASTY.replace(/\n/g, '\n   ') }));
  const text = fs.readFileSync(brief, 'utf8');
  const models = loadModels(REPO);
  const roles = loadRoles(REPO);
  const effort = (tier) => (models.codex[tier].effort ? ['-c', `model_reasoning_effort=${JSON.stringify(models.codex[tier].effort)}`] : []);
  assert.equal(models.codex.low.effort, undefined, 'the low tier has no effort, so scout covers the no-effort branch');
  assert.ok(models.codex.high.effort, 'the high tier has an effort');
  // Only scout and researcher run read-only (they report inline: that sandbox cannot write a scratch file); the refuter
  // runs tests and builds a throwaway worktree, and the review-* roles write at most an overflow scratch report.
  const winMxc = process.platform === 'win32' ? ['-c', 'windows.sandbox=mxc'] : [];
  for (const [role, sandbox] of [['scout', 'read-only'], ['researcher', 'read-only'], ['refuter', 'workspace-write'], ['review-code-explorer', 'workspace-write'], ['builder', 'workspace-write']]) {
    const r0 = roles.find((r) => r.name === role);
    const want = ['exec', '--model', models.codex[r0.tier].model, '--sandbox', sandbox, ...effort(r0.tier), ...winMxc, '-'];
    const dir = tempDir('stub');
    const r = isolated(['dispatch', '--tool', 'codex', '--role', role, '--brief', brief], { ORC_TOOL_BIN_CODEX: stub(dir), STUB_EXIT: '0' });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'argv.json'), 'utf8')), want, role);
    assert.equal(fs.readFileSync(path.join(dir, 'stdin.txt'), 'utf8'), `${r0.body}\n\n---\n\n${text}`, `${role}: role body, separator, brief byte-identical`);
    const dry = isolated(['dispatch', '--tool', 'codex', '--role', role, '--brief', brief, '--dry-run']);
    assert.equal(dry.code, 0, dry.err);
    assert.ok(dry.out.includes(` ${want.map(q).join(' ')}\n`), dry.out);
    assert.match(dry.out, new RegExp(`stdin: ${Buffer.byteLength(`${r0.body}\n\n---\n\n${text}`)} bytes \\(the role body, then the brief\\)\\n`));
  }
});

test('F8: codex headless adds -c windows.sandbox=mxc before - on Windows for every role, and leaves other platforms unchanged', async () => {
  const codex = (await import('../adapters/codex.mjs')).default;
  const roles = loadRoles(REPO);
  const models = loadModels(REPO, { local: false });
  for (const name of ['scout', 'researcher', 'builder', 'refuter']) {
    const role = roles.find((r) => r.name === name);
    const tierModel = models.codex[role.tier];
    const win = codex.headless(role, tierModel, 'brief', { platform: 'win32' });
    assert.deepEqual(win.args.slice(-3), ['-c', 'windows.sandbox=mxc', '-'], `win32 ${name}`);
    for (const platform of ['linux', 'darwin']) {
      const other = codex.headless(role, tierModel, 'brief', { platform });
      assert.equal(other.args.at(-1), '-', `${platform} ${name}`);
      assert.ok(!other.args.includes('windows.sandbox=mxc'), `${platform} ${name} has no windows.sandbox=mxc`);
      assert.deepEqual(win.args, [...other.args.slice(0, -1), '-c', 'windows.sandbox=mxc', '-'], `${platform} vs win32 ${name}`);
    }
  }
});

test('killTree on a gone pid and a live process: the POSIX fallback runs only when the tree kill throws', async () => {
  // A pid no process can have (not a multiple of 4 on Windows, above pid_max on Linux), so nothing real is killed.
  // On POSIX process.kill(-pid) throws and the fallback runs, silently. On Windows taskkill exits 128 (already gone),
  // which counts as success; its failure fallback is covered with an injected runSync below.
  const gone = 2147483647;
  const calls = [];
  const said = [];
  killTree({ pid: gone, kill: (sig) => calls.push(sig) }, { err: (s) => said.push(s) });
  assert.deepEqual(calls, process.platform === 'win32' ? [] : ['SIGKILL']);
  assert.deepEqual(said, []);
  // A live process: the tree kill works, so the fallback is not called.
  const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', detached: process.platform !== 'win32' });
  const liveCalls = [];
  const liveSaid = [];
  try {
    killTree({ pid: live.pid, kill: (sig) => liveCalls.push(sig) }, { err: (s) => liveSaid.push(s) });
    assert.deepEqual(liveCalls, []);
    assert.deepEqual(liveSaid, [], 'nothing to say when the tree kill works');
    // Wait on the exit event: a synchronous poll never lets Node reap the child, and on POSIX a killed but unreaped
    // child still answers signal 0.
    const ended = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000);
      live.once('exit', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    assert.equal(ended, true, 'the tree kill ended the process');
  } finally {
    if (alive(live.pid)) live.kill('SIGKILL');
  }
});

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('dispatch honours the timeout and kills the child tree', () => {
  const dir = tempDir('stub');
  const brief = briefFile();
  const t0 = Date.now();
  const r = isolated(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', brief, '--timeout', '2'], {
    ORC_TOOL_BIN_ANTIGRAVITY: stub(dir), STUB_SLEEP: '1',
  });
  assert.equal(r.code, 124, r.err);
  assert.match(r.err, /timed out after 2s/);
  assert.ok(Date.now() - t0 < 30000, 'returned well before the stub would have');
  const pid = Number(fs.readFileSync(path.join(dir, 'grandchild.pid'), 'utf8'));
  const until = Date.now() + 5000;
  while (alive(pid) && Date.now() < until) spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},200)']);
  assert.equal(alive(pid), false, 'grandchild was killed with the tree');
});

test('killTree on Windows falls back to child.kill() and says so when taskkill errors or exits non-zero', () => {
  const calls = [];
  const makeChild = () => {
    const killed = [];
    const lines = [];
    return { pid: 4242, killed, lines, err: (s) => lines.push(s), kill: (...a) => killed.push(a) };
  };
  const partial = (why) => [`dispatch: taskkill failed (${why}); killed only pid 4242, its child processes may still be running`];

  // taskkill errors (e.g. ENOENT/EACCES in a sandbox): falls back to child.kill().
  const cErr = makeChild();
  killTree(cErr, {
    platform: 'win32',
    err: cErr.err,
    runSync: (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { error: Object.assign(new Error('EACCES'), { code: 'EACCES' }), status: null };
    },
  });
  assert.deepStrictEqual(calls[0], { cmd: 'taskkill', args: ['/pid', '4242', '/T', '/F'], opts: { stdio: 'ignore', shell: false } });
  assert.deepStrictEqual(cErr.killed, [[]]);
  assert.deepStrictEqual(cErr.lines, partial('EACCES'));

  // taskkill exits non-zero (other than 128): falls back to child.kill().
  const cNonZero = makeChild();
  killTree(cNonZero, { platform: 'win32', err: cNonZero.err, runSync: () => ({ status: 1 }) });
  assert.deepStrictEqual(cNonZero.killed, [[]]);
  assert.deepStrictEqual(cNonZero.lines, partial('exit status 1'));

  // runSync throws: falls back to child.kill() exactly once.
  const cThrow = makeChild();
  killTree(cThrow, {
    platform: 'win32',
    err: cThrow.err,
    runSync: () => {
      throw Object.assign(new Error('spawnSync failed'), { code: 'EPERM' });
    },
  });
  assert.deepStrictEqual(cThrow.killed, [[]]);
  assert.deepStrictEqual(cThrow.lines, partial('EPERM'));

  // taskkill succeeds (status 0, no error) or the process was already gone (128): no child.kill(), no line.
  for (const status of [0, 128]) {
    const c = makeChild();
    killTree(c, { platform: 'win32', err: c.err, runSync: () => ({ status }) });
    assert.deepStrictEqual(c.killed, [], `status ${status}`);
    assert.deepStrictEqual(c.lines, [], `status ${status}`);
  }

  // Without an err function the fallback still kills and writes nothing.
  const cQuiet = makeChild();
  killTree(cQuiet, { platform: 'win32', runSync: () => ({ status: 1 }) });
  assert.deepStrictEqual(cQuiet.killed, [[]]);

  // Non-Windows: kills process group, falls back to child.kill('SIGKILL') on throw.
  const cPosix = makeChild();
  killTree(cPosix, {
    platform: 'linux',
    killProcess: () => {
      throw new Error('ESRCH');
    },
  });
  assert.deepStrictEqual(cPosix.killed, [['SIGKILL']]);
});

test('runDispatch: an error after the timeout kill began is a failed kill, and the run still exits 124', async (t) => {
  let child = null;
  t.mock.method(ChildProcess.prototype, 'on', function (ev, fn) {
    child ??= this;
    return EventEmitter.prototype.on.call(this, ev, fn);
  });
  const lines = [];
  const err = (s) => {
    lines.push(s);
    // Runs before killTree, so the error lands while the kill is under way.
    if (s.startsWith('dispatch: timed out')) child.emit('error', new Error('kill EPERM'));
  };
  const plan = { exe: { command: process.execPath }, argv: ['-e', 'setTimeout(() => {}, 30000)'], stdin: null, toolId: 'antigravity' };
  const code = await runDispatch(plan, { timeoutSec: 1, err });
  assert.strictEqual(code, 124);
  assert.ok(lines.includes('dispatch: kill failed: kill EPERM'), lines.join('\n'));
  assert.ok(!lines.some((l) => l.startsWith('dispatch: cannot start')), lines.join('\n'));
});

// ---------- hooks ----------

const EXAMPLE = JSON.parse(fs.readFileSync(path.join(REPO, 'adapters', 'claude-code', 'settings.example.json'), 'utf8'));
const exampleCommands = Object.values(EXAMPLE.hooks).flatMap((gs) => gs.flatMap((g) => g.hooks.map((h) => h.command)));

test('hooks: empty home gets every example hook with the real home and setup checkout; dry run writes nothing', () => {
  const home = tempDir('hookhome');
  const dry = isolated(['hooks', '--home', home]);
  assert.equal(dry.code, 0, dry.err);
  assert.equal(dry.out.match(/^would add /gm).length, exampleCommands.length);
  assert.deepEqual(fs.readdirSync(home), [], 'dry run writes nothing');
  const applied = isolated(['hooks', '--home', home, '--apply']);
  assert.equal(applied.code, 0, applied.err);
  const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(Object.keys(settings), ['hooks'], 'only the hooks block is merged');
  const text = JSON.stringify(settings);
  const setup = fs.realpathSync.native(REPO).replace(/\\/g, '/');
  assert.ok(!text.includes('<you>'), 'home placeholder replaced');
  assert.ok(!text.includes('<setup>'), 'setup placeholder replaced');
  assert.ok(text.includes(JSON.stringify(home).slice(1, -1)), 'real home in the commands');
  assert.ok(text.includes(`${setup}/extras/worklog/log-event.ps1`), 'setup checkout path in worklog commands');
  assert.ok(text.includes(`${setup}/extras/peon/peon-hook.ps1`), 'setup checkout path in peon commands');
  // Every worklog and peon script wired from <setup>/extras/ exists on disk.
  const extrasPaths = Object.values(settings.hooks)
    .flatMap((gs) => gs.flatMap((g) => g.hooks.map((h) => /"([^"]+\/extras\/[^"]+\.ps1)"/.exec(h.command)?.[1])))
    .filter(Boolean);
  assert.ok(extrasPaths.length >= 11, `expected worklog and peon hooks, got ${extrasPaths.length}`);
  for (const p of extrasPaths) assert.ok(fs.existsSync(p), `extras script exists: ${p}`);
  assert.match(isolated(['hooks', '--home', home]).out, /nothing to add/);
  assert.match(isolated(['hooks']).err, /hooks needs --home/);
});

test('hooks: stale .claude/tools/worklog and .claude/tools/peon entries are reported to replace and never duplicated', () => {
  const home = tempDir('hookstale');
  const file = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Simulate a live home whose settings.json still points at the old .claude\tools\worklog and .claude\tools\peon paths.
  const oldSettings = {
    hooks: {
      Stop: [
        { matcher: '', hooks: [{ type: 'command', command: `powershell -NoProfile -NonInteractive -File "${home}\\.claude\\tools\\worklog\\log-event.ps1" -Kind stop`, timeout: 10, async: true }] },
        { matcher: '', hooks: [{ type: 'command', command: `powershell -NoProfile -NonInteractive -File "${home}\\.claude\\tools\\peon\\peon-hook.ps1"`, timeout: 10, async: true }] },
      ],
      PostToolUse: [
        { matcher: 'ArtifactData', hooks: [{ type: 'command', command: `powershell -NoProfile -NonInteractive -File "${home}\\.claude\\tools\\worklog\\board-title.ps1"`, timeout: 10 }] },
      ],
    },
  };
  fs.writeFileSync(file, `${JSON.stringify(oldSettings, null, 2)}\n`);
  const dry = isolated(['hooks', '--home', home]);
  assert.equal(dry.code, 0, dry.err);
  assert.equal(dry.out.match(/^stale /gm).length, 3, dry.out);
  assert.match(dry.out, /stale Stop \(replace by hand; not duplicated\): .*tools\\worklog\\log-event\.ps1" -Kind stop/);
  assert.match(dry.out, /-> .*\/extras\/worklog\/log-event\.ps1" -Kind stop/);
  assert.match(dry.out, /stale PostToolUse \[ArtifactData\] \(replace by hand; not duplicated\): .*tools\\worklog\\board-title\.ps1/);
  assert.equal(dry.out.match(/^would add /gm).length, exampleCommands.length - 3, 'stale entries are not added beside the old ones');
  const applied = isolated(['hooks', '--home', home, '--apply']);
  assert.equal(applied.code, 0, applied.err);
  assert.equal(applied.out.match(/^stale /gm).length, 3, applied.out);
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  const stopCmds = after.hooks.Stop.flatMap((g) => g.hooks.map((h) => h.command));
  assert.equal(stopCmds.filter((c) => /log-event\.ps1/.test(c)).length, 1, 'worklog Stop hook not duplicated');
  assert.equal(stopCmds.filter((c) => /peon-hook\.ps1/.test(c)).length, 1, 'peon Stop hook not duplicated');
  assert.equal(stopCmds.filter((c) => /peon-nag\.ps1/.test(c)).length, 1, 'missing peon-nag hook was added');
  const ptuCmds = after.hooks.PostToolUse.flatMap((g) => g.hooks.map((h) => h.command));
  assert.equal(ptuCmds.filter((c) => /board-title\.ps1/.test(c)).length, 1, 'board-title hook not duplicated');
  // Second run reports the 3 stale hooks and adds nothing.
  const again = isolated(['hooks', '--home', home, '--apply']);
  assert.equal(again.code, 0, again.err);
  assert.equal(again.out.match(/^stale /gm).length, 3);
  assert.match(again.out, /nothing added: 3 stale hook\(s\) still point at \.claude\/tools\/worklog or \.claude\/tools\/peon/);
});

test('hooks: stale pattern also matches unquoted .claude/tools/worklog and .claude/tools/peon paths', () => {
  const home = tempDir('hookstale-unquoted');
  const file = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const oldSettings = {
    hooks: {
      Stop: [
        { matcher: '', hooks: [{ type: 'command', command: 'powershell -NoProfile -NonInteractive -File ~/.claude/tools/worklog/log-event.ps1 -Kind stop', timeout: 10, async: true }] },
        { matcher: '', hooks: [{ type: 'command', command: `powershell -NoProfile -NonInteractive -File ${home}\\.claude\\tools\\peon\\peon-hook.ps1`, timeout: 10, async: true }] },
      ],
      PostToolUse: [
        { matcher: 'ArtifactData', hooks: [{ type: 'command', command: 'powershell -NoProfile -NonInteractive -File ~/.claude/tools/worklog/board-title.ps1', timeout: 10 }] },
      ],
    },
  };
  fs.writeFileSync(file, `${JSON.stringify(oldSettings, null, 2)}\n`);
  const dry = isolated(['hooks', '--home', home]);
  assert.equal(dry.code, 0, dry.err);
  assert.equal(dry.out.match(/^stale /gm)?.length, 3, dry.out);
  assert.match(dry.out, /stale Stop \(replace by hand; not duplicated\): .*~\/\.claude\/tools\/worklog\/log-event\.ps1 -Kind stop/);
  assert.match(dry.out, /-> .*\/extras\/worklog\/log-event\.ps1" -Kind stop/);
  assert.equal(dry.out.match(/^would add /gm)?.length, exampleCommands.length - 3, 'unquoted stale entries are not duplicated');
  const applied = isolated(['hooks', '--home', home, '--apply']);
  assert.equal(applied.code, 0, applied.err);
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  const stopCmds = after.hooks.Stop.flatMap((g) => g.hooks.map((h) => h.command));
  assert.equal(stopCmds.filter((c) => /log-event\.ps1/.test(c)).length, 1, 'unquoted worklog Stop hook not duplicated');
  assert.equal(stopCmds.filter((c) => /peon-hook\.ps1/.test(c)).length, 1, 'unquoted peon Stop hook not duplicated');
  const ptuCmds = after.hooks.PostToolUse.flatMap((g) => g.hooks.map((h) => h.command));
  assert.equal(ptuCmds.filter((c) => /board-title\.ps1/.test(c)).length, 1, 'unquoted board-title hook not duplicated');
});

test('D7: hooks treats a stale .claude/tools/{worklog,peon} entry under another matcher in the same event as stale and never duplicates it', () => {
  const home = tempDir('hookstale-matcher');
  const file = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const oldSettings = {
    hooks: {
      PostToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: `powershell -NoProfile -NonInteractive -File "${home}\\.claude\\tools\\worklog\\log-event.ps1" -Kind tool`, timeout: 10, async: true }] },
        { matcher: 'mcp__claude-artifacts__db_write', hooks: [{ type: 'command', command: `powershell -NoProfile -NonInteractive -File "${home}\\.claude\\tools\\worklog\\board-title.ps1"`, timeout: 10 }] },
      ],
    },
  };
  fs.writeFileSync(file, `${JSON.stringify(oldSettings, null, 2)}\n`);
  const dry = isolated(['hooks', '--home', home]);
  assert.equal(dry.code, 0, dry.err);
  assert.equal(dry.out.match(/^stale /gm)?.length, 2, dry.out);
  assert.match(dry.out, /stale PostToolUse \[Bash\] \(replace by hand; not duplicated\): .*tools\\worklog\\log-event\.ps1" -Kind tool/);
  assert.match(dry.out, /-> .*\/extras\/worklog\/log-event\.ps1" -Kind tool/);
  assert.match(dry.out, /stale PostToolUse \[mcp__claude-artifacts__db_write\] \(replace by hand; not duplicated\): .*tools\\worklog\\board-title\.ps1/);
  assert.equal(dry.out.match(/^would add /gm)?.length, exampleCommands.length - 2, 'stale entries under different matchers are not added beside the old ones');
  const applied = isolated(['hooks', '--home', home, '--apply']);
  assert.equal(applied.code, 0, applied.err);
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ptuCmds = after.hooks.PostToolUse.flatMap((g) => g.hooks.map((h) => h.command));
  assert.equal(ptuCmds.filter((c) => /log-event\.ps1/.test(c)).length, 1, 'worklog PostToolUse hook not duplicated');
  assert.equal(ptuCmds.filter((c) => /board-title\.ps1/.test(c)).length, 1, 'board-title PostToolUse hook not duplicated');
  // Same script under a different event does not suppress PostToolUse.
  const otherEvent = tempDir('hookstale-event');
  const otherFile = path.join(otherEvent, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(otherFile), { recursive: true });
  fs.writeFileSync(otherFile, JSON.stringify({
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: `powershell -NoProfile -NonInteractive -File "${otherEvent}\\.claude\\tools\\worklog\\log-event.ps1" -Kind tool`, timeout: 10 }] },
      ],
    },
  }, null, 2));
  const diffEv = isolated(['hooks', '--home', otherEvent]);
  assert.equal(diffEv.code, 0, diffEv.err);
  assert.doesNotMatch(diffEv.out, /^stale /m);
  assert.equal(diffEv.out.match(/^would add /gm)?.length, exampleCommands.length);
});

test('hooks fills <setup> with the running checkout, not --repo', () => {
  const otherRepo = tempDir('hooks-other-repo');
  const destDir = path.join(otherRepo, 'adapters', 'claude-code');
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(path.join(REPO, 'adapters', 'claude-code', 'settings.example.json'), path.join(destDir, 'settings.example.json'));
  const home = tempDir('hooks-setup-home');
  const r = isolated(['hooks', '--repo', otherRepo, '--home', home, '--apply']);
  assert.equal(r.code, 0, r.err);
  const text = fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8');
  const runningSetup = fs.realpathSync.native(REPO).replace(/\\/g, '/');
  const otherSetup = fs.realpathSync.native(otherRepo).replace(/\\/g, '/');
  assert.ok(text.includes(`${runningSetup}/extras/worklog/log-event.ps1`), text);
  assert.ok(!text.includes(otherSetup), `expected running checkout, not --repo: ${text}`);
});

test('hooks: existing settings keep every key and hook byte-for-byte; second run is idempotent', () => {
  const home = tempDir('hookhome');
  const file = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const relay = EXAMPLE.hooks.SubagentStop[0].hooks[0].command.replaceAll('C:\\Users\\<you>', home);
  const mine = {
    model: 'mine',
    permissions: { allow: ['Bash(ls)'] },
    hooks: {
      Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo my own stop', timeout: 5 }] }],
      SubagentStop: [{ hooks: [{ type: 'command', command: relay, timeout: 99 }] }],
    },
    zLast: true,
  };
  const original = `${JSON.stringify(mine, null, 2)}\n`;
  fs.writeFileSync(file, original);
  const r = isolated(['hooks', '--home', home, '--apply']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.match(/^added /gm).length, exampleCommands.length - 1, 'an identical command is not added again');
  const after = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(after);
  assert.deepEqual(Object.keys(parsed), ['model', 'permissions', 'hooks', 'zLast'], 'key order kept');
  assert.deepEqual(parsed.hooks.Stop[0], mine.hooks.Stop[0], 'existing hook first and unchanged');
  assert.deepEqual(parsed.hooks.SubagentStop, mine.hooks.SubagentStop, 'nothing added beside an identical command');
  // Take the added entries back out: the rest is the original file, byte for byte.
  const stripped = structuredClone(parsed);
  for (const [event, groups] of Object.entries(stripped.hooks)) {
    const keep = mine.hooks[event]?.length ?? 0;
    if (keep) stripped.hooks[event] = groups.slice(0, keep);
    else delete stripped.hooks[event];
  }
  assert.equal(formatLike(after, stripped), original);
  const backups = fs.readdirSync(path.dirname(file)).filter((f) => f.includes('.orc-backup-'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(path.dirname(file), backups[0]), 'utf8'), original);
  const again = isolated(['hooks', '--home', home, '--apply']);
  assert.match(again.out, /nothing to add/);
  assert.equal(fs.readFileSync(file, 'utf8'), after, 'second run changes nothing');
});

test('hooks warns once per wired script that is not at its path, on stderr', () => {
  const home = tempDir('hookhome');
  const missing = isolated(['hooks', '--home', home, '--node']);
  assert.equal(missing.code, 0, missing.err);
  const tools = path.join(home, '.claude', 'tools');
  const warned = missing.err.split('\n').filter((l) => l.startsWith('WARN hook script not found: '));
  assert.deepEqual(warned.map((l) => path.basename(l.slice(28).split(' (')[0])).sort(), ['board-reminder.mjs', 'guard.mjs']);
  assert.doesNotMatch(missing.out, /WARN/);
  // Once the scripts are there, no warning.
  fs.mkdirSync(tools, { recursive: true });
  for (const s of ['board-reminder.mjs', 'guard.mjs']) fs.writeFileSync(path.join(tools, s), '');
  const present = isolated(['hooks', '--home', home, '--node']);
  assert.equal(present.code, 0, present.err);
  assert.doesNotMatch(present.err, /hook script not found/);
  // The PowerShell example wires the guard too.
  assert.match(isolated(['hooks', '--home', home]).err, /WARN hook script not found: .*guard\.ps1/);
});

test('hooks --node merges only the Node entries (board-reminder and guard)', () => {
  const home = tempDir('hookhome');
  const r = isolated(['hooks', '--home', home, '--node', '--apply']);
  assert.equal(r.code, 0, r.err);
  const s = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  const cmds = Object.values(s.hooks).flatMap((gs) => gs.flatMap((g) => g.hooks.map((h) => h.command)));
  assert.equal(cmds.length, 4);
  const fwd = home.replace(/\\/g, '/');
  for (const c of cmds) assert.match(c, new RegExp(`^node "${fwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.claude/tools/(board-reminder\\.mjs" (mark|relay)|guard\\.mjs")$`));
  assert.ok(!JSON.stringify(s).includes('powershell'));
});

test('mergeHooks rejects a non-array event and leaves the input untouched', () => {
  const input = { hooks: { Stop: { not: 'an array' } } };
  assert.throws(() => mergeHooks(input, EXAMPLE, '/h'), /not an array/);
  assert.deepEqual(input, { hooks: { Stop: { not: 'an array' } } });
});

// ---------- hooks --tool antigravity ----------

function orcaStatusHooks() {
  const h = (cmd) => ({ type: 'command', command: `C:/Users/<you>/.orca/agent-hooks/${cmd}`, timeout: 10 });
  return {
    'orca-status': {
      PreInvocation: [h('antigravity-pre-invocation.cmd')],
      PostInvocation: [h('antigravity-post-invocation.cmd')],
      Stop: [h('antigravity-stop.cmd')],
      PreToolUse: [{ matcher: '*', hooks: [h('antigravity-pre-tool-use.cmd')] }],
      PostToolUse: [{ matcher: '*', hooks: [h('antigravity-post-tool-use.cmd')] }],
    },
  };
}

test('hooks --tool antigravity: new file, warning when guard missing, exact top-level orc-guard shape, idempotent', () => {
  const home = tempDir('agy-hooks-new');
  const target = path.join(home, '.gemini', 'config', 'hooks.json');
  const scriptFwd = path.join(home, '.gemini', 'tools', 'guard.mjs').replace(/\\/g, '/');

  // Dry run writes nothing, prints would add and warns about missing guard.mjs.
  const dry = isolated(['hooks', '--tool', 'antigravity', '--home', home]);
  assert.strictEqual(dry.code, 0, dry.err);
  assert.match(dry.out, /^would add orc-guard /m);
  assert.match(dry.out, /dry run: would create /);
  assert.match(dry.err, /WARN .*run install --tool antigravity --apply first/);
  assert.deepStrictEqual(fs.readdirSync(home), [], 'dry run writes nothing');

  // --apply creates folder and file with 2-space LF and no Claude-style hooks wrapper.
  const ap = isolated(['hooks', '--tool', 'antigravity', '--home', home, '--apply']);
  assert.strictEqual(ap.code, 0, ap.err);
  assert.match(ap.out, /^added orc-guard /m);
  assert.match(ap.out, /^created /m);
  assert.match(ap.err, /WARN .*run install --tool antigravity --apply first/);
  const raw = fs.readFileSync(target, 'utf8');
  assert.ok(!raw.includes('\r\n'), 'new file uses LF');
  assert.ok(raw.endsWith('\n'), 'new file ends with LF');
  assert.ok(raw.includes('\n  "orc-guard": {'), 'new file uses 2-space indent');
  const parsed = JSON.parse(raw);
  assert.deepStrictEqual(Object.keys(parsed), ['orc-guard'], 'no Claude-style hooks wrapper');
  assert.deepStrictEqual(parsed['orc-guard'], {
    PreToolUse: [
      {
        matcher: 'run_command',
        hooks: [{ type: 'command', command: `node "${scriptFwd}"`, timeout: 10 }],
      },
    ],
  });

  // Once guard.mjs exists, no missing-script warning, and second run is already wired (no backup, no write).
  fs.mkdirSync(path.join(home, '.gemini', 'tools'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gemini', 'tools', 'guard.mjs'), '// guard\n');
  const again = isolated(['hooks', '--tool', 'antigravity', '--home', home, '--apply']);
  assert.strictEqual(again.code, 0, again.err);
  assert.match(again.out, /^already wired: orc-guard /m);
  assert.strictEqual(again.err, '');
  assert.strictEqual(fs.readFileSync(target, 'utf8'), raw);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(target)), ['hooks.json'], 'no backup on no-op');
});

test('hooks --tool antigravity: preserves real-shaped orca-status across dry run, apply, re-apply and --remove', () => {
  const home = tempDir('agy-hooks-orca');
  const target = path.join(home, '.gemini', 'config', 'hooks.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.mkdirSync(path.join(home, '.gemini', 'tools'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gemini', 'tools', 'guard.mjs'), '// guard\n');
  const orca = orcaStatusHooks();
  const original = `${JSON.stringify(orca, null, 2)}\n`;
  fs.writeFileSync(target, original);

  // 1. Dry run leaves file untouched.
  const dry = isolated(['hooks', '--tool', 'antigravity', '--home', home]);
  assert.strictEqual(dry.code, 0, dry.err);
  assert.match(dry.out, /^would add orc-guard /m);
  assert.strictEqual(fs.readFileSync(target, 'utf8'), original);

  // 2. --apply backs up original, preserves orca-status first and byte-for-byte in value, adds orc-guard.
  const ap1 = isolated(['hooks', '--tool', 'antigravity', '--home', home, '--apply']);
  assert.strictEqual(ap1.code, 0, ap1.err);
  assert.match(ap1.out, /^backed up: .*hooks\.json\.orc-backup-/m);
  const afterAdd = fs.readFileSync(target, 'utf8');
  const parsedAdd = JSON.parse(afterAdd);
  assert.deepStrictEqual(Object.keys(parsedAdd), ['orca-status', 'orc-guard']);
  assert.deepStrictEqual(parsedAdd['orca-status'], orca['orca-status']);
  const backups1 = fs.readdirSync(path.dirname(target)).filter((f) => f.includes('.orc-backup-'));
  assert.strictEqual(backups1.length, 1);
  assert.strictEqual(fs.readFileSync(path.join(path.dirname(target), backups1[0]), 'utf8'), original);

  // 3. Second --apply is a no-op (already wired, no new backup, orca-status unchanged).
  const ap2 = isolated(['hooks', '--tool', 'antigravity', '--home', home, '--apply']);
  assert.strictEqual(ap2.code, 0, ap2.err);
  assert.match(ap2.out, /^already wired: orc-guard /m);
  assert.strictEqual(fs.readFileSync(target, 'utf8'), afterAdd);
  assert.strictEqual(fs.readdirSync(path.dirname(target)).filter((f) => f.includes('.orc-backup-')).length, 1);

  // 4. --remove dry run writes nothing.
  const remDry = isolated(['hooks', '--tool', 'antigravity', '--home', home, '--remove']);
  assert.strictEqual(remDry.code, 0, remDry.err);
  assert.match(remDry.out, /^would remove orc-guard /m);
  assert.strictEqual(fs.readFileSync(target, 'utf8'), afterAdd);

  // 5. --remove --apply backs up and restores exact original content (orca-status byte-for-byte identical).
  const rem = isolated(['hooks', '--tool', 'antigravity', '--home', home, '--remove', '--apply']);
  assert.strictEqual(rem.code, 0, rem.err);
  assert.match(rem.out, /^removed orc-guard /m);
  assert.match(rem.out, /^backed up: /m);
  assert.strictEqual(fs.readFileSync(target, 'utf8'), original);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(target, 'utf8')), orca);

  // 6. --remove when absent exits 0 and writes nothing.
  const remAgain = isolated(['hooks', '--tool', 'antigravity', '--home', home, '--remove', '--apply']);
  assert.strictEqual(remAgain.code, 0, remAgain.err);
  assert.match(remAgain.out, /nothing to remove: orc-guard is not in /);
  assert.strictEqual(fs.readFileSync(target, 'utf8'), original);

  // --remove on a home with no hooks.json exits 0 and creates nothing.
  const emptyHome = tempDir('agy-hooks-empty-rm');
  const remEmpty = isolated(['hooks', '--tool', 'antigravity', '--home', emptyHome, '--remove', '--apply']);
  assert.strictEqual(remEmpty.code, 0, remEmpty.err);
  assert.match(remEmpty.out, /nothing to remove: orc-guard is not in /);
  assert.deepStrictEqual(fs.readdirSync(emptyHome), []);
});

test('hooks --tool antigravity: existing differing orc-guard reports what differs and replaces only orc-guard in place', () => {
  const home = tempDir('agy-hooks-replace');
  const target = path.join(home, '.gemini', 'config', 'hooks.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.mkdirSync(path.join(home, '.gemini', 'tools'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gemini', 'tools', 'guard.mjs'), '// guard\n');
  const initial = {
    'first-hook': { Stop: [{ type: 'command', command: 'echo first', timeout: 5 }] },
    'orc-guard': {
      enabled: false,
      PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node "/old/guard.mjs"', timeout: 30 }] }],
    },
    'last-hook': { PreInvocation: [{ type: 'command', command: 'echo last', timeout: 5 }] },
  };
  const original = `${JSON.stringify(initial, null, 2)}\n`;
  fs.writeFileSync(target, original);

  const dry = isolated(['hooks', '--tool', 'antigravity', '--home', home]);
  assert.strictEqual(dry.code, 0, dry.err);
  assert.match(dry.out, /^would replace orc-guard /m);
  assert.match(dry.out, /enabled was false/);
  assert.match(dry.out, /matcher "\*" -> "run_command"/);
  assert.match(dry.out, /timeout 30 -> 10/);
  assert.strictEqual(fs.readFileSync(target, 'utf8'), original, 'dry run writes nothing');

  const ap = isolated(['hooks', '--tool', 'antigravity', '--home', home, '--apply']);
  assert.strictEqual(ap.code, 0, ap.err);
  assert.match(ap.out, /^replaced orc-guard /m);
  const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.deepStrictEqual(Object.keys(parsed), ['first-hook', 'orc-guard', 'last-hook'], 'key order preserved');
  assert.deepStrictEqual(parsed['first-hook'], initial['first-hook']);
  assert.deepStrictEqual(parsed['last-hook'], initial['last-hook']);
  assert.strictEqual(parsed['orc-guard'].enabled, undefined);
  assert.strictEqual(parsed['orc-guard'].PreToolUse[0].matcher, 'run_command');
  assert.strictEqual(parsed['orc-guard'].PreToolUse[0].hooks[0].timeout, 10);

  // --remove takes out orc-guard only: both other named hooks stay, in order, with their values.
  const rm = isolated(['hooks', '--tool', 'antigravity', '--home', home, '--remove', '--apply']);
  assert.strictEqual(rm.code, 0, rm.err);
  const left = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.deepStrictEqual(Object.keys(left), ['first-hook', 'last-hook'], 'only orc-guard is removed');
  assert.deepStrictEqual(left['first-hook'], initial['first-hook']);
  assert.deepStrictEqual(left['last-hook'], initial['last-hook']);
  assert.ok(fs.readdirSync(path.dirname(target)).filter((f) => f.startsWith('hooks.json.orc-backup-')).length >= 2, 'each write is backed up');
});

test('setAntigravityGuard names each difference of an existing orc-guard', () => {
  const home = '/h';
  const entry = antigravityGuardEntry(home);
  const want = entry.PreToolUse[0].hooks[0].command;
  const diff = (prev) => setAntigravityGuard({ 'orc-guard': prev }, home).diff;
  const hook = (over) => ({ PreToolUse: [{ matcher: 'run_command', hooks: [{ ...entry.PreToolUse[0].hooks[0], ...over }] }] });
  assert.strictEqual(diff('x'), 'was "x"');
  assert.strictEqual(diff({ ...entry, enabled: true }), 'enabled was true');
  assert.strictEqual(diff({ ...entry, Stop: [], note: 1 }), 'extra key(s): Stop, note');
  assert.strictEqual(diff({ PreToolUse: [] }), 'PreToolUse was []');
  assert.strictEqual(diff({ PreToolUse: [{ matcher: 'run_command', hooks: [] }] }), 'PreToolUse hooks was []');
  assert.strictEqual(diff(hook({ type: 'script' })), 'type "script" -> "command"');
  assert.strictEqual(diff(hook({ command: 'node "/old/guard.mjs"' })), `command "node \\"/old/guard.mjs\\"" -> ${JSON.stringify(want)}`);
  assert.strictEqual(diff({ enabled: false, ...hook({ timeout: 30 }) }), 'enabled was false; timeout 30 -> 10');
  assert.strictEqual(setAntigravityGuard({ 'orc-guard': entry }, home).status, 'unchanged');
});

test('antigravityGuardScript: the script a node command runs, quoted or bare; none for another program; disabled', () => {
  const at = (command, extra = {}) => antigravityGuardScript({ ...extra, PreToolUse: [{ matcher: 'run_command', hooks: [{ type: 'command', command }] }] });
  assert.deepStrictEqual(at(`node '/my dir/guard.mjs'`), { command: `node '/my dir/guard.mjs'`, script: '/my dir/guard.mjs', disabled: false });
  assert.strictEqual(at('node "C:/My Tools/guard.mjs"').script, 'C:/My Tools/guard.mjs');
  assert.strictEqual(at('node /srv/orc/.gemini/tools/guard.mjs').script, '/srv/orc/.gemini/tools/guard.mjs');
  assert.strictEqual(at('node.exe "C:/Program Files/orc/guard.mjs"').script, 'C:/Program Files/orc/guard.mjs');
  assert.strictEqual(at('node.exe C:/orc/guard.mjs').script, 'C:/orc/guard.mjs');
  assert.strictEqual(at('NODE C:/orc/guard.mjs').script, 'C:/orc/guard.mjs', 'the program name is matched case-insensitively');
  assert.deepStrictEqual(at('python C:/orc/guard.py'), { command: 'python C:/orc/guard.py', script: null, disabled: false });
  assert.strictEqual(at('echo guard').script, null);
  assert.deepStrictEqual(at('node /x/guard.mjs', { enabled: false }), { command: 'node /x/guard.mjs', script: '/x/guard.mjs', disabled: true });
  assert.deepStrictEqual(antigravityGuardScript(null), { command: null, script: null, disabled: false });
  assert.deepStrictEqual(antigravityGuardScript({ enabled: false, PreToolUse: [{ hooks: [{ command: '  ' }] }] }), { command: null, script: null, disabled: true });
});

test('hooks --tool antigravity: one WARN for a Claude-style "hooks" key, left alone; --remove says removed only after the write', async () => {
  const home = tempDir('agy-hooks-wrapper');
  const target = path.join(home, '.gemini', 'config', 'hooks.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const wrapper = { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node x.mjs' }] }] };
  fs.writeFileSync(target, `${JSON.stringify({ hooks: wrapper }, null, 2)}\n`);
  const add = await run(['hooks', '--tool', 'antigravity', '--home', home, '--apply']);
  assert.strictEqual(add.code, 0, add.err);
  const warns = add.err.split('\n').filter((l) => l.includes('top-level key named "hooks"'));
  assert.deepStrictEqual(warns, [`WARN ${target} has a top-level key named "hooks", which Antigravity loads as a hook named "hooks" (a Claude Code-style wrapper?); orc leaves it alone`]);
  const added = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.deepStrictEqual(Object.keys(added), ['hooks', 'orc-guard']);
  assert.deepStrictEqual(added.hooks, wrapper, 'the "hooks" key is left alone');

  // A write that fails: the temp file writeSettings writes first is a folder, so nothing is said to be removed.
  const blocker = `${target}.orc-tmp-${process.pid}`;
  fs.mkdirSync(blocker);
  const failed = await run(['hooks', '--tool', 'antigravity', '--home', home, '--remove', '--apply']);
  fs.rmSync(blocker, { recursive: true });
  assert.strictEqual(failed.code, 1);
  assert.doesNotMatch(failed.out, /removed/);
  assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(target, 'utf8'))), ['hooks', 'orc-guard'], 'still there');
  const rem = await run(['hooks', '--tool', 'antigravity', '--home', home, '--remove', '--apply']);
  assert.strictEqual(rem.code, 0, rem.err);
  assert.match(rem.out, /^backed up: .*\nremoved orc-guard from .*hooks\.json\nupdated /);
  assert.match(rem.err, /top-level key named "hooks"/);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { hooks: wrapper });
});

test('uninstall --tool antigravity with no manifest still names a wired orc-guard', async () => {
  const home = tempDir('agy-uninstall-nomanifest');
  const target = path.join(home, '.gemini', 'config', 'hooks.json');
  assert.strictEqual((await run(['hooks', '--tool', 'antigravity', '--home', home, '--apply'])).code, 0);
  const un = await run(['uninstall', '--tool', 'antigravity', '--home', home]);
  assert.strictEqual(un.code, 1);
  assert.match(un.err, /no install manifest at .*: remove antigravity's files by hand/);
  assert.strictEqual(un.out, `note: ${target} still has orc-guard; run node tools/orc.mjs hooks --tool antigravity --home ${home} --remove --apply to remove it`);
  assert.strictEqual((await run(['hooks', '--tool', 'antigravity', '--home', home, '--remove', '--apply'])).code, 0);
  assert.strictEqual((await run(['uninstall', '--tool', 'antigravity', '--home', home])).out, '', 'no note once it is gone');
});

test('hooks --tool antigravity: keeps CRLF, tab indentation and BOM; refuses invalid JSON and non-object files', () => {
  const home = tempDir('agy-hooks-style');
  const target = path.join(home, '.gemini', 'config', 'hooks.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.mkdirSync(path.join(home, '.gemini', 'tools'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gemini', 'tools', 'guard.mjs'), '// guard\n');
  const orca = orcaStatusHooks();
  const crlfTab = `\uFEFF${JSON.stringify(orca, null, '\t').replace(/\n/g, '\r\n')}\r\n`;
  fs.writeFileSync(target, crlfTab);

  assert.strictEqual(isolated(['hooks', '--tool', 'antigravity', '--home', home, '--apply']).code, 0);
  const after = fs.readFileSync(target, 'utf8');
  assert.strictEqual(after.charCodeAt(0), 0xfeff, 'BOM preserved');
  assert.ok(after.includes('\r\n\t"orca-status": {\r\n\t\t'), 'tab indent and CRLF preserved');
  assert.ok(!after.replace(/\r\n/g, '').includes('\n'), 'no bare LF introduced');
  assert.ok(after.endsWith('\r\n'), 'trailing CRLF preserved');
  assert.strictEqual(isolated(['hooks', '--tool', 'antigravity', '--home', home, '--remove', '--apply']).code, 0);
  assert.strictEqual(fs.readFileSync(target, 'utf8'), crlfTab, 'round-trip remove restores exact CRLF/tab/BOM bytes');

  // Invalid JSON and non-object top levels are refused naming the path and writing nothing.
  for (const bad of ['{ broken', '[]', 'null', '"str"', '42']) {
    fs.writeFileSync(target, bad);
    for (const extra of [['--apply'], ['--remove', '--apply']]) {
      const r = isolated(['hooks', '--tool', 'antigravity', '--home', home, ...extra]);
      assert.strictEqual(r.code, 1, `${bad} ${extra.join(' ')}`);
      assert.ok(r.err.includes(target), `error names ${target}: ${r.err}`);
      assert.strictEqual(fs.readFileSync(target, 'utf8'), bad, 'file untouched');
    }
  }
});

test('hooks --tool validation: unsupported tool errors naming both supported tools; claude-code default unchanged', () => {
  const home = tempDir('agy-hooks-opts');
  const badTool = isolated(['hooks', '--tool', 'cursor', '--home', home]);
  assert.strictEqual(badTool.code, 1);
  assert.match(badTool.err, /unsupported tool cursor/);
  assert.match(badTool.err, /claude-code/);
  assert.match(badTool.err, /antigravity/);

  // --remove is antigravity-only; --node is claude-code-only; --remove on other commands is refused.
  assert.strictEqual(isolated(['hooks', '--home', home, '--remove']).code, 1);
  assert.match(isolated(['hooks', '--tool', 'claude-code', '--home', home, '--remove']).err, /--remove is for --tool antigravity only/);
  assert.match(isolated(['hooks', '--tool', 'antigravity', '--home', home, '--node']).err, /--node is for --tool claude-code only/);
  assert.match(isolated(['install', '--tool', 'antigravity', '--home', home, '--remove']).err, /--remove applies to hooks only/);

  // Explicit --tool claude-code behaves identically to no --tool.
  const h1 = tempDir('hooks-cc-default');
  const h2 = tempDir('hooks-cc-explicit');
  const r1 = isolated(['hooks', '--home', h1, '--node', '--apply']);
  const r2 = isolated(['hooks', '--tool', 'claude-code', '--home', h2, '--node', '--apply']);
  assert.strictEqual(r1.code, 0, r1.err);
  assert.strictEqual(r2.code, 0, r2.err);
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(path.join(h1, '.claude', 'settings.json'), 'utf8')).hooks.PreToolUse[0].matcher,
    JSON.parse(fs.readFileSync(path.join(h2, '.claude', 'settings.json'), 'utf8')).hooks.PreToolUse[0].matcher,
  );
});

// ---------- board-reminder.mjs ----------

const BOARD_RULEBOOK = "# Orchestration\n\n- **Board:** this machine's board address is `http://localhost:8377`; write it with `node \"C:/b/local/board.js\"`.\n";
const KIT_RULEBOOK = '# Orchestration\n\n- **Board:** none on this machine (sprint kit). Skip every board write.\n';

test('board-reminder.mjs: mark, relay, silence and subagent calls (keyed on CLAUDE.md Board line)', (t) => {
  const root = tempDir('reminder');
  const hook = (o) => JSON.stringify({ session_id: 's-1', hook_event_name: 'PostToolUse', ...o });
  // No CLAUDE.md (even with retired board.local.md present): silent, writes nothing.
  fs.writeFileSync(path.join(root, 'board.local.md'), 'http://localhost:8377\n');
  assert.equal(reminder('mark', hook({ agent_type: 'builder', agent_id: 'a1' }), root, Date.now()), '');
  assert.ok(!fs.existsSync(path.join(root, 'board-reminders')));
  // CLAUDE.md without the Board line, and sprint kit's `- **Board:** none` line: silent, writes nothing.
  for (const content of ['# Orchestration\n\nNo board here.\n', KIT_RULEBOOK, '']) {
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), content);
    assert.equal(reminder('mark', hook({ agent_type: 'builder', agent_id: 'a1' }), root, Date.now()), '', content);
    assert.ok(!fs.existsSync(path.join(root, 'board-reminders')), content);
  }
  // Unreadable CLAUDE.md (a directory): off silently.
  fs.rmSync(path.join(root, 'CLAUDE.md'));
  fs.mkdirSync(path.join(root, 'CLAUDE.md'));
  assert.equal(reminder('mark', hook({ agent_type: 'builder', agent_id: 'a1' }), root, Date.now()), '');
  assert.ok(!fs.existsSync(path.join(root, 'board-reminders')));
  fs.rmSync(path.join(root, 'CLAUDE.md'), { recursive: true });

  // UTF-8 BOM right before the Board line on line 1 is stripped and recognised.
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), `\uFEFF- **Board:** this machine's board address is \`https://claude.ai/artifact/x\`.\n`);
  // Relay with no markers stops before reading CLAUDE.md or stdin.
  const reads = [];
  const origRead = fs.readFileSync;
  const spy = t.mock.method(fs, 'readFileSync', (...a) => {
    reads.push(String(a[0]));
    return origRead(...a);
  });
  assert.equal(reminder('relay', 'not json', root, Date.now()), '');
  assert.deepEqual(reads, [], 'relay with no markers must not read CLAUDE.md');
  spy.mock.restore();

  // Mark: only builder, refuter, debugger.
  assert.equal(reminder('mark', hook({ agent_type: 'scout', agent_id: 'a0' }), root, Date.now()), '');
  assert.ok(!fs.existsSync(path.join(root, 'board-reminders')));
  reminder('mark', hook({ agent_type: 'builder', agent_id: 'a1' }), root, Date.now());
  // Also works with a multi-line CLAUDE.md without BOM.
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), BOARD_RULEBOOK);
  reminder('mark', hook({ agent_type: 'refuter', agent_id: 'a/2' }), root, Date.now());
  reminder('mark', JSON.stringify({ session_id: 'other', agent_type: 'debugger', agent_id: 'x' }), root, Date.now());
  const dir = path.join(root, 'board-reminders');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['other.x', 's-1.a1', 's-1.a2']);
  // A relay inside a subagent is ignored.
  assert.equal(reminder('relay', hook({ agent_id: 'a1' }), root, Date.now()), '');
  // An empty marker (killed mid-write) is cleared without naming an agent.
  fs.writeFileSync(path.join(dir, 's-2.e'), '');
  const empty = JSON.parse(reminder('relay', JSON.stringify({ session_id: 's-2', hook_event_name: 'UserPromptSubmit' }), root, Date.now()));
  assert.match(empty.hookSpecificOutput.additionalContext, /^Board: An agent finished\./);
  // Relay names the session's agents, clears its markers and keeps others.
  const out = JSON.parse(reminder('relay', hook({}), root, Date.now()));
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(out.hookSpecificOutput.additionalContext, /^Board: builder, refuter finished\. Update this session's now and events/);
  assert.deepEqual(fs.readdirSync(dir), ['other.x']);
  // Old markers expire on the next mark.
  const old = path.join(dir, 'other.x');
  const past = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  fs.utimesSync(old, past, past);
  reminder('mark', hook({ agent_type: 'debugger', agent_id: 'd' }), root, Date.now());
  assert.deepEqual(fs.readdirSync(dir), ['s-1.d']);
});

test('board-reminder.mjs as a hook process: stdin JSON in, context out, exit 0 on bad input', () => {
  const root = tempDir('reminder');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), BOARD_RULEBOOK);
  const script = path.join(REPO, 'tools', 'board-reminder.mjs');
  const env = { ...process.env, BOARD_REMINDER_ROOT: root };
  const mark = spawnSync(process.execPath, [script, 'mark'], { env, input: JSON.stringify({ session_id: 's', agent_type: 'builder', agent_id: 'b' }), encoding: 'utf8' });
  assert.equal(mark.status, 0);
  assert.equal(mark.stdout, '');
  const relay = spawnSync(process.execPath, [script, 'relay'], { env, input: JSON.stringify({ session_id: 's', hook_event_name: 'UserPromptSubmit' }), encoding: 'utf8' });
  assert.equal(relay.status, 0);
  assert.match(JSON.parse(relay.stdout).hookSpecificOutput.additionalContext, /^Board: builder finished/);
  fs.mkdirSync(path.join(root, 'board-reminders'), { recursive: true });
  fs.writeFileSync(path.join(root, 'board-reminders', 's.z'), 'builder\n');
  const bad = spawnSync(process.execPath, [script, 'relay'], { env, input: '{not json', encoding: 'utf8' });
  assert.equal(bad.status, 0);
  assert.match(bad.stderr, /^board-reminder: /);
});

test('board-reminder.ps1 keys on CLAUDE.md Board line and stays silent without it, for sprint kit, or when missing', { skip: process.platform !== 'win32' && 'PowerShell board-reminder is Windows only' }, () => {
  const root = tempDir('reminder-ps1');
  const script = path.join(REPO, 'tools', 'board-reminder.ps1');
  const runPs = (mode, input) => spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Mode', mode], {
    env: { ...process.env, BOARD_REMINDER_ROOT: root },
    input,
    encoding: 'utf8',
  });
  const markIn = JSON.stringify({ session_id: 's', agent_type: 'builder', agent_id: 'b' });
  // Absent CLAUDE.md, even with retired board.local.md: silent, writes no marker.
  fs.writeFileSync(path.join(root, 'board.local.md'), 'http://localhost:8377\n');
  const off = runPs('mark', markIn);
  assert.equal(off.status, 0, off.stderr);
  assert.equal(off.stdout, '');
  assert.equal(off.stderr, '');
  assert.ok(!fs.existsSync(path.join(root, 'board-reminders')));
  // Relay with no markers and no CLAUDE.md: silent, exit 0.
  const noMarkers = runPs('relay', '{not json');
  assert.equal(noMarkers.status, 0, noMarkers.stderr);
  assert.equal(noMarkers.stdout, '');
  assert.equal(noMarkers.stderr, '');
  // Plain CLAUDE.md without Board line, or sprint kit's `- **Board:** none` line: silent.
  for (const raw of ['# Orchestration\n', KIT_RULEBOOK, '']) {
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), raw);
    const r = runPs('mark', markIn);
    assert.equal(r.status, 0, raw);
    assert.equal(r.stderr, '', raw);
    assert.ok(!fs.existsSync(path.join(root, 'board-reminders')), raw);
  }
  // Valid Board line (including with a UTF-8 BOM): mark + relay fire.
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), `\uFEFF${BOARD_RULEBOOK}`);
  assert.equal(runPs('mark', markIn).status, 0);
  const relay = runPs('relay', JSON.stringify({ session_id: 's', hook_event_name: 'UserPromptSubmit' }));
  assert.equal(relay.status, 0, relay.stderr);
  assert.match(JSON.parse(relay.stdout).hookSpecificOutput.additionalContext, /^Board: builder finished/);
});

// ---------- models validation ----------

test('models validation rejects bad ids, tiers, efforts and values in both files; check reports it', async () => {
  const copy = tempDir('models');
  for (const p of ['core', 'models.json', 'adapters', 'tools/lib', 'tests/golden']) {
    fs.cpSync(path.join(REPO, p), path.join(copy, p), { recursive: true });
  }
  const base = JSON.parse(fs.readFileSync(path.join(REPO, 'models.json'), 'utf8'));
  const cases = [
    [{ nosuchtool: { low: { model: 'x' } } }, /unknown tool id "nosuchtool"/],
    [{ codex: { huge: { model: 'x' } } }, /codex: unknown tier key "huge"/],
    [{ codex: { mid: { effort: 'extreme' } } }, /codex\.mid\.effort: must be one of low, medium, high, xhigh, max, ultra/],
    [{ codex: { low: { model: 5 } } }, /codex\.low\.model: must be a string/],
    [{ antigravity: { headless: { low: 7 } } }, /antigravity\.headless\.low: model must be a string/],
    [{ antigravity: { headless: { turbo: 'x' } } }, /antigravity\.headless: unknown tier key "turbo"/],
  ];
  for (const [bad, re] of cases) {
    fs.writeFileSync(path.join(copy, 'models.local.json'), JSON.stringify(bad));
    assert.throws(() => loadModels(copy), (e) => /^models\.local\.json: /.test(e.message) && re.test(e.message) && !e.message.includes('extreme'), JSON.stringify(bad));
    const c = await run(['check', '--repo', copy]);
    assert.equal(c.code, 1);
    assert.match(c.err, re);
    assert.doesNotMatch(c.err, /extreme/);
    fs.rmSync(path.join(copy, 'models.local.json'));
    const [tool] = Object.keys(bad);
    const merged = { ...base, [tool]: { ...(base[tool] ?? {}), ...bad[tool] } };
    fs.writeFileSync(path.join(copy, 'models.json'), JSON.stringify(merged));
    assert.throws(() => loadModels(copy, { local: false }), (e) => /^models\.json: /.test(e.message) && re.test(e.message) && !e.message.includes('extreme'));
    fs.writeFileSync(path.join(copy, 'models.json'), JSON.stringify(base));
  }
  assert.doesNotThrow(() => loadModels(copy));
});

test('dispatch refuses an argv brief over the command-line limit or with a NUL; nothing is spawned', () => {
  const dir = tempDir('stub-big');
  const env = { ORC_TOOL_BIN_ANTIGRAVITY: stub(dir) };
  const big = briefFile(goodBrief({ 7: `context ${'x'.repeat(40000)}` }));
  const r = isolated(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', big], env);
  assert.equal(r.code, 1);
  assert.match(r.err, /brief is \d+ bytes; this tool takes the brief as a command-line argument, limit about 32,000 on Windows/);
  const nul = briefFile(goodBrief({ 7: 'has a \0 byte' }));
  const n = isolated(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', nul], env);
  assert.equal(n.code, 1);
  assert.match(n.err, /NUL byte/);
  assert.ok(!fs.existsSync(path.join(dir, 'argv.json')), 'the stub never ran');
});

test('dispatch names the executable and the override when the tool is not installed', () => {
  const missing = path.join(tempDir('nobin'), 'agy-not-here.exe');
  const r = isolated(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', briefFile()], { ORC_TOOL_BIN_ANTIGRAVITY: missing });
  assert.equal(r.code, 127);
  // The override is already set, so the hint names it and the path it gives, not "set it".
  assert.match(r.err, /cannot start .*agy-not-here\.exe: ORC_TOOL_BIN_ANTIGRAVITY names .*agy-not-here\.exe, which does not exist; point it at the real executable/);
  assert.doesNotMatch(r.err, /set ORC_TOOL_BIN_ANTIGRAVITY to its full path/);
  // The dry run says the same before anything starts.
  const dry = isolated(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', briefFile(), '--dry-run'], { ORC_TOOL_BIN_ANTIGRAVITY: missing });
  assert.equal(dry.code, 0, dry.err);
  assert.ok(dry.out.includes(`note: ORC_TOOL_BIN_ANTIGRAVITY names ${missing}, which does not exist`), dry.out);
});

test('gemini-cli gap says the headless syntax exists and why dispatch does not use it', async () => {
  const gemini = (await import('../adapters/gemini-cli.mjs')).default;
  assert.ok(gemini.gaps.some((g) => /`gemini -p "<prompt>" -m <model> -o json` is documented, but no flag selects a subagent/.test(g)));
  assert.equal(typeof gemini.headless, 'undefined');
});

test('a tool whose tiers share a model in models.json has a gap naming those tiers; others have none', async () => {
  const models = JSON.parse(fs.readFileSync(path.join(REPO, 'models.json'), 'utf8'));
  const collapsed = [];
  for (const [tool, tiers] of Object.entries(models)) {
    const byModel = {};
    // A tier with no model runs the tool's default, so tiers without one share that model.
    for (const t of ['low', 'mid', 'high']) (byModel[tiers[t]?.model ?? '(default)'] ??= []).push(t);
    const shared = Object.values(byModel).filter((ts) => ts.length > 1).flat();
    const adapter = (await import(`../adapters/${tool}.mjs`)).default;
    const gap = adapter.gaps.find((g) => /tier override/.test(g));
    if (!shared.length) {
      assert.equal(gap, undefined, `${tool}: no tiers share a model, so no tier-override gap`);
      continue;
    }
    collapsed.push(tool);
    assert.ok(gap, `${tool}: tiers ${shared.join(', ')} share a model but no gap says so`);
    for (const t of shared) assert.match(gap, new RegExp(`\\b${t}\\b`, 'i'), `${tool}: gap names ${t}`);
  }
  assert.ok(collapsed.length > 0 && collapsed.length < Object.keys(models).length, 'the check covers both branches');
});

test('review-tier: prompts count as product; uncommitted changes warn', async () => {
  for (const p of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'core/AGENTS.md', 'core/roles/scout.md', '.claude/x.md', '.agents/x.md', '.agents/skills/ship-prompts/SKILL.md', '.codex/AGENTS.md',
    '.cursor/agents/a.md', '.gemini/GEMINI.md', 'profiles/p.md', 'adapters/codex.notes.md', 'adapters/claude-code/commands/start.md', 'adapters/claude-code/skills/orc-permissions/SKILL.md',
    'skills/x/SKILL.md', 'a/b.agent.md', 'review/PROCEDURE.md', 'review/lanes/code-reviewer.md', 'workflows/start.md']) {
    assert.equal(classify([p]).tier, 'Full', p);
  }
  assert.equal(classify(['README.md', 'docs/rulebook-notes.md', 'tests/a.test.mjs']).tier, 'Light-eligible');
  // Root roles/, agents/ and commands/ Markdown count as product (other repos keep prompts there), alongside core/.
  for (const p of ['roles/scout.md', 'agents/scout.md', 'commands/start.md']) assert.equal(classify([p]).tier, 'Full', p);
  // Only the top-level prompt folders: a docs page about them stays Light-eligible.
  assert.equal(classify(['docs/review/notes.md', 'docs/workflows.md', 'docs/adapters/x.md', 'docs/roles/scout.md', 'docs/agents/scout.md', 'docs/commands/start.md']).tier, 'Light-eligible');
  for (const p of ['review/PROCEDURE.md', 'workflows/start.md', 'adapters/claude-code/commands/start.md']) {
    const d = repoWith({ [p]: 'a\n', 'README.md': 'r\n' });
    commit(d, (dir) => fs.writeFileSync(path.join(dir, p), 'b\n'));
    assert.match((await run(['review-tier', '--base', 'base', '--repo-dir', d])).out, new RegExp(`^Full: .*${p.replace('.', '\\.')}`, 'm'), p);
  }
  // Every tracked file in the prompt folders counts as product, not only the samples above.
  // The routine procedures and the sprint assets the generated skills point at are product too.
  const procs = ['orchestration/board.md', 'orchestration/brief.md', 'orchestration/wrap-up.md', 'orchestration/sprint.md', 'orchestration/standards.md'];
  const tracked = spawnSync('git', ['ls-files', 'review', 'workflows', 'adapters/claude-code', 'orchestration/sprint', 'core', ...procs], { cwd: REPO, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  for (const dir of ['review/', 'workflows/', 'adapters/claude-code/', 'orchestration/sprint/', 'core/procedures.mjs', ...procs]) assert.ok(tracked.some((p) => p.startsWith(dir)), `tracked files under ${dir}`);
  for (const p of tracked) assert.equal(classify([p]).tier, 'Full', p);
  // The cost-log template the rulebook points at is tracked; the cost logs beside it stay ignored.
  const git = (...a) => spawnSync('git', a, { cwd: REPO, encoding: 'utf8' });
  assert.equal(git('ls-files', 'orchestration/log').stdout.trim(), 'orchestration/log/TEMPLATE.md');
  assert.equal(git('check-ignore', 'orchestration/log/2026-01-01-x-y.md').status, 0, 'a cost log is ignored');
  const start = { 'README.md': 'r\n' };
  const dir = repoWith(start);
  commit(dir, (d) => fs.writeFileSync(path.join(d, 'README.md'), 'r2\n'));
  const clean = await run(['review-tier', '--base', 'base', '--repo-dir', dir]);
  assert.doesNotMatch(clean.err, /uncommitted/);
  fs.writeFileSync(path.join(dir, 'src.js'), 'x\n');
  const dirty = await run(['review-tier', '--base', 'base', '--repo-dir', dir]);
  assert.match(dirty.err, /WARN 1 uncommitted change\(s\) are not in base\.\.\.HEAD/);
  assert.match(dirty.out, /^Light-eligible/);
});

test('hooks: a non-object settings file is refused; a BOM is kept; a failed write leaves no backup', () => {
  const home = tempDir('hookhome');
  const file = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const text of ['[]', '"x"', 'null', '3']) {
    fs.writeFileSync(file, text);
    const r = isolated(['hooks', '--home', home, '--apply']);
    assert.equal(r.code, 1, text);
    assert.match(r.err, /not a JSON object at the top level; nothing written/);
    assert.equal(fs.readFileSync(file, 'utf8'), text);
  }
  fs.writeFileSync(file, '\uFEFF{\n  "model": "mine"\n}\n');
  assert.equal(isolated(['hooks', '--home', home, '--apply']).code, 0);
  const after = fs.readFileSync(file, 'utf8');
  assert.equal(after.charCodeAt(0), 0xfeff, 'BOM kept');
  assert.equal(JSON.parse(after.slice(1)).model, 'mine');
  // A directory where the temp file goes makes the write fail before any backup is made.
  const home2 = tempDir('hookhome');
  const file2 = path.join(home2, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file2), { recursive: true });
  fs.writeFileSync(file2, '{}\n');
  const fakeHome = tempDir('fakehome');
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
  const pre = `
    const fs = require('node:fs'); const real = fs.writeFileSync;
    fs.writeFileSync = (p, ...a) => { if (String(p).includes('.orc-tmp-')) { const e = new Error('EACCES: denied'); e.code = 'EACCES'; throw e; } return real(p, ...a); };`;
  const preFile = path.join(tempDir('pre'), 'deny.cjs');
  fs.writeFileSync(preFile, pre);
  const r = spawnSync(process.execPath, ['--require', preFile, ORC, 'hooks', '--home', home2, '--apply'], { env, encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /EACCES/);
  assert.deepEqual(fs.readdirSync(path.dirname(file2)), ['settings.json'], 'no backup and no temp file left');
  assert.deepEqual(fs.readdirSync(fakeHome), []);
});

test('brief lint: text outside the items, a command-like item 4, and BOARD: none', () => {
  const items = parseMarchingOrders(AGENTS);
  assert.deepEqual(lintBrief(`# Brief for scout\n\n${goodBrief()}\n`, items), [], 'a title heading is allowed');
  assert.match(lintBrief(`Hello agent,\n${goodBrief()}`, items).join('\n'), /line 1: text before item 1: "Hello agent,"/);
  // Lines after an item's number belong to that item, indented or not: real briefs put unindented bullets and
  // lettered sub-steps under an item. (An earlier rule called these "text outside the items" and refused them.)
  const realistic = goodBrief({
    2: 'Files:\n- src/a.ts\n- src/b.ts',
    4: 'Run every item:\na. `npm test`\nb. `node tools/orc.mjs check`\n\nPaste the tails.',
    5: 'Known traps:\n* do not push\n* do not touch the real home',
  });
  assert.deepEqual(lintBrief(realistic, items), [], 'unindented bullets and lettered lines under an item are part of it');
  assert.deepEqual(lintBrief(`${goodBrief()}\n\nThanks, and good luck\n`, items), [], 'closing text is part of the last item');
  assert.match(lintBrief(goodBrief({ 2: '' }), items).join('\n'), /item 2 \(Scope\) is empty/);
  assert.match(lintBrief(`${goodBrief()}\n12. one more\n   x`, items).join('\n'), /item 12 is past the rulebook's 11 items/);
  assert.match(lintBrief(goodBrief({ 4: 'Make sure the node tests pass' }), items).join('\n'), /item 4 \(Must verify\) names no command/);
  assert.deepEqual(lintBrief(goodBrief({ 4: 'node --test tests/' }), items), []);
  assert.deepEqual(lintBrief(goodBrief({ 4: '```\n   npm test\n   ```' }), items), []);
  assert.deepEqual(lintBrief(goodBrief({ 11: 'BOARD: none' }), items, 'refuter'), []);
  assert.match(lintBrief(goodBrief({ 11: 'BOARD: nothing' }), items).join('\n'), /BOARD line does not match/);
});

test('costlog: malformed events are skipped and counted; an end event with no time is not also "no end event"', () => {
  for (const events of [{ text: 'x' }, 'nope', 7, [1, 'a', null, ['x'], { text: 5 }]]) {
    const data = { sessions: { s: { title: 't', events } }, cards: {} };
    const md = costlog(data, 's');
    assert.match(md, /## Totals/, JSON.stringify(events));
  }
  const bad = costlog({ sessions: { s: { events: [1, 'a', null, { at: '2026-11-15T09:00:00Z', text: 'scout dispatched on #a', card: 'c' }] } }, cards: {} }, 's');
  assert.match(bad, /TODO: 3 board event\(s\) skipped/);
  const noAt = costlog({ sessions: { s: { events: [
    { at: '2026-11-15T09:00:00Z', text: 'scout dispatched on #a', card: 'c' },
    { text: 'scout done: 2 paths', card: 'c' },
  ] } }, cards: {} }, 's');
  const row = noAt.split('\n').find((l) => l.startsWith('| 1 |'));
  assert.match(row, /TODO \(no time on the start or end event\) \| scout done: 2 paths/);
  assert.doesNotMatch(noAt, /no end event/);
});

test('hooks: a settings file that cannot be replaced leaves no stray backup or temp file', () => {
  const home = tempDir('hooks-ro');
  const dir = path.join(home, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'settings.json');
  fs.writeFileSync(target, '{"a":1}\n');
  fs.chmodSync(target, 0o444);
  const fakeHome = tempDir('fakehome');
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
  const r = spawnSync(process.execPath, [ORC, 'hooks', '--home', home, '--apply'], { env, encoding: 'utf8' });
  fs.chmodSync(target, 0o644);
  const left = fs.readdirSync(dir);
  if (r.status !== 0) {
    // Windows refuses to rename over a read-only file: the original must be intact with nothing beside it.
    assert.equal(fs.readFileSync(target, 'utf8'), '{"a":1}\n');
    assert.deepEqual(left, ['settings.json']);
  } else {
    // POSIX allows the rename: then exactly one backup holds the original.
    assert.equal(left.filter((f) => f.includes('.orc-backup-')).length, 1);
    assert.ok(!left.some((f) => f.includes('.orc-tmp-')));
  }
  assert.deepEqual(fs.readdirSync(fakeHome), []);
});

// ---------- final rework R1-R10 ----------

test('R1/R8: UTF-16 LE and UTF-8-BOM briefs reach the tool as the decoded UTF-8 text', () => {
  const text = goodBrief({ 7: 'Unicode: café → ✓' });
  const encodings = {
    utf16le: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text.replace(/\n/g, '\r\n'), 'utf16le')]),
    bom: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]),
  };
  for (const [name, bytes] of Object.entries(encodings)) {
    const brief = path.join(tempDir('enc'), `${name}.md`);
    fs.writeFileSync(brief, bytes);
    for (const [tool, role] of [['antigravity', 'scout'], ['claude-code', 'builder']]) {
      const dir = tempDir('stub');
      const env = { [`ORC_TOOL_BIN_${tool.toUpperCase().replace('-', '_')}`]: stub(dir) };
      const r = isolated(['dispatch', '--tool', tool, '--role', role, '--brief', brief], env);
      assert.equal(r.code, 0, `${name} ${tool}: ${r.err}`);
      const got = tool === 'antigravity'
        ? JSON.parse(fs.readFileSync(path.join(dir, 'argv.json'), 'utf8'))[1]
        : fs.readFileSync(path.join(dir, 'stdin.txt'), 'utf8');
      assert.equal(got, text, `${name} ${tool}: decoded once, clean UTF-8`);
    }
  }
});

test('R8: costlog reads a UTF-16 LE export', async () => {
  const file = path.join(tempDir('cost16'), 'export.json');
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify(EXPORT), 'utf16le')]));
  const r = await run(['costlog', '--session', SID, '--board-export', file]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /\| 1 \| builder \|/);
});

test('R4: costlog --board takes a 3 MB export from the board CLI', async () => {
  const boardRepo = tempDir('bigboard');
  fs.mkdirSync(path.join(boardRepo, 'local'));
  const big = structuredClone(EXPORT);
  big.cards.padding = { session: 'other', title: 'x'.repeat(3 * 1024 * 1024) };
  fs.writeFileSync(path.join(boardRepo, 'local', 'export.json'), JSON.stringify(big));
  fs.writeFileSync(path.join(boardRepo, 'local', 'board.js'), "process.stdout.write(require('node:fs').readFileSync(__dirname + '/export.json'));\n");
  fs.writeFileSync(path.join(boardRepo, 'package.json'), '{"type":"commonjs"}');
  const r = await run(['costlog', '--session', SID, '--board', 'http://localhost:8399', '--board-repo', boardRepo]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /\| 1 \| builder \|/);
});

test('R2: board-reminder.mjs runs when started through a junction or symlink', (t) => {
  const link = path.join(tempDir('rlink'), 'tools');
  try {
    fs.symlinkSync(path.join(REPO, 'tools'), link, 'junction');
  } catch (e) {
    t.skip(`cannot create a directory link here (${e.code})`);
    return;
  }
  const root = tempDir('reminder');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), BOARD_RULEBOOK);
  fs.mkdirSync(path.join(root, 'board-reminders'));
  fs.writeFileSync(path.join(root, 'board-reminders', 's.a'), 'builder\n');
  const r = spawnSync(process.execPath, [path.join(link, 'board-reminder.mjs'), 'relay'], {
    env: { ...process.env, BOARD_REMINDER_ROOT: root },
    input: JSON.stringify({ session_id: 's', hook_event_name: 'UserPromptSubmit' }),
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Board: builder finished/);
});

const NO_SIGNALS = process.platform === 'win32'
  && 'Windows cannot deliver SIGINT/SIGTERM to another process; process.kill there terminates orc without running its handlers';

test('R3: a signal to orc kills the dispatched tree', { skip: NO_SIGNALS }, async () => {
  const { spawn } = await import('node:child_process');
  const fakeHome = tempDir('fakehome');
  for (const [sig, code] of [['SIGTERM', 143], ['SIGINT', 130]]) {
    const dir = tempDir('stub');
    const child = spawn(process.execPath, [ORC, 'dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', briefFile()], {
      env: agentFree({ ...process.env, HOME: fakeHome, USERPROFILE: fakeHome }, { ORC_TOOL_BIN_ANTIGRAVITY: stub(dir), STUB_SLEEP: '1' }),
      stdio: 'ignore',
    });
    const until = Date.now() + 15000;
    while (!fs.existsSync(path.join(dir, 'grandchild.pid')) && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 200));
    const exited = new Promise((r) => child.on('exit', (c) => r(c)));
    child.kill(sig);
    assert.equal(await exited, code, sig);
    for (const f of ['stub.pid', 'grandchild.pid']) {
      const pid = Number(fs.readFileSync(path.join(dir, f), 'utf8'));
      const end = Date.now() + 5000;
      while (alive(pid) && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
      assert.equal(alive(pid), false, `${sig}: ${f} killed`);
    }
  }
  assert.deepEqual(fs.readdirSync(fakeHome), []);
});

test('R7: --timeout must be a whole number from 1 to 86400 seconds', () => {
  const brief = briefFile();
  for (const bad of ['3600000', '0', '1.5', '86401', '-1e3']) {
    const r = isolated(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', brief, `--timeout=${bad}`, '--dry-run']);
    assert.equal(r.code, 1, bad);
    assert.ok(r.err.includes(`--timeout needs a whole number of seconds from 1 to 86400, got ${bad}`), r.err);
    assert.doesNotMatch(r.out, /command:/, 'nothing planned or started');
  }
  assert.equal(isolated(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', brief, '--timeout', '86400', '--dry-run']).code, 0);
});

test('R9: --out refuses to overwrite an existing file unless --force', async () => {
  const dir = tempDir('out');
  const exportFile = path.join(dir, 'export.json');
  fs.writeFileSync(exportFile, JSON.stringify(EXPORT));
  for (const argv of [['brief', 'new'], ['costlog', '--session', SID, '--board-export', exportFile]]) {
    const out = path.join(dir, `${argv[0]}.md`);
    fs.writeFileSync(out, 'mine\n');
    const r = await run([...argv, '--out', out]);
    assert.equal(r.code, 1, argv[0]);
    assert.ok(r.err.includes(`refusing to overwrite ${out}; pass --force`), r.err);
    assert.equal(fs.readFileSync(out, 'utf8'), 'mine\n');
    assert.equal((await run([...argv, '--out', out, '--force'])).code, 0);
    assert.notEqual(fs.readFileSync(out, 'utf8'), 'mine\n');
  }
});

test('R10: the same command under another matcher is added beside it, with a note; the old entry is untouched', () => {
  const home = tempDir('hookhome');
  const file = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const group = EXAMPLE.hooks.PostToolUse.find((g) => g.matcher.startsWith('Agent|ArtifactData'));
  const relay = group.hooks[0].command.replaceAll('C:\\Users\\<you>', home);
  const old = { matcher: 'Agent', hooks: [{ type: 'command', command: relay, timeout: 10 }] };
  fs.writeFileSync(file, `${JSON.stringify({ hooks: { PostToolUse: [old] } }, null, 2)}\n`);
  const r = isolated(['hooks', '--home', home, '--apply']);
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.includes(`added PostToolUse [${group.matcher}]: ${relay}`), r.out);
  assert.match(r.out, /note: the same command already runs under matcher "Agent"; that entry is left as it is/);
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(s.hooks.PostToolUse[0], old, 'old entry first and intact');
  assert.ok(s.hooks.PostToolUse.some((g) => g.matcher === group.matcher && g.hooks.some((h) => h.command === relay)));
  assert.match(isolated(['hooks', '--home', home, '--apply']).out, /nothing to add/);
});

test('R6: install options are remembered; plain status and install reuse them; --no-profile clears', async () => {
  const home = tempDir('opthome');
  const boardRepo = tempDir('boardrepo');
  const base = ['--tool', 'claude-code', '--home', home];
  const manifest = () => JSON.parse(fs.readFileSync(path.join(home, '.claude', '.orc-manifest.claude-code.json'), 'utf8'));
  const first = await run(['install', ...base, '--profile', 'dotnet-azure-devops', '--board', 'http://localhost:8377', '--board-repo', boardRepo, '--apply']);
  assert.equal(first.code, 0, first.err);
  assert.deepEqual(manifest().options, { profiles: ['dotnet-azure-devops'], board: 'http://localhost:8377', boardRepo });
  const st = await run(['status', ...base]);
  assert.equal(st.code, 0, st.out);
  assert.match(st.out, /using the options recorded at install: profile dotnet-azure-devops; board http:\/\/localhost:8377/);
  assert.match(st.out, /all same/);
  const again = await run(['install', ...base, '--apply']);
  assert.equal(again.code, 0, again.err);
  assert.doesNotMatch(again.out, /applied (create|replace)/, 'everything unchanged');
  const rulebook = path.join(home, '.claude', 'CLAUDE.md');
  assert.match(fs.readFileSync(rulebook, 'utf8'), /# Profile: dotnet-azure-devops/);
  assert.match(fs.readFileSync(rulebook, 'utf8'), /\*\*Board:\*\* this machine's board address is `http:\/\/localhost:8377`/);
  const cleared = await run(['install', ...base, '--no-profile', '--apply']);
  assert.equal(cleared.code, 0, cleared.err);
  assert.doesNotMatch(fs.readFileSync(rulebook, 'utf8'), /# Profile:/);
  assert.match(fs.readFileSync(rulebook, 'utf8'), /\*\*Board:\*\*/, 'the board is kept when only the profile is cleared');
  assert.deepEqual(manifest().options.profiles, []);
  const noBoard = await run(['install', ...base, '--no-board', '--apply']);
  assert.equal(noBoard.code, 0, noBoard.err);
  assert.doesNotMatch(fs.readFileSync(rulebook, 'utf8'), /\*\*Board:\*\*/);
  assert.equal((await run(['install', ...base, '--no-board', '--board', 'http://localhost:1', '--board-repo', boardRepo])).code, 1);
  assert.equal((await run(['build', '--no-profile'])).code, 1);
});

// A temp copy of the repo with its goldens, for the golden command.
function goldenRepo(name) {
  const copy = tempDir(name);
  for (const p of ['core', 'models.json', 'adapters', 'tools/lib', 'tests/golden']) {
    fs.cpSync(path.join(REPO, p), path.join(copy, p), { recursive: true });
  }
  return copy;
}

test('golden: an unchanged copy reports every file unchanged', async () => {
  const copy = goldenRepo('golden-same');
  const r = await run(['golden', '--repo', copy]);
  assert.equal(r.code, 0, r.err);
  const lines = r.out.split('\n');
  const goldenFiles = fs.readdirSync(path.join(copy, 'tests', 'golden'), { recursive: true, withFileTypes: true }).filter((d) => d.isFile());
  assert.equal(lines.length, goldenFiles.length);
  assert.ok(lines.every((l) => l.startsWith('unchanged tests/golden/')), r.out);
});

test('golden: a role edit rewrites that role in every adapter; a stale golden is deleted', async () => {
  const copy = goldenRepo('golden-edit');
  const role = path.join(copy, 'core', 'roles', 'scout.md');
  fs.writeFileSync(role, `${fs.readFileSync(role, 'utf8').replace(/\r\n/g, '\n')}Extra golden line.\n`);
  const stale = path.join(copy, 'tests', 'golden', 'codex', '.codex', 'agents', 'gone.toml');
  fs.writeFileSync(stale, 'old\n');
  const r = await run(['golden', '--repo', copy]);
  assert.equal(r.code, 0, r.err);
  const wrote = r.out.split('\n').filter((l) => l.startsWith('wrote '));
  const tools = ['antigravity', 'claude-code', 'codex', 'copilot', 'cursor', 'gemini-cli', 'opencode'];
  const scoutTools = tools.filter((t) => wrote.some((l) => l.startsWith(`wrote tests/golden/${t}/`) && /scout/.test(l)));
  assert.deepEqual(scoutTools, tools, r.out);
  assert.ok(wrote.every((l) => /scout/.test(l)), r.out);
  assert.match(r.out, /^deleted tests\/golden\/codex\/\.codex\/agents\/gone\.toml$/m);
  assert.equal(fs.existsSync(stale), false);
  assert.ok((await run(['golden', '--repo', copy])).out.split('\n').every((l) => l.startsWith('unchanged ')));
});

test('golden: --tool touches only that tool; an unknown tool or a build error exits 1 and writes nothing', async () => {
  const copy = goldenRepo('golden-tool');
  const codexStray = path.join(copy, 'tests', 'golden', 'codex', 'stray.md');
  fs.writeFileSync(codexStray, 'x\n');
  fs.writeFileSync(path.join(copy, 'tests', 'golden', 'cursor', 'stray.md'), 'x\n');
  const r = await run(['golden', '--repo', copy, '--tool', 'cursor']);
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.split('\n').every((l) => l.includes(' tests/golden/cursor/')), r.out);
  assert.ok(fs.existsSync(codexStray));
  assert.equal(fs.existsSync(path.join(copy, 'tests', 'golden', 'cursor', 'stray.md')), false);
  const bad = await run(['golden', '--repo', copy, '--tool', 'nope']);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /unknown tool nope/);
  const models = JSON.parse(fs.readFileSync(path.join(copy, 'models.json'), 'utf8'));
  delete models.codex.low;
  fs.writeFileSync(path.join(copy, 'models.json'), JSON.stringify(models));
  const broken = await run(['golden', '--repo', copy]);
  assert.equal(broken.code, 1);
  assert.match(broken.err, /codex: no model for tier low/);
  assert.equal(broken.out, '');
  assert.ok(fs.existsSync(codexStray), 'nothing deleted on a build error');
});

test('help: every dispatched command has a help entry, and every entry is a command', async () => {
  const { HELP } = await import('../tools/lib/help.mjs');
  const src = fs.readFileSync(ORC, 'utf8');
  const dispatched = [...src.matchAll(/cmd === '([a-z][a-z-]*)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(dispatched)].sort(), Object.keys(HELP).sort());
  const global = await run(['help']);
  assert.equal(global.code, 0);
  for (const c of Object.keys(HELP)) assert.match(global.out, new RegExp(`^  ${c} +\\S`, 'm'), c);
  for (const argv of [['--help'], ['-h']]) assert.equal((await run(argv)).out, global.out);
  for (const c of Object.keys(HELP)) {
    const one = await run(['help', c]);
    assert.equal(one.code, 0, c);
    assert.match(one.out, new RegExp(`^usage: node tools/orc\\.mjs ${c}\\b`), c);
    if (c !== 'help') assert.equal((await run([c, '--help'])).out, one.out, c);
  }
  assert.match((await run(['install', '--help'])).out, /--board-repo <dir> +the Orc-Dashboard checkout/);
  const modelsHelp = (await run(['help', 'models'])).out;
  assert.match(modelsHelp, /--family <name>/);
  assert.doesNotMatch(modelsHelp, /Flash slugs only/i);
  const hooksHelp = (await run(['help', 'hooks'])).out;
  assert.match(hooksHelp, /--tool <id>/);
  assert.match(hooksHelp, /--remove/);
  assert.equal((await run(['help', 'nope'])).code, 1);
  const nope = await run(['nope']);
  assert.equal(nope.code, 1);
  assert.match(nope.err, /^usage: node tools\/orc\.mjs build\|check\|sync\|golden\|/);
});

test('generated marker: the old and new forms are recognised, including a Codex TOML first line', async () => {
  const { isGenerated, generatedMarker } = await import('../tools/lib/frontmatter.mjs');
  assert.match(generatedMarker('codex'), /^<!-- generated by orc\.mjs: codex\. Do not edit: .*CONTRIBUTING\.md.* -->$/);
  assert.ok(isGenerated(`${generatedMarker('antigravity')}\nrules\n`));
  assert.ok(isGenerated('<!-- generated by orc.mjs: antigravity -->\nrules\n'));
  assert.ok(isGenerated(`@AGENTS.md\r\n${generatedMarker('claude-code')}\r\n`));
  assert.ok(isGenerated('# generated by orc.mjs: codex\nname = "scout"\n'));
  const toml = `# ${generatedMarker('codex').slice(5, -4)}`;
  assert.equal(toml, '# generated by orc.mjs: codex. Do not edit: change the sources in the Orc-istration repo (see CONTRIBUTING.md) and regenerate.');
  assert.ok(isGenerated(`${toml}\nname = "scout"\n`));
  assert.ok(!isGenerated('my own rules\n'));
});

test('check names the source to edit for a golden rulebook, agent and command', async () => {
  const copy = goldenRepo('check-src');
  const gold = path.join(copy, 'tests', 'golden', 'claude-code', '.claude');
  fs.appendFileSync(path.join(gold, 'CLAUDE.md'), 'hand edit\n');
  fs.rmSync(path.join(gold, 'agents', 'refuter.md'));
  fs.rmSync(path.join(gold, 'commands', 'pre-pr-review.md'));
  fs.appendFileSync(path.join(copy, 'tests', 'golden', 'antigravity', '.gemini', 'config', 'skills', 'sprint', 'SKILL.md'), 'hand edit\n');
  const r = await run(['check', '--repo', copy]);
  assert.equal(r.code, 1);
  assert.match(r.err, /tests\/golden\/antigravity\/\.gemini\/config\/skills\/sprint\/SKILL\.md: differs from the build at line \d+ \(generated from core\/procedures\.mjs \/ adapters\/antigravity\.mjs; edit those, then run node tools\/orc\.mjs golden\)/);
  assert.match(r.err, /tests\/golden\/claude-code\/\.claude\/CLAUDE\.md: differs from the build at line \d+ \(generated from core\/AGENTS\.md \/ adapters\/claude-code\.notes\.md \/ adapters\/claude-code\.mjs; edit those, then run node tools\/orc\.mjs golden\)/);
  assert.match(r.err, /tests\/golden\/claude-code\/\.claude\/agents\/refuter\.md: missing \(generated from core\/roles\/refuter\.md; run node tools\/orc\.mjs golden\)/);
  assert.match(r.err, /tests\/golden\/claude-code\/\.claude\/commands\/pre-pr-review\.md: missing \(generated from core\/procedures\.mjs \/ adapters\/claude-code\.mjs; run node tools\/orc\.mjs golden\)/);
  // golden repairs every one of them, and check passes again.
  assert.equal((await run(['golden', '--repo', copy])).code, 0);
  assert.equal((await run(['check', '--repo', copy])).code, 0);
});

const canLink = (() => {
  const d = tempDir('jprobe');
  try {
    fs.mkdirSync(path.join(d, 't'));
    fs.symlinkSync(path.join(d, 't'), path.join(d, 'l'), 'junction');
    return true;
  } catch {
    return false;
  }
})();

test('golden refuses a linked tests/golden or tests/golden/<tool>; nothing outside is written or deleted', { skip: canLink ? false : 'this platform cannot create a junction or directory symlink' }, async () => {
  for (const linked of [['tests', 'golden', 'cursor'], ['tests', 'golden']]) {
    const copy = goldenRepo('golden-link');
    const outside = tempDir('golden-outside');
    fs.cpSync(path.join(copy, ...linked), outside, { recursive: true });
    const canary = path.join(outside, 'victim.txt');
    fs.writeFileSync(canary, 'keep me\n');
    fs.rmSync(path.join(copy, ...linked), { recursive: true });
    fs.symlinkSync(outside, path.join(copy, ...linked), 'junction');
    const r = await run(['golden', '--repo', copy]);
    assert.equal(r.code, 1, linked.join('/'));
    assert.match(r.err, /^refused: .*(symlink or junction|resolves outside)/m);
    assert.match(r.err, /nothing written: unsafe tests\/golden path/);
    assert.equal(r.out, '');
    assert.equal(fs.readFileSync(canary, 'utf8'), 'keep me\n');
  }
});
