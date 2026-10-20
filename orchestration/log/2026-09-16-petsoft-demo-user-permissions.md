# 2026-09-16 Petsoft — demo user permissions (17336)

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| code-reviewer | opus | pre-PR review of proc diff | 79k | 9 | 1.0 | 2 nits (1 fixed, 1 wont-fix) | earned: caught stale Manage Tags comment |
| comment-analyzer | opus | doc/comment review | 91k | 6 | 1.7 | 1 nit (fixed) | earned: header wording; confirmed no doc gap |
| code-reviewer-gpt | gpt sol | mirror | n/a | n/a | ~2 | 0 findings | marginal: agreement signal only |
| comment-analyzer-gpt | gpt sol | mirror | n/a | n/a | ~2 | 1 issue (dup of nit, over-rated) + 1 suggestion (wont-fix, house convention) | marginal |

Totals: 170k subagent tokens; Fable context ~105k at task start (diagnosis), ~150k at writing. Diagnosis, fix, DB verify, ticket, branch, PR all inline (~25 tool calls).
Loop signal: one review round, approved first pass. Single-file SQL change; inline was right.
Spec misses: none. GPT comment-analyzer rated a nit as issue and flagged dated header idiom as narration (house convention false-positive, 2nd of its kind).
