# 2026-09-24 — Petsoft — 17329 plan 7: Daycare Availability Playwright

| # | Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|-------|-------|---------|--------|-----------|-----|--------|-------|
| 1 | builder | opus | 7-task spec: page objects + new suite + docs, filtered run, 3 mutations, db checks | 187k | 56 | 22 | 4/4 new+daycare green; ParentDaycare red on stale app (not its fault) | earned |
| 2 | refuter | opus | rerun 7 tests cross-suite + own mutation (skip approval) | 128k | 21 | 4 | REWORK: approval unproven (pending counts as Reserved), test-1 order dependence; 3 should-fixes | earned — the approval hole was real |
| 3 | builder (resumed) | opus | 2 must + 3 should fixes, rerun, approval mutation | 195k (delta) | 7 | 5 | 5/5 green, mutation now fails | earned |
| 4 | code-reviewer | fable | pre-PR | 112k | 9 | 2 | approved; 1 nit fixed, 1 wont-fix | marginal |
| 5 | playwright-reviewer | fable | pre-PR | 99k | 6 | 1 | approved; 3 nits, none actioned | marginal |
| 6 | comment-analyzer | fable | pre-PR | 120k | 13 | 4 | approved; 1 nit fixed | marginal |
| 7 | code-simplifier | fable | pre-PR | 95k | 4 | 1 | approved; 3 nits fixed, 1 false-positive (month boundary) | marginal |

Totals: ~936k agent tokens, 116 tool uses, ~39 agent-minutes. Fable context: ~40k at task start (post-compaction), ~115k at writing.
Fable inline: fact-finding (~14 tool calls), spec, app restart/rebuild, rework verification by reading the diff (no second refuter), nit fixes, UAT run.

Loop signal: one REWORK round; second refute done inline (5 small edits, all verified by the builder's rerun + mutation). Pre-PR fan-out of 4 found only nits — for a UITests-only diff already refuted, 2 agents (playwright-reviewer + comment-analyzer) would have found the two nits worth fixing.

Spec misses (mine):
- Did not say the app on :7099 was an older build than develop → builder lost a run on `#invoiceSubtotal`; rule: restart the app from the new worktree before dispatching a live-app builder.
- Said "approve, then assert Reserved 1" without checking that Pending Approval already counts in TotalBooked — the refuter caught it. Manual 15127's premise (approval produces the count) is wrong; goes to task 17376.
- Did not require every test to reset the days it asserts (order-dependence caught by the refuter).
- Told the builder not to create a report file path that it then never wrote; the refuter had nothing to judge deviations against — restate "write the file" as a must-verify item.
