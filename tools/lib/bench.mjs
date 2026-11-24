// Replay benchmark: run the checkout's builder and refuter roles headlessly on fixed, invented cases, score each run
// and compare variants. Case format, procedure, scoring and the result schema: orchestration/bench.md. A case is
// tests/fixtures/bench/<id>/ with case.md, seed/, brief.md, and accept/ (build) or change.patch and expected.md (refute).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from './frontmatter.mjs';
import { readText } from './text.mjs';
import { parseExpected, scoreCase, locationsIn } from './corpus.mjs';
import { resolveExecutable, runTool, formatCommand, binEnv, ARGV_LIMIT } from './dispatch.mjs';

export const SCHEMA_VERSION = 1;
export const BENCH_USAGE =
  'usage: bench list | bench run [--case <id>]... [--variant <label>] [--models <file>] [--tool claude-code] [--out <dir>] [--budget-usd <n>] [--timeout <seconds>] [--runs <n>] [--keep] [--keep-output] [--dry-run] | bench report [--dir <dir>] [--out <file>] [--force]';

const CASE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VARIANT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const ROLE_OF = { build: 'builder', refute: 'refuter' };
// The tools each role may use without a prompt. Anything else is denied in a headless run unless the user's or the
// project's settings allow it, since those allow rules still apply.
export const ALLOWED_TOOLS = {
  builder: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(node:*)', 'Bash(npm:*)', 'Bash(git:*)'],
  refuter: ['Read', 'Glob', 'Grep', 'Bash(node:*)', 'Bash(npm:*)', 'Bash(git:*)'],
};
// The levels `claude --effort` takes (models.json also allows `ultra`, which it does not).
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const ACCEPT_TIMEOUT_SEC = 300;

// case.md: a `# <title>` heading, a `Kind: build|refute` line, and `Accept: <command>` (build) or
// `Expect: ACCEPT|REWORK` (refute).
export function readBenchCase(text) {
  const line = (key) => new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm').exec(text)?.[1] ?? '';
  return { title: /^#\s+(.+?)\s*$/m.exec(text)?.[1] ?? '', kind: line('Kind'), accept: line('Accept'), expect: line('Expect') };
}

const isDir = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory();
const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();

// Every case folder with a case.md, each with `problems` (a malformed case is listed, warned about and never run).
export function listBenchCases(root, warnings = []) {
  if (!isDir(root)) throw new Error(`bench: no case folder at ${root}`);
  const cases = [];
  for (const id of fs.readdirSync(root).filter((d) => isDir(path.join(root, d))).sort()) {
    const dir = path.join(root, id);
    if (!isFile(path.join(dir, 'case.md'))) {
      warnings.push(`bench: ${id} has no case.md, so it is not listed`);
      continue;
    }
    const c = { id, dir, ...readBenchCase(readText(path.join(dir, 'case.md'))), problems: [] };
    const p = c.problems;
    if (!CASE_ID.test(id)) p.push('the folder name is not lower-case words joined by hyphens');
    if (!c.title) p.push('case.md has no `# <title>` heading');
    if (!ROLE_OF[c.kind]) p.push(`case.md has no \`Kind: build\` or \`Kind: refute\` line${c.kind ? ` (got "${c.kind}")` : ''}`);
    if (!isDir(path.join(dir, 'seed'))) p.push('no seed/ folder');
    if (!isFile(path.join(dir, 'brief.md'))) p.push('no brief.md');
    if (c.kind === 'build') {
      if (!c.accept) p.push('case.md has no `Accept: <command>` line');
      if (!isDir(path.join(dir, 'accept'))) p.push('no accept/ folder');
    }
    if (c.kind === 'refute') {
      if (!['ACCEPT', 'REWORK'].includes(c.expect)) p.push('case.md has no `Expect: ACCEPT` or `Expect: REWORK` line');
      if (!isFile(path.join(dir, 'change.patch'))) p.push('no change.patch');
      if (c.expect === 'REWORK') {
        if (!isFile(path.join(dir, 'expected.md'))) p.push('Expect: REWORK needs expected.md');
        else {
          try {
            c.expected = parseExpected(readText(path.join(dir, 'expected.md')));
          } catch (e) {
            p.push(`expected.md: ${e.message}`);
          }
        }
      }
    }
    for (const msg of p) warnings.push(`bench: ${id}: ${msg}`);
    cases.push(c);
  }
  return cases;
}

// The --agents value: the agent file `build --tool claude-code` writes for this role (adapter.renderAgent at the
// role's tier), as the JSON shape Claude Code takes ({name: {description, prompt, tools?, model, effort?}}).
export function agentDefinition(adapter, role, models) {
  const tierModel = models[adapter.id]?.[role.tier];
  if (!tierModel?.model) throw new Error(`bench: no ${role.tier} model for ${adapter.id}`);
  const { data, body } = parse(adapter.renderAgent(role, tierModel).content);
  const def = { description: data.description, prompt: body };
  if (data.tools !== undefined) def.tools = (Array.isArray(data.tools) ? data.tools : String(data.tools).split(',')).map((t) => String(t).trim()).filter(Boolean);
  if (data.model) def.model = data.model;
  if (data.effort) def.effort = data.effort;
  return { [data.name]: def };
}

// The headless command for one role on Claude Code. The brief goes on stdin, never through a shell.
export function benchPlan(adapter, role, models, briefText, { budgetUsd, env = process.env } = {}) {
  if (adapter.id !== 'claude-code') return { error: `bench: no bench recipe for ${adapter.id}` };
  const tiers = models[adapter.id] ?? {};
  const base = tiers[role.tier] ?? {};
  const model = tiers.headless?.[role.tier] ?? base.model;
  const effort = role.effort ?? base.effort;
  if (!model) return { error: `bench: no ${role.tier} model for ${adapter.id}` };
  if (effort && !CLAUDE_EFFORTS.includes(effort)) return { error: `bench: effort "${effort}" (the ${role.tier} tier) is not one claude --effort takes (${CLAUDE_EFFORTS.join(', ')})` };
  const tools = ALLOWED_TOOLS[role.name];
  if (!tools) return { error: `bench: no allowed-tools list for role ${role.name}` };
  const args = [
    '-p', '--agent', role.name, '--agents', JSON.stringify(agentDefinition(adapter, role, models)),
    '--model', model, ...(effort ? ['--effort', effort] : []),
    '--output-format', 'json', '--permission-mode', 'acceptEdits', '--allowedTools', tools.join(','),
    '--max-budget-usd', String(budgetUsd), '--no-session-persistence',
  ];
  const exe = resolveExecutable('claude', adapter.id, env);
  const plan = { command: 'claude', args, stdin: briefText, toolId: adapter.id, exe, argv: [...exe.pre, ...args], model, effort: effort ?? null };
  const bytes = plan.argv.reduce((n, a) => n + Buffer.byteLength(a) + 1, Buffer.byteLength(exe.command));
  if (bytes > ARGV_LIMIT) return { error: `bench: the command line is ${bytes} bytes (the --agents definition is passed inline); the limit is about ${ARGV_LIMIT} on Windows` };
  return plan;
}

// The verdict line of the refuter's report format (roles/refuter.md: `VERDICT: ACCEPT | REWORK`), bold or code
// decoration allowed; the last one wins. The template line itself (`ACCEPT | REWORK`) is not a verdict.
const VERDICT_LINE = /^[\s>*`_#-]*VERDICT:[\s*`_]*(ACCEPT|REWORK)\b(?![\s*`_]*\|)/;
export function parseVerdict(text) {
  let verdict = null;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = VERDICT_LINE.exec(line);
    if (m) verdict = m[1];
  }
  return verdict;
}

// The CLI's `--output-format json` result: one JSON object (the last line that parses, if anything precedes it).
export function parseResultJson(stdout) {
  const text = String(stdout ?? '').trim();
  const candidates = [text, ...text.split(/\r?\n/).reverse()];
  for (const c of candidates) {
    try {
      const o = JSON.parse(c);
      if (o && typeof o === 'object' && !Array.isArray(o)) return o;
    } catch {
      // not JSON; try the next candidate
    }
  }
  return null;
}

// Tokens as the result JSON reports them: the per-model `modelUsage` totals when present (they include side calls
// on other models), else the top-level `usage`. A counter that is absent counts 0; one that is present but not a
// number (an explicit null) makes the whole figure unknown (null), so the report flags it instead of adding 0.
export function tokensOf(r) {
  let unknown = false;
  const n = (v) => {
    if (v === undefined) return 0;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    unknown = true;
    return 0;
  };
  const per = r?.modelUsage && typeof r.modelUsage === 'object' ? Object.values(r.modelUsage).filter((m) => m && typeof m === 'object') : [];
  let t = null;
  if (per.length) {
    t = per.reduce(
      (s, m) => ({ input: s.input + n(m.inputTokens), cacheWrite: s.cacheWrite + n(m.cacheCreationInputTokens), cacheRead: s.cacheRead + n(m.cacheReadInputTokens), output: s.output + n(m.outputTokens) }),
      { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 },
    );
  } else if (r?.usage && typeof r.usage === 'object') {
    const u = r.usage;
    t = { input: n(u.input_tokens), cacheWrite: n(u.cache_creation_input_tokens), cacheRead: n(u.cache_read_input_tokens), output: n(u.output_tokens) };
  }
  return unknown ? null : t;
}

// A figure from the result JSON: a finite number, else unknown (null). An explicit null is unknown, never 0.
const figure = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The ways a path can be written in a report: as given and resolved, with either slash, and as Git Bash writes a
// Windows path (`/c/Users/...`). Longest first, so a longer form is replaced before its prefix.
function pathForms(p) {
  const bases = [p];
  try {
    bases.push(fs.realpathSync.native(p));
  } catch {
    // a path that is gone keeps its given form only
  }
  const forms = new Set();
  for (const b of bases) {
    forms.add(b).add(b.replace(/\\/g, '/')).add(b.replace(/\//g, '\\'));
    const drive = /^([A-Za-z]):[\\/](.*)$/.exec(b);
    if (drive) forms.add(`/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, '/')}`);
  }
  return [...forms].sort((a, b) => b.length - a.length);
}

// Replaces each root (any written form, any case) and then any other absolute path, so no result carries one.
export function redact(text, roots = []) {
  let out = String(text ?? '');
  for (const [root, label] of roots) {
    if (!root) continue;
    for (const form of pathForms(root)) out = out.replace(new RegExp(escapeRe(form), 'gi'), label);
  }
  return out.replace(/\b[A-Za-z]:[\\/][^\s'"`]*/g, '<path>').replace(/(^|[\s'"`(])\/(?:Users|home|tmp|var|private|root)\/[^\s'"`]*/g, '$1<path>');
}

// The agent's report with the scratch repo's own path removed, so `C:\...\src\a.js:3` reads as `src/a.js:3`.
export function relativeToRepo(text, repoDir) {
  let out = String(text ?? '');
  for (const form of pathForms(repoDir)) out = out.replace(new RegExp(`${escapeRe(form)}[\\\\/]?`, 'gi'), '');
  return out;
}

// Each expected row of a refute case, found when the report cites `path:line` in its file with the line in range
// (review/corpus.md matching: first line only, `\` and a leading `./` normalised).
export function scoreDefects(expected, text) {
  const s = scoreCase(expected, [{ locations: locationsIn(String(text ?? '')) }]);
  const found = new Set(s.found.map((e) => e.id));
  return expected.map((e) => ({ id: e.id, found: found.has(e.id) }));
}

const GIT_TIMEOUT_MS = 120000;

// Scratch-repo git: no signing, no hooks (an empty hooks folder) and no autocrlf, whatever the user's global config
// says, and a timeout so a hung call fails the run instead of stalling it.
const git = (cwd, args, input, noHooks) => {
  const r = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', `core.hooksPath=${noHooks}`, ...args], { cwd, input, encoding: 'utf8', shell: false, windowsHide: true, timeout: GIT_TIMEOUT_MS });
  if (r.error?.code === 'ETIMEDOUT') throw new Error(`git ${args[0]} timed out after ${GIT_TIMEOUT_MS / 1000}s`);
  if (r.error || r.status !== 0) throw new Error(`git ${args[0]} failed: ${(r.stderr || r.error?.message || '').trim().split('\n')[0]}`);
  return r.stdout;
};

// Copies a fixture folder, turning CRLF into LF in text files (a checkout under core.autocrlf would otherwise break
// `git apply` and the byte-for-byte cases).
function copyLf(from, to) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      copyLf(src, dst);
      continue;
    }
    const buf = fs.readFileSync(src);
    fs.writeFileSync(dst, buf.includes(0) ? buf : buf.toString('utf8').replace(/\r\n/g, '\n'));
  }
}

// A scratch repo for one case run: the seed committed on `base`; for refute, the change committed on `change`, which
// stays checked out.
export function makeScratchRepo(c) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orc-bench-'));
  // An empty folder serves as both the init template and the hooks path, so no user template or hook applies.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'orc-bench-empty-'));
  const g = (args, input) => git(dir, args, input, empty);
  try {
    copyLf(path.join(c.dir, 'seed'), dir);
    g(['init', '-q', `--template=${empty}`, '-b', 'base']);
    g(['config', 'core.autocrlf', 'false']);
    g(['config', 'user.name', 'orc bench']);
    g(['config', 'user.email', 'bench@example.invalid']);
    g(['add', '-A']);
    g(['commit', '-q', '-m', 'seed']);
    if (c.kind === 'refute') {
      g(['checkout', '-q', '-b', 'change']);
      g(['apply', '-'], readText(path.join(c.dir, 'change.patch')).replace(/\r\n/g, '\n'));
      g(['add', '-A']);
      g(['commit', '-q', '-m', 'change']);
    }
  } catch (e) {
    removeDir(dir);
    throw e;
  } finally {
    removeDir(empty);
  }
  return dir;
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // a temp folder that cannot be removed is left for the OS to clean
  }
}

// Runs the case's Accept command in the scratch repo after copying accept/ in: no shell, split on spaces, a leading
// `node` is this Node. Returns the exit code (124 on timeout, 127 when it cannot start).
export function runAccept(c, dir) {
  copyLf(path.join(c.dir, 'accept'), dir);
  const [cmd, ...args] = c.accept.trim().split(/\s+/);
  // Inside a `node --test` run (as in tests/bench.test.mjs) NODE_TEST_CONTEXT would make a nested `node --test`
  // report to the parent and exit 0 whatever its tests do.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(cmd === 'node' ? process.execPath : cmd, args, { cwd: dir, env, stdio: 'ignore', shell: false, windowsHide: true, timeout: ACCEPT_TIMEOUT_SEC * 1000 });
  if (r.error?.code === 'ETIMEDOUT') return 124;
  if (r.error) return 127;
  return r.status ?? 1;
}

const wholeNumber = (v, name, min, max) => {
  const n = /^\d+$/.test(String(v)) ? Number(v) : NaN;
  if (!(n >= min && n <= max)) throw new Error(`bench: --${name} needs a whole number from ${min} to ${max}, got ${v}`);
  return n;
};

// The run options, validated, with their defaults.
export function runOptions(opt, cwd, top) {
  const variant = opt.variant ?? 'baseline';
  if (!VARIANT.test(variant)) throw new Error(`bench: --variant must be letters, digits, '.', '_' or '-' (up to 64), got ${variant}`);
  const budget = opt['budget-usd'] === undefined ? 2 : Number(opt['budget-usd']);
  if (!(Number.isFinite(budget) && budget > 0 && budget <= 1000)) throw new Error(`bench: --budget-usd needs a number above 0 and at most 1000, got ${opt['budget-usd']}`);
  return {
    variant,
    budgetUsd: budget,
    timeoutSec: opt.timeout === undefined ? 900 : wholeNumber(opt.timeout, 'timeout', 1, 86400),
    runs: opt.runs === undefined ? 1 : wholeNumber(opt.runs, 'runs', 1, 100),
    out: path.resolve(cwd, opt.out ?? path.join(top ?? cwd, '.orc', 'bench')),
    cases: opt.case ?? [],
    keep: Boolean(opt.keep),
    keepOutput: Boolean(opt['keep-output']),
    dryRun: Boolean(opt['dry-run']),
  };
}

const utcStamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

function checkoutState(repo) {
  const run = (args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', shell: false, windowsHide: true });
  const head = run(['rev-parse', 'HEAD']);
  if (head.status !== 0) return { gitHead: null, gitDirty: null };
  return { gitHead: head.stdout.trim(), gitDirty: run(['status', '--porcelain']).stdout.trim() !== '' };
}

function toolVersion(exe) {
  const r = spawnSync(exe.command, [...exe.pre, '--version'], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 30000 });
  return /\d+\.\d+\.\d+\S*/.exec(r.stdout ?? '')?.[0] ?? null;
}

// One case run: scratch repo, agent, score. Always returns a result; a failure is outcome "error" with its reason.
async function runOne(c, plan, o, ctx, io) {
  const started = Date.now();
  const result = {
    schemaVersion: SCHEMA_VERSION, case: c.id, kind: c.kind, variant: o.variant, role: ROLE_OF[c.kind], model: plan.model, effort: plan.effort,
    run: ctx.run, startedAt: new Date(started).toISOString(), outcome: 'error', error: null,
    ...(c.kind === 'refute' ? { verdict: null, expect: c.expect, defects: c.expect === 'REWORK' ? c.expected.map((e) => ({ id: e.id, found: false })) : [] } : {}),
    tokens: null, costUsd: null, turns: null, wallClockSeconds: null, gitHead: ctx.gitHead, gitDirty: ctx.gitDirty, claudeVersion: ctx.claudeVersion,
  };
  let dir = null;
  let text = null;
  let signalled = null;
  const roots = () => [[dir, '<scratch>'], [ctx.repo, '<checkout>'], [os.tmpdir(), '<temp>'], [os.homedir(), '<home>']];
  try {
    dir = makeScratchRepo(c);
    const r = await runTool(plan, { timeoutSec: o.timeoutSec, err: io.err, capture: true, cwd: dir, label: 'bench' });
    signalled = r.signalled;
    const json = parseResultJson(r.stdout);
    if (json) {
      result.tokens = tokensOf(json);
      result.costUsd = figure(json.total_cost_usd);
      result.turns = figure(json.num_turns);
      if (typeof json.result === 'string') text = json.result;
    }
    // What the result JSON says went wrong: a non-success subtype by name, or `is_error` under any other subtype.
    let cliError = null;
    if (json && json.subtype && json.subtype !== 'success') cliError = `${json.subtype}${/budget/i.test(json.subtype) ? ' (budget stop)' : ''}`;
    else if (json?.is_error === true) cliError = `an error (is_error with subtype ${json.subtype ?? 'none'})`;
    if (r.signalled) result.error = `stopped by ${r.signalled}`;
    else if (r.timedOut) result.error = `timed out after ${o.timeoutSec}s`;
    else if (r.code === 127) result.error = 'the tool could not start (exit 127)';
    else if (r.code !== 0) result.error = `exit code ${r.code}${cliError ? ` (the CLI reported ${cliError})` : ''}`;
    else if (!json) result.error = 'the output is not the CLI result JSON';
    else if (cliError) result.error = `the CLI reported ${cliError}`;
    else if (text === null) result.error = 'the result JSON has no result text';
    if (c.kind === 'refute' && text !== null) {
      result.verdict = parseVerdict(text);
      if (c.expect === 'REWORK') result.defects = scoreDefects(c.expected, relativeToRepo(text, dir));
      if (!result.error && !result.verdict) result.error = 'no VERDICT line in the report';
    }
    if (!result.error) {
      if (c.kind === 'refute') result.outcome = result.verdict === c.expect ? 'pass' : 'fail';
      else result.outcome = runAccept(c, dir) === 0 ? 'pass' : 'fail';
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  } finally {
    result.wallClockSeconds = Math.round((Date.now() - started) / 100) / 10;
    if (result.error) result.error = redact(result.error, roots());
    if (dir && o.keep) io.out(`kept scratch repo for ${c.id}: ${dir}`);
    else if (dir) removeDir(dir);
  }
  return { result, text, signalled };
}

// `bench run`: every selected case (default all), `runs` times each, into <out>/<runId>/. Exits 1 when a case is
// malformed or unknown (nothing started) or when any run errored.
export async function runBench({ repo, root, adapter, roles, models, opt, cwd }, io) {
  const top = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', shell: false, windowsHide: true });
  const o = runOptions(opt, cwd, top.status === 0 ? top.stdout.trim() : null);
  const all = listBenchCases(root, []);
  const unknown = o.cases.filter((id) => !all.some((c) => c.id === id));
  if (unknown.length) throw new Error(`bench: no case ${unknown.join(', ')} (known: ${all.map((c) => c.id).join(', ')})`);
  const cases = o.cases.length ? all.filter((c) => o.cases.includes(c.id)) : all;
  const bad = cases.filter((c) => c.problems.length);
  if (bad.length) throw new Error(`bench: malformed case(s), nothing started: ${bad.map((c) => `${c.id} (${c.problems.join('; ')})`).join(', ')}`);
  const plans = new Map();
  for (const c of cases) {
    const role = roles.find((r) => r.name === ROLE_OF[c.kind]);
    if (!role) throw new Error(`bench: no ${ROLE_OF[c.kind]} role in roles/`);
    const plan = benchPlan(adapter, role, models, readText(path.join(c.dir, 'brief.md')), { budgetUsd: o.budgetUsd });
    if (plan.error) throw new Error(plan.error);
    plans.set(c.id, plan);
  }
  if (o.dryRun) {
    for (const c of cases) io.out(`case ${c.id} (${c.kind}, ${ROLE_OF[c.kind]}; working folder: a scratch repo)\n${formatCommand(plans.get(c.id))}`);
    return 0;
  }
  const first = plans.get(cases[0]?.id);
  if (!first) throw new Error('bench: no cases to run');
  if (first.exe.missing) throw new Error(`bench: cannot run claude: not found${first.exe.shim ? ' (only a .cmd/.bat shim)' : ''}; set ${binEnv(adapter.id)} to its full path`);
  const runId = `${utcStamp(new Date())}-${o.variant}`;
  const outDir = path.join(o.out, runId);
  if (fs.existsSync(outDir)) throw new Error(`bench: ${outDir} already exists; wait a second and run again`);
  fs.mkdirSync(outDir, { recursive: true });
  const ctx = { repo, ...checkoutState(repo), claudeVersion: toolVersion(first.exe) };
  const tally = { pass: 0, fail: 0, error: 0 };
  let stopped = false;
  for (const c of cases) {
    for (let n = 1; n <= o.runs && !stopped; n++) {
      const name = o.runs > 1 ? `${c.id}.${n}` : c.id;
      const { result, text, signalled } = await runOne(c, plans.get(c.id), o, { ...ctx, run: n }, io);
      fs.writeFileSync(path.join(outDir, `${name}.json`), `${JSON.stringify(result, null, 2)}\n`);
      if (o.keepOutput && text !== null) fs.writeFileSync(path.join(outDir, `${name}.output.md`), text.endsWith('\n') ? text : `${text}\n`);
      tally[result.outcome]++;
      const tokens = result.tokens ? Object.values(result.tokens).reduce((a, b) => a + b, 0) : 'n/a';
      const cost = result.costUsd === null ? 'n/a' : `$${result.costUsd.toFixed(2)}`;
      io.out(`${name}: ${result.outcome}${result.error ? ` (${result.error})` : ''}; tokens ${tokens}; cost ${cost}`);
      if (signalled) stopped = true;
    }
    if (stopped) break;
  }
  io.out(`${tally.pass + tally.fail + tally.error} run(s): ${tally.pass} pass, ${tally.fail} fail, ${tally.error} error${stopped ? ' (stopped early)' : ''}; results in ${outDir}`);
  return tally.error || stopped ? 1 : 0;
}

// Every result file under <dir>/<runId>/; a file that is not a result is listed in `skipped`, never dropped silently.
export function loadBenchResults(dir) {
  if (!isDir(dir)) throw new Error(`bench: no results folder at ${dir}`);
  const results = [];
  const skipped = [];
  for (const run of fs.readdirSync(dir).filter((d) => isDir(path.join(dir, d))).sort()) {
    for (const f of fs.readdirSync(path.join(dir, run)).filter((x) => x.endsWith('.json')).sort()) {
      const rel = `${run}/${f}`;
      try {
        const r = JSON.parse(readText(path.join(dir, run, f)));
        if (r?.schemaVersion !== SCHEMA_VERSION) throw new Error(`schemaVersion ${r?.schemaVersion}`);
        if (!ROLE_OF[r.kind] || typeof r.case !== 'string' || typeof r.variant !== 'string' || !['pass', 'fail', 'error'].includes(r.outcome)) throw new Error('missing case, kind, variant or outcome');
        results.push(r);
      } catch (e) {
        skipped.push(`${rel} (${e instanceof Error ? e.message : String(e)})`);
      }
    }
  }
  return { results, skipped };
}

// A rate: `n/a` with no runs, the count alone under 5 runs, else a percentage with its count.
export function rate(k, n) {
  if (!n) return 'n/a';
  if (n < 5) return `${k}/${n}`;
  return `${Math.round((100 * k) / n)}% (${k}/${n})`;
}

const hasTokens = (r) => Boolean(r.tokens && typeof r.tokens === 'object');
const sumTokens = (rs) => rs.reduce((t, r) => t + (hasTokens(r) ? Object.values(r.tokens).reduce((a, b) => a + Number(b || 0), 0) : 0), 0);
const sumCost = (rs) => rs.reduce((t, r) => t + (Number.isFinite(r.costUsd) ? r.costUsd : 0), 0);
// A run with no token or cost figure counts as 0 in the sums; every cell built on such a sum says how many.
const unknownFlag = (n) => (n ? ` (+${n} unknown)` : '');
const tokensCell = (rs, value) => `${value}${unknownFlag(rs.filter((r) => !hasTokens(r)).length)}`;
const costCell = (rs, value) => `${value.toFixed(2)}${unknownFlag(rs.filter((r) => !Number.isFinite(r.costUsd)).length)}`;

// The variant figures; see orchestration/bench.md "Scoring rules" for each denominator.
export function variantStats(rs) {
  const build = rs.filter((r) => r.kind === 'build');
  const refute = rs.filter((r) => r.kind === 'refute');
  const wantRework = refute.filter((r) => r.expect === 'REWORK');
  // An errored run's verdict (read from partial text) is not one: the false-verdict rates count finished runs only.
  const finishedRework = wantRework.filter((r) => r.outcome !== 'error');
  const finishedAccept = refute.filter((r) => r.expect === 'ACCEPT' && r.outcome !== 'error');
  // An errored run's planted defects count as expected and not found.
  const defects = wantRework.flatMap((r) => (r.defects ?? []).map((d) => (r.outcome === 'error' ? { ...d, found: false } : d)));
  const passes = rs.filter((r) => r.outcome === 'pass').length;
  const tokens = sumTokens(rs);
  const cost = sumCost(rs);
  return {
    runs: rs.length,
    errors: rs.filter((r) => r.outcome === 'error').length,
    buildPass: rate(build.filter((r) => r.outcome === 'pass').length, build.length),
    verdictRight: rate(refute.filter((r) => r.outcome === 'pass').length, refute.length),
    falseAccept: rate(finishedRework.filter((r) => r.verdict === 'ACCEPT').length, finishedRework.length),
    falseRework: rate(finishedAccept.filter((r) => r.verdict === 'REWORK').length, finishedAccept.length),
    defects: defects.length ? `${defects.filter((d) => d.found).length}/${defects.length}` : 'n/a',
    tokens: tokensCell(rs, tokens),
    cost: costCell(rs, cost),
    tokensPerPass: passes ? tokensCell(rs, Math.round(tokens / passes)) : 'n/a',
    costPerPass: passes ? costCell(rs, cost / passes) : 'n/a',
  };
}

export function benchReport(results, skipped = []) {
  const variants = [...new Set(results.map((r) => r.variant))].sort((a, b) => (a === 'baseline' ? -1 : b === 'baseline' ? 1 : a.localeCompare(b)));
  const out = ['# Bench report', ''];
  out.push(`${results.length} run(s) in ${variants.length} variant(s). A rate over fewer than 5 runs shows its count (\`2/3\`); \`n/a\` means no run it applies to. Definitions: orchestration/bench.md, "Scoring rules".`, '');
  out.push('| Variant | Runs | Errors | Build pass | Verdict right | False ACCEPT | False REWORK | Defects found | Tokens | Cost (USD) | Tokens per pass | Cost per pass (USD) |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const v of variants) {
    const s = variantStats(results.filter((r) => r.variant === v));
    out.push(`| ${v} | ${s.runs} | ${s.errors} | ${s.buildPass} | ${s.verdictRight} | ${s.falseAccept} | ${s.falseRework} | ${s.defects} | ${s.tokens} | ${s.cost} | ${s.tokensPerPass} | ${s.costPerPass} |`);
  }
  out.push('', '## Per case', '', '| Case | Variant | Outcomes | Tokens | Cost (USD) |', '|---|---|---|---|---|');
  const cases = [...new Set(results.map((r) => r.case))].sort();
  for (const c of cases) {
    for (const v of variants) {
      const rs = results.filter((r) => r.case === c && r.variant === v);
      if (!rs.length) continue;
      const outcomes = ['pass', 'fail', 'error'].map((k) => [k, rs.filter((r) => r.outcome === k).length]).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ');
      out.push(`| ${c} | ${v} | ${outcomes} | ${tokensCell(rs, sumTokens(rs))} | ${costCell(rs, sumCost(rs))} |`);
    }
  }
  if (skipped.length) out.push('', '## Skipped files', '', ...skipped.map((s) => `- ${s}`));
  return `${out.join('\n')}\n`;
}
