# Cost log: <YYYY-MM-DD> <project> <slug>

- Date: YYYY-MM-DD
- Project: <project>
- Branch: <branch>
- Task: <ticket or one line>
- Outcome: <shipped | partial | abandoned> — <what verification passed>

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | <scout\|researcher\|builder\|refuter\|debugger\|review-*\|orchestrator> | <model> | <one line> | <tokens> | <tools> | <min> | <ACCEPT/REWORK/DONE/...> | <earned\|marginal\|waste: reason> |

## Totals

- Tokens: <sum of subagent tokens>
- Wall clock: <minutes> min across <n> dispatch(es)
- Orchestrator context: <start>k → <end>k

## Loop signal

- Spec defects found by builder: <none | list>
- Refuter must-fixes: <confirmed> confirmed, <rejected> rejected
- SPEC VS INTENT entries: <count or none>
- REWORK rounds: <count>
- Escaped defects: <none | one line per defect found after the loop accepted: what, who caught it, why the loop missed it>

## Spec misses

- <none | what the marching orders got wrong that cost a dispatch or rework round>
