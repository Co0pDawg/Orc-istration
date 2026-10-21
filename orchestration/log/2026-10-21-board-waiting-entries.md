# 2026-10-21 · board · Waiting entries (agent time between Cooper's turns)

Cooper: "If there are no driven entries, add non-driven, as I was viewing and waiting." Fable built it inline as a pure function, measured it on real db exports first, and asked once with the numbers. Cooper chose "between your turns" (a gap of 2 h or less). Result: v32 live, main b1a9561. The 10/21 timeline was re-uploaded, because the board still held the 1:45 AM copy, which is why today looked undriven.

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| refuter | sonnet | Waiting rule on real 10/19-10/21 exports | 86k | 9 | 2 | REWORK: the tie-break rule had no failing test | earned (a mutation stayed green) |

**Totals:** 1 dispatch, 86k subagent tokens. Fable context at start and at writing: not captured.

**Loop signal:** running the rule on real exports before asking turned a vague ask into a billing decision with numbers: all agent time would add 2.5-4.6 h/day, including a 2-4 AM run. The Sonnet refuter was enough for a pure function plus a real-data script. No pre-PR tier (personal repo).

**Spec misses:** a fixture where both tie-break rules picked the same ticket, so the test could not tell them apart.
