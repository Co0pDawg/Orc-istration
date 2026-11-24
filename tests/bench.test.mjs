// orc bench: the replay benchmark. Real runs go through a stub executable (ORC_TOOL_BIN_CLAUDE_CODE), never a model;
// the cases are the real ones in tests/fixtures/bench and the agent definitions come from the real roles/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main, loadRoles, loadModels, buildTool } from '../tools/orc.mjs';
import { parse } from '../tools/lib/frontmatter.mjs';
import { parseVerdict, benchReport, variantStats, rate, tokensOf, redact, listBenchCases } from '../tools/lib/bench.mjs';

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
else {
  const text = (process.env.STUB_TEXT ?? 'done').replaceAll('{cwd}', process.cwd());
  const budget = mode === 'budget';
  process.stdout.write(JSON.stringify({ type: 'result', subtype: budget ? 'error_max_budget_usd' : 'success', is_error: budget, num_turns: 7, result: text, total_cost_usd: 0.25,
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
  const r = spawnSync(process.execPath, [ORC, 'bench', ...argv, ...(argv.includes('--out') ? [] : ['--out', out])], {
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, ORC_TOOL_BIN_CLAUDE_CODE: stub(dir), ...env },
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
  fs.cpSync(path.join(REPO, 'roles'), path.join(repo, 'roles'), { recursive: true });
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
  const built = buildTool(adapter, loadRoles(REPO), loadModels(REPO, { local: false }), fs.readFileSync(path.join(REPO, 'AGENTS.md'), 'utf8'));
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
  assert.deepStrictEqual(res.defects, [{ id: 'E1', found: false }]);
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
  for (const [mode, reason] of [['exit', /^exit code 3$/], ['budget', /^the CLI reported error_max_budget_usd \(budget stop\)$/], ['garbage', /^the output is not the CLI result JSON$/]]) {
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
  assert.strictEqual(s.tokens, 140);
  assert.strictEqual(s.cost, '3.00 (+1 unknown)');
  assert.strictEqual(s.tokensPerPass, '35', 'all tokens over the 4 passing runs');
  assert.strictEqual(s.costPerPass, '0.75');
  const cheap = variantStats(results.filter((r) => r.variant === 'cheap'));
  assert.strictEqual(cheap.tokensPerPass, 'n/a');
  assert.strictEqual(cheap.costPerPass, 'n/a');
  assert.strictEqual(cheap.falseAccept, 'n/a');
  assert.strictEqual(cheap.verdictRight, 'n/a');
  assert.strictEqual(cheap.buildPass, '0/2', 'an errored build run is not a pass and stays in the count');
  assert.strictEqual(rate(0, 0), 'n/a');
  assert.strictEqual(rate(2, 3), '2/3');
  assert.strictEqual(rate(1, 5), '20% (1/5)');
  const md = benchReport(results, ['x/broken.json (schemaVersion undefined)']);
  assert.match(md, /^\| baseline \| 7 \| 1 \| 1\/2 \| 60% \(3\/5\) \| 1\/3 \| 0\/1 \| 2\/8 \| 140 \| 3\.00 \(\+1 unknown\) \| 35 \| 0\.75 \|$/m);
  assert.match(md, /^\| cheap \| 2 \| 1 \| 0\/2 \| n\/a \| n\/a \| n\/a \| n\/a \| 20 \| 1\.00 \| n\/a \| n\/a \|$/m);
  assert.match(md, /^\| r \| baseline \| 2 pass, 1 fail, 1 error \| 80 \| 2\.00 \|$/m);
  assert.match(md, /^- x\/broken\.json \(schemaVersion undefined\)$/m);
});

test('bench report reads the result files, lists unreadable ones, and --out refuses to overwrite without --force', async () => {
  const dir = tempDir('bench-results');
  fs.mkdirSync(path.join(dir, '20261124T000000Z-baseline'));
  fs.writeFileSync(path.join(dir, '20261124T000000Z-baseline', 'b.json'), JSON.stringify(run({ case: 'b', kind: 'build', variant: 'baseline', outcome: 'pass' })));
  fs.writeFileSync(path.join(dir, '20261124T000000Z-baseline', 'c.json'), '{not json');
  fs.writeFileSync(path.join(dir, '20261124T000000Z-baseline', 'b.output.md'), 'VERDICT: ACCEPT\n');
  const io = () => {
    const o = { out: [], err: [] };
    return [o, { out: (s) => o.out.push(s), err: (s) => o.err.push(s) }];
  };
  const [o1, io1] = io();
  assert.strictEqual(await main(['bench', 'report', '--dir', dir], io1), 0, o1.err.join('\n'));
  assert.match(o1.out.join('\n'), /^\| baseline \| 1 \| 0 \| 1\/1 \|/m);
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
