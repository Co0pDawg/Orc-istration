# Release 115 cut

- Date: 2026-09-28
- Project: Petsoft
- Branch: release/iteration_115 (911943698, 8646fea4e)
- Task: #17497 Cut Release 115 - 115.sql from prod backup, release PRs 6038 (-> develop) and 6039 (develop -> main)
- Outcome: shipped as drafts. 115.sql applied, residual clean, re-run idempotent; unit tests green; QBO tier-row fix live-verified flag off/on; KennelManagementSystem.Tests 3271 passed.

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | refuter | opus | Review 18 procs/views in 115.sql vs origin/main + callers | 148,900 | 21 | 6.7 | ACCEPT; 1 RISK (report param rename vs deploy window), 3 FYI | earned - RISK drove the maintenanceMinutes deploy note; 3,800 lines Fable did not read |
| 2 | builder | opus | Hide QBO tier-list row when flag off | ~113,000 | 21 | 5.0 | BLOCKED: 3rd caller + hardcoded Pricing row | earned - found ReactivationController caller and the Pricing hardcode the spec missed |
| 3 | builder (resume) | opus | Rework: Reactivation + Pricing view | ~12,000 | 9 | 4.2 | DONE, build 0 errors, 73 filtered pass, mutation-checked | earned |

## Totals

~274k subagent tokens, ~16 min wall clock across dispatches. Fable inline: restore, p_DevSetup, script runs, 115.sql guard edits + idempotency re-run, release-pr skill (125 ids validated), ticket/PR writes, diff read, full test run, live app check.
Fable context: unmeasured -> unmeasured (not read from status line this session).

## Loop signal

- No refuter on the builder diff: small (104/23 lines), Fable read the full diff, ran the full test project once and a live flag-off/on check instead.
- Builder surfaced 2 spec defects (below); one REWORK round, then DONE.
- Refuter #1: 0 must-fixes; RISK confirmed by Fable against ado-petsoft-webapp-deploy.yml (maintenanceMinutes default 0).

## Spec misses

- Builder spec listed callers from a grep of `new SubscriptionTierViewModel|SubscriptionTierListViewModel(` but missed the target-typed `new(dbContext)` in ReactivationController - grep for the type name in declarations too, not just `new TypeName(`.
- Spec assumed Pricing rendered the view-model feature list; it hardcodes the row. Check the consuming views before scoping "views must not change".

## Follow-up: PR 6039 CI red (same night)

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 4 | debugger | opus | ServiceCalendar find-timeslot modal stays open | 149,125 | 58 | 20.9 | Reproduced; test bug already fixed on develop (a923792c6) | earned - saved a builder dispatch; proved #17462 innocent |
| 5 | debugger | opus | 2-3 min app stall at ~T0+30 min | 301,005 | 118 | 56.4 | Timing pinned to T0+30:30 tick; not reproduced; logging gap found | marginal - no root cause, but the tick-timing proof and logging gap shaped Bug 17529 |

Spec misses: the stall brief assumed an idle-app repro could trigger it; the CI data created by specific suites (ParentPromoCodes/Onboarding/Employees) is the likely trigger, so a repro needed those suites running, not a poller. Brief should have named "replay the suite order" as the repro path.
