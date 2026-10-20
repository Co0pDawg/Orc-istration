# 2026-09-29 — Petsoft — 17471 service add-on toggle

- Date: 2026-09-29
- Project: Petsoft
- Branch: feature/17471-addon-day-picker (worktree, PR 6056), uncommitted
- Task: #17471 follow-up — Parent Portal service add-ons drop the quantity stepper (Add/Added toggle + day chips, 1 per day); products keep the stepper; office unchanged
- Outcome: shipped to working tree (uncommitted). Build green, 54/54 targeted unit, Playwright 15102/15105/15106/15295 + 15132 green on DB copy Petsoft_17471, mutation-checked; 375px light/dark screenshots reviewed. 15231/32 red twice (TargetClosedException, judged environmental).

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | builder | opus | Implement toggle in AddonsReservation/AddonsPets, UITests, docs; Playwright on DB copy | 241k | 125 | 45 | DONE | earned — full change + mutation check; needed one nudge to retake mid-transition screenshots |
| 2 | refuter | opus | Static review + build + targeted unit rerun | 118k | 12 | 4 | ACCEPT, 2 should-fix | earned — caught a vacuous `ToContainText("Add")` assertion |
| 3 | fable | — | Two should-fixes inline, UITests build | — | 2 | 1 | done | earned |

**Totals** — ~359k subagent tokens, ~50 min wall clock. Fable context: unmeasured at start → unmeasured (no /context read this session; format miss).

**Loop signal** — 0 REWORK rounds. Refuter: 0 must-fix, 2 should-fix (both confirmed, fixed inline). Builder found no spec defects; confirmed ValidateDates already skips qty 0 (spec's hedge was unnecessary).

**Spec misses**
- Screenshot step didn't say "wait for settle / transitions off / mouse off cards" — first captures looked like a dark-mode bug and cost a SendMessage round.
- Didn't name which local ports were taken (:7399, :7499 by other sessions); builder briefly pointed a run at another session's app. Next spec: "pick a free port, check with netstat first".
- Design-time: TC 15132 (product qty 2) surfaced only when grepping UITests — check manual-case/UITests dependencies before presenting a UI-removal design.

## Continuation 2026-09-30 — one invoice line per add-on (folded into PR 6056)

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 4 | builder | opus | InvoiceFactory: merge non-consecutive same-service lines, consumer audit, tests, Playwright on DB copy | 206k | 92 | 23 | DONE | earned — audit proved grouping is display-only, which corrected Fable's "affects every saved invoice" framing |
| 5 | refuter | opus | Independent display-only proof + sums + tests | 122k | 25 | 5 | ACCEPT, 2 should-fix | earned — confirmed no persist path; stale comment + missing test summaries fixed inline |

**Totals (continuation)** — ~328k subagent tokens, ~28 min. Fable context: unmeasured.

**Spec misses**
- Fable told Cooper the change would alter every saved invoice / QuickBooks before checking callers; one grep (`GroupInvoiceLinesForReservation` callers) would have shown it is display-only. Check callers before sizing blast radius in a design.
- Builder left a compressed backup (`Petsoft_17471b.bak` in the SQL Server Backup folder) it could not delete; next DB-copy spec should say "back up to the scratchpad or delete the .bak".
| 6 | builder | opus | Browser-verify Review qty line, two-column mobile invoice, one-line stepper; PR screenshots | 194k | 96 | 24 | DONE, 2 CSS fixes | earned — caught the 40px promo input and mismatched row borders Fable's CSS introduced |

Continuation note: Fable wrote the qty/stepper/table CSS inline without a browser; the builder found 2 visual defects in it. Inline UI CSS still needs a browser pass before commit.
