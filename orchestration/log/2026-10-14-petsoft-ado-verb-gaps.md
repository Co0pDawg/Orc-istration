# 2026-10-14 Petsoft: ado.ps1 verb gaps (task 17924, PR 6192)

| # | agent | model | purpose | tokens | tool uses | min | result | value |
|---|---|---|---|---|---|---|---|---|
| 1 | researcher | sonnet | mine 77 transcripts for hand-rolled ADO calls vs existing verbs | 54,755 | 12 | 1.7 | 4 ranked gaps + clean skills check | earned: picked scope from evidence (66 runs-list calls) |
| 2 | builder | opus | 4 read-only verbs + tests + AGENTS/doc exception removal | 121,386 | 27 | 5.1 | DONE, mutation-checked | earned |

Totals: 2 dispatches, ~176k subagent tokens. Fable context: not captured at start; small session (~40k at writing).
Loop signal: refuter skipped, Fable read the full diff inline (138-line diff, tooling script, no product code). Diff read caught one defect: testplan-suites silently truncated after page 1 (helper's "never silent" rule); fixed inline with a [ref] headers param on Invoke-Ado. No pre-PR review tier run (PR already open; tooling-only). Later CI/review catches: none yet.
Spec misses: spec allowed the builder to defer paging ("note paging unhandled") instead of requiring it; should have said "follow x-ms-continuationtoken; extend Invoke-Ado if needed".
