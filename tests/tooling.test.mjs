import { test } from 'node:test';
import { isolateHome } from './helpers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { main, loadModels, loadRoles } from '../tools/orc.mjs';
import { killTree } from '../tools/lib/dispatch.mjs';
import { parseMarchingOrders, briefTemplate, lintBrief } from '../tools/lib/brief.mjs';
import { classify } from '../tools/lib/reviewtier.mjs';
import { costlog, dispatchRows } from '../tools/lib/costlog.mjs';
import { mergeHooks, formatLike } from '../tools/lib/hooks.mjs';
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
  for (const k of Object.keys(out)) if (k.startsWith('ORC_TOOL_BIN_')) delete out[k];
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
  for (const p of ['node_modules/x/index.js', 'tools/node_modules/x.js', 'dist/codex/.codex/AGENTS.md', 'models.local.json', '.orc/reviews/run.md', 'orchestration/board/index.html',
    '.claude/settings.local.json', '.claude/worktrees/a/x.md', '.claude/skills/mine/SKILL.md', '.agents/settings.json', '.agents/skills/mine/SKILL.md', '.vscode/settings.json', '.idea/x.xml', 'a.swp', 'notes.md~', '.DS_Store', 'docs/Thumbs.db', 'desktop.ini']) {
    assert.equal(ignored(p), true, `${p} is ignored`);
  }
  for (const p of ['AGENTS.md', 'CLAUDE.md', 'core/AGENTS.md', 'core/roles/scout.md', '.claude/skills/ship-prompts/SKILL.md', '.agents/skills/ship-prompts/SKILL.md', 'tests/golden/claude-code/.claude/CLAUDE.md',
    'tests/golden/claude-code/.claude/agents/scout.md', 'adapters/claude-code/commands/start.md', 'adapters/claude-code/skills/orc-permissions/SKILL.md', 'extras/worklog/worklog.ps1', 'skills/brief/SKILL.md', 'tools/orc.mjs', 'orchestration/README.md', 'new-top-level-file.md']) {
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
    const argv = JSON.parse(fs.readFileSync(path.join(dir, 'argv.json'), 'utf8'));
    const stdin = fs.readFileSync(path.join(dir, 'stdin.txt'), 'utf8');
    if (tool === 'antigravity') {
      assert.equal(argv[0], '-p');
      assert.equal(argv[1], text, 'brief arrives byte-identical as one argument');
      assert.equal(stdin, '');
    } else {
      assert.deepEqual(argv.slice(0, 3), ['-p', '--agent', 'builder']);
      assert.equal(stdin, text, 'brief arrives byte-identical on stdin');
    }
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

test('killTree falls back to child.kill when the tree kill fails, and not when it succeeds', async () => {
  // A pid no process can have (not a multiple of 4 on Windows, above pid_max on Linux), so nothing real is killed:
  // taskkill (Windows) exits non-zero, process.kill(-pid) (POSIX) throws.
  const gone = 2147483647;
  const calls = [];
  const said = [];
  killTree({ pid: gone, kill: (sig) => calls.push(sig) }, (s) => said.push(s));
  assert.deepEqual(calls, ['SIGKILL']);
  // On Windows the fallback says the grandchildren may survive; the POSIX fallback is silent.
  if (process.platform === 'win32') assert.deepEqual(said, [`dispatch: taskkill failed for pid ${gone}; killing only the direct child, so its child processes may still run`]);
  else assert.deepEqual(said, []);
  // A live process: the tree kill works, so the fallback is not called.
  const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', detached: process.platform !== 'win32' });
  const liveCalls = [];
  const liveSaid = [];
  try {
    killTree({ pid: live.pid, kill: (sig) => liveCalls.push(sig) }, (s) => liveSaid.push(s));
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

// ---------- board-reminder.mjs ----------

test('board-reminder.mjs: mark, relay, silence and subagent calls', () => {
  const root = tempDir('reminder');
  const state = tempDir('reminder-orc');
  const env = { ORC_DATA_DIR: state };
  const hook = (o) => JSON.stringify({ session_id: 's-1', hook_event_name: 'PostToolUse', ...o });
  // No config.json (even with a retired board.local.md present): silent, writes nothing.
  fs.writeFileSync(path.join(root, 'board.local.md'), 'http://localhost:8377\n');
  assert.equal(reminder('mark', hook({ agent_type: 'builder', agent_id: 'a1' }), root, Date.now(), env), '');
  assert.ok(!fs.existsSync(path.join(root, 'board-reminders')));
  // Invalid JSON or config without board.url: silent, writes nothing.
  for (const raw of ['{ broken', '{}', '{"version":1,"board":{}}', '{"version":1,"board":{"url":"   "}}']) {
    fs.writeFileSync(path.join(state, 'config.json'), raw);
    assert.equal(reminder('mark', hook({ agent_type: 'builder', agent_id: 'a1' }), root, Date.now(), env), '', raw);
    assert.ok(!fs.existsSync(path.join(root, 'board-reminders')), raw);
  }
  fs.writeFileSync(path.join(state, 'config.json'), JSON.stringify({ version: 1, board: { url: 'http://localhost:8377' } }));
  // Relay with no markers: silent without reading stdin.
  assert.equal(reminder('relay', 'not json', root, Date.now(), env), '');
  // Mark: only builder, refuter, debugger.
  assert.equal(reminder('mark', hook({ agent_type: 'scout', agent_id: 'a0' }), root, Date.now(), env), '');
  assert.ok(!fs.existsSync(path.join(root, 'board-reminders')));
  reminder('mark', hook({ agent_type: 'builder', agent_id: 'a1' }), root, Date.now(), env);
  reminder('mark', hook({ agent_type: 'refuter', agent_id: 'a/2' }), root, Date.now(), env);
  reminder('mark', JSON.stringify({ session_id: 'other', agent_type: 'debugger', agent_id: 'x' }), root, Date.now(), env);
  const dir = path.join(root, 'board-reminders');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['other.x', 's-1.a1', 's-1.a2']);
  // A relay inside a subagent is ignored.
  assert.equal(reminder('relay', hook({ agent_id: 'a1' }), root, Date.now(), env), '');
  // An empty marker (killed mid-write) is cleared without naming an agent.
  fs.writeFileSync(path.join(dir, 's-2.e'), '');
  const empty = JSON.parse(reminder('relay', JSON.stringify({ session_id: 's-2', hook_event_name: 'UserPromptSubmit' }), root, Date.now(), env));
  assert.match(empty.hookSpecificOutput.additionalContext, /^Board: An agent finished\./);
  // Relay names the session's agents, clears its markers and keeps others.
  const out = JSON.parse(reminder('relay', hook({}), root, Date.now(), env));
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(out.hookSpecificOutput.additionalContext, /^Board: builder, refuter finished\. Update this session's now and events/);
  assert.deepEqual(fs.readdirSync(dir), ['other.x']);
  // Old markers expire on the next mark.
  const old = path.join(dir, 'other.x');
  const past = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  fs.utimesSync(old, past, past);
  reminder('mark', hook({ agent_type: 'debugger', agent_id: 'd' }), root, Date.now(), env);
  assert.deepEqual(fs.readdirSync(dir), ['s-1.d']);
});

test('board-reminder.mjs as a hook process: stdin JSON in, context out, exit 0 on bad input', () => {
  const root = tempDir('reminder');
  const state = tempDir('reminder-orc');
  fs.writeFileSync(path.join(state, 'config.json'), JSON.stringify({ version: 1, board: { url: 'http://localhost:8377' } }));
  const script = path.join(REPO, 'tools', 'board-reminder.mjs');
  const env = { ...process.env, BOARD_REMINDER_ROOT: root, ORC_DATA_DIR: state };
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

test('board-reminder.ps1 keys on config.json board.url and stays silent when missing or invalid', { skip: process.platform !== 'win32' && 'PowerShell board-reminder is Windows only' }, () => {
  const root = tempDir('reminder-ps1');
  const state = tempDir('reminder-ps1-orc');
  const script = path.join(REPO, 'tools', 'board-reminder.ps1');
  const runPs = (mode, input) => spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Mode', mode], {
    env: { ...process.env, BOARD_REMINDER_ROOT: root, ORC_DATA_DIR: state },
    input,
    encoding: 'utf8',
  });
  const markIn = JSON.stringify({ session_id: 's', agent_type: 'builder', agent_id: 'b' });
  // Absent config.json, even with retired board.local.md: silent, writes no marker.
  fs.writeFileSync(path.join(root, 'board.local.md'), 'http://localhost:8377\n');
  const off = runPs('mark', markIn);
  assert.equal(off.status, 0, off.stderr);
  assert.equal(off.stdout, '');
  assert.equal(off.stderr, '');
  assert.ok(!fs.existsSync(path.join(root, 'board-reminders')));
  // Invalid JSON or missing board.url: silent.
  for (const raw of ['{ broken', '{"version":1}', '{"version":1,"board":{"url":""}}']) {
    fs.writeFileSync(path.join(state, 'config.json'), raw);
    const r = runPs('mark', markIn);
    assert.equal(r.status, 0, raw);
    assert.equal(r.stderr, '', raw);
    assert.ok(!fs.existsSync(path.join(root, 'board-reminders')), raw);
  }
  // Valid board.url: mark + relay fire.
  fs.writeFileSync(path.join(state, 'config.json'), JSON.stringify({ version: 1, board: { url: 'http://localhost:8377' } }));
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
  // The roles moved to core/roles and commands moved to adapters/claude-code/commands: stray top-level pages are docs again.
  assert.equal(classify(['roles/scout.md', 'agents/scout.md', 'commands/start.md']).tier, 'Light-eligible');
  // Only the top-level prompt folders: a docs page about them stays Light-eligible.
  assert.equal(classify(['docs/review/notes.md', 'docs/workflows.md', 'docs/adapters/x.md']).tier, 'Light-eligible');
  for (const p of ['review/PROCEDURE.md', 'workflows/start.md', 'adapters/claude-code/commands/start.md']) {
    const d = repoWith({ [p]: 'a\n', 'README.md': 'r\n' });
    commit(d, (dir) => fs.writeFileSync(path.join(dir, p), 'b\n'));
    assert.match((await run(['review-tier', '--base', 'base', '--repo-dir', d])).out, new RegExp(`^Full: .*${p.replace('.', '\\.')}`, 'm'), p);
  }
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
  const state = tempDir('reminder-orc');
  fs.writeFileSync(path.join(state, 'config.json'), JSON.stringify({ version: 1, board: { url: 'http://localhost:8377' } }));
  fs.mkdirSync(path.join(root, 'board-reminders'));
  fs.writeFileSync(path.join(root, 'board-reminders', 's.a'), 'builder\n');
  const r = spawnSync(process.execPath, [path.join(link, 'board-reminder.mjs'), 'relay'], {
    env: { ...process.env, BOARD_REMINDER_ROOT: root, ORC_DATA_DIR: state },
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
  const r = await run(['check', '--repo', copy]);
  assert.equal(r.code, 1);
  assert.match(r.err, /tests\/golden\/claude-code\/\.claude\/CLAUDE\.md: differs from the build at line \d+ \(generated from core\/AGENTS\.md \/ adapters\/claude-code\.notes\.md \/ adapters\/claude-code\.mjs; edit those, then run node tools\/orc\.mjs golden\)/);
  assert.match(r.err, /tests\/golden\/claude-code\/\.claude\/agents\/refuter\.md: missing \(generated from core\/roles\/refuter\.md; run node tools\/orc\.mjs golden\)/);
  assert.match(r.err, /tests\/golden\/claude-code\/\.claude\/commands\/pre-pr-review\.md: missing \(generated from adapters\/claude-code\.mjs; run node tools\/orc\.mjs golden\)/);
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
