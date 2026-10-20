# 2026-09-21 — Petsoft — /pre-pr-review PR 5962 (#17287 Twilio close on deactivation)

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| general-purpose (code-reviewer) | session (Fable) | correctness/security | 103,931 | 8 | 0.9 | 3 findings, 0 issue | marginal — missed the two issues sfh found; clean tenant/predicate confirmation was useful |
| general-purpose (silent-failure-hunter) | session | error handling | 109,393 | 7 | 1.5 | 7 findings, 2 issue | earned — both issues confirmed by Fable reading the code |
| general-purpose (type-design-analyzer) | session | type design | 85,782 | 7 | 0.8 | 1 nit | marginal — 86k tokens for a duplicate nit |
| general-purpose (comment-analyzer) | session | comments/docs/annotation | 124,572 | 14 | 1.6 | 5 findings, 1 issue | earned — contract-comment issue + stale mapped doc |
| general-purpose (pr-test-analyzer) | session | test coverage | 102,719 | 8 | 2.8 | 9 findings, 5 warning | earned — vacuous-test finding confirmed |
| general-purpose (code-simplifier) | session | simplification | 100,909 | 8 | 0.9 | 6 findings | marginal — one real dedupe suggestion |
| clodex sol (code-reviewer-gpt) | GPT high | mirror | n/a | n/a | ~6 | 3 findings, 2 issue | earned — ACTIVE-without-number issue was unique and confirmed |
| clodex sol (silent-failure-hunter-gpt) | GPT high | mirror | n/a | n/a | ~5 | 2 findings | marginal — both duplicated Claude |

## Totals
Subagent tokens: 627,306 (Claude agents; GPT not metered). Dispatches: 8. Fable context at start / at writing: not captured (no status line reading taken).

## Loop signal
Single pass, no rework. Agents read their own definitions + a shared ctx.md instead of Fable reading seven definitions — kept orchestrator context small.

## Spec misses
- Skill is pinned to session model, so six reviewers ran on Fable at ~100k each; type-design-analyzer on a 120-line static-method addition was predictable low yield.
- Did not capture context size at start.
- Unexpected working-tree edits appeared during the run (5 unrelated files); source not identified.

## Fix loop (same session)

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| builder | opus | implement spec A-G in worktree pr5962 | 177,319 | 56 | 13.3 | all items done, build clean, 69/69 filtered, 2 mutation checks | earned |
| refuter | opus | static refute vs spec | 120,646 | 13 | 2.6 | REWORK, 2 narrow must-fixes (stale public XMLDoc, untested log guard) | earned — both real |
| builder (resumed) | opus | rework, edits only | 7,407 delta | 6 | 1.1 | 3 edits | earned |

Totals (fix loop): 305,372 subagent tokens, 3 dispatches, 1 REWORK round. Fable ran the full test project once (2914 pass / 0 fail, 10m42s) during the refuter's static pass, then build + filtered 70/70 after rework.
Loop signal: one round; refuter ran static-only because the full run held the worktree — serialising worked.
Spec misses: spec D/A did not tell the builder to update the PUBLIC method's XMLDoc when splitting the overload (cost the REWORK round). Main checkout was switched to another branch by a parallel session mid-task — should have started in a dedicated worktree.
