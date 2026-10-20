# 2026-10-06 petsoft unit-test coverage round 5 (story 17761) + bug dedupe

Rework rows show the resume delta. Figures come from the task notifications in session c24f041c. All refuters ran on sonnet.

| # | Agent | Model | Purpose | Tokens | Result | Value |
|---|---|---|---|---|---|---|
| 0 | builder | sonnet | bug dedupe merges in ADO (12 approved pairs) | 94.6k | 3 merged, 9 skipped after reading bodies | earned: titles misled; body read prevented 9 bad merges |
| 1 | builder | opus | 17762 Customers Payments | 137.1k (+5.9k) | 16->~70%; P2 17806, 17807 | earned |
| 2 | refuter | sonnet | 17762 | 115.4k | REWORK: receipt success reachable, terminal-log gap | earned |
| 3 | builder | opus | 17763 MobileApi Billing | 120.4k (+7.9k) | 35->97%; 17804 | earned |
| 4 | refuter | sonnet | 17763 | 85.6k | REWORK: no-device 500 pinned as expected | earned |
| 5 | builder | opus | 17765 InvoiceFactory + Core Payments | 278.7k (+42.0k) | 83->88 / 81->95%; P2 17810, 17811 | earned |
| 6 | refuter | sonnet | 17765 | 89.8k | REWORK: legacy deposit refunds + late-cancel reachable; NRE pinned | earned: found P2 17810 via rework |
| 7 | builder | opus | 17764 Org Facility | 136.1k (+5.8k) | 33->71%; 17808, task 17809 | earned |
| 8 | refuter | sonnet | 17764 | 99.9k | REWORK: 17395 unpinned; dead action | earned |
| 9 | builder | opus | 17766 Admin PaymentRecovery/Certs | 147.9k (+3.2k) | 0->60-100%; 17812 | earned |
| 10 | refuter | sonnet | 17766 | 90.3k | REWORK: catch-branch 500 reproduced | earned |
| 11 | builder | opus | 17767 Admin promo codes | 143.0k (+2.2k) | 0->97-100%; 17813 | earned |
| 12 | refuter | sonnet | 17767 | 87.3k | REWORK: edit-save exactness; ran the mutation the builder was refused | earned |
| 13 | builder | opus | 17768 Admin Home + administrators | 152.5k | 23->64%, models 98-100%; P2 17814, 17815, 17816 | earned |
| 14 | refuter | sonnet | 17768 | 110.3k | ACCEPT; severity ratings per bug | earned |
| 15 | builder | opus | 17769 Admin ops pages | 154.7k | 0->76-100% x7 | earned |
| 16 | refuter | sonnet | 17769 | 77.6k | ACCEPT | earned |
| 17 | general-purpose x2 | session | /pre-pr-review light + test analyzer | 169.3k | PASS; 3 nits fixed inline | earned |

## Totals
18 rows, about 26 dispatches including resumes. Roughly 2.9M subagent tokens: builders ~1.74M, refuters ~0.76M, review ~0.17M, dedupe ~0.09M. Fable's own context was not recorded at task start.

## Loop signal
- Pre-PR review tier: **light + pr-test-analyzer**. The diff is test-only and every task was refuted, the same as round 4. It found no warnings, only nits, which matches the tier rule's evidence. No later review or CI catches yet (PR 6133 just opened).
- 6 of 8 refuters returned REWORK.
  - The "500 pinned as expected" pattern appeared twice (17763, 17765) even though the brief said not to pin defects. Next time the brief should name it explicitly: a test asserting ThrowsExactly on NullReferenceException, InvalidOperationException or ArgumentException from a user path is a bug test.
  - "Not covered due to time" on money paths was reversed once (17765).
- The classifier refused a builder's production mutation (17767) but allowed the refuter's identical one. I did not run it on the builder's behalf.
- The bug dedupe proposed merges from ticket titles. Reading the bodies kept only 3 of 12, and Cooper confirmed that bar (one fix must close both). Memory updated.
- Merging develop at the end hit one small test conflict this time (NavMenuItemTests). Merging develop before the last wave is still cheaper.

## Spec misses
- Builder briefs should forbid ThrowsExactly on NRE/ArgumentException as a pinned "expected" result for user-reachable paths.
- One builder reported a wrong commit hash (17762: 7c3d5e1fa vs the actual 90a641c6d). Cherry-pick from `git log wip/<task>`, not from the report.
