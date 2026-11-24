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

// `briefText` is the decoded brief (tools/lib/text.mjs), read once by the caller.
export function dispatchPlan(adapter, role, models, briefText, env = process.env) {
  if (typeof adapter.headless !== 'function') return { error: `no headless recipe for ${adapter.id}` };
  const tiers = models[adapter.id] ?? {};
  const base = tiers[role.tier] ?? {};
  const tierModel = { model: tiers.headless?.[role.tier] ?? base.model, effort: role.effort ?? base.effort };
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

export function killTree(child, { platform = process.platform, runSync = spawnSync, killProcess = process.kill } = {}) {
  if (platform === 'win32') {
    let r;
    try {
      r = runSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: false });
    } catch {
      child.kill();
      return;
    }
    if (r?.error || r?.status !== 0) child.kill();
  } else {
    try {
      killProcess(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

// Streams the tool's output through; resolves to its exit code, or 124 after a timeout kill.
export function runDispatch(plan, { timeoutSec, err = console.error } = {}) {
  return new Promise((resolve) => {
    const cannot = (e) => {
      const hint = e.code === 'ENOENT' ? `: ${plan.exe.command} is not installed or not on PATH; set ${binEnv(plan.toolId)} to its full path` : `: ${e.message}`;
      err(`dispatch: cannot start ${plan.exe.command}${hint}`);
    };
    let child;
    try {
      child = spawn(plan.exe.command, plan.argv, {
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: [plan.stdin == null ? 'ignore' : 'pipe', 'inherit', 'inherit'],
      });
    } catch (e) {
      cannot(e);
      resolve(127);
      return;
    }
    let timedOut = false;
    let signalled = null;
    // Ctrl-C or a kill of orc must not leave a detached agent running: kill the tree, then exit 128+signal.
    const CODES = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129, SIGBREAK: 149 };
    const signals = process.platform === 'win32' ? ['SIGINT', 'SIGBREAK'] : ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const onSignal = (sig) => {
      if (signalled) return;
      signalled = sig;
      err(`dispatch: ${sig} received; killing the process tree`);
      killTree(child);
    };
    for (const s of signals) process.on(s, onSignal);
    const unhook = () => signals.forEach((s) => process.off(s, onSignal));
    const timer = timeoutSec
      ? setTimeout(() => {
          timedOut = true;
          err(`dispatch: timed out after ${timeoutSec}s; killing the process tree`);
          killTree(child);
        }, timeoutSec * 1000)
      : null;
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      unhook();
      cannot(e);
      resolve(127);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      unhook();
      resolve(signalled ? CODES[signalled] : timedOut ? 124 : (code ?? 1));
    });
    if (plan.stdin != null) {
      child.stdin.on('error', () => {});
      child.stdin.end(plan.stdin);
    }
  });
}
