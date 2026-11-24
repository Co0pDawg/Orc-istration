# Builder brief: retry backoff

1. **Goal**, in one sentence.
   Add capped exponential backoff, with an injected `sleep`, and a non-retryable escape to `retry` in `src/retry.js`.
2. **Scope**: exact files or URLs.
   `src/retry.js`, `test/retry.test.mjs` (paths relative to the current folder, a git repo on branch `base`).
3. **May change / must not change.**
   May change: those two files. Must not change: `package.json`; no new files, no dependencies.
   New options of `retry(fn, options)`, all optional: `baseMs` (default 100), `maxMs` (default 2000), `sleep(ms)` returning a promise (default a real `setTimeout` wait), `isRetryable(error)` (default: every error is retryable). After failed attempt `n` (counting from 0), when another attempt remains, wait `Math.min(maxMs, baseMs * 2 ** n)` through `sleep` before the next one; never wait after the last attempt. An error `isRetryable` returns false for is rethrown at once, with no wait and no further attempt. `attempts` (default 3), the attempt index passed to `fn`, the returned value and rethrowing the last error stay as they are.
4. **Must verify**: exact commands.
   `node --test` (all tests pass, the existing ones and the ones you add).
5. **Do not**: known traps.
   Do not commit. No test may wait in real time: pass a recording `sleep`. Do not wait after the final attempt.
6. **Output format and cap** (default 40 lines).
   At most 20 lines: files changed, the test command and its result.
7. **Known**: facts already established.
   Node 22, ES modules, `node:test` with `assert/strict`. The existing tests already pass a no-op `sleep`, which the current code ignores.
8. **Scratch path**: `<session scratchpad>/<agent>-<topic>.md` for overflow; the report is the path plus a short summary.
   none: the report fits the cap; return it inline.
9. **Intent** (refuters; builders and debuggers write `n/a`): the ticket brief path or the acceptance criteria verbatim, or `none: <why>`.
   n/a
10. **Data precondition** (builders/refuters): the real rows or paths the feature depends on; query them, don't exercise one seeded row. The loop verifies the spec; this line makes the spec verify the requirement.
   Test the delay sequence with enough attempts to reach the cap, the number of calls, and the non-retryable path.
11. **Board** (builders/refuters): `BOARD: <board address> card cards/<card id> stage <label>`, so the agent posts its milestones and moves its own stage. Give the full `cards/<id>` path, or the agent may look the card up wrong and skip every board write.
   BOARD: none
