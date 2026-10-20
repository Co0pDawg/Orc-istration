# 2026-09-25 — Petsoft — 17445 round 2 plan 4 (Service Calendar, Task 17449)

| # | Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|-------|-------|---------|--------|-----------|-----|--------|-------|
| 1 | builder | opus | 7 cases in 4 tests | 241k | 78 | 36 | 3 same-day + fresh + neighbours green; 4/4 mutations | earned |
| 2 | refuter | opus | adversarial + 1 mutation run | 148k | 43 | 12 | REWORK: Sunday flake | earned |
| 3 | playwright-reviewer | opus | review | 98k | 7 | 1.3 | 2 warnings | earned |
| 4 | code-reviewer | opus | review | 122k | 17 | 2.4 | found the Sunday flake | earned |
| 5 | comment-analyzer | opus | review | 133k | 30 | 4.2 | Sunday flake + a false product fact | earned |
| 6 | code-simplifier | opus | review | 115k | 11 | 1.2 | helper + dedupe | marginal |
| 7 | builder (resumed) | opus | rework, 6 items | +14k | 7 | 5 | all done, 4/4 + neighbours 4/4 | earned |

Totals: ~870k agent tokens. Orchestrator context ~200k at plan start, ~235k at writing. Orchestrator inline: rework check instead of a second refuter (small, readable diff), UAT run, develop merge, three-way merge check, PR 6031 via ado.ps1.

Loop signal: the builder's runs were all single-class, so an interaction with another class's org-wide data (MiscTests' Sunday hours) was invisible; three reviewers found it by reading. Specs using random dates on a shared org should name the org-wide settings other classes write.

Spec misses (mine): didn't list the misc org's per-weekday hours written by MiscTests.
