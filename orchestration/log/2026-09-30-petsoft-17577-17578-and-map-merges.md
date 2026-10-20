# Tasks 17577 (feasibility, closed) + 17578 (itinerary/notes) + map merges + CI fix

- Date: 2026-09-30
- Project: Petsoft
- Outcome:
  - 17577 closed as not feasible, with the reasons on the ticket.
  - 17578 is draft PR 6076.
  - Bug 17632 filed (P1: removing the departure day leaves the removed night billed). 17586 extended.
  - Merged develop's condensed map into all six open PRs; all six now show mergeable.
  - CI build 20502 failure on PR 6070 fixed (ecca7791f).

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | researcher | sonnet | 17577 feasibility | 87,348 | 17 | 2.3 | 2 of 3 areas blocked | earned (avoided a builder on an infeasible task) |
| 2 | builder | opus | 17578 tests | 201,494 | 92 | 38 | 3 tests | earned (suspected billing bug) |
| 3 | refuter | opus | refute 17578 + reproduce the bug | 122,800 | 28 | 5.8 | REWORK, bug CONFIRMED | earned (P1 billing bug proven live) |
| 4 | builder (resumed) | opus | 17578 hooks rework | ~7k delta | 18 | 5 | done | earned |
| 5-8 | general-purpose x4 | session | /pre-pr-review 17578 | ~342k | 20 | ~1 each | approved, minor only | marginal |
| - | Fable inline | - | map conflict merges (6 branches), CI 20502 trace diagnosis and fix | - | ~25 | ~40 | resolved | earned |

**Totals:** about 760k subagent tokens across 8 dispatches, plus substantial Fable inline work (map merges and trace analysis). Fable context: unmeasured.

**Loop signal:**
- Staggering the live runs (a researcher instead of a second builder) cut down the load failures. One builder run still hit SQL/RAM starvation (1.7 GB free).
- /pre-pr-review on refuted test-only PRs found nothing actionable for the fourth time.

**Spec misses:**
1. The first builder spec pointed at old-format map rows; develop had condensed the map in PR 6032 the same afternoon. Fable should check develop's doc format after each fetch.
2. Earlier builder specs said "no product code". That made the 17578 builder skip test hooks, which the rules require in the same PR. Future specs should say "hook-only view edits (data-testid) are in scope".
