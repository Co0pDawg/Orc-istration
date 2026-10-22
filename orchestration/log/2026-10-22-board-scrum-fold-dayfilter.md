# 2026-10-22 · board + worklog · High-level scrum, Entries fold, chips by day with a shared date

Three asks from Cooper. (1) The scrum should be high-level, with no commits, merge ids or test numbers. (2) The Entries pane should collapse behind a side arrow. (3) The top-bar chips should filter by the day each session was touched, with one date shared between Board and Time. Result: v34 (scrum), v35 (fold, Fable inline) and v36 (day filter) are live, main ec515b5. The worklog sync now exports `titles` (uncommitted, Cooper's repo).

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| builder | opus | High-level scrum + worklog titles | 156k | 50 | 12 | DONE, 99/99 | earned |
| builder (resumed) | opus | Whole-clause cap | +13k | 19 | 3 | DONE | earned (a cut mid-phrase) |
| refuter | sonnet | Scrum on real 10/19-10/21 | 88k | 11 | 7 | ACCEPT + 5 should-fix | earned |
| builder (resumed) | opus | Title echoes, PR wording | +21k | 23 | 5 | DONE, 102/102 | earned |
| builder | opus | Chips by day, shared date | 209k | 59 | 27 | DONE, 110/110 | earned |
| refuter | opus | Day filter | 152k | 27 | 9 | REWORK: `#time` with no date crashed boot | earned (it would have broken every reload after clicking Time) |
| builder (resumed) | opus | Rework + 3 should-fixes | +25k | 17 | 5 | DONE, committed 908d3c3 | earned |
| refuter | sonnet | Scoped re-review | 85k | 10 | 3 | ACCEPT | earned |

Inline by Fable: the Entries fold (46b6675, previewed in both skins and at 480 px); the try/catch around boot's route call.

**Totals:** 8 dispatches, ~750k subagent tokens. Fable context at start and at writing: not captured.

**Loop signal:** the day-filter refuter's CDP harness caught a boot crash that the builder's own measurement page missed, because the builder always started on Board. Briefs that touch routing should list "load each hash fresh" as a check. The Sonnet refuter was enough for the scoped re-review. No pre-PR tier (personal repos).

**Spec misses:** (1) the scrum spec capped by characters, not whole clauses; (2) the day-filter spec did not require a fresh load on each hash with no date.
