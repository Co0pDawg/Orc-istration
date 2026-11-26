// `orc poll`: run a command (argv, no shell) every interval until its stdout matches a regex, once the bash
// `until ...; do sleep 300; done` loop in workflows/fix-ci.md. A run that exits non-zero is retried (CI helpers fail
// transiently); a command that cannot start ends the poll at once.
import { spawnSync } from 'node:child_process';

// One run: {code, stdout, stderr} or {cannotStart: message}. `limitMs` kills a run that would outlast the deadline.
export function runOnce(argv, limitMs) {
  const r = spawnSync(argv[0], argv.slice(1), {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    ...(limitMs ? { timeout: Math.max(1, limitMs) } : {}),
  });
  if (r.error && r.error.code !== 'ETIMEDOUT') return { cannotStart: r.error.code === 'ENOENT' ? `${argv[0]} not found (it runs without a shell: name an executable, not a .cmd shim or shell built-in)` : r.error.message };
  return { code: r.error ? null : r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', timedOut: Boolean(r.error) };
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Resolves to {code, out?, err?}: 0 with the matching stdout, 124 at the deadline with the last result, 1 when the
// command cannot start. A run that exits non-zero has its stderr passed to `log` while the poll goes on, once per
// distinct text, so a helper that fails every run is not silent. `run`, `sleep` and `now` are injectable so tests
// need no real waiting.
export async function pollUntil({ argv, everyMs, until, timeoutMs, run = runOnce, sleep = sleepMs, now = Date.now, log = () => {} }) {
  const deadline = timeoutMs ? now() + timeoutMs : null;
  let last = null;
  let logged = null;
  // Runs start strictly before the deadline, and a run still going at the deadline is killed.
  for (;;) {
    const left = deadline ? deadline - now() : undefined;
    if (last && deadline && left <= 0) break;
    const r = await run(argv, left);
    if (r.cannotStart) return { code: 1, err: `poll: cannot start ${argv[0]}: ${r.cannotStart}` };
    last = r;
    const out = r.stdout.trim();
    if (r.code === 0 && until.test(out)) return { code: 0, out };
    const stderr = r.stderr.trim();
    if (r.code !== 0 && !r.timedOut && stderr && stderr !== logged) {
      logged = stderr;
      log(`poll: a run exited ${r.code}; its stderr: ${stderr}`);
    }
    const wait = deadline ? Math.min(everyMs, deadline - now()) : everyMs;
    if (wait > 0) await sleep(wait);
  }
  const how = last.timedOut ? 'the last run was killed at the deadline' : last.code === 0 ? 'the last run exited 0 without a match' : `the last run exited ${last.code}`;
  const err = [`poll: timed out after ${Math.round(timeoutMs / 1000)}s; ${how}; last output:`, last.stdout.trim() || '(no stdout)'];
  if (last.code !== 0 && last.stderr.trim()) err.push(`last stderr: ${last.stderr.trim()}`);
  return { code: 124, err: err.join('\n') };
}
