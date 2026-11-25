# <date> · <project> · <slug>
Branch: <branch> · Task: <task>
Outcome: shipped | partial | abandoned — verification passed: <...>

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | earned / marginal / waste |

Value: earned = changed the next step or caught a real defect; marginal = correct but doable inline in under 5 tool calls; waste = wrong, ignored, duplicated or rate-limited. A resumed agent gets its own row with its token delta.

Totals: <tokens>, <wall clock>. Orchestrator context: <start>k → <end>k (target share under 20%)
Loop signal: spec defects found by the builder, must-fixes confirmed vs rejected, SPEC VS INTENT entries, REWORK rounds, review tier used, what later review or CI caught that the tier missed
Escaped defects: <one line per defect found after the loop accepted: what, who caught it, why the loop missed it; or none>
Spec misses: <what the marching orders got wrong; feed back into the template>
