# 2026-09-18 — Petsoft — PR 5953 pre-pr-review (skill 2.3.2)

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| pr-review-toolkit:silent-failure-hunter | session | error-handling review | 123,850 | 11 | 1.1 | 1 warning, 2 suggestion, 1 nit | earned — nonexistent-id silent short result |
| pr-review-toolkit:pr-test-analyzer | session | test coverage | 96,754 | 7 | 0.9 | 2 warning, 2 suggestion | earned — no-data short-circuit means RDLCs never load |
| general-purpose (playwright-reviewer) | session | UITest quality | 104,576 | 13 | 1.3 | 1 issue (refuted), 2 warning, 3 minor | marginal — headline issue rested on a premise it flagged as unchecked; one grep refuted it |
| pr-review-toolkit:comment-analyzer | session | comments/docs/annotation | 154,664 | 16 | 2.0 | 1 issue, 1 warning, 5 minor | earned |
| pr-review-toolkit:code-simplifier | session | simplification | 124,901 | 13 | 2.2 | 5 suggestions | earned |
| pr-review-toolkit:code-reviewer | session | correctness/security | 155,983 | 17 | 3.5 | 1 suggestion, 2 nit; tenant scoping + insert-exec verified | earned — verification value, few findings |
| clodex sol (code-reviewer-gpt) | GPT high | mirror | n/a | n/a | ~5 | 2 warnings, both verified | earned — both unique, RDLC width overflow confirmed by XML sum |
| clodex sol (silent-failure-hunter-gpt) | GPT high | mirror | n/a | n/a | ~4 | 1 pre-existing suggestion | marginal |

## Totals
Subagent tokens: 760,728 across 6 Claude agents (77 tool uses), plus 2 GPT workers on clodex quota. Fable context: not captured at start or at writing.

## Loop signal
No build loop — review only. One orchestrator verification pass (3 tool calls) refuted an `issue:` and confirmed two GPT warnings.

## Spec misses
- playwright-reviewer brief did not say "open the Error view before claiming an error page passes"; the agent listed it under Not verified yet still rated the finding 95.
- Agent definitions and diff were staged as scratch files read by each agent rather than inlined — kept orchestrator context small; six agents each re-read a 100 KB diff.

# Part 2 — verify and fix (same day)

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| builder | opus | fixes A–H from review (SQL guards, CCR tidy, RDLC width/title, comments, test dedupe) | 190,437 | 70 | 13.2 | done; build green, 13/13 | earned |
| refuter | opus | adversarial review of the fixes | 119,427 | 18 | 4.6 | REWORK — GUID column leaked into xlsx export | earned — caught a regression my own spec (fix D) introduced |
| builder (resumed) | opus | revert fix D, restore output assert | 23,382 (delta) | 43 | 4.2 | done, verified inline by Fable | earned |
| builder | opus | live verification: DB copy, before/after EXEC, deploy, render, Playwright run, seeded test | 252,664 | 149 | 63.3 | all phases pass; found PR's tests used a report name that does not exist ("&" vs "And"); found Emails Sent cached-org failure | earned — the "&" defect and the first-ever renders were only findable live |

## Totals
Part 2 subagent tokens: 585,910 (280 tool uses, ~85 min). Day total 1,346,638. Fable context: not captured.

## Loop signal
One REWORK round, caused by the orchestrator's spec, not the builder: fix D (group on id) was specced without checking what else consumes the proc result set. The refuter's "does the export enumerate columns" check was in its orders and paid off.

## Spec misses
- Fix D should have been preceded by one grep for other consumers of the DataTable (the xlsx export). Cost: ~140k tokens of build + revert.
- Live builder's explanation for "no cents shift" (old proc already decimal(19,2)) contradicts develop's source (bare decimal); likelier cause is whole-dollar prepayments in the sampled month. Fable checked source, did not re-run. The cents fix itself remains unexercised by data.

# Part 3 — 2026-09-21: Hunter's wrapper design (base procs untouched, per-facility wrapper)

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| builder | opus | restore 3 base procs to develop, 2 wrapper procs, ReportFactory, docs; deploy to Petsoft_DEVELOP; acceptance vs saved before-CSVs; Reports PW suite | 146,016 | 53 | 18.9 | done; acceptance (i)-(v) all pass, 16/16 PW | earned — reusing part 2's before-CSVs made acceptance nearly free |
| refuter | opus | staging-table fidelity, exit paths, RDLC field match, doc truth | n/a (not in notification) | n/a | n/a | ACCEPT, 0 must-fix | earned |

## Loop signal
Zero REWORK rounds. Fable fixed two false annotation sentences inline (Payroll guard claim; insert-exec causality) before the refuter ran.

## Spec misses
- Spec said "guard preamble same as No-Shows" and the builder generalised that into a doc claim covering Payroll; the Known section should have stated Payroll's guard is the old shape.

# Part 4 — 2026-09-21: pre-pr-review of the wrapper sub-branch + fixes

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| refuter (part 3) | opus | wrapper staging fidelity | 105,293 | 19 | 4.6 | ACCEPT | earned |
| code-reviewer | session | correctness/security | 121,269 | 15 | 3.2 | 1 nit; verified temp-table collisions, tenant scoping | marginal — verification only |
| silent-failure-hunter | session | error handling | 111,587 | 10 | 1.0 | 2 suggestion, 1 nit | earned — the mid-loop partial-result trace |
| comment-analyzer | session | comments/annotation | 128,406 | 19 | 1.8 | 2 issue, 1 warning | earned — caught a false T-SQL claim that originated in Fable's own spec |
| pr-test-analyzer | session | coverage | 88,438 | 7 | 1.2 | 1 warning, 3 suggestion | earned — its W1 led to Bug 17395 |
| code-simplifier | session | simplification | 106,530 | 7 | 1.3 | 1 suggestion, premise wrong | waste — asserted a NOT NULL column without reading the table |
| playwright-reviewer | sonnet | 5-line comment change | 99,570 | 8 | 0.5 | no findings | marginal — selection rule fired on a comment-only diff; sonnet override kept it cheap |
| 2 GPT mirrors | GPT high | code-reviewer, silent-failure-hunter | n/a | n/a | ~6 | 0 findings each | marginal |
| builder | opus | fixes A–I + seeded revenue test + redeploy + acceptance + PW run | 175,830 | 81 | 23.4 | partial: test blocked by product defect (no ledger accounts on added facilities) | earned — found Bug 17395 |

## Totals
Part 4 subagent tokens: 936,923 (excl. GPT). Fable context: not captured.

## Loop signal
No REWORK round. Fable made the final edits inline (removed xact_abort after the builder's own probe showed it inert; added bug refs) and skipped a second refuter for a 22-line comment/doc diff.

## Spec misses
- Spec trap "T-SQL forbids re-DECLARE in a loop" was false (copied from the PR description) and became a false code comment; comment-analyzer caught it.
- Fable's own inline edit used [IO.File] with a relative path after `cd` — .NET resolves against the process cwd, so two empty files landed in the main checkout (removed). Same root cause left a BOM-only change on main's ReportsTests.cs from the 09-18 builder (reverted). Use absolute paths with [IO.File], always.
