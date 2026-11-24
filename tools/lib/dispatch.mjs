// Headless dispatch: one role on one tool at the role's tier. The brief goes to the tool as one argv element or on
// stdin, never through a shell. ORC_TOOL_BIN_<TOOL> (e.g. ORC_TOOL_BIN_CLAUDE_CODE) overrides the executable; a
// .js/.mjs override runs under this Node, which is how the tests inject a stub.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export const binEnv = (toolId) => `ORC_TOOL_BIN_${toolId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

// Finds a real executable; a Windows .cmd/.bat shim cannot be started without a shell, so it is not accepted.
export function resolveExecutable(name, toolId, env = process.env) {
  const override = env[binEnv(toolId)];
  if (override) {
    if (/\.(c|m)?js$/i.test(override)) return { command: process.execPath, pre: [override] };
    return { command: override, pre: [] };
  }
  const win = process.platform === 'win32';
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  if (win && toolId === 'antigravity' && env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'agy', 'bin'));
  let shim = null;
  for (const d of dirs) {
    const exe = path.join(d, win ? `${name}.exe` : name);
    if (fs.existsSync(exe) && fs.statSync(exe).isFile()) return { command: exe, pre: [] };
    if (win && !shim && ['.cmd', '.bat'].some((x) => fs.existsSync(path.join(d, name + x)))) shim = path.join(d, name);
  }
  return { command: name, pre: [], missing: true, shim };
}

// The model and effort for one tool and tier: the tier's headless slug first, then its model; the role's effort
// first, then the tier's. Shared by dispatch and the queue.
export function tierSettings(models, toolId, tier, roleEffort) {
  const tiers = models[toolId] ?? {};
  const base = tiers[tier] ?? {};
  return { model: tiers.headless?.[tier] ?? base.model, effort: roleEffort ?? base.effort };
}

// `briefText` is the decoded brief (tools/lib/text.mjs), read once by the caller.
export function dispatchPlan(adapter, role, models, briefText, env = process.env) {
  if (typeof adapter.headless !== 'function') return { error: `no headless recipe for ${adapter.id}` };
  const tierModel = tierSettings(models, adapter.id, role.tier, role.effort);
  if (!tierModel.model) return { error: `no ${role.tier} model for ${adapter.id} in models.json` };
  const spec = adapter.headless(role, tierModel, briefText);
  const exe = resolveExecutable(spec.command, adapter.id, env);
  return { ...spec, toolId: adapter.id, exe, argv: [...exe.pre, ...spec.args] };
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
  lines.push(`stdin: ${plan.stdin === null || plan.stdin === undefined ? 'none' : `${Buffer.byteLength(plan.stdin)} bytes (the brief)`}`);
  if (plan.exe.missing) lines.push(`note: ${plan.command} not found on PATH${plan.exe.shim ? ` (only a .cmd/.bat shim at ${plan.exe.shim}; set ${binEnv(plan.toolId)} to the real executable)` : ''}`);
  return lines.join('\n');
}

function killTree(child) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: false });
  else {
    try {
      process.kill(-child.pid, 'SIGKILL');
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
      const hint = e.code === 'ENOENT' ? `: ${plan.exe.command} is not installed or not on PATH; set ${binEnv(plan.toolId)} to its full path` : `: ${e.message}`;
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
      killTree(child);
    };
    for (const s of signals) process.on(s, onSignal);
    const unhook = () => signals.forEach((s) => process.off(s, onSignal));
    const timer = timeoutSec
      ? setTimeout(() => {
          timedOut = true;
          err(`${label}: timed out after ${timeoutSec}s; killing the process tree`);
          killTree(child);
        }, timeoutSec * 1000)
      : null;
    child.on('error', (e) => {
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
