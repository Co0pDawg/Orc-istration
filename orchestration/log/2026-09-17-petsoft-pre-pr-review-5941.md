# 2026-09-17 — Petsoft — pre-pr-review PR 5941 (#17290 branding tier gate)

Task: run `/pre-pr-review` (skill 2.3.2, read from `origin/skills/pre-pr-review-2.3.2`) on Christopher's PR 5941, `claude/branding-professional-tier` → `develop`. Read-only review, no fixes applied.

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| code-reviewer | opus | correctness/security/schema co-change | 141,762 | 28 | 7.0 | needs changes — 1 warning, 1 nit | earned — only agent to find the `--seed`/fresh-DB backfill gap and its Playwright fallout |
| code-reviewer-gpt | sol (GPT, high) | mirror | n/a | n/a | ~9 | 1 warning | earned — independently found the searchable-items gap *and* named the concrete consequence (search hides the card as "no results") the Claude run rated only a nit |
| silent-failure-hunter | opus | error handling | 123,618 | 14 | 4.3 | approved — 1 suggestion | marginal — one latent finding; its "checked and clear" list was the useful half |
| silent-failure-hunter-gpt | sol (GPT, high) | mirror | n/a | n/a | ~5 | approved — 0 findings | waste — no findings, no cross-check value |
| type-design-analyzer | opus | type design | 110,607 | 13 | 3.9 | approved — 1 suggestion, 2 nits | earned — third independent hit on GetSearchableItems, plus the `protected set` nit |
| comment-analyzer | opus | comment/doc accuracy | 127,484 | 21 | 3.5 | needs changes — 1 issue, 1 warning | earned — the run's only `issue:` (six-vs-nine gates) and the doc gap |
| pr-test-analyzer | opus | test coverage | 113,329 | 15 | 2.4 | needs changes — 4 warnings, 1 suggestion | earned — the whole test-gap half of the report; caught that OrgProvisioner always provisions Professional |
| code-simplifier | opus | over-engineering | 102,589 | 10 | 3.8 | approved — 1 suggestion, 3 nits | earned — the ViewData→list-model suggestion converged with two other agents |

## Totals

- 6 Claude (opus) + 2 GPT mirrors; 719,389 subagent tokens across the Claude agents, 101 tool uses, ~25 agent-minutes wall clock (staged 3+3 per the rate-limit guard, so ~18 min elapsed).
- Fable context: task start ~60k; at writing ~150k. Orchestrator spend is a small fraction of subagent spend — the report and log were written from the eight hand-backs alone, no diff read by Fable.
- Output: 18 findings (1 issue / 7 warning / 4 suggestion / 6 nit), verdict **needs changes**, calibration log `docs/internal/agents/calibration/log/2026-09-17-claude-branding-professional-tier.md`.

## Loop signal

- Staging 3+3 cost nothing: the second wave finished before the first wave's slowest agent (code-reviewer, 7 min). Keep staging.
- The GPT mirror earned its keep exactly once out of two. The code-reviewer mirror was worth it — it escalated a finding the Claude side under-rated. The silent-failure-hunter mirror returned nothing. Next time mirror `code-reviewer` only unless the diff is error-handling heavy.
- GPT mirror output arrives as a bare text file, not JSONL — parse with `Get-Content`, not a `{"type":"result"}` grep. The JSONL-extraction step in the skill's Step 3 did not match this worker's output shape.
- Bash mangles `origin/<branch>:<path>` in `git show` (backslash-strips it); PowerShell handles it. Same known trap, hit again at the very first call.
- Four agents converged on `ManageModel.GetSearchableItems()` at three different severities. Cross-agent convergence was the best severity signal in this run — worth weighting explicitly when merging.

## Spec misses

- The dispatch briefs did not name a data precondition (which orgs/tiers actually carry BRANDING_ENABLED in a local DB). code-reviewer found the `--seed` gap anyway, by following the tagging precedent. A "check what a fresh DB has" line would have made that finding structural rather than lucky.
- No brief told the agents the PR is Christopher's, not Fable's. Harmless here, but a reviewer brief should say whose work it is so "fix it" never reads as authorized.
