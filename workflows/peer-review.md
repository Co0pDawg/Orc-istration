# Peer review

Review someone else's PR with effort scaled to its size and risk, fix what the review finds on a `review/<id>-fix` branch, and hand back a drafted summary comment. Not for the developer's own branch; that is the review panel (`review/PROCEDURE.md`). The rulebook's orchestration rules (marching orders, build loop, rate-limit guard, test runs, cost log) apply throughout; this workflow adds the tiering. Settings, tracker calls and files follow `workflows/README.md`; it needs a tracker helper.

**Arguments:** `<PR id or URL> [--tier S|M|L|XL] [--lite|--full]`.

## Tiers

| Tier | Score | Review | Fix |
|---|---|---|---|
| **S** | up to 100 | One `builder` reviews against `review/lanes/code-reviewer.md`, then fixes and builds | the same agent |
| **M** | up to 400 | The review panel (`<source> <target>`), normal lane selection | one `builder`, filtered tests |
| **L** | up to 1500 | The review panel, every selected agent staged 3+3; one `refuter` verifies the issue and warning findings before they count | `builder` and `refuter` loop |
| **XL** | over 1500 | L, plus the `arch` lane forced, plus a live-app run of the PR's How to test in its own worktree (`Run the app`; with `none`, skip it and say so) | the L loop, plus a browser check of the fixed paths when the repo has UI tests (follow its test docs) |

**Score** = product lines + a quarter of test and doc lines (that quarter capped at 1000). `peer-review-score.sh` computes it.

**Risk bump:** each `risk:` line from the script raises the tier one step (XL stays XL). So does a change in any other extra-scrutiny area the repo's rulebook or review rules name; when they name tenant scoping, that includes any changed query that loads or changes tenant data by an id from the route, query string or form, so check the diff for it. `--tier` overrides both.

**Lite mode** (`workflows/README.md`): L and XL run as M, and the review panel gets the `lite` token. A diff in an extra-scrutiny area keeps its tier.

## Steps

1. **Intake.** `TRACKER pr-get -Pr <id> -IncludeWorkItems` and `TRACKER pr-comments -Pr <id>`. Keep the PR description, the linked items' acceptance criteria (`TRACKER wi-get`) and the existing threads as the review's intent. Never re-raise a point a thread already settled.
2. **Worktree.**
   1. `git fetch origin <source> <target>`.
   2. In a sibling folder of the main checkout: `git worktree add ../<repo>-pr<id> -b review/<id>-fix origin/<source>`.
   3. Try `git merge --no-commit --no-ff origin/<target>`. On conflicts, resolve them and commit the merge first; on a clean merge, `git merge --abort`.
3. **Score.** From the main checkout (worktrees share refs, and the author's branch may predate any repo-local copy): `bash <checkout>/workflows/peer-review-score.sh origin/<target> origin/<source> '<regex>'`, where `<regex>` is the `Sensitive paths:` line of the repo's review rules (omit it when there is none). On Windows run it in Git Bash; from PowerShell, `bash` may resolve to WSL and fail. Apply the risk bump, then state the tier and reason in one line, e.g. `Tier L: score 521, no risk hits`.
4. **Review** at that tier. Every dispatch gets the PR intent from step 1.
5. **Fix** every confirmed issue and warning, each with the test that proves it. Suggestions and nits follow the rulebook's nit rule. A finding that changes behavior the author chose deliberately is not fixed: it becomes a question in the comment.
6. **Verify.**
   1. `Build`.
   2. Each touched `Test, full` project once, at the end, in the background.
   3. Check the test logs' timestamps against the last code edit.
7. **Commit** on `review/<id>-fix`, referencing the PR's ticket, then **ask once** before pushing to `<source>`: it is the author's branch. Capture metrics first when the tool supports it (`metrics capture --workflow peer-review`); at M and above it links the review panel's report as a child run.
8. **Draft the comment** in the scratch folder: one summary of what was fixed (with commit shas), the open questions, and what was not verified.
   - Every question for the author goes to the developer first; only the ones they approve reach the comment.
   - Write in a neutral review voice ("This change...", "Consider..."), never as if the developer were speaking.
   - Post only after the developer approves the text: `TRACKER pr-comment-add -Pr <id> -BodyFile <file>`.
9. **Record.** The review run log (the panel writes it at M and above; write it yourself at S, `review/calibration.md`), and the cost-log record with `score=`, `tier=` and the risk hits, so the cut points can be retuned.

## Common mistakes

- Scoring against a stale local ref. Always fetch first and score `origin/...`.
- Treating a test-only PR like product code. The quarter weight and the cap exist so 20k lines of new tests land in L, not XL.
- Running the full panel on S "to be safe". The tier is the budget. A finding that warrants more escalates one tier, and you say so.
- Pushing or posting without asking. Both reach a teammate.
