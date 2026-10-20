# 2026-09-24 — Petsoft — ADO helper (story 17457)

Research → spec → plan → subagent-driven build of `.claude/scripts/ado.ps1` and migration of 6 ADO skills onto it. Branch `feature/17457-ado-helper`, 12 local commits, not pushed.

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | researcher | sonnet | Inventory current az/ADO usage in skills + memory | 93,516 | 30 | 2.2 | 5 skills, 13 gotchas, no MCP | earned — shaped the design; but missed /customer-docs and reported the az extension missing (its shell only) |
| 2 | researcher | sonnet | External survey (MS azure-devops-mcp, community, Copilot/Boards) | 63,347 | 17 | 3.0 | 10 ideas + pitfalls | earned — settled "no MCP", supplied failed-step and context ideas |
| 3 | builder | opus | Tasks 1-4: ado.ps1 + self-check | 152,284 | 61 | 13.5 | DONE_WITH_CONCERNS | earned — live smoke caught 5 plan-code defects (byte[] unroll, param collisions, buildUri ignored) |
| 4 | refuter | opus | Review Tasks 1-4 | 112,008 | 10 | 3.8 | REWORK (2 MF + 7 SF) | earned — test-results silent truncation (3038 vs 1000), download host guard |
| 5 | builder (resumed #3) | opus | Fix round 1, Tasks 1-4 | 23,167 (delta) | 24 | 2.8 | DONE | earned |
| 6 | builder | opus | Tasks 6-8: migrate 5 skills | 209,293 | 92 | 10.0 | DONE | earned |
| 7 | refuter | opus | Review Tasks 6-8 | 172,971 | 17 | 4.6 | REWORK (1 MF) | earned — PAT-scope gate break in /playwright-pipeline-debug |
| 8 | builder (resumed #6) | opus | Fix round 1 + customer-docs + pipeline doc | 37,339 (delta) | 37 | 3.7 | DONE | earned |
| 9 | refuter | opus | Final whole-branch review | 151,204 | 30 | 6.6 | REWORK (1 MF + live-write gap) | earned — sprint query silently capped 50 of 85 |
| 10 | builder (resumed #6) | opus | Final-review fix wave | 12,238 (delta) | 16 | 1.9 | PARTIAL (declined CLAUDE.md edit on agent instruction) | earned |
| — | fable | opus | Spec, plan, ticket 17457 + checklist, live writes (comment-edit, scratch Task 17458), settings/CLAUDE.md, inline re-reviews of both fix rounds | — | — | — | — | — |

## Totals
- Subagent tokens: ~1,027k across 10 dispatches (2 sonnet, 8 opus incl. 3 resumes).
- Fable context: not captured at task start or end (no status-line read taken) — gap to fix next record.
- Wall clock: ~52 min of subagent time; two sittings across 2026-09-24/25.

## Loop signal
- Each of the three reviews found a real must-fix; zero false positives. Two of three were the same class (silent truncation: test-results $top, WIQL $top) — the spec's "never silent" rule should have had a test per paging verb.
- Plan code was wrong in 5 places only a live call could show; -WhatIf tests are request-shape checks, not transport checks. Live smoke in the builder's Step 5 paid for itself.
- Inline scoped re-reviews by Fable (both fix rounds) instead of dispatching re-reviewers: diffs were <60 lines each, saved two opus dispatches.

## Spec misses
- Inventory missed a sixth ADO consumer (/customer-docs) and a doc recipe; found by Fable's own grep before merge.
- Spec's test/runs "buildUri + window" was wrong (API ignores buildUri with a window).
- Spec assumed a PR-list access gate was harmless; it broke the PAT-only path for the pipeline-debug skill.
