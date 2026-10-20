# Playwright coverage gap research (whole app)

- Date: 2026-09-29
- Project: Petsoft
- Task: find critical or important areas that lack Playwright coverage
- Outcome: ranked gap list delivered in chat. Fable's own spot checks found one researcher false positive (Dashboard ApproveReservation is covered via PendingApprovalPage) and surfaced a state-changing-GET bug class, verified for 3 actions.

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | researcher | sonnet | money workflows | 111,518 | 33 | 2.8 | 8 ranked gaps | earned (subscription billing actions; verified) |
| 2 | researcher | sonnet | reservations and ops | 107,539 | 24 | 2.7 | read only the map | waste (skipped controller enumeration; a map cannot show gaps by absence) |
| 3 | researcher | sonnet | security, admin, org | 148,299 | 37 | 6.6 | tenant-refusal gap + 10 more | earned for the tenant finding; the rest relied on the map |
| 4 | researcher | sonnet | reservations, controller-level redo | 75,019 | 10 | 1.8 | 138 actions, ~48 unverified | marginal (medication gap real; ApproveReservation claim false) |

**Totals:** about 442k subagent tokens across 4 dispatches. Fable context: unmeasured.

**Spec misses:**
1. Telling researchers to "read the map in full" first used up their budget, and two treated the map as the answer. For gap-finding, the spec should start from a code inventory (a script listing controller actions) and use the map only for lookups.
2. Grep-for-route evidence misses click-driven coverage, and that produced a false CRITICAL. Better evidence is runtime route hits: run the full UITests suite with Hosting.Diagnostics set to Information. That was proposed to Cooper, not run.
