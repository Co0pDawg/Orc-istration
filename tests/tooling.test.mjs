import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main, loadModels } from '../tools/orc.mjs';
import { parseMarchingOrders, briefTemplate, lintBrief } from '../tools/lib/brief.mjs';
import { classify } from '../tools/lib/reviewtier.mjs';
import { costlog, dispatchRows } from '../tools/lib/costlog.mjs';
import { mergeHooks, formatLike } from '../tools/lib/hooks.mjs';
import { run as reminder } from '../tools/board-reminder.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORC = path.join(REPO, 'tools', 'orc.mjs');
const AGENTS = fs.readFileSync(path.join(REPO, 'AGENTS.md'), 'utf8').replace(/\r\n/g, '\n');
const tempDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `orc-${name}-`));

async function run(argv) {
  const out = [];
  const err = [];
  const code = await main(argv, { out: (s) => out.push(s), err: (s) => err.push(s), stdin: () => '' });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

// A child CLI with HOME and USERPROFILE on an empty scratch dir that must stay empty.
function isolated(argv, extraEnv = {}) {
  const fakeHome = tempDir('fakehome');
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, ...extraEnv };
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
    9: 'The real sessions collection.',
    10: 'BOARD: http://localhost:8377 card cards/c1 stage Build',
    ...extra,
  };
  return parseMarchingOrders(AGENTS)
    .map((it, i) => `${i + 1}. ${it.text}\n   ${fill[i + 1]}`)
    .join('\n');
}

// ---------- brief ----------

test('brief new follows the AGENTS.md list, also after the list changes', async () => {
  const items = parseMarchingOrders(AGENTS);
  assert.equal(items.length, 10);
  const r = await run(['brief', 'new', '--role', 'builder']);
  assert.equal(r.code, 0, r.err);
  for (const it of items) assert.ok(r.out.includes(`${it.n}. ${it.text}`), it.label);
  const scout = await run(['brief', 'new', '--role', 'scout']);
  assert.ok(!scout.out.includes('Data precondition') && !scout.out.includes('BOARD:'), 'items 9 and 10 only for writers');
  assert.match(scout.out, /^8\. \*\*Scratch path\*\*/m);

  const copy = tempDir('brief');
  fs.cpSync(path.join(REPO, 'roles'), path.join(copy, 'roles'), { recursive: true });
  fs.writeFileSync(path.join(copy, 'AGENTS.md'), AGENTS.replace('5. **Do not**: known traps.', '5. **Do not**: known traps and the new rule.\n6. **Budget**: one line.').replace(/^6\. \*\*Output/m, '7. **Output'));
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
  assert.match(lintBrief(goodBrief({ 10: 'BOARD: http://localhost:8377 card c1 stage Build' }), items).join('\n'), /BOARD line does not match/);
  assert.deepEqual(lintBrief(goodBrief({ 10: 'BOARD: https://claude.ai/artifact/x slug 1234 card cards/imp-i3 stage Build' }), items), []);
  // Writer roles require items 9 and 10.
  const eight = goodBrief().split('\n').slice(0, 16).join('\n');
  assert.deepEqual(lintBrief(eight, items, 'scout'), []);
  assert.match(lintBrief(eight, items, 'builder').join('\n'), /item 9 \(Data precondition\) is missing/);
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
  assert.match(md, /## Spec misses\n\nTODO/);
  assert.equal((await run(['costlog', '--session', 'missing', '--board-export', file])).code, 1);
  assert.equal((await run(['costlog', '--session', SID])).code, 1);
  assert.equal((await run(['costlog', '--session', SID, '--board-export', file, '--board', 'http://localhost:1'])).code, 1);
  assert.equal(costlog(EXPORT, SID).includes('TODO'), true);
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
  assert.ok(agy.out.includes(` -p ${JSON.stringify(fs.readFileSync(brief, 'utf8'))} --agent scout --model ${slug} --output-format json\n`), agy.out);
  assert.match(agy.out, /stdin: none/);
  const cc = isolated(['dispatch', '--tool', 'claude-code', '--role', 'builder', '--brief', brief, '--dry-run']);
  assert.equal(cc.code, 0, cc.err);
  assert.match(cc.out, new RegExp(` -p --agent builder --model ${models['claude-code'].high.model}\\n`));
  assert.match(cc.out, /stdin: \d+ bytes \(the brief\)/);
});

test('dispatch refuses a tool without a recipe and a failing brief', () => {
  const good = briefFile();
  for (const tool of ['codex', 'cursor', 'copilot', 'gemini-cli', 'opencode']) {
    const r = isolated(['dispatch', '--tool', tool, '--role', 'scout', '--brief', good, '--dry-run']);
    assert.equal(r.code, 1);
    assert.match(r.err, new RegExp(`no headless recipe for ${tool}`));
  }
  const bad = briefFile(goodBrief({ 4: 'just check' }));
  const r = isolated(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', bad, '--dry-run']);
  assert.equal(r.code, 1);
  assert.match(r.err, /names no command[\s\S]*dispatch refused: the brief fails lint/);
  assert.equal(isolated(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', bad, '--dry-run', '--no-lint']).code, 0);
  assert.match(isolated(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', good, '--timeout', 'x']).err, /--timeout needs a number/);
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

const EXAMPLE = JSON.parse(fs.readFileSync(path.join(REPO, 'settings.example.json'), 'utf8'));
const exampleCommands = Object.values(EXAMPLE.hooks).flatMap((gs) => gs.flatMap((g) => g.hooks.map((h) => h.command)));

test('hooks: empty home gets every example hook with the real home; dry run writes nothing', () => {
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
  assert.ok(!text.includes('<you>'), 'placeholder replaced');
  assert.ok(text.includes(JSON.stringify(home).slice(1, -1)), 'real home in the commands');
  assert.match(isolated(['hooks', '--home', home]).out, /nothing to add/);
  assert.match(isolated(['hooks']).err, /hooks needs --home/);
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

test('hooks --node merges only the Node board-reminder entries', () => {
  const home = tempDir('hookhome');
  const r = isolated(['hooks', '--home', home, '--node', '--apply']);
  assert.equal(r.code, 0, r.err);
  const s = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  const cmds = Object.values(s.hooks).flatMap((gs) => gs.flatMap((g) => g.hooks.map((h) => h.command)));
  assert.equal(cmds.length, 3);
  const fwd = home.replace(/\\/g, '/');
  for (const c of cmds) assert.match(c, new RegExp(`^node "${fwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.claude/tools/board-reminder\\.mjs" (mark|relay)$`));
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
  const hook = (o) => JSON.stringify({ session_id: 's-1', hook_event_name: 'PostToolUse', ...o });
  // No board.local.md: silent, writes nothing.
  assert.equal(reminder('mark', hook({ agent_type: 'builder', agent_id: 'a1' }), root), '');
  assert.deepEqual(fs.readdirSync(root), []);
  fs.writeFileSync(path.join(root, 'board.local.md'), 'http://localhost:8377\n');
  // Relay with no markers: silent without reading stdin.
  assert.equal(reminder('relay', 'not json', root), '');
  // Mark: only builder, refuter, debugger.
  assert.equal(reminder('mark', hook({ agent_type: 'scout', agent_id: 'a0' }), root), '');
  assert.ok(!fs.existsSync(path.join(root, 'board-reminders')));
  reminder('mark', hook({ agent_type: 'builder', agent_id: 'a1' }), root);
  reminder('mark', hook({ agent_type: 'refuter', agent_id: 'a/2' }), root);
  reminder('mark', JSON.stringify({ session_id: 'other', agent_type: 'debugger', agent_id: 'x' }), root);
  const dir = path.join(root, 'board-reminders');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['other.x', 's-1.a1', 's-1.a2']);
  // A relay inside a subagent is ignored.
  assert.equal(reminder('relay', hook({ agent_id: 'a1' }), root), '');
  // An empty marker (killed mid-write) is cleared without naming an agent.
  fs.writeFileSync(path.join(dir, 's-2.e'), '');
  const empty = JSON.parse(reminder('relay', JSON.stringify({ session_id: 's-2', hook_event_name: 'UserPromptSubmit' }), root));
  assert.match(empty.hookSpecificOutput.additionalContext, /^Board: An agent finished\./);
  // Relay names the session's agents, clears its markers and keeps others.
  const out = JSON.parse(reminder('relay', hook({}), root));
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(out.hookSpecificOutput.additionalContext, /^Board: builder, refuter finished\. Update this session's now and events/);
  assert.deepEqual(fs.readdirSync(dir), ['other.x']);
  // Old markers expire on the next mark.
  const old = path.join(dir, 'other.x');
  const past = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  fs.utimesSync(old, past, past);
  reminder('mark', hook({ agent_type: 'debugger', agent_id: 'd' }), root);
  assert.deepEqual(fs.readdirSync(dir), ['s-1.d']);
});

test('board-reminder.mjs as a hook process: stdin JSON in, context out, exit 0 on bad input', () => {
  const root = tempDir('reminder');
  fs.writeFileSync(path.join(root, 'board.local.md'), 'x\n');
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

// ---------- models validation ----------

test('models validation rejects bad ids, tiers, efforts and values in both files; check reports it', async () => {
  const copy = tempDir('models');
  for (const p of ['AGENTS.md', 'CLAUDE.md', 'models.json', 'roles', 'adapters', 'agents', 'tools/lib']) {
    fs.cpSync(path.join(REPO, p), path.join(copy, p), { recursive: true });
  }
  const base = JSON.parse(fs.readFileSync(path.join(REPO, 'models.json'), 'utf8'));
  const cases = [
    [{ nosuchtool: { low: { model: 'x' } } }, /unknown tool id "nosuchtool"/],
    [{ codex: { huge: { model: 'x' } } }, /codex: unknown tier key "huge"/],
    [{ codex: { mid: { effort: 'extreme' } } }, /codex\.mid\.effort: "extreme" is not one of/],
    [{ codex: { low: { model: 5 } } }, /codex\.low\.model: must be a string/],
    [{ antigravity: { headless: { low: 7 } } }, /antigravity\.headless\.low: model must be a string/],
    [{ antigravity: { headless: { turbo: 'x' } } }, /antigravity\.headless: unknown tier key "turbo"/],
  ];
  for (const [bad, re] of cases) {
    fs.writeFileSync(path.join(copy, 'models.local.json'), JSON.stringify(bad));
    assert.throws(() => loadModels(copy), (e) => /^models\.local\.json: /.test(e.message) && re.test(e.message), JSON.stringify(bad));
    const c = await run(['check', '--repo', copy]);
    assert.equal(c.code, 1);
    assert.match(c.err, re);
    fs.rmSync(path.join(copy, 'models.local.json'));
    const [tool] = Object.keys(bad);
    const merged = { ...base, [tool]: { ...(base[tool] ?? {}), ...bad[tool] } };
    fs.writeFileSync(path.join(copy, 'models.json'), JSON.stringify(merged));
    assert.throws(() => loadModels(copy, { local: false }), (e) => /^models\.json: /.test(e.message) && re.test(e.message));
    fs.writeFileSync(path.join(copy, 'models.json'), JSON.stringify(base));
  }
  assert.doesNotThrow(() => loadModels(copy));
});
