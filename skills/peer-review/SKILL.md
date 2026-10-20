---
name: peer-review
description: Use when asked to review (and fix) a teammate's Azure DevOps pull request in Petsoft, given a PR id or URL, or when the user invokes /peer-review. Not for the user's own branch; that is /pre-pr-review.
argument-hint: "<PR id | URL> [--tier S|M|L|XL]"
---

# Peer Review

Review someone else's PR with effort scaled to its size and risk, fix what the review finds on a `review/<id>-fix` branch, and hand back a drafted summary comment. The orchestration rules in `~/.claude/CLAUDE.md` (marching orders, build loop, rate-limit guard, test runs, cost log) apply throughout; this skill only adds the tiering.

## Tiers

| Tier | Score | Review | Fix |
|---|---|---|---|
| **S** | ≤100 | One Opus `builder`: reviews against `docs/internal/agents/code-reviewer.md`, then fixes and builds | same agent |
| **M** | ≤400 | `/pre-pr-review <source> <target>`, normal agent selection | one `builder`, filtered tests |
| **L** | ≤1500 | `/pre-pr-review`, every selected agent staged 3+3; one `refuter` verifies the issue/warning findings before they count | `builder` → `refuter` loop |
| **XL** | >1500 | L, plus `arch` forced, plus a live-app run of the PR's How-to-Test in its own worktree | L loop, plus a Playwright check of the fixed paths |

**Score** = product lines + ¼ of test and doc lines (capped at 1000). `score.sh` computes it.

**Risk bump:** any `risk:` line from `score.sh` raises the tier by one step (XL stays XL). So does any changed query that loads or mutates tenant data by an id from the route, query or form; check for that in the diff.

`--tier` overrides both.

## Steps

1. **Intake.** Run `& ./.claude/scripts/ado.ps1 pr-get -Pr <id> -IncludeWorkItems` and `pr-comments -Pr <id>`. Keep the PR description, the linked tickets' acceptance criteria, and the existing threads as the review's intent. Never re-raise a point a thread already settled.
2. **Worktree.**
   1. Run `git fetch origin <source> <target>`.
   2. Create the worktree: `git worktree add C:/Development/Petsoft-pr<id> -b review/<id>-fix origin/<source>`.
   3. Try `git merge --no-commit --no-ff origin/<target>`. On conflicts, resolve them and commit the merge first. On a clean merge, `git merge --abort`.
3. **Score.** Run `bash ~/.claude/skills/peer-review/score.sh origin/<target> origin/<source>` from the worktree. Apply the risk bump, then state the tier and the reason in one line, e.g. `Tier L: score 521, no risk hits`.
4. **Review** at that tier. Every dispatch gets the PR intent from step 1.
5. **Fix** every confirmed issue and warning, each with the test that proves it. Suggestions and nits follow the CLAUDE.md nit rule. A finding that changes behaviour the author chose deliberately is not fixed. It becomes a question in the comment.
6. **Verify.**
   1. `dotnet build` the solution.
   2. Run each touched test project once, at the end, in the background.
   3. Check the test-log timestamps against the last code edit.
7. **Commit** on `review/<id>-fix`, referencing the PR's ticket, then **ask once** before pushing to `<source>`. It is the author's branch.
8. **Draft the comment** in the scratchpad: one summary covering what was fixed (with SHAs), the open questions, and what was not verified. Post it only after the user approves it: use the `ado.ps1` PR-comment verb if the header lists one (PR 6192 adds it); otherwise give the user the text to paste.
9. **Record.**
   - Calibration log (`/pre-pr-review` writes it at M+; write it yourself at S).
   - One line in the memory `project_pr_review_records_index.md` plus a per-PR record.
   - The cost-log record, including `score=`, `tier=` and the risk hits, so the cut points can be retuned.

## Common mistakes

- Scoring against a stale local ref. Always `fetch` first and score `origin/...`.
- Treating a test-only PR like product code. The ¼ weight and the cap exist so that 20k lines of coverage tests land in L, not XL.
- Running the full panel on S "to be safe". The tier is the budget. A finding that warrants more escalates one tier, and you say so.
- Pushing or posting without asking. Both reach a teammate.
