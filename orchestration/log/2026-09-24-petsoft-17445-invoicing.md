# 2026-09-24 — Petsoft — 17445 round 2 plan 1 (invoicing, Task 17446)

| # | Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|-------|-------|---------|--------|-----------|-----|--------|-------|
| 1 | builder | opus | InvoicingTests + DashboardInvoicesPage | 170k | 54 | 17 | 4/4 x2, suite 12/12, 4 mutations caught | earned |
| 2 | refuter | opus | adversarial check + 3 mutations | 129k | 24 | 10 | ACCEPT | earned |
| 3 | playwright-reviewer | opus | review | 99k | 10 | 2 | approved, 2 sugg + 2 nits | marginal |
| 4 | code-reviewer | opus | review | 115k | 17 | 3.5 | 1 warning (SaveAsync landing) | earned |
| 5 | comment-analyzer | opus | review | 117k | 21 | 3 | caught the inverted sort (real page-one bug) | earned |
| 6 | code-simplifier | opus | review | 96k | 7 | 1 | alias removal, locator reuse | marginal |

Totals: ~726k agent tokens. Orchestrator context: ~20k after compaction at start, ~75k at writing.
Orchestrator inline: app restart from the new worktree, verified the proc sort, applied all fixes, local + UAT runs, merge check (8 pairs + full sequence + build), PR 6021, ticket updates.

Loop signal: the builder, refuter and code-reviewer all read "SortAsc=true" as ascending; only comment-analyzer read the proc's inverted CASE. Reading the SQL, not the flag name, is what settles sort direction.

Spec misses (mine): none material; told the builder the list might need a date setting, which invited the sort click.
