# 2026-09-23 Petsoft — 17329 plan 6: early checkout, card payment, card refund

| # | Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | researcher | sonnet | early-checkout repricing, refund path, hooks | 98,279 | 40 | 3 | p_Reservation_CheckOut deletes trailing rows; no fee rule; refund routes by tender | earned — decided the $80/2-line assertion |
| 2 | builder | opus | 7 tasks (CardDeviceSetup, checkout fix, 3 tests, docs) | 177,351 | 66 | 86 (stalled 10 min, resumed) | 7/7, both mutations, db checks; found RefundFullAsync card defect | earned |
| 3 | refuter | opus | diff vs spec, cross-suite reruns | 115,679 | 15 | 10 | ACCEPT, 10/10, 5 should-fixes | earned — the dead code + two more duplicate setups |
| 2b | builder (resumed) | opus | 5 should-fixes | 191,261 | 10 | 6 | 6/6 | earned |
| 4-5 | pre-PR (2 opus) | opus | playwright-reviewer, code-reviewer | 227,617 | 18 | 3 | 3 nits, all fixed inline by Fable | marginal — refuter had already covered the diff; the blocked-modal guard was the one new catch |

Fable inline: worktree, spec (~50 lines), test-point tester lookup, checklist comment on 17329, 3 nit fixes, PR description, calibration/cost logs, UAT run.

**Totals:** 5 dispatches (+1 resume), ~810k agent tokens, 149 tool uses, ~108 agent-min. Fable context: ~15k at task start (post-compaction) → ~100k at writing.

**Loop signal:** builder → refuter ACCEPT with should-fixes → same builder → 2 quick reviewers → 3 nits fixed inline. No REWORK round.

**Spec misses (Fable's):**
- Said the boarding org has a second facility (EnsureSecondFacilityAsync exists but only runs for the tests that need it); builder corrected.
- Said "assert quantity 2" for the boarding line; the invoice renders one line per night. The spec's escape clause covered it.
- Missed that RefundFullAsync navigated away from the refund link for card payments; the builder found it on the first red run. A researcher question about the refund link's page would have caught it.
- "Leave ContinueAnywayBtn for check-in" was wrong: CheckInAsync never used it. Grep before deciding what to keep.
- Builder stalled once at 600 s with all edits already on disk; the resume cost nothing because it had finished before the message arrived.
