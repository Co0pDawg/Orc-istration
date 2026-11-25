// Headless dispatch: one role on one tool at the role's tier. The brief goes to the tool as one argv element or on
// stdin, never through a shell. ORC_TOOL_BIN_<TOOL> (e.g. ORC_TOOL_BIN_CLAUDE_CODE), then `binaries` in
// ~/.orc/config.json, override the executable; a .js/.mjs override runs under this Node, which is how the tests
// inject a stub.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export const binEnv = (toolId) => `ORC_TOOL_BIN_${toolId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

const isRegularFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

// Finds a real executable: ORC_TOOL_BIN_<TOOL>, then `binaries[toolId]` from config.json, then PATH. `source` says
// which. A Windows .cmd/.bat shim cannot be started without a shell, so it is not accepted (in `binaries` either). An
// ORC_TOOL_BIN_* that names a path which does not exist or is not a regular file, or a .cmd/.bat shim, carries
// `unusable` (routing skips it; an explicit --tool still tries, and the failure names the override). A `binaries` entry
// that does not exist, is not a file or is a shim is `missing` with a `reason` instead, so neither routing nor --tool
// starts it.
export function resolveExecutable(name, toolId, env = process.env, { binaries = null, configFile = null } = {}) {
  const override = env[binEnv(toolId)];
  if (override) {
    const isShim = /\.(cmd|bat)$/i.test(override);
    const hasSep = /[\\/]/.test(override);
    const unusable = isShim ? `${binEnv(toolId)} names ${override}, a .cmd/.bat shim, which cannot be started without a shell`
      : hasSep && !fs.existsSync(override) ? `${binEnv(toolId)} names ${override}, which does not exist`
      : hasSep && !isRegularFile(override) ? `${binEnv(toolId)} names ${override}, which is not a regular file` : undefined;
    const extra = { source: 'env', ...(unusable ? { unusable } : {}), ...(isShim ? { shim: override } : {}) };
    if (/\.(c|m)?js$/i.test(override)) return { command: process.execPath, pre: [override], ...extra };
    return { command: override, pre: [], ...extra };
  }
  const configured = binaries?.[toolId];
  if (configured) {
    const where = `binaries.${toolId} in ${configFile}`;
    if (!fs.existsSync(configured) || !fs.statSync(configured).isFile()) return { command: configured, pre: [], source: 'config', missing: true, reason: `${configured} (${where}) does not exist` };
    if (/\.(cmd|bat)$/i.test(configured)) return { command: configured, pre: [], source: 'config', missing: true, shim: configured, reason: `${configured} (${where}) is a .cmd/.bat shim, which cannot be started without a shell` };
    if (/\.(c|m)?js$/i.test(configured)) return { command: process.execPath, pre: [configured], source: 'config' };
    return { command: configured, pre: [], source: 'config' };
  }
  const win = process.platform === 'win32';
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  if (win && toolId === 'antigravity' && env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'agy', 'bin'));
  let shim = null;
  for (const d of dirs) {
    const exe = path.join(d, win ? `${name}.exe` : name);
    if (fs.existsSync(exe) && fs.statSync(exe).isFile()) return { command: exe, pre: [], source: 'PATH' };
    if (win && !shim && ['.cmd', '.bat'].some((x) => fs.existsSync(path.join(d, name + x)))) shim = path.join(d, name);
  }
  return { command: name, pre: [], source: 'PATH', missing: true, shim };
}

// Why a planned tool cannot run, or null: no headless recipe, no model for the role's tier, or no executable.
export function unavailable(plan) {
  if (plan.error) return plan.error;
  const exe = plan.exe;
  if (exe.missing) return exe.reason ?? (exe.shim ? `only a .cmd/.bat shim at ${exe.shim}` : `${plan.command} not found on PATH`);
  return exe.unusable ?? null;
}

// The model and effort for one tool and tier: the tier's headless slug first, then its model; the role's effort
// first, then the tier's. Shared by dispatch and the queue.
export function tierSettings(models, toolId, tier, roleEffort) {
  const tiers = models[toolId] ?? {};
  const base = tiers[tier] ?? {};
  return { model: tiers.headless?.[tier] ?? base.model, effort: roleEffort ?? base.effort };
}

// `briefText` is the decoded brief (tools/lib/text.mjs), read once by the caller. `model` (--model) replaces the
// tier's model; `binaries` and `configFile` come from config.json.
export function dispatchPlan(adapter, role, models, briefText, env = process.env, { binaries = null, configFile = null, model = undefined } = {}) {
  if (typeof adapter.headless !== 'function') return { error: `no headless recipe for ${adapter.id}` };
  const tierModel = tierSettings(models, adapter.id, role.tier, role.effort);
  if (model) tierModel.model = model;
  if (!tierModel.model) return { error: `no ${role.tier} model for ${adapter.id} in the models files (models.json, ~/.orc/models.json, models.local.json)` };
  const spec = adapter.headless(role, tierModel, briefText);
  const exe = resolveExecutable(spec.command, adapter.id, env, { binaries, configFile });
  // What stdin carries, for the dry-run line: the brief alone (Claude Code) or the role body before it (Codex).
  const stdinHolds = spec.stdin == null ? null
    : spec.stdin === briefText ? 'the brief'
    : spec.stdin.startsWith(role.body) && spec.stdin.endsWith(briefText) ? 'the role body, then the brief'
    : 'not the brief alone';
  return { ...spec, toolId: adapter.id, exe, argv: [...exe.pre, ...spec.args], stdinHolds };
}

// An argv recipe cannot carry a NUL byte, and Windows caps the whole command line near 32,767 characters.
export const ARGV_LIMIT = 32000;
export function argvProblem(plan) {
  if (plan.stdin != null) return null;
  if (plan.argv.some((a) => a.includes('\0'))) return 'the brief contains a NUL byte; this tool takes the brief as a command-line argument, which cannot carry one';
  const bytes = plan.argv.reduce((n, a) => n + Buffer.byteLength(a) + 1, Buffer.byteLength(plan.exe.command));
  if (bytes > ARGV_LIMIT) return `brief is ${bytes} bytes; this tool takes the brief as a command-line argument, limit about 32,000 on Windows`;
  return null;
}

const quote = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : JSON.stringify(a));
export function formatCommand(plan) {
  const lines = [`command: ${quote(plan.exe.command)} ${plan.argv.map(quote).join(' ')}`];
  lines.push(`stdin: ${plan.stdin === null || plan.stdin === undefined ? 'none' : `${Buffer.byteLength(plan.stdin)} bytes (${plan.stdinHolds})`}`);
  if (plan.exe.reason) lines.push(`note: ${plan.exe.reason}`);
  else if (plan.exe.missing) lines.push(`note: ${plan.command} not found on PATH${plan.exe.shim ? ` (only a .cmd/.bat shim at ${plan.exe.shim}; set ${binEnv(plan.toolId)} to the real executable)` : ''}`);
  else if (plan.exe.unusable) lines.push(`note: ${plan.exe.unusable}`);
  return lines.join('\n');
}

// taskkill exit status 128 means the process was already gone.
export function killTree(child, { platform = process.platform, runSync = spawnSync, killProcess = process.kill, err = () => {} } = {}) {
  if (platform === 'win32') {
    let ok = false;
    let why;
    try {
      const r = runSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: false });
      if (r?.error) why = r.error.code ?? r.error.message;
      else if (r?.status === 0 || r?.status === 128) ok = true;
      else why = `exit status ${r?.status}`;
    } catch (e) {
      why = e.code ?? e.message;
    }
    if (ok) return;
    child.kill();
    err(`dispatch: taskkill failed (${why}); killed only pid ${child.pid}, its child processes may still be running`);
  } else {
    try {
      killProcess(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

// Streams the tool's output through; resolves to its exit code, or 124 after a timeout kill.
export async function runDispatch(plan, { timeoutSec, err = console.error } = {}) {
  return (await runTool(plan, { timeoutSec, err })).code;
}

// The spawn, timeout, kill-tree and signal handling behind runDispatch. With `capture`, stdout is collected and
// returned instead of streamed, and `captureStderr` does the same for stderr; `cwd` sets the working folder; `env`
// replaces the environment; `label` prefixes the messages. Resolves to {code, stdout, stderr, timedOut, signalled}:
// code is the exit code, 124 after a timeout kill, 128+signal after Ctrl-C or a kill of orc, 127 when the tool cannot
// start.
export function runTool(plan, { timeoutSec, err = console.error, capture = false, captureStderr = false, cwd, env, label = 'dispatch' } = {}) {
  return new Promise((resolve) => {
    const chunks = [];
    const errChunks = [];
    const cannot = (e) => {
      const hint = plan.exe.shim && plan.exe.source === 'env' ? `: ${plan.exe.shim} is a .cmd/.bat shim, which cannot be started without a shell; set ${binEnv(plan.toolId)} to the real executable`
        : plan.exe.unusable ? `: ${plan.exe.unusable}; point it at the real executable`
        : e.code === 'ENOENT' ? `: ${plan.exe.command} is not installed or not on PATH; set ${binEnv(plan.toolId)} to its full path` : `: ${e.message}`;
      err(`${label}: cannot start ${plan.exe.command}${hint}`);
    };
    const done = (code, extra = {}) => resolve({ code, stdout: Buffer.concat(chunks).toString('utf8'), stderr: Buffer.concat(errChunks).toString('utf8'), timedOut: false, signalled: null, ...extra });
    let child;
    try {
      child = spawn(plan.exe.command, plan.argv, {
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        ...(cwd ? { cwd } : {}),
        ...(env ? { env } : {}),
        stdio: [plan.stdin == null ? 'ignore' : 'pipe', capture ? 'pipe' : 'inherit', captureStderr ? 'pipe' : 'inherit'],
      });
    } catch (e) {
      cannot(e);
      done(127);
      return;
    }
    if (capture) child.stdout.on('data', (c) => chunks.push(c));
    if (captureStderr) child.stderr.on('data', (c) => errChunks.push(c));
    let timedOut = false;
    let signalled = null;
    // Ctrl-C or a kill of orc must not leave a detached agent running: kill the tree, then resolve with 128+signal
    // (dispatch exits with that code; bench and queue record the stop and exit 1).
    const CODES = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129, SIGBREAK: 149 };
    const signals = process.platform === 'win32' ? ['SIGINT', 'SIGBREAK'] : ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const onSignal = (sig) => {
      if (signalled) return;
      signalled = sig;
      err(`${label}: ${sig} received; killing the process tree`);
      killTree(child, { err });
    };
    for (const s of signals) process.on(s, onSignal);
    const unhook = () => signals.forEach((s) => process.off(s, onSignal));
    const timer = timeoutSec
      ? setTimeout(() => {
          timedOut = true;
          err(`${label}: timed out after ${timeoutSec}s; killing the process tree`);
          killTree(child, { err });
        }, timeoutSec * 1000)
      : null;
    child.on('error', (e) => {
      // After a timeout or signal kill began, an error is a failed kill, not a failed start. The process may have
      // survived, in which case `close` never comes, so resolve now with the timeout or signal code.
      if (timedOut || signalled) {
        err(`${label}: kill failed: ${e.message}`);
        if (timer) clearTimeout(timer);
        unhook();
        done(signalled ? CODES[signalled] : 124, { timedOut, signalled });
        return;
      }
      if (timer) clearTimeout(timer);
      unhook();
      cannot(e);
      done(127);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      unhook();
      done(signalled ? CODES[signalled] : timedOut ? 124 : (code ?? 1), { timedOut, signalled });
    });
    if (plan.stdin != null) {
      child.stdin.on('error', () => {});
      child.stdin.end(plan.stdin);
    }
  });
}
