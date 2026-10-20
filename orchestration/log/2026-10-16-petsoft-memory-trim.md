# 2026-10-16 Petsoft: memory trim

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| researcher | sonnet | Classify 147 project_* memories ARCHIVE/KEEP/CONDENSE against PR status | 105,382 | 15 | 8.4 | 45/66/36 table with gotcha quotes | earned: Fable avoided reading 147 files; some quotes truncated, re-grepped |

**Totals:** 1 dispatch, 105k subagent tokens. Fable did PR-status fetch (ado.ps1 pr-get loop), condensing into 4 topical files, the move.

**Loop signal:** n/a (no code, no review).

**Spec misses:** brief didn't ask for untruncated gotcha lines; cost one extra grep pass.

## Follow-on: story 17963 (repo integration)

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| researcher | sonnet | Map 44 gotchas to repo targets, check EXISTS/STALE | 68,489 | 10 | 3.3 | 23 ADD / 14 EXISTS / 6 PERSONAL / 1 STALE | earned: saved 14 duplicate adds |
| builder | sonnet | Write 23 one-liners + AGENTS.md rule, verify each claim | 132,687 | 26 | 5.7 | 14 files +33; dropped 6 unconfirmed claims | earned |
| comment-analyzer | sonnet | /pre-pr-review comments tier on docs diff | 108,850 | 15 | 2.8 | 2 warnings + 1 nit confirmed, 1 FP | earned: caught 2 wrong lines builder wrote |

**Loop signal:** light tier (comments only) without a refuter: docs-only diff; Fable read the full diff. The comment agent still found 2 factual errors, so docs-only lesson PRs need a claim-checking reviewer, not just a read.

**Spec misses:** builder brief said "verify each claim" but two lines paraphrased the memory source wrongly (filter vs service; "never mutate"); brief should require citing the file:line each line rests on.
