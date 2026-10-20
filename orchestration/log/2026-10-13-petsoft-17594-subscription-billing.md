# 17594 subscription billing defects

Date: 2026-10-12 to 2026-10-13
Project: Petsoft
Branch: feature/17594-subscription-billing-defects (10 commits, 405b31390..c343beb8f)
Task: /start 17594, a grouped Bug (17594 + 17595/17652/17653 + the 10-06 reactivation addendum). Covers the retry that never applied the tier, the reactivation overcharge, owner gate/CSRF, the tokenization decline and small fixes.
Outcome: shipped to the branch (no PR; /draft-pr is for the developer). Build green. Full Tests 6231/0 fail, Core 1774/0 fail on c343beb8f. Live UITests: Reactivation 5/5, Billing 1/1, SubscriptionBilling 7/7, TrialExpiry 2/2. Pre-PR review was full tier.

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | researcher | sonnet | verify 14 ticket items on develop with path:line | 101k | 20 | 2.5 | 13 still present, 1 already fixed, fix sketches | earned: workability verdict, and the plan and builder Known came straight from it |
| 2 | builder | opus | 5 commit groups | 346k | 155 | 41 | DONE, 5 commits, mutations red | earned |
| 3 | refuter | sonnet (rate guard after a 346k builder) | static review + targeted reruns + 2 mutations | 121k | 19 | 7 | REWORK: 2 must-fixes (retry clobbers a newer tier; empty foreign-facility set charges and deactivates) | earned: both real |
| 4 | builder (UITests, worktree) | opus | UITests for the new flow + live run | 189k | 68 | 27 | PARTIAL: found the single-facility TempData Guid loop live | earned: a P1 product bug that unit tests could not see |
| 5 | builder (resume of #2) | opus | rework round 1 | 24k delta | 25 | 11 | DONE 5d877082b | earned |
| 6 | fable | — | inline refute of the rework; first-attempt edge fix d8a45f9d0; TempData fix c264e5134; apply UITests diff | — | ~15 | — | 2 fixes, both mutation-checked | earned |
| 7 | builder (resume of #4) | opus | live rerun on e9f3789a1 | 7k delta | 10 | 9 | 5/5 + 10/10 | earned |
| 8-14 | pre-pr-review x7 | opus (session) | code-reviewer 131k, silent-failure-hunter 114k, architecture-reviewer 126k, type-design-analyzer 98k, comment-analyzer 123k, playwright-reviewer 92k, code-simplifier 100k | 784k | 84 | ~6 each | 0 issue / 5 warning / 5 suggestion / 1 nit | earned: 4 money/tenant warnings (org-switch TempData, Inactive retry, post-charge failure, superseded retry) missed by the refuter |
| 15-16 | code-reviewer-gpt, silent-failure-hunter-gpt | gpt-5.6-sol | mirrors | 0 | 0 | 15 | FAILED: unrecognized_model, no result; stopped | waste: worker's Claude Code does not know the model id |
| 17 | builder | opus | review fixes A-E (paused mid-run, resumed) | 177k | 27 | ~25 active | DONE c343beb8f, 4 mutations red | earned |
| 18 | builder (resume of #4) | opus | live rerun on c343beb8f | 26k delta | 13 | 22 | all green (2 Arrange-timeout reruns) | earned |

## Totals

- About 1.78M subagent tokens across 16 Claude dispatches. Roughly 4 h wall clock of agent time, plus an overnight pause.
- Fable context: unmeasured. No status line or /context reading was taken in this VS Code session, so this record fails the mandatory line; take the reading at task start next time.

## Loop signal

- Refuter: 2 must-fixes, both confirmed; 1 should-fix taken; 1 pre-existing item escalated to the user. One REWORK round.
- Fable's inline refute of the rework found one more edge: a multi-decline retry still let a later approved retry overwrite the switched tier (first attempt vs last attempt).
- The live UI run found a defect that neither the builder, the refuter nor 1,700+ unit tests caught: the fake TempData skipped serialization. The fix made the test helper round-trip through the real TempDataSerializer.
- Full-tier pre-PR review found 4 warnings the refuter missed, all requirement-level money/tenant paths. This is the same pattern as the first review (data-precondition line insufficient for flows with cross-request state). The light tier would have been wrong here; full tier was correct for product money code.

## Spec misses

- The builder spec did not say that TempData round-trips through the cookie serializer in production but not in the unit test fake. That cost a live-run cycle and a fix.
- The builder spec did not mention org switching for per-browser TempData state. The refuter brief should name "state carried across requests in TempData/session/cookies: per-browser, not per-tenant".
- GPT mirror launched without checking that the worker's model id resolves. Memory says to verify the clodex gateway; the probe checks the port only, not the model catalog.
- Pausing: Fable said "pausing" but left a builder running until the user asked. When the user says pause, stop running writers too.

## Addendum 2026-10-13: two pre-existing reactivation gaps (Cooper: fix in-branch)

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 19 | builder | opus | same-tier free reactivation + status gate | 185k | 48 | 13 | DONE df0c6acb8, 3 mutations red, 39 Inactive orgs' shapes checked | earned |
| 20 | builder (resume of #4) | opus | live rerun on df0c6acb8 | 7k delta | 10 | 7 | all green; flagged no UI test for previous tier | earned: found the coverage gap |
| 21 | builder (resume of #4) | opus | previous-tier UI test | 10k delta | 25 | 10 | 6/6, $100 confirmed; UI mutation refused by classifier | earned |

Spec miss: the gates spec did not ask for a Playwright test of the fixed workflow; the live-run builder had to point it out.

## Addendum 2026-10-19: external pre-PR review round 2 + develop merge

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 22 | builder | opus | round-2 fixes R1-R10 (5 commits) | 425k | 132 | 68 | DONE, mutations red | earned |
| 23 | builder (resume) | opus | freshness rule | 12k delta | 12 | 10 | DONE 694404339 | earned (later superseded by develop's rule) |
| 24 | researcher | sonnet | overlap with develop #17941/#17787/#17897 | 87k | 18 | 4 | found RESTART_TIER_CHANGE_ID duplicate mechanism + merge plan | earned: prevented a blind merge |
| 25 | builder | opus | merge develop, reconcile marker | 317k | 84 | 35 | DONE 3b999fc48 + ebd61b3c9 (found SMS-invoice-as-tier-change bug) | earned |
| 26 | refuter | sonnet | static merge review | 149k | 17 | 5 | ACCEPT + should-fix (marker failure) fixed inline a007c96c5 | earned |
| 27 | builder | opus | live check + screenshots | 207k | 76 | 19 | all green; 2 states unreachable live | earned |

Spec miss: round-2 spec designed a 3-column record without checking develop for parallel work; #17941 (merged 10/16) had built the same mechanism. Lesson: before speccing a schema/state change on a long-lived branch, diff develop for the same table/class first. Loop signal: external runtime review found 3 issues + 6 warnings that the earlier full-tier /pre-pr-review and refuters missed (cancel copy vs saved date, invalid-card path outside try, cross-session double charge) - runtime validation against ticket items earned its keep.
