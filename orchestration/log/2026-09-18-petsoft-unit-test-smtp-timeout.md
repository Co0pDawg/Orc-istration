# 2026-09-18 — Petsoft — unit-test step ballooned (Bug 17388)

Diagnosis and fix were done inline by Fable (ADO timeline/test-results REST, log diff, local socket repro, 4 edits). Only the pre-pr-review (skill 2.3.2) was dispatched.

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| general-purpose (code-reviewer) | session | correctness/security | 83,568 | 8 | 0.5 | 1 nit, 1 pre-existing suggestion; both fixed | earned — small, but the grep for leftover references was useful verification |
| general-purpose (silent-failure-hunter) | session | error handling | 82,386 | 7 | 0.5 | 0 findings; confirmed refusal still lands as Pending, never Sent | marginal — literal-only diff |
| general-purpose (pr-test-analyzer) | session | test coverage | 80,464 | 5 | 0.3 | 0 findings | marginal — literal-only diff |
| general-purpose (code-simplifier) | session | simplification | 79,647 | 5 | 0.3 | 0 findings | waste — nothing to simplify in four literal swaps; selection rules forced it |
| clodex sol (code-reviewer-gpt) | GPT high | mirror | n/a | n/a | ~6 | 0 findings | marginal |
| clodex sol (silent-failure-hunter-gpt) | GPT high | mirror | n/a | n/a | ~4 | 0 findings | marginal |

## Totals
Subagent tokens: 326,065 across 4 Claude agents (25 tool uses), plus 2 GPT workers on clodex quota. Fable context: not captured at start or at writing.

## Loop signal
No build loop. One full run of each test project, once, in the background while the review ran (Core.Test 3 m 7 s, Tests 7 m 46 s), then one filtered rerun after the two review fixes.

## Spec misses
- ~80k tokens per agent is the floor cost of each agent reading its definition plus shared rules; on a 10-line fixture diff that floor dominated. The selection guide has no "trivial diff" exit, so four agents ran where code-reviewer alone would have found the same two items.
- Agents were staged 3+1 to respect the three-in-flight guard; on sub-minute agents the staging cost nothing.
