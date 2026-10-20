# 2026-09-24 — Petsoft — 17329 plan 10: pet-parent trial lifecycle Playwright

| # | Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|-------|-------|---------|--------|-----------|-----|--------|-------|
| 1 | builder | opus | 6-task spec: 3 page objects, keystone params, new suite, docs; run, 3 mutations, db checks | 244k | 85 | 30 | 4/4 green; found 3 spec facts wrong on the live app (prepayment, Invoiced, pet→Active) | earned |
| 2 | refuter | opus | first launch | — | — | — | died on session rate limit (429), no output | waste |
| 3 | code-reviewer | fable | first launch | — | — | — | died on 429 | waste |
| 4 | playwright-reviewer | fable | first launch | — | — | — | died on 429 | waste |
| 5 | refuter | opus | relaunch: rerun ×2 + no-card mutation | 125k | 27 | 9 | REWORK: missing runsettings, raw asserts on UI cells | earned — runsettings gap also covered plans 7-9 |
| 6 | code-reviewer | opus | pre-PR | 106k | 10 | 1.5 | approved, no findings | marginal |
| 7 | playwright-reviewer | opus | pre-PR | 105k | 10 | 1.5 | approved; 1 suggestion, 1 nit (both fixed) | marginal |
| 8 | comment-analyzer | opus | pre-PR | 131k | 35 | 4 | approved; 2 suggestions, 1 nit (all fixed) | marginal |
| 9 | code-simplifier | opus | pre-PR | 98k | 6 | 0.7 | approved, no findings | marginal |
| 10 | builder (resumed) | opus | 8-item rework + rerun + mutation | 15k (delta) | 11 | 5.6 | 4/4 green, mutation red | earned |

Totals: ~824k agent tokens (excluding the three 429'd launches), ~184 tool uses, ~52 agent-minutes. Fable/Opus orchestrator context: ~235k at task start, ~260k at writing (session switched Fable → Opus 5.5 mid-task via /model).
Orchestrator inline: fact-finding (~20 calls), spec, worktree, the cross-PR map/keystone merge hygiene (Cooper's "keep the map synced" request): pairwise + sequence merge simulation of all five open branches, runsettings added to plans 7-9, row placement moves on plans 7 and 8, one revert on plan 8, and a shared `ProvisionBookingParentAsync` signature written byte-identical into plans 8 and 10.

Loop signal: one REWORK (convention gap, not logic). The 429 cost three launches and a wait; the relaunch ran refuter + 2 reviewers at once (3 in flight) — within the guard, but right at the limit that just failed.

Spec misses (mine):
- Assumed a no-deposit portal trial would reach a no-card Complete button; the app requires single-day trials prepaid. Check deposit/prepayment rules (BookReservationModel) before speccing a portal booking.
- Assumed Checked-Out on Departed; a fully prepaid stay posts to Invoiced at checkout.
- Assumed the trial review changes the reservation; it changes the pet.
- Did not list the per-suite runsettings file as a deliverable (the map's "Wiring a new suite" step 3) — missed on plans 7-10.
- Did not include the cross-PR merge check in the plan: every new plan now runs the pairwise merge simulation before its PR is created.
