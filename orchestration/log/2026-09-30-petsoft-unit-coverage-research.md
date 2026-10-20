# 2026-09-30 petsoft unit-test coverage research

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | researcher | sonnet | bug-fix churn + testability of top 25 files | 59.8k | 21 | 5.3 | table + scratch file | earned: churn ranking not derivable from coverage alone |

Inline (Fable): local coverage run (4 MSTest projects, ~4 min), python cobertura merge, 1 peek grep.

## Totals
1 dispatch, ~60k subagent tokens. Fable context: start ~45k, end ~95k (estimate; status line not read).

## Loop signal
No build loop. Pulling the nightly CI coverage artifact would have saved the local run but no ado.ps1 verb exists.

## Spec misses
Researcher testability labels were partly inferred from names (it said so); coverage numbers superseded its "decent coverage" claim for view models.
