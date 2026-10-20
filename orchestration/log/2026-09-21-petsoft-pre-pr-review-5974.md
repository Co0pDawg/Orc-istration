# 2026-09-21 — Petsoft — /pre-pr-review PR 5974 (internal-link SEO fixes)

13 files, ~50 changed lines. Read-only review, 5 Claude agents + 2 GPT mirrors.

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| general-purpose (code-reviewer) | session (Fable) | correctness + cross-file route checks | 94,698 | 6 | 1.0 | 6 findings | earned — confirmed routes/ViewImports, caught the mid-run third commit |
| general-purpose (comment-analyzer) | session (Fable) | annotation pair check | 100,686 | 8 | 1.0 | 3 findings | earned — the run's only issue |
| general-purpose (silent-failure-hunter) | session (Fable) | error handling | 90,380 | 7 | 0.6 | 1 nit | marginal — duplicate of code-reviewer's leading-slash finding |
| general-purpose (pr-test-analyzer) | session (Fable) | test gaps | 93,683 | 8 | 0.7 | 2 findings | earned — named the exact test file + rows |
| general-purpose (code-simplifier) | session (Fable) | simplification | 91,806 | 6 | 1.0 | 3 findings | marginal — polish only |
| clodex sol (code-reviewer-gpt) | GPT | mirror | n/a | n/a | ~6 | 0 findings | marginal — missed everything the Claude run found |
| clodex sol (comment-analyzer-gpt) | GPT | mirror | n/a | n/a | ~5 | 3 findings | marginal — exact overlap, cross-backend agreement only |

## Totals
Subagents: 471,253 tokens, 35 tool uses, ~4.3 agent-minutes (Claude) + two GPT workers.
Fable context: not captured at start or at writing (no status-line read this session).

## Loop signal
No build loop — single fan-out, staged 3+2 under the rate-limit guard. No reworks.

## Spec misses
- ~90k tokens per agent on a 50-line diff: the floor is the agent definition + shared rules + diff, not the work. A diff this small could run code-reviewer + comment-analyzer only, or on a cheaper model.
- The PR branch gained a commit between the first fetch and the staged diff; pin the reviewed SHA in the staging step.
