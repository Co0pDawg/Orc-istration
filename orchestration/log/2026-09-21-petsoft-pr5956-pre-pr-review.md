# 2026-09-21 — Petsoft — PR 5956 pre-pr-review (+ fixes)

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Verdict |
|---|---|---|---|---|---|---|---|
| refuter (as code-reviewer) | opus | static review of 4-file marketing diff | 90.7k | 8 | 1.2 | 2 findings, both real | earned — caught FAQ/JSON-LD mismatch, cleared the global-CSS-scope worry |
| researcher (as code-simplifier) | sonnet | simplification pass | 48.3k | 4 | 0.5 | 1 suggestion, declined | marginal — 66-line diff, nothing to cut |
| clodex sol (code-reviewer-gpt) | GPT | mirror | n/a | n/a | ~3 | 1 finding, duplicate of Claude's | marginal — agreement only, but raised severity correctly |
| clodex sol (code-simplifier-gpt) | GPT | mirror | n/a | n/a | ~2 | 1 suggestion, declined | waste — against file idiom |

## Totals
Subagents: ~139k Claude tokens + 2 GPT worker runs. Fable context: not captured (no status line read). Fixes applied inline by Fable (2 edits).

## Loop signal
No build loop. One review round, fixes inline (under five tool calls).

## Spec misses
- Reviewer's `contain: inline-size` recommendation was wrong: layout containment is what stops overflow propagating to ancestors. Fable reworded the comment only. Reviewers should not propose CSS property swaps unverified in a browser.
- For a views-only diff this small, the simplifier pair is not worth dispatching.
