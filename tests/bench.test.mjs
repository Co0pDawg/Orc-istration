// orc bench: the replay benchmark. Real runs go through a stub executable (ORC_TOOL_BIN_CLAUDE_CODE), never a model;
// the cases are the real ones in tests/fixtures/bench and the agent definitions come from the real core/roles/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main, loadRoles, loadModels, buildTool } from '../tools/orc.mjs';
import { parse } from '../tools/lib/frontmatter.mjs';
import { parseVerdict, benchReport, variantStats, rate, tokensOf, redact, listBenchCases, scoreDefects, makeScratchRepo } from '../tools/lib/bench.mjs';
import { parseExpected } from '../tools/lib/corpus.mjs';
import { isolateHome } from './helpers.mjs';

// No test in this file can reach the real home folder: commands that default --home use this scratch one.
isolateHome();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORC = path.join(REPO, 'tools', 'orc.mjs');
const CASES = path.join(REPO, 'tests', 'fixtures', 'bench');
const tempDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `orc-${name}-`));

// The stub stands in for claude: `--version` prints a version; otherwise it records its call (argv, stdin, working
// folder, branch, whether any hidden acceptance file is visible) and prints a result JSON, or misbehaves on request.
function stub(dir) {
  const file = path.join(dir, 'stub.mjs');
  fs.writeFileSync(file, `import fs from 'node:fs';
import path from 'node:path';
if (process.argv.includes('--version')) { process.stdout.write('9.9.9 (Claude Code stub)\\n'); process.exit(0); }
const stdin = await new Promise((r) => { let s = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => r(s)); process.stdin.on('error', () => r(s)); });
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.name === '.git' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [e.name]);
const head = fs.readFileSync('.git/HEAD', 'utf8').trim();
const call = { argv: process.argv.slice(2), stdin, cwd: process.cwd(), branch: head.replace('ref: refs/heads/', ''), acceptVisible: walk('.').some((n) => n.includes('.accept.')) };
fs.appendFileSync(${JSON.stringify(path.join(dir, 'calls.jsonl'))}, JSON.stringify(call) + '\\n');
const mode = process.env.STUB_MODE ?? 'ok';
if (process.env.STUB_SOLVE) fs.cpSync(process.env.STUB_SOLVE, '.', { recursive: true });
if (mode === 'sleep') setTimeout(() => {}, 60000);
else if (mode === 'garbage') { process.stdout.write('this is not json\\n'); process.exit(0); }
else if (mode === 'nulls') {
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: null, result: process.env.STUB_TEXT ?? 'done', total_cost_usd: null,
    usage: { input_tokens: 100, cache_creation_input_tokens: null, cache_read_input_tokens: 300, output_tokens: 50 } }) + '\\n');
  process.exit(0);
}
else {
  const text = (process.env.STUB_TEXT ?? 'done').replaceAll('{cwd}', process.cwd());
  const budget = mode === 'budget';
  process.stdout.write(JSON.stringify({ type: 'result', subtype: budget ? 'error_max_budget_usd' : 'success', is_error: budget || mode === 'iserror', num_turns: 7, result: text, total_cost_usd: 0.25,
    usage: { input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 300, output_tokens: 50 } }) + '\\n');
  process.exit(mode === 'exit' ? 3 : 0);
}
`);
  return file;
}

// Runs orc.mjs in a child with the stub and a scratch HOME; returns the exit code, output, calls and result files.
function bench(argv, env = {}) {
  const dir = tempDir('bench-stub');
  const out = path.join(dir, 'out');
  const fakeHome = tempDir('fakehome');
  const childEnv = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, ORC_DATA_DIR: tempDir('bench-data'), ORC_TOOL_BIN_CLAUDE_CODE: stub(dir), ...env };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete childEnv[k];
  const r = spawnSync(process.execPath, [ORC, 'bench', ...argv, ...(argv.includes('--out') ? [] : ['--out', out])], {
    env: childEnv,
    encoding: 'utf8',
    timeout: 120000,
  });
  const callsFile = path.join(dir, 'calls.jsonl');
  const calls = fs.existsSync(callsFile) ? fs.readFileSync(callsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  const runs = fs.existsSync(out) ? fs.readdirSync(out) : [];
  const results = {};
  for (const run of runs) {
    for (const f of fs.readdirSync(path.join(out, run))) results[f] = fs.readFileSync(path.join(out, run, f), 'utf8');
  }
  return { code: r.status, out: r.stdout, err: r.stderr, calls, runs, results, outDir: out };
}

// PATH with any folder holding a claude executable removed, so a test can prove binaries.claude-code is used.
const pathWithoutClaude = (process.env.PATH ?? process.env.Path ?? '')
  .split(path.delimiter)
  .filter((d) => d && !['claude', 'claude.exe', 'claude.cmd', 'claude.bat'].some((n) => fs.existsSync(path.join(d, n))))
  .join(path.delimiter);

const result = (r, name) => JSON.parse(r.results[`${name}.json`]);

// A reference solution for the csv case, copied in by the stub.
function csvSolution() {
  const dir = tempDir('csv-solution');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'csv.js'), `export function parseLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { fields.push(field); field = ''; }
    else field += ch;
  }
  fields.push(field);
  return fields;
}
`);
  return dir;
}

function assertNoPaths(text) {
  for (const p of [os.tmpdir(), os.homedir(), REPO]) {
    for (const form of [p, p.replace(/\\/g, '/')]) assert.ok(!text.toLowerCase().includes(form.toLowerCase()), `result names ${form}`);
  }
  assert.doesNotMatch(text, /\b[A-Za-z]:[\\/]/, 'result holds no drive path');
}

// ---------- list and dry run ----------

test('bench list shows the 7 real cases with no warning', async () => {
  const out = [];
  const err = [];
  const code = await main(['bench', 'list'], { out: (s) => out.push(s), err: (s) => err.push(s) });
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(err, []);
  const lines = out.join('\n').split('\n');
  assert.strictEqual(lines.length, 7);
  assert.deepStrictEqual(lines.map((l) => l.split(/\s+/).slice(0, 2).join(' ')), [
    'accept-clean-change refute', 'config-merge-keeps-unknown build', 'csv-quoted-fields build', 'retry-backoff build',
    'save-rewrites-file refute', 'spec-requirement-dropped refute', 'test-asserts-nothing refute',
  ]);
});

test('bench list warns about a malformed case, and run refuses it before starting anything', () => {
  const repo = tempDir('bench-repo');
  fs.cpSync(path.join(REPO, 'core'), path.join(repo, 'core'), { recursive: true });
  fs.cpSync(path.join(REPO, 'adapters'), path.join(repo, 'adapters'), { recursive: true });
  fs.cpSync(path.join(REPO, 'tools'), path.join(repo, 'tools'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'models.json'), path.join(repo, 'models.json'));
  const bad = path.join(repo, 'tests', 'fixtures', 'bench', 'half-done');
  fs.mkdirSync(path.join(bad, 'seed'), { recursive: true });
  fs.writeFileSync(path.join(bad, 'case.md'), '# Half done\n\nKind: refute\n');
  fs.mkdirSync(path.join(repo, 'tests', 'fixtures', 'bench', 'no-case-file'));
  const list = spawnSync(process.execPath, [ORC, 'bench', 'list', '--repo', repo], { encoding: 'utf8' });
  assert.strictEqual(list.status, 0);
  assert.match(list.stdout, /^half-done {2}refute {2}Half done/m);
  assert.match(list.stderr, /WARN bench: half-done: no brief\.md/);
  assert.match(list.stderr, /WARN bench: half-done: case\.md has no `Expect: ACCEPT` or `Expect: REWORK` line/);
  assert.match(list.stderr, /WARN bench: half-done: no change\.patch/);
  assert.match(list.stderr, /WARN bench: no-case-file has no case\.md/);
  const r = bench(['run', '--repo', repo]);
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /malformed case\(s\), nothing started: half-done/);
  assert.deepStrictEqual(r.calls, []);
});

test('bench run --dry-run prints one command per case and starts nothing', () => {
  const r = bench(['run', '--dry-run']);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual((r.out.match(/^command: /gm) ?? []).length, 7);
  assert.strictEqual((r.out.match(/^stdin: \d+ bytes \(the brief\)$/gm) ?? []).length, 7);
  assert.match(r.out, /--agent builder --agents /);
  assert.match(r.out, /--agent refuter --agents /);
  assert.match(r.out, /--output-format json --permission-mode acceptEdits --allowedTools "Read,Glob,Grep,Bash\(node:\*\),Bash\(npm:\*\),Bash\(git:\*\)" --max-budget-usd 2 --no-session-persistence/);
  assert.match(r.out, /--allowedTools "Read,Edit,Write,Glob,Grep,Bash\(node:\*\),Bash\(npm:\*\),Bash\(git:\*\)"/);
  assert.deepStrictEqual(r.calls, [], 'the stub never ran, not even for --version');
  assert.deepStrictEqual(r.runs, [], 'no result folder');
});

test('bench run refuses any tool but claude-code, and bad option values', () => {
  for (const tool of ['antigravity', 'codex', 'nope']) {
    const r = bench(['run', '--tool', tool, '--dry-run']);
    assert.strictEqual(r.code, 1);
    assert.match(r.err, new RegExp(`no bench recipe for ${tool}`));
  }
  assert.match(bench(['run', '--case', 'nope', '--dry-run']).err, /no case nope \(known: accept-clean-change,/);
  assert.match(bench(['run', '--runs', '0', '--dry-run']).err, /--runs needs a whole number from 1 to 100, got 0/);
  assert.match(bench(['run', '--timeout', 'x', '--dry-run']).err, /--timeout needs a whole number from 1 to 86400, got x/);
  assert.match(bench(['run', '--budget-usd', '-1', '--dry-run']).err, /--budget-usd needs a number above 0/);
  assert.match(bench(['run', '--variant', '../x', '--dry-run']).err, /--variant must be/);
});

// ---------- models and the agent definition ----------

test('--models overrides the tier model and effort on the command line and in the agent definition', () => {
  const dir = tempDir('bench-models');
  const file = path.join(dir, 'models.bench.json');
  fs.writeFileSync(file, JSON.stringify({ 'claude-code': { high: { model: 'stub-model', effort: 'low' } } }));
  const r = bench(['run', '--case', 'csv-quoted-fields', '--models', file, '--dry-run']);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, / --model stub-model --effort low /);
  assert.match(r.out, /\\"model\\":\\"stub-model\\",\\"effort\\":\\"low\\"/);
  fs.writeFileSync(file, JSON.stringify({ 'claude-code': { high: { effort: 'ultra' } } }));
  const ultra = bench(['run', '--case', 'csv-quoted-fields', '--models', file, '--dry-run']);
  assert.strictEqual(ultra.code, 1);
  assert.match(ultra.err, /effort "ultra" \(the high tier\) is not one claude --effort takes/);
  fs.writeFileSync(file, JSON.stringify({ 'claude-code': { huge: { model: 'x' } } }));
  const bad = bench(['run', '--models', file, '--dry-run']);
  assert.strictEqual(bad.code, 1);
  assert.match(bad.err, /unknown tier key "huge"/);
});

test('the --agents definition is the checkout role build for builder and refuter', async () => {
  const adapter = (await import(pathToFileURL(path.join(REPO, 'adapters', 'claude-code.mjs')).href)).default;
  const built = buildTool(adapter, loadRoles(REPO), loadModels(REPO, { local: false }), fs.readFileSync(path.join(REPO, 'core', 'AGENTS.md'), 'utf8'));
  for (const [id, role] of [['csv-quoted-fields', 'builder'], ['test-asserts-nothing', 'refuter']]) {
    const r = bench(['run', '--case', id], { STUB_TEXT: 'VERDICT: REWORK' });
    assert.strictEqual(r.calls.length, 1, r.err);
    const argv = r.calls[0].argv;
    const agents = JSON.parse(argv[argv.indexOf('--agents') + 1]);
    const file = built.files.find((f) => f.role === role);
    const { data, body } = parse(file.content);
    const expected = { description: data.description, prompt: body, model: data.model, effort: data.effort };
    if (data.tools !== undefined) expected.tools = data.tools.split(',').map((t) => t.trim());
    assert.deepStrictEqual(agents, { [role]: expected });
    assert.strictEqual(argv[argv.indexOf('--agent') + 1], role);
    assert.strictEqual(r.calls[0].stdin, fs.readFileSync(path.join(CASES, id, 'brief.md'), 'utf8'), 'the brief arrives byte-identical on stdin');
  }
});

// ---------- build runs ----------

test('a build run that solves the case passes; the hidden accept/ folder is absent while the agent runs', () => {
  const r = bench(['run', '--case', 'csv-quoted-fields', '--keep', '--variant', 'v1'], { STUB_SOLVE: csvSolution() });
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(r.calls.length, 1);
  const call = r.calls[0];
  assert.strictEqual(call.acceptVisible, false, 'no acceptance file while the agent runs');
  assert.strictEqual(call.branch, 'base');
  assert.ok(!path.resolve(call.cwd).toLowerCase().startsWith(REPO.toLowerCase()), 'the agent runs outside the checkout');
  const kept = /kept scratch repo for csv-quoted-fields: (.+)$/m.exec(r.out)[1].trim();
  assert.ok(fs.existsSync(path.join(kept, 'test', 'csv-quoted.accept.test.mjs')), 'accept/ was copied in after the run');
  fs.rmSync(kept, { recursive: true, force: true });
  assert.match(r.runs[0], /^\d{8}T\d{6}Z-v1$/);
  const res = result(r, 'csv-quoted-fields');
  assert.strictEqual(res.outcome, 'pass');
  assert.strictEqual(res.error, null);
  assert.strictEqual(res.kind, 'build');
  assert.strictEqual(res.role, 'builder');
  assert.strictEqual(res.model, 'opus');
  assert.strictEqual(res.effort, 'high');
  assert.strictEqual(res.variant, 'v1');
  assert.deepStrictEqual(res.tokens, { input: 100, cacheWrite: 20, cacheRead: 300, output: 50 });
  assert.strictEqual(res.costUsd, 0.25);
  assert.strictEqual(res.turns, 7);
  assert.strictEqual(res.claudeVersion, '9.9.9');
  assert.match(res.gitHead, /^[0-9a-f]{40}$/);
  assert.strictEqual(typeof res.gitDirty, 'boolean');
  assert.ok(!('verdict' in res), 'no refute fields on a build result');
  assertNoPaths(r.results['csv-quoted-fields.json']);
});

test('a build run that leaves the seed as it was fails, and the command still exits 0', () => {
  const r = bench(['run', '--case', 'retry-backoff', '--runs', '2']);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(r.calls.length, 2);
  for (const n of [1, 2]) {
    const res = result(r, `retry-backoff.${n}`);
    assert.strictEqual(res.outcome, 'fail');
    assert.strictEqual(res.run, n);
  }
  assert.match(r.out, /2 run\(s\): 0 pass, 2 fail, 0 error/);
});

// ---------- refute runs ----------

test('a right REWORK verdict passes; a cited planted defect is found and an uncited one missed', () => {
  const text = 'VERDICT: REWORK\nMUST-FIX:\n1. {cwd}/src/paginate.js:9 — pageCount(10, 5) gives 3 → use Math.ceil\nSHOULD-FIX: none';
  const r = bench(['run', '--case', 'test-asserts-nothing', '--keep-output'], { STUB_TEXT: text });
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(r.calls[0].branch, 'change', 'the change is checked out for the refuter');
  const res = result(r, 'test-asserts-nothing');
  assert.strictEqual(res.outcome, 'pass');
  assert.strictEqual(res.verdict, 'REWORK');
  assert.strictEqual(res.expect, 'REWORK');
  assert.deepStrictEqual(res.defects, [{ id: 'E1', found: true }, { id: 'E2', found: false }]);
  assertNoPaths(r.results['test-asserts-nothing.json']);
  assert.match(r.results['test-asserts-nothing.output.md'], /^VERDICT: REWORK\n/);
});

test('a wrong verdict fails: ACCEPT on a planted defect, REWORK on a clean change', () => {
  const r = bench(['run', '--case', 'save-rewrites-file'], { STUB_TEXT: '**VERDICT:** ACCEPT\nMUST-FIX: none' });
  assert.strictEqual(r.code, 0, r.err);
  const res = result(r, 'save-rewrites-file');
  assert.strictEqual(res.outcome, 'fail');
  assert.strictEqual(res.verdict, 'ACCEPT');
  assert.deepStrictEqual(res.defects, [{ id: 'E1', found: false }, { id: 'E2', found: false }]);
  const clean = result(bench(['run', '--case', 'accept-clean-change'], { STUB_TEXT: 'VERDICT: REWORK\n1. src/slug.js:6 — nit' }), 'accept-clean-change');
  assert.strictEqual(clean.outcome, 'fail');
  assert.deepStrictEqual(clean.defects, []);
});

test('a report with no verdict line is an error and the command exits 1', () => {
  const r = bench(['run', '--case', 'spec-requirement-dropped'], { STUB_TEXT: 'Looks fine to me.\nVERDICT: ACCEPT | REWORK' });
  assert.strictEqual(r.code, 1);
  const res = result(r, 'spec-requirement-dropped');
  assert.strictEqual(res.outcome, 'error');
  assert.strictEqual(res.error, 'no VERDICT line in the report');
  assert.strictEqual(res.verdict, null);
  assert.deepStrictEqual(res.defects, [{ id: 'E1', found: false }]);
});

// ---------- failed runs ----------

test('a non-zero exit, a budget stop and unparseable output are errors; the next case still runs; exit 1', () => {
  for (const [mode, reason] of [
    ['exit', /^exit code 3$/],
    ['budget', /^the CLI reported error_max_budget_usd \(budget stop\)$/],
    ['iserror', /^the CLI reported an error \(is_error with subtype success\)$/],
    ['garbage', /^the output is not the CLI result JSON$/],
  ]) {
    const r = bench(['run', '--case', 'csv-quoted-fields', '--case', 'test-asserts-nothing'], { STUB_MODE: mode, STUB_TEXT: 'VERDICT: REWORK', STUB_SOLVE: csvSolution() });
    assert.strictEqual(r.code, 1, mode);
    assert.strictEqual(r.calls.length, 2, `${mode}: the second case ran`);
    for (const id of ['csv-quoted-fields', 'test-asserts-nothing']) {
      const res = result(r, id);
      assert.strictEqual(res.outcome, 'error', `${mode} ${id}`);
      assert.match(res.error, reason, `${mode} ${id}`);
    }
    if (mode !== 'garbage') assert.strictEqual(result(r, 'csv-quoted-fields').costUsd, 0.25, 'the money spent is still recorded');
    assert.match(r.out, /2 run\(s\): 0 pass, 0 fail, 2 error/);
  }
});

test('explicit null cost, turns and token counters are recorded as unknown, and the report flags them', () => {
  const r = bench(['run', '--case', 'test-asserts-nothing'], { STUB_MODE: 'nulls', STUB_TEXT: 'VERDICT: REWORK' });
  const res = result(r, 'test-asserts-nothing');
  assert.strictEqual(res.costUsd, null);
  assert.strictEqual(res.turns, null);
  assert.strictEqual(res.tokens, null);
  assert.match(r.out, /tokens n\/a; cost n\/a/);
  const report = benchReport([res]);
  assert.match(report, /\(\+1 unknown\)/);
});

test('scratch repos ignore a global hooks path, commit signing and init template', () => {
  const home = tempDir('bench-gitglobal');
  const hooks = path.join(home, 'hooks');
  fs.mkdirSync(hooks);
  fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho blocked by a global hook >&2\nexit 1\n', { mode: 0o755 });
  fs.mkdirSync(path.join(home, 'template', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(home, 'template', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const globalFile = path.join(home, 'gitconfig');
  fs.writeFileSync(globalFile, `[core]\n\thooksPath = ${hooks.replace(/\\/g, '/')}\n[commit]\n\tgpgsign = true\n[tag]\n\tgpgsign = true\n[gpg]\n\tprogram = orc-bench-no-gpg\n[init]\n\ttemplateDir = ${path.join(home, 'template').replace(/\\/g, '/')}\n`);
  const saved = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = globalFile;
  try {
    for (const c of listBenchCases(CASES).filter((x) => ['test-asserts-nothing', 'csv-quoted-fields'].includes(x.id))) {
      const dir = makeScratchRepo(c);
      try {
        assert.ok(spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).status === 0, `${c.id}: committed`);
        assert.ok(!fs.existsSync(path.join(dir, '.git', 'hooks', 'pre-commit')), `${c.id}: no template hook copied`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  } finally {
    if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = saved;
  }
});

test('an error that names a path is written with the path redacted', () => {
  const repo = tempDir('bench-redact');
  for (const d of ['core', 'adapters', 'tools']) fs.cpSync(path.join(REPO, d), path.join(repo, d), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'models.json'), path.join(repo, 'models.json'));
  const caseDir = path.join(repo, 'tests', 'fixtures', 'bench', 'test-asserts-nothing');
  fs.cpSync(path.join(CASES, 'test-asserts-nothing'), caseDir, { recursive: true });
  const abs = path.join(os.tmpdir(), 'orc-bench-redact-probe').replace(/\\/g, '/');
  fs.writeFileSync(path.join(caseDir, 'change.patch'), `diff --git a/${abs}/x.js b/${abs}/x.js\n--- a/${abs}/x.js\n+++ b/${abs}/x.js\n@@ -1 +1 @@\n-a\n+b\n`);
  const r = bench(['run', '--repo', repo, '--case', 'test-asserts-nothing']);
  assert.strictEqual(r.code, 1);
  assert.deepStrictEqual(r.calls, [], 'the scratch repo failed before the agent started');
  const res = result(r, 'test-asserts-nothing');
  assert.strictEqual(res.outcome, 'error');
  assert.match(res.error, /^git apply failed: error: <temp>\/orc-bench-redact-probe\/x\.js: No such file or directory$/);
  assertNoPaths(r.results['test-asserts-nothing.json']);
});

test('a signal stops the run early: the next case does not start, the tally says so, exit 1', async () => {
  const dir = tempDir('bench-signal');
  const out = path.join(dir, 'out');
  const saved = process.env.ORC_TOOL_BIN_CLAUDE_CODE;
  process.env.ORC_TOOL_BIN_CLAUDE_CODE = stub(dir);
  process.env.STUB_MODE = 'sleep';
  const before = process.listeners('SIGINT');
  const lines = [];
  try {
    const running = main(['bench', 'run', '--case', 'retry-backoff', '--case', 'test-asserts-nothing', '--out', out], { out: (s) => lines.push(s), err: (s) => lines.push(s) });
    const calls = path.join(dir, 'calls.jsonl');
    for (let i = 0; i < 300 && !fs.existsSync(calls); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(fs.existsSync(calls), 'the first case started');
    // Only the handler the run registered gets the signal, so the test runner's own handlers stay out of it.
    for (const l of before) process.off('SIGINT', l);
    try {
      process.emit('SIGINT', 'SIGINT');
    } finally {
      for (const l of before) process.on('SIGINT', l);
    }
    const code = await running;
    assert.strictEqual(code, 1);
    assert.strictEqual(fs.readFileSync(calls, 'utf8').trim().split('\n').length, 1, 'the second case never started');
    const text = lines.join('\n');
    assert.match(text, /retry-backoff: error \(stopped by SIGINT\)/);
    assert.match(text, /1 run\(s\): 0 pass, 0 fail, 1 error \(stopped early\)/);
  } finally {
    delete process.env.STUB_MODE;
    if (saved === undefined) delete process.env.ORC_TOOL_BIN_CLAUDE_CODE;
    else process.env.ORC_TOOL_BIN_CLAUDE_CODE = saved;
  }
});

test('a run past --timeout is killed and recorded as an error', () => {
  const t0 = Date.now();
  const r = bench(['run', '--case', 'retry-backoff', '--timeout', '2'], { STUB_MODE: 'sleep' });
  assert.strictEqual(r.code, 1);
  assert.ok(Date.now() - t0 < 60000, 'returned well before the stub would have');
  assert.match(r.err, /bench: timed out after 2s; killing the process tree/);
  const res = result(r, 'retry-backoff');
  assert.strictEqual(res.outcome, 'error');
  assert.strictEqual(res.error, 'timed out after 2s');
});

test('a tool that cannot start is recorded as an error, with no version', () => {
  const missing = path.join(tempDir('nobin'), 'claude-not-here.exe');
  const r = bench(['run', '--case', 'retry-backoff'], { ORC_TOOL_BIN_CLAUDE_CODE: missing });
  assert.strictEqual(r.code, 1);
  const res = result(r, 'retry-backoff');
  assert.strictEqual(res.outcome, 'error');
  assert.strictEqual(res.error, 'the tool could not start (exit 127)');
  assert.strictEqual(res.claudeVersion, null);
});

// ---------- parsing ----------

test('parseVerdict follows the refuter report format and takes the last verdict line', () => {
  assert.strictEqual(parseVerdict('VERDICT: ACCEPT\nRERAN: node --test'), 'ACCEPT');
  assert.strictEqual(parseVerdict('**VERDICT:** REWORK'), 'REWORK');
  assert.strictEqual(parseVerdict('`VERDICT: REWORK`'), 'REWORK');
  assert.strictEqual(parseVerdict('VERDICT: ACCEPT\n...\nVERDICT: REWORK\n'), 'REWORK');
  assert.strictEqual(parseVerdict('VERDICT: ACCEPT | REWORK'), null, 'the template line is not a verdict');
  assert.strictEqual(parseVerdict('REWORK\nI would ACCEPT this'), null, 'a bare word is not a verdict line');
  assert.strictEqual(parseVerdict('The VERDICT: REWORK is mine'), null, 'only at the start of a line');
  assert.strictEqual(parseVerdict(''), null);
});

test('tokensOf prefers the per-model totals, and redact leaves no path behind', () => {
  assert.deepStrictEqual(
    tokensOf({ usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: { a: { inputTokens: 5, outputTokens: 2, cacheReadInputTokens: 10, cacheCreationInputTokens: 3 }, b: { inputTokens: 1, outputTokens: 1 } } }),
    { input: 6, cacheWrite: 3, cacheRead: 10, output: 3 },
  );
  assert.strictEqual(tokensOf({}), null);
  assert.strictEqual(tokensOf({ usage: { input_tokens: 1, output_tokens: null } }), null, 'an explicit null counter is unknown, not 0');
  assert.strictEqual(tokensOf({ modelUsage: { a: { inputTokens: 5, outputTokens: '7' } } }), null, 'so is a counter that is not a number');
  const t = redact('git apply failed: error in C:\\Temp\\orc-bench-1\\a.js and /var/tmp/x', [['C:\\Temp\\orc-bench-1', '<scratch>']]);
  assert.strictEqual(t, 'git apply failed: error in <scratch>\\a.js and <path>');
});

// ---------- report ----------

const run = (fields) => ({ schemaVersion: 1, tokens: { input: 10, cacheWrite: 0, cacheRead: 0, output: 10 }, costUsd: 0.5, ...fields });

test('report maths: false-ACCEPT rate, tokens and cost per pass, n/a, and the small-count form', () => {
  const rework = (verdict, outcome, found) => run({ case: 'r', kind: 'refute', variant: 'baseline', expect: 'REWORK', verdict, outcome, defects: [{ id: 'E1', found }, { id: 'E2', found: false }] });
  const results = [
    rework('ACCEPT', 'fail', false),
    rework('REWORK', 'pass', true),
    rework('REWORK', 'pass', true),
    rework(null, 'error', false),
    run({ case: 'a', kind: 'refute', variant: 'baseline', expect: 'ACCEPT', verdict: 'ACCEPT', outcome: 'pass', defects: [] }),
    run({ case: 'b', kind: 'build', variant: 'baseline', outcome: 'pass' }),
    run({ case: 'b', kind: 'build', variant: 'baseline', outcome: 'fail', costUsd: null }),
    run({ case: 'b', kind: 'build', variant: 'cheap', outcome: 'fail' }),
    run({ case: 'b', kind: 'build', variant: 'cheap', outcome: 'error', tokens: null }),
  ];
  const s = variantStats(results.filter((r) => r.variant === 'baseline'));
  assert.strictEqual(s.runs, 7);
  assert.strictEqual(s.errors, 1);
  assert.strictEqual(s.falseAccept, '1/3', 'over the REWORK runs that returned a verdict');
  assert.strictEqual(s.falseRework, '0/1');
  assert.strictEqual(s.verdictRight, '60% (3/5)', 'errors count against accuracy');
  assert.strictEqual(s.buildPass, '1/2');
  assert.strictEqual(s.defects, '2/8');
  assert.strictEqual(s.tokens, '140');
  assert.strictEqual(s.cost, '3.00 (+1 unknown)');
  assert.strictEqual(s.tokensPerPass, '35', 'all tokens over the 4 passing runs');
  assert.strictEqual(s.costPerPass, '0.75 (+1 unknown)', 'a run with no cost is flagged in the per-pass figure too');
  const cheap = variantStats(results.filter((r) => r.variant === 'cheap'));
  assert.strictEqual(cheap.tokens, '20 (+1 unknown)');
  assert.strictEqual(cheap.tokensPerPass, 'n/a');
  assert.strictEqual(cheap.costPerPass, 'n/a');
  assert.strictEqual(cheap.falseAccept, 'n/a');
  assert.strictEqual(cheap.verdictRight, 'n/a');
  assert.strictEqual(cheap.buildPass, '0/2', 'an errored build run is not a pass and stays in the count');
  assert.strictEqual(rate(0, 0), 'n/a');
  assert.strictEqual(rate(2, 3), '2/3');
  assert.strictEqual(rate(1, 5), '20% (1/5)');
  const md = benchReport(results, ['x/broken.json (schemaVersion undefined)']);
  assert.match(md, /^\| baseline \| 7 \| 1 \| 1\/2 \| 60% \(3\/5\) \| 1\/3 \| 0\/1 \| 2\/8 \| 140 \| 3\.00 \(\+1 unknown\) \| 35 \| 0\.75 \(\+1 unknown\) \|$/m);
  assert.match(md, /^\| cheap \| 2 \| 1 \| 0\/2 \| n\/a \| n\/a \| n\/a \| n\/a \| 20 \(\+1 unknown\) \| 1\.00 \| n\/a \| n\/a \|$/m);
  assert.match(md, /^\| r \| baseline \| 2 pass, 1 fail, 1 error \| 80 \| 2\.00 \|$/m);
  assert.match(md, /^\| b \| cheap \| 1 fail, 1 error \| 20 \(\+1 unknown\) \| 1\.00 \|$/m);
  assert.match(md, /^- x\/broken\.json \(schemaVersion undefined\)$/m);
});

test('an errored run neither counts in the false-verdict rates nor earns defect credit, whatever its partial text said', () => {
  const rework = (verdict, outcome, found) => run({ case: 'r', kind: 'refute', variant: 'baseline', expect: 'REWORK', verdict, outcome, defects: [{ id: 'E1', found }] });
  const results = [
    rework('ACCEPT', 'fail', false),
    rework('ACCEPT', 'fail', false),
    rework('REWORK', 'error', true),
    rework('REWORK', 'error', true),
    rework('REWORK', 'error', true),
    run({ case: 'a', kind: 'refute', variant: 'baseline', expect: 'ACCEPT', verdict: 'REWORK', outcome: 'error', defects: [] }),
  ];
  const s = variantStats(results);
  assert.strictEqual(s.falseAccept, '2/2', 'not 2/5');
  assert.strictEqual(s.falseRework, 'n/a', 'the only ACCEPT-expected run errored');
  assert.strictEqual(s.defects, '0/5', 'an errored run finds nothing');
  assert.strictEqual(s.errors, 4);
  assert.strictEqual(s.verdictRight, '0% (0/6)');
});

test('runs with no token or cost figure flag every sum and per-pass cell built on them', () => {
  const results = [
    run({ case: 'b', kind: 'build', variant: 'baseline', outcome: 'pass', tokens: { input: 40, cacheWrite: 0, cacheRead: 50, output: 10 }, costUsd: 1 }),
    run({ case: 'b', kind: 'build', variant: 'baseline', outcome: 'error', tokens: null, costUsd: null }),
    run({ case: 'b', kind: 'build', variant: 'baseline', outcome: 'error', tokens: null, costUsd: null }),
  ];
  const s = variantStats(results);
  assert.strictEqual(s.tokens, '100 (+2 unknown)');
  assert.strictEqual(s.tokensPerPass, '100 (+2 unknown)');
  assert.strictEqual(s.cost, '1.00 (+2 unknown)');
  assert.strictEqual(s.costPerPass, '1.00 (+2 unknown)');
  const md = benchReport(results);
  assert.doesNotMatch(md, /\| 100 \|/, 'no bare 100 anywhere');
  assert.match(md, /^\| b \| baseline \| 1 pass, 2 error \| 100 \(\+2 unknown\) \| 1\.00 \(\+2 unknown\) \|$/m);
});

test('a citation one line past an expected range is not found', () => {
  const expected = parseExpected(fs.readFileSync(path.join(CASES, 'test-asserts-nothing', 'expected.md'), 'utf8'));
  const e1 = (text) => scoreDefects(expected, text).find((d) => d.id === 'E1').found;
  assert.strictEqual(e1('src/paginate.js:10 — off by one'), true);
  assert.strictEqual(e1('src/paginate.js:7-8 — off by one'), true);
  assert.strictEqual(e1('src/paginate.js:11 — off by one'), false);
  assert.strictEqual(e1('src/paginate.js:6 — off by one'), false);
  assert.strictEqual(e1('test/paginate.test.mjs:9 — wrong file'), false);
});

test('bench report reads the result files, lists unreadable ones, and --out refuses to overwrite without --force', async () => {
  const dir = tempDir('bench-results');
  fs.mkdirSync(path.join(dir, '20261124T000000Z-baseline'));
  fs.writeFileSync(path.join(dir, '20261124T000000Z-baseline', 'b.json'), JSON.stringify(run({ case: 'b', kind: 'build', variant: 'baseline', outcome: 'pass' })));
  fs.writeFileSync(path.join(dir, '20261124T000000Z-baseline', 'e.json'), JSON.stringify(run({ case: 'e', kind: 'build', variant: 'baseline', outcome: 'error', error: 'exit code 1' })));
  fs.writeFileSync(path.join(dir, '20261124T000000Z-baseline', 'c.json'), '{not json');
  fs.writeFileSync(path.join(dir, '20261124T000000Z-baseline', 'b.output.md'), 'VERDICT: ACCEPT\n');
  const io = () => {
    const o = { out: [], err: [] };
    return [o, { out: (s) => o.out.push(s), err: (s) => o.err.push(s) }];
  };
  const [o1, io1] = io();
  assert.strictEqual(await main(['bench', 'report', '--dir', dir], io1), 0, o1.err.join('\n'));
  assert.match(o1.out.join('\n'), /^\| baseline \| 2 \| 1 \| 1\/2 \|/m, 'the errored run is in Runs, Errors and the pass rate');
  assert.match(o1.out.join('\n'), /^\| e \| baseline \| 1 error \|/m);
  assert.match(o1.out.join('\n'), /^- 20261124T000000Z-baseline\/c\.json \(/m);
  const file = path.join(dir, 'report.md');
  fs.writeFileSync(file, 'keep me');
  const [o2, io2] = io();
  assert.strictEqual(await main(['bench', 'report', '--dir', dir, '--out', file], io2), 1);
  assert.match(o2.err.join('\n'), /refusing to overwrite .*report\.md; pass --force to replace it/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'keep me');
  const [, io3] = io();
  assert.strictEqual(await main(['bench', 'report', '--dir', dir, '--out', file, '--force'], io3), 0);
  assert.match(fs.readFileSync(file, 'utf8'), /^# Bench report/);
});

test('every real case lists cleanly and its expected rows parse', () => {
  const warnings = [];
  const cases = listBenchCases(CASES, warnings);
  assert.deepStrictEqual(warnings, []);
  assert.strictEqual(cases.length, 7);
  for (const c of cases.filter((x) => x.expect === 'REWORK')) assert.ok(c.expected.length >= 1, c.id);
});

test('bench run uses binaries.claude-code from ~/.orc/config.json, and warns and continues on invalid config.json', () => {
  const stubDir = tempDir('bench-cfg-bin');
  const bin = stub(stubDir);
  const data = tempDir('bench-orcdata');
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ version: 1, binaries: { 'claude-code': bin } }));
  const r = bench(['run', '--case', 'csv-quoted-fields'], {
    ORC_DATA_DIR: data,
    ORC_TOOL_BIN_CLAUDE_CODE: undefined,
    PATH: pathWithoutClaude,
    STUB_SOLVE: csvSolution(),
  });
  assert.strictEqual(r.code, 0, r.err);
  const calls = fs.readFileSync(path.join(stubDir, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(calls.length, 1, 'the stub named only in binaries.claude-code ran');
  assert.strictEqual(result(r, 'csv-quoted-fields').outcome, 'pass');
  assert.strictEqual(result(r, 'csv-quoted-fields').claudeVersion, '9.9.9');

  fs.writeFileSync(path.join(data, 'config.json'), '{not json');
  const warn = bench(['run', '--case', 'csv-quoted-fields', '--dry-run'], { ORC_DATA_DIR: data });
  assert.strictEqual(warn.code, 0, warn.err);
  assert.match(warn.err, /WARN .*config\.json: not valid JSON.*bench run goes on without its binaries/);
});

test('bench run refuses a binaries.claude-code that does not exist, and starts nothing', () => {
  const data = tempDir('bench-orcdata-missing');
  const configFile = path.join(data, 'config.json');
  const gone = path.join(tempDir('bench-nobin'), 'claude.exe');
  fs.writeFileSync(configFile, JSON.stringify({ version: 1, binaries: { 'claude-code': gone } }));
  const r = bench(['run', '--case', 'csv-quoted-fields'], { ORC_DATA_DIR: data, ORC_TOOL_BIN_CLAUDE_CODE: undefined, PATH: pathWithoutClaude });
  assert.strictEqual(r.code, 1);
  assert.ok(r.err.includes(`bench: cannot run claude-code: ${gone} (binaries.claude-code in ${configFile}) does not exist`), r.err);
  assert.deepStrictEqual(r.calls, []);
  assert.deepStrictEqual(r.runs, [], 'no run folder, no result');
});

test('bench run ignores ~/.orc/models.json so a benchmark depends on the checkout and flags alone', () => {
  const data = tempDir('bench-shared-models');
  fs.writeFileSync(path.join(data, 'models.json'), JSON.stringify({ 'claude-code': { high: { model: 'shared-override-model', effort: 'low' } } }));
  const r = bench(['run', '--case', 'csv-quoted-fields', '--dry-run'], { ORC_DATA_DIR: data });
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, / --model opus --effort high /);
  assert.doesNotMatch(r.out, /shared-override-model/);
});
