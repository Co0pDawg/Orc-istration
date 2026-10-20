# 2026-10-01 petsoft: 17581 trial expiry + 17582 maintenance windows Playwright (PRs 6101, 6102)

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result |
|---|---|---|---|---|---|---|---|
| 1 | builder | opus | 17581 first pass | 130,314 | 21 | 3.9 | earned: stopped with a clean BLOCKED and three options instead of guessing; surfaced bug 17669 |
| 2 | builder (resumed) | opus | 17581 option C: proc + suite | 242,422* | 82 | 21.7 | earned: 2 green + 2 mutation reds; caught that staff never reach Access Denied |
| 3 | builder | opus | 17582 first pass | 251,252 | 59 | 16.7 | marginal: blocked on the CLICKED_DATE schema drift; code reused |
| 4 | builder (resumed) | opus | 17582 after KmsDbTool on Petsoft_MW | 281,050* | 30 | 14.7 | earned: caught its own async-predicate wait bug through a mutation |
| 5 | refuter | sonnet | 17581 | 104,381 | 13 | 3.2 | earned: ACCEPT; the role-default should-fix was applied |
| 6 | refuter | sonnet | 17582 | 98,968 | 12 | 1.4 | earned: ACCEPT; verified every pipeline Ignore filter |
| 7 | code-reviewer | opus (inherit) | 17581 full tier | 102,588 | 11 | 2.0 | marginal: 0 findings |
| 8 | playwright-reviewer | opus (inherit) | 17581 full tier | 80,998 | 6 | 0.8 | marginal: 0 findings |
| 9 | code-simplifier | opus (inherit) | 17581 full tier | 86,878 | 8 | 0.9 | marginal: 2 nits, not actioned |
| 10 | comment-analyzer | opus (inherit) | 17581 full tier | 106,596 | 13 | 1.2 | marginal: 0 findings |
| 11 | comment-analyzer | opus (inherit) | 17582 light tier | 120,702 | 19 | 1.7 | earned: 2 real doc-wording fixes |

\* Figures 2 and 4 are as reported by the resume notification. They may be cumulative rather than a delta.

## Totals

- 11 dispatches, about 1.61M tokens (up to ~1.23M if 2 and 4 are cumulative), 274 tool uses, about 68 agent-minutes.
- Fable context: about 230k at task start (post-compaction), about 330k at writing.

## Loop signal

- **17581, full tier** (QA proc SQL change): 4 reviewers produced 0 issues/warnings, 2 nits. A refuter that read every proc caller plus the job code already covered what code-reviewer checked. For QA-only proc changes, the light tier plus a code-reviewer-briefed refuter would likely suffice.
- **17582, light tier:** comment-analyzer found 2 real doc inaccuracies; nothing escalated.
- Sonnet refuters after builders over 300k tokens: both were thorough and cheap (~100k).

## Spec misses

- The 17581 spec assumed staff reach Access Denied. The live login proc refuses them earlier. Read the sign-in path before writing an expected outcome for a lapsed org.
- The 17582 spec did not anticipate local DB schema drift (CLICKED_DATE). A DB-copy spec should say: upgrade the copy with KmsDbTool from the worktree's build, or ask first.
- I filed 17669 from a code read with too wide a scope and corrected it within the hour. Reading the sign-in proc before filing would have avoided that.
