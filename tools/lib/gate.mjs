// `orc gate`: rerun the brief's Must-verify test command in a builder's worktree, fresh, and say PASS or FAIL in one
// line. PASS needs exit 0 and a tree the run left as it found it, by both hashes of the builder role's mutation recipe.
// The command's stdout and stderr share one log file outside the work tree, so they interleave and the log itself
// cannot move the hashes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { killTree } from './dispatch.mjs';

const MAX_BUFFER = 1024 * 1024 * 1024;

// Raw bytes in and out (no decoding), so a --binary diff and CRLF text hash as the bash recipe hashes them.
function git(top, args, input) {
  const r = spawnSync('git', args, { cwd: top, shell: false, windowsHide: true, maxBuffer: MAX_BUFFER, ...(input === undefined ? {} : { input }) });
  if (r.error) throw new Error(`cannot run git ${args[0]} (${r.error.message})`);
  return r;
}

function hashObject(top, bytes) {
  const r = git(top, ['hash-object', '--stdin'], bytes);
  if (r.status !== 0) throw new Error(`git hash-object --stdin failed: ${r.stderr.toString('utf8').trim()}`);
  return r.stdout.toString('utf8').trim();
}

// The work tree's top folder, or null when `dir` is not inside one.
export function gitTop(dir) {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', shell: false, windowsHide: true });
  const top = r.error || r.status !== 0 ? '' : r.stdout.trim();
  return top ? path.resolve(top) : null;
}

// core/roles/builder.md, mutation bullet, run from `top`:
//   status: git status --porcelain | git hash-object --stdin
//   change: { git diff HEAD --binary; git ls-files -z -o --exclude-standard | xargs -0 -r git hash-object --; } | git hash-object --stdin
// `git diff HEAD` fails on an unborn HEAD and prints nothing, as it does in the pipe.
export function treeHashes(top) {
  const status = git(top, ['status', '--porcelain']);
  if (status.status !== 0) throw new Error(`git status failed: ${status.stderr.toString('utf8').trim()}`);
  const diff = git(top, ['diff', 'HEAD', '--binary']).stdout;
  const listed = git(top, ['ls-files', '-z', '-o', '--exclude-standard']);
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr.toString('utf8').trim()}`);
  const files = listed.stdout.toString('utf8').split('\0').filter(Boolean);
  const parts = [diff];
  // Batches keep each command line short, as xargs does; the output is the same one line per file, in order.
  for (let i = 0; i < files.length;) {
    const batch = [];
    for (let len = 0; i < files.length && (batch.length === 0 || len + files[i].length < 8000); i++) {
      batch.push(files[i]);
      len += files[i].length + 1;
    }
    parts.push(git(top, ['hash-object', '--', ...batch]).stdout);
  }
  return { status: hashObject(top, status.stdout), change: hashObject(top, Buffer.concat(parts)) };
}

const utcStamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

// The deepest existing folder of `p`, resolved to its real path, with the rest appended (short names and links
// resolved), lower-cased on Windows, for the inside-the-tree check.
function realish(p) {
  let head = path.resolve(p);
  const rest = [];
  while (!fs.existsSync(head) && path.dirname(head) !== head) {
    rest.unshift(path.basename(head));
    head = path.dirname(head);
  }
  let real = head;
  try {
    real = fs.realpathSync.native(head);
  } catch {
    real = head;
  }
  const full = path.join(real, ...rest);
  return process.platform === 'win32' ? full.toLowerCase() : full;
}

function inside(top, p) {
  const rel = path.relative(realish(top), realish(p));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

// The last `n` lines of the log (from its last 64 KB).
function logTail(file, n = 20) {
  const size = fs.statSync(file).size;
  const len = Math.min(size, 64 * 1024);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buf, 0, len, size - len);
  } finally {
    fs.closeSync(fd);
  }
  const lines = buf.toString('utf8').split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines.slice(-n).join('\n');
}

const CODES = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129, SIGBREAK: 149 };

// Resolves to {code, timedOut, cannot?}: 124 after a timeout kill, 128+signal after Ctrl-C or a kill of orc, 127 when
// the command cannot start. Both of its output streams go to `fd`.
function runLogged(command, args, { cwd, fd, timeoutSec, verbatim, err }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: verbatim,
        detached: process.platform !== 'win32',
        stdio: ['ignore', fd, fd],
      });
    } catch (e) {
      resolve({ code: 127, cannot: e });
      return;
    }
    let timedOut = false;
    let signalled = null;
    let settled = false;
    const signals = process.platform === 'win32' ? ['SIGINT', 'SIGBREAK'] : ['SIGINT', 'SIGTERM', 'SIGHUP'];
    // A detached command would outlive orc: Ctrl-C or a kill of orc kills its tree first.
    const onSignal = (sig) => {
      if (signalled) return;
      signalled = sig;
      err(`gate: ${sig} received; killing the process tree`);
      killTree(child, { err });
    };
    for (const s of signals) process.on(s, onSignal);
    const timer = timeoutSec
      ? setTimeout(() => {
          timedOut = true;
          err(`gate: timed out after ${timeoutSec}s; killing the process tree`);
          killTree(child, { err });
        }, timeoutSec * 1000)
      : null;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signals.forEach((s) => process.off(s, onSignal));
      resolve(r);
    };
    child.on('error', (e) => {
      if (timedOut || signalled) {
        err(`gate: kill failed: ${e.message}`);
        finish({ code: signalled ? CODES[signalled] : 124, timedOut });
      } else finish({ code: 127, cannot: e });
    });
    child.on('close', (code) => finish({ code: signalled ? CODES[signalled] : timedOut ? 124 : (code ?? 1), timedOut }));
  });
}

// One gate run. `argv` (no shell) or `shellLine` (the platform shell); `iso` formats the finish time.
// Resolves to {code, line?, err?}: `line` is the one stdout line; `err` goes to stderr (the log's last 20 lines on a
// FAIL). A usage problem found here (a log inside the work tree) is code 2 with no line.
export async function runGate({ argv = null, shellLine = null, dir, out, timeoutSec = 0, iso, err = () => {}, platform = process.platform, env = process.env }) {
  const top = gitTop(dir);
  if (!top) return { code: 1, err: `gate: ${dir} is not in a git work tree` };
  const log = path.resolve(out ?? path.join(os.tmpdir(), 'orc-gate', `${utcStamp()}-${process.pid}.log`));
  if (inside(top, log)) return { code: 2, err: `gate: the log ${log} is inside the work tree ${top}, where it would change the hashes; pass --out outside it` };
  let command;
  let args;
  let verbatim = false;
  if (shellLine !== null) {
    if (platform === 'win32') {
      command = env.ComSpec || 'cmd.exe';
      args = ['/d', '/s', '/c', `"${shellLine}"`];
      verbatim = true;
    } else {
      command = '/bin/sh';
      args = ['-c', shellLine];
    }
  } else [command, ...args] = argv;
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const before = treeHashes(top);
  const fd = fs.openSync(log, 'w');
  const started = Date.now();
  let r;
  try {
    r = await runLogged(command, args, { cwd: dir, fd, timeoutSec, verbatim, err });
  } finally {
    fs.closeSync(fd);
  }
  const finished = new Date();
  const after = treeHashes(top);
  const at = iso(finished);
  const secs = ((finished.getTime() - started) / 1000).toFixed(1);
  const h = (s) => s.slice(0, 12);
  const notes = [];
  if (r.cannot) {
    const e = r.cannot instanceof Error ? r.cannot : new Error(String(r.cannot));
    const code = 'code' in e ? e.code : undefined;
    const hint = 'the -- form runs without a shell: name an executable, or use --shell for a .cmd shim such as npm on Windows, a shell built-in or a pipe';
    const why = shellLine === null && code === 'ENOENT' ? `not found (${hint})`
      : shellLine === null && code === 'EINVAL' && /\.(cmd|bat)$/i.test(command) ? `${e.message} (${hint})`
      : e.message;
    notes.push(`gate: cannot start ${command}: ${why}`);
  }
  let line;
  let code;
  if (r.code === 0 && before.status === after.status && before.change === after.change) {
    return { code: 0, line: `GATE PASS exit 0 in ${secs}s at ${at} tree ${h(after.change)} log ${log}` };
  }
  if (r.code === 0) {
    line = `GATE FAIL tree changed during the run (status ${h(before.status)}→${h(after.status)}, change ${h(before.change)}→${h(after.change)}) at ${at} log ${log}`;
    code = 1;
  } else {
    line = `GATE FAIL exit ${r.code} in ${secs}s at ${at} tree ${h(after.change)} log ${log}`;
    code = r.code;
  }
  const tail = logTail(log);
  if (tail) notes.push(tail);
  return { code, line, ...(notes.length ? { err: notes.join('\n') } : {}) };
}
