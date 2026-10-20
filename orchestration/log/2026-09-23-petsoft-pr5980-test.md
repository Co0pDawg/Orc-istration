# PR 5980 test + review fixes (#17335 tax line) — 2026-09-23

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Rating |
|---|---|---|---|---|---|---|---|
| builder | opus | Live-app Playwright test of Review step, taxed + zero-tax, 4 screenshots | 159,868 | 75 | 12.6 | PASS + 1 cosmetic defect | earned — found the only taxed org with parent logins; tax cross-check caught per-night rounding |
| builder | opus | Fix 4 review findings (style, ids, unit tests, PW tax split) | 173,309 | 53 | 12.4 | DONE, mutation-checked | earned — found qa proc already honours taxable; no proc change |
| refuter | opus | Static review of fixes (no runs; builder's PW run in same worktree) | 98,964 | 11 | 1.5 | ACCEPT, 1 should-fix (gotcha note, applied inline) | earned — cleared the suite-wide taxable-Daycare risk by reading every amount assertion |
| builder (resumed) | opus | Full ParentReservations suite once | ~9,800 delta | 12 | ~13 | 11/13; 2 non-tax failures | earned — but DiffFacility failure was stale branch vs develop, which Fable found in 2 git calls |

## Totals
4 dispatches, ~442k subagent tokens. Fable inline: PR lookup, diff reads, pre-PR review (no agents, per user), ticket comments, commit/push, stale-locator diagnosis. Fable context at start / end: not captured.

## Loop signal
One builder pass, refuter ACCEPT, zero REWORK. Refuter ran static-only in parallel with the builder's suite run — worked, no vstest collision.

## Spec misses
- Data precondition was right to demand a DB query: Dogwood has no taxable services.
- Suite-run orders should have said: "before classifying a failure as unrelated, diff the failing page object against origin/develop". The builder could not prove the DiffFacility failure pre-existing; `git diff HEAD origin/develop -- <pageobject>` proved it instantly.
