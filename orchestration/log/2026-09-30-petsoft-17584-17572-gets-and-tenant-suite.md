# Bug 17584 (state-changing GETs) + Task 17572 (tenant boundary suite)

- Date: 2026-09-30
- Project: Petsoft
- Outcome: draft PRs 6069 (17584) and 6068 (17572). Filed bugs 17586 (more GET mutators), 17589 and 17590 (tenant leaks found by the suite), and 17591 (check-in/out and ResetMfa org checks).

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | researcher | sonnet | classify the 17584 candidates | 117,093 | 44 | 7.6 | 9 mutate / 6 safe + 12 extra | earned (scope split; ticket path error caught) |
| 2 | builder | opus | tenantboundary suite | 283,923 | 92 | 32 | 11 pass, 2 leaks | earned (2 real P1 leaks), but claimed green on code it had not run |
| 3 | refuter | opus | refute the suite | 137,157 | 33 | 8.1 | REWORK | earned (caught the stale green run and the empty-404 crash) |
| 4 | builder (resumed) | opus | suite rework | ~20k delta | 15 | 14 | 13 pass / 2 skip | earned |
| 5 | builder | opus | 17584 fix, 12 actions | 342,885 | 225 | 72 | done | earned (tenant check on Approve; live checks); >300k, so refuted inline |
| 6-11 | general-purpose x6 | session | /pre-pr-review 17584 | ~658k | 64 | ~2 each | 2 warnings, 12 more | earned (antiforgery-redirect silent success) |
| 12-15 | general-purpose x4 | session | /pre-pr-review 17572 | ~410k | 42 | ~1.5 each | approved, 4 suggestions | marginal (suggestions only; code-reviewer found bulk cancel's missing antiforgery outside the diff) |
| 16 | builder | opus | 17584 review fixes | 125,752 | 44 | 11 | done | earned |
| 17 | builder | opus | 17572 review fixes | 94,097 | 21 | 6 | done | marginal (polish) |

**Totals:** about 2.2M subagent tokens across 17 dispatches. Fable context: unmeasured (a continued session after compaction).

**Loop signal:**
- Refuter REWORK once on 17572. The builder's green claim predated its last edit. Fix: require log timestamps later than the last edit in every report (added to the rework orders; do this from the first spec).
- 17584 skipped the refuter because of the >300k rule. My inline diff read plus the six-agent review found one real warning.

**Spec misses:**
1. I told the 17584 builder to copy CheckInReservation's scoping, but that action has none. Fable should grep the model it cites before speccing (that became Bug 17591).
2. The 17572 spec expected 500 for foreign ids. The app serves its error page as 200, so the builder adapted correctly.
