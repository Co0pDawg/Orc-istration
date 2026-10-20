# 2026-09-16 Petsoft — 17329 plan 3: Cancellation rules refund workflow (new suite)

| # | Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | scout | haiku | cancel flow, void status, portal Account Activity, deposit copy, parent helper | 67,891 | 50 | 3 | correct; wrote its overflow file this time | earned |
| 2 | builder | opus | Tasks 1-7 (2 page objects, suite, 4 tests, docs) | 168,312 | 69 | 48 | 4/4 twice, DB-verified idempotency, own mutation | earned |
| 2b | builder (resumed) | opus | 4 refuter fixes, edit-only then build+1 test | ~10,000 | 8 | 4 | green | earned |
| 3 | refuter | opus | static + amounts + merge check + reruns + mutation | 136,132 | 33 | 16 | REWORK (3 doc/merge-hygiene must-fixes) then ACCEPT; found the 3-way merge conflict with PR 5942 | earned — the merge check alone justified it |
| 4-7 | pre-PR agents (2 opus, 2 sonnet) | mixed | code-reviewer, playwright-reviewer, code-simplifier, comment-analyzer | 412,659 | 55 | 8 | 4 findings, 2 fixed, 2 wont-fix | earned |

Fable inline: plan (~500 lines), worktree, UAT run 4/4 (8 min), two review fixes, PR description, commit/push/draft PR.

**Totals:** 7 dispatches (+1 resume), ~795k agent tokens, 215 tool uses, ~79 agent-min. Wall ≈ 2 h.

**Loop signal:** builder → refuter REWORK(docs) → builder → refuter ACCEPT. One round; the must-fixes were doc co-change and merge hygiene, not logic.

**Spec misses (Fable's):**
- Did not check the ShortSuite keystone doc when tagging a new keystone; CLAUDE.md's doc co-change rule applies to test docs too.
- Told the builder to copy the InvoicePage hunk "verbatim" but did not say byte-for-byte; a re-wrapped comment created a merge conflict with PR 5942.
- Made StatusDisplay public without checking for the existing duplicate on PendingApprovalPage (three review agents flagged it).
- Assumed "Reservation Created" rows are one per reservation; the history proc emits one per invoice line. The builder caught it on the first run.

**Pattern that is working:** refuter holds reruns until Fable's UAT run finishes (one vstest host per worktree); pre-PR agents launch on the diff while the refuter reruns, since they never run tests.
