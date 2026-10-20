# 2026-10-08 Petsoft 17216 scoping (grill + ticket rewrite)

| Agent | Model | Purpose | Tokens | Tools | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| researcher | sonnet | Map Office Book page multi-date flow | 107,853 | 36 | 2.8 | Report; found #17125/#17215 default fix | earned: surfaced that the ticket's main pain was already shipped |

Totals: 1 dispatch, ~108k subagent tokens. Fable context: start ~25k, at writing ~45k.
Loop signal: no build loop, no pre-PR review tier (scoping only).
Spec misses: researcher's BHV service query used a wrong view name; Fable re-ran it inline (v_KennelFacilityPrimaryItem, dbo.Organization).
