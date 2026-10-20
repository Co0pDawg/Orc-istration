# 2026-09-24/25 — Petsoft — 17445 round 2 plan 3 (pet-parent booking variants, Task 17448)

| # | Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|-------|-------|---------|--------|-----------|-----|--------|-------|
| 1 | builder | opus | 9 cases, 2 classes (stalled twice: standby, then 600 s watchdog; resumed) | ~406k | ~69 | ~90 active | 3 same-day green runs per class, 7/7 mutations, neighbours green | earned |
| 2 | refuter | opus | adversarial + 2 mutations | 161k | 38 | 10 | REWORK: deposit amount unasserted; found 2 product bugs | earned |
| 3 | playwright-reviewer | opus | review | 115k | 12 | 2.3 | 1 warning + 10 | earned |
| 4 | code-reviewer | opus | review | 140k | 24 | 2.7 | 1 warning (today capacity) + 1 nit | earned |
| 5 | comment-analyzer | opus | review | 161k | 50 | 7 | 3 wrong-cause comments | earned |
| 6 | code-simplifier | opus | review | 121k | 8 | 1.6 | aliases, duplicates (-40 lines) | earned |
| 7 | builder (fresh) | opus | fix batch, 14 items | 192k | 72 | 37 | 13/14; item 1 blocked by an app bug; item 5 introduced a wrong wait | marginal (one regression) |
| 8 | refuter | opus | static re-refute | 125k | 12 | 2 | ACCEPT | marginal (a static pass could not see the wrong wait) |
| 9 | debugger | opus | UAT add-on failure root cause | 85k | 10 | 1.8 | wait expected the list; the form lands on the edit page | earned |

Totals: ~1.5M agent tokens. Orchestrator context ~115k at plan start, ~200k at writing. Orchestrator inline: hung-process cleanup twice, UAT failure triage (the screenshot showed the 0-lb rule), two test-side fixes, develop merge with 2 conflicts, PR 6029 via ado.ps1.

Loop signal: the cached org's "already exists" branch hid the create path locally; only the UAT run exercised it. Specs for seed-by-name helpers must require a fresh-org run.

Spec misses (mine): did not warn that a foreground dotnet test over 10 minutes kills the builder (now in memory); fix-batch item 5 told the builder a save redirects to the list without checking the form's action.
