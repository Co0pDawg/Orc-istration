# 17471 add-on day picker

- Date: 2026-09-28 to 2026-09-29 (paused overnight)
- Project: Petsoft
- Branch: feature/17471-addon-day-picker (worktree, uncommitted)
- Task: Bug 17471. Multi-date parent daycare billed Arrival/Departure add-ons once per date. Fixed by a day picker in both portals.
- Outcome: partial. Built and verified end to end. The build is green. The full Core and KMS run was green before Fable's final review fixes, and the targeted runs were green after them (72/72). Playwright: 7 ParentBookingVariantTests and the new boarding test pass. Screenshots reviewed. Not yet done: /pre-pr-review, PR, and saving manual case 15105 (drafted).

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | researcher | sonnet | map add-on model, dating, and both portals' save paths | 96,938 | 26 | 1.9 | 7 cited answers | earned: it found the one-row-per-date ReservationDetail and the per-date parent save (the root cause), which set the design |
| 2 | builder | opus | Tasks 1-2: Dates, ResolveDates, CreateReservationDetails | 167,533 | 63 | 36.3 | DONE, 33/33 | earned |
| 3 | refuter | opus | review Tasks 1-2 | 150,284 | 31 | 9.7 | ACCEPT + 4 should-fix | earned: the midnight-timeslot regression and the over-post of bookingDates were real |
| 4 | builder | opus | Tasks 3, 4, 6: parent and office pickers, validation, docs | 256,305 | 80 | 22.7 | DONE, 38/38 | earned: caught that the parent boarding cache holds only [in, out] |
| 5 | refuter | opus | review Tasks 3, 4, 6 | 154,290 | 35 | 7.0 | REWORK, 1 must-fix | earned: an unscoped item load leaked item names across orgs. It also showed Fable's [BindNever] fix was a no-op on a [FromBody] path |
| 6 | builder | opus | Task 5: Playwright plus screenshots | 275,226 | 113 | 30.3 | DONE, tests green, mutation red | earned |
| 7 | fable | opus | inline review fixes (x2), full run, ticket upkeep, DB check on null ORGANIZATION_ID | n/a | ~25 | — | the must-fix widened to org OR facility link | earned: the refuter's one-line org filter would have silently skipped validation for 37 active legacy add-ons |

**Totals:** about 1.10M subagent tokens across 6 dispatches, about 108 min of agent wall clock. Fable context: unmeasured. The status line is not visible to Fable, and the session spans a pause and resume, so the rule was missed again.

**Loop signal:**
- Builders found 2 spec defects: the null execution type conflicted with "mirror the ternary", and parent boarding ReservationDates holds only 2 dates.
- Refuters: 1 must-fix, confirmed and fixed with a wider scope than suggested. 7 should-fixes, of which 4 were acted on. One REWORK round, resolved inline by Fable because the fix was under 5 calls.
- Running the parallel refuter and builder on disjoint files worked. The refuter waited on a `.done` sentinel file for the full test run, so vstest hosts never overlapped.

**Spec misses:**
1. The plan's Task 3 said "stay dates = ReservationDates" without checking the MultiDay cache shape (wrong precedent).
2. Fable spec'd [BindNever] for a JSON [FromBody] model. Rule: check the binding source before choosing an over-post guard.
3. The refuter's suggested tenant filter (ORGANIZATION_ID only) did not match the data: 37 active add-ons have a null org. Rule: before applying a tenant-scope fix, query the rows it would exclude.
4. The Task 2 test sketch for MultiDay said "build exactly as in :3756". The builder coped, but it was a placeholder.

## Addendum: pre-PR review and PR (2026-09-29)

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 8 | general-purpose | opus | pre-pr-review: code-reviewer | 188,588 | 31 | 4.3 | approved, 1 suggestion | earned (mobile doc error) |
| 9 | general-purpose | opus | silent-failure-hunter | 124,439 | 21 | 3.3 | 1 warning, 1 suggestion | earned (the no-day-ticked hole) |
| 10 | general-purpose | opus | comment-analyzer | 175,717 | 24 | 3.4 | 1 warning, 1 suggestion | earned |
| 11 | general-purpose | opus | type-design-analyzer | 110,596 | 11 | 1.2 | 1 nit | marginal |
| 12 | general-purpose | opus | playwright-reviewer | 84,836 | 7 | 0.8 | 1 nit | marginal |
| 13 | general-purpose | opus | code-simplifier | 105,972 | 7 | 1.6 | 4 (1 false positive) | marginal |
| 14 | builder | opus | verify and fix the 11 findings, then rerun Playwright | 169,839 | 55 | 18.3 | 10 fixed, 1 FP shown | earned |

Totals, addendum: about 0.96M tokens. Task total is about 2.06M subagent tokens.
Loop signal: pre-PR review found 2 warnings that the builder->refuter loop missed. The no-day-ticked POST was reachable only with JS bypassed, and neither refuter checked the form shape as posted with no key. Matches the 2026-09-15 finding: refuters miss requirement-level edges that the review agents catch.
Spec miss: the "empty list is an error" requirement did not say how an empty checkbox group posts (it sends no key at all). Future pickers need a "shown" marker in the spec.
