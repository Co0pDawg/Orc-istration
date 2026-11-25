// Headless dispatch: one role on one tool at the role's tier. The brief goes to the tool as one argv element or on
// stdin, never through a shell. ORC_TOOL_BIN_<TOOL> (e.g. ORC_TOOL_BIN_CLAUDE_CODE), then `binaries` in
// ~/.orc/config.json, override the executable; a .js/.mjs override runs under this Node, which is how the tests
// inject a stub.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export const binEnv = (toolId) => `ORC_TOOL_BIN_${toolId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

// Finds a real executable: ORC_TOOL_BIN_<TOOL>, then `binaries[toolId]` from config.json, then PATH. `source` says
// which. A Windows .cmd/.bat shim cannot be started without a shell, so it is not accepted (in `binaries` either). An
// override that names a path which does not exist, or a .cmd/.bat shim, carries `unusable` (routing skips it; an
// explicit --tool still tries, and a shim's failure names the shim).
export function resolveExecutable(name, toolId, env = process.env, { binaries = null, configFile = null } = {}) {
  const override = env[binEnv(toolId)];
  if (override) {
    const isShim = /\.(cmd|bat)$/i.test(override);
    const unusable = isShim ? `${binEnv(toolId)} names ${override}, a .cmd/.bat shim, which cannot be started without a shell`
      : /[\\/]/.test(override) && !fs.existsSync(override) ? `${binEnv(toolId)} names ${override}, which does not exist` : undefined;
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

// `briefText` is the decoded brief (tools/lib/text.mjs), read once by the caller. `model` (--model) replaces the
// tier's model; `binaries` and `configFile` come from config.json.
export function dispatchPlan(adapter, role, models, briefText, env = process.env, { binaries = null, configFile = null, model = undefined } = {}) {
  if (typeof adapter.headless !== 'function') return { error: `no headless recipe for ${adapter.id}` };
  const tiers = models[adapter.id] ?? {};
  const base = tiers[role.tier] ?? {};
  const tierModel = { model: model ?? tiers.headless?.[role.tier] ?? base.model, effort: role.effort ?? base.effort };
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
  return lines.join('\n');
}

export function killTree(child) {
  if (process.platform === 'win32') {
    const r = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: false });
    if (r.error || r.status !== 0) {
      try {
        child.kill('SIGKILL');
      } catch {}
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

// Streams the tool's output through; resolves to its exit code, or 124 after a timeout kill.
export function runDispatch(plan, { timeoutSec, err = console.error } = {}) {
  return new Promise((resolve) => {
    const cannot = (e) => {
      const hint = plan.exe.shim && plan.exe.source === 'env' ? `: ${plan.exe.shim} is a .cmd/.bat shim, which cannot be started without a shell; set ${binEnv(plan.toolId)} to the real executable`
        : e.code === 'ENOENT' ? `: ${plan.exe.command} is not installed or not on PATH; set ${binEnv(plan.toolId)} to its full path` : `: ${e.message}`;
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
