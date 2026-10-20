# 2026-09-18 — Petsoft — PR 5941 review fixes (#17290 branding tier gate)

Task: verify the 18 findings from the 2026-09-17 pre-PR review of Christopher's PR 5941 and address them. Fable verified the findings itself before speccing (four file reads), then dispatched. Companion record: `2026-09-17-petsoft-pre-pr-review-5941.md`.

| Agent | Model | Purpose | Tokens | Tool uses | Minutes | Result | Value |
|---|---|---|---|---|---|---|---|
| builder (app) | opus | app code, views, schema proc, docs, unit tests | 129,278 | 28 | 9.3 | DONE, no deviations; build clean, 97/97 filtered, self-mutation-checked | earned |
| builder (UITests) | opus | tier knob in OrgProvisioner + below-tier Playwright suite | 141,916 | 52 | 7.8 | DONE; UITests build clean; confirmed from SQL that the provisioning endpoint accepts Starter | earned |
| refuter | opus | adversarial review of the combined diff | 134,003 | 35 | 8.3 | **ACCEPT**, 0 must-fixes, 4 noted-not-blocking | earned — its own mutation pass (gates + ctor flag) put exactly the 4 intended tests red |

## Totals

- 3 opus agents, 405,197 subagent tokens, 115 tool uses, ~25 agent-minutes; ~18 min wall clock (two builders in parallel, refuter after).
- Fable's own work: verified all 18 findings against the code before speccing (~8 tool calls), merged builder B's diff into builder A's worktree, ran the one full test project, read the final diff.
- Fable context: ~150k at task start, ~205k at writing.
- Result: 19 modified + 4 new files, +397/−194. Full project run **2738 passed / 0 failed / 6 skipped** in 9m24s. Everything left unstaged.

## Loop signal

- **Verifying the findings myself before speccing was the highest-value step in the task.** All 18 held up, and the verification turned up the fix shape: reading `PaymentDevicesListModel.SufficientTier` showed the house idiom, and reading `GetSearchableItems()` showed that skipping the row load *is* the search fix — one change closing three findings instead of three changes. A spec written straight off the review would have bolted an explicit section-skip onto the ViewData design and kept both problems' shapes.
- Two builders split by file ownership (app vs `UITests/`) had zero overlap again — third time. `git apply` of the smaller diff plus a copy of the two untracked files was clean.
- **Near-miss worth keeping:** I launched the full test project and the refuter into the same worktree in one message, then stopped the test run seconds later. Two vstest hosts in one worktree is my own recorded failure mode and I walked straight into it because the two calls looked independent. They are not — a refuter that runs tests owns the worktree until it reports. Sequence: refuter, then the full run.
- A builder that cannot use the requested branch name (already checked out elsewhere) branches rather than failing — fine, but it means the merge step is mandatory, not optional. Worth stating the target worktree in the orders when a second builder's work has to land on the first's branch.

## Spec misses

- The UITests spec did not say what to do when `git worktree add` refuses the branch. The builder improvised a `-ui` branch, correctly, and reported it — but that left a stray branch and worktree for me to clean up.
- Neither spec named the live-verification boundary crisply enough: both builders correctly declined a live run, but "written and compiles, never executed" is a state the PR has to declare, and I had to add that to the hand-off myself rather than getting it as a required output field.
- The doc nit about linking `BrandingFeature` went into the spec as part of a batch and was silently not done, because the reviewing agent had itself noted the bare name is house style. A finding that arrives already self-refuted should be dropped at triage, not passed to a builder.
