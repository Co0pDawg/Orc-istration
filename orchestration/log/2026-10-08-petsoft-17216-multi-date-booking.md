# 2026-10-08/09 Petsoft 17216 multi-date New Reservation page (Tasks 17867, 17873, 17874, 17875)

| Agent | Model | Purpose | Tokens | Tools | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| researcher | sonnet | Map Book page (scoping) | 107,853 | 36 | 2.8 | Found #17215 already fixed default service | earned |
| Explore x2 | inherit | Client + server maps for plan | 201,748 | 27 | 2.0 | Plan inputs (GetDisabledDatesModel reuse) | earned |
| builder | opus | Build 17867 + 5 redesign/feature rounds (modal, Edit Selected, menu 17873, adjacent days 17874, add-on picker) | ~780,000 (cumulative, resumed) | ~260 | ~220 | 11 commits; stalled overnight on 17875 folder run | earned (rounds) / waste (overnight stall) |
| refuter | sonnet | Round-1 refute | 121,865 | 16 | 8.3 | ACCEPT, 2 should-fixes | earned |
| pre-pr-review r1 x7 | inherit | Full tier | ~690,000 | ~100 | ~6 | 5 warnings real | earned |
| researcher | sonnet | Price estimate reuse | 102,416 | 24 | 1.5 | Feasible; user dropped price | marginal |
| pre-pr-review r2 x7 | inherit | Full tier, whole branch | ~830,000 | ~130 | ~6 | 2 real issues (service-change reset, capacity departure day) | earned |
| debugger | opus | UITests 503 | 98,360 | 25 | 17.5 | PETSOFT_PROFILE unset -> devatlps101 | earned (but avoidable) |
| builder | opus | Round-2 fixes | 279,334 | 18 | 25 | 07d08705e, daycare 25/25 | earned |
| refuter | sonnet | Round-2 refute | 146,582 | 25 | 4.2 | 1 stale JSDoc | earned |

Totals: ~3.3M subagent tokens across ~30 dispatches. Fable context: start ~25k; at writing ~115k of window used (est.).
Loop signal: full tier both rounds (product code). Round 2 caught a real data-integrity issue (Edit Selected/service change reset dates/runs/per-pet add-ons) introduced by later redesigns that round 1 never saw — re-review after scope growth was worth it.
Spec misses: (1) builder briefs omitted PETSOFT_PROFILE=local; after an overnight shell death, ~30 min of runs hit devatlps101. (2) No keep-awake for an unattended long run; machine slept mid-run. (3) Round-1 spec carried the panel template behaviour that later redesigns removed — churn from design changes, not spec error.

## 2026-10-09 continuation
| Agent | Model | Purpose | Tokens | Tools | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| audit x3 | inherit | Whole-page client/server/money audit | ~627,000 | 133 | ~10 | 3 high security + money findings; real-invoice parity confirmed | earned |
| builder (server, own worktree) | opus | Security fixes 17843/17586/17877 | 275,338 | 87 | 23 | 3 commits cherry-picked | earned |
| builder (client) | opus | Audit client round + list/layout requests | 409,683 | 180 | 154 | 5 commits | earned |
| builder | opus | Demo feedback (pet add-ons, AM/PM, columns, tracker) | ~327,000 | 136 | ~130 | 2 commits; broke live page once by editing views under running app | earned / waste (live-edit outage) |
| pre-pr-review r3 x7 | inherit | Full tier on 716a1127d..HEAD | ~950,000 | ~190 | ~6 | antiforgery-302 hang (real), 2 scoping gaps | earned |
| builder | opus | Round-3 fixes | 280,599 | 134 | 84 | 3 commits | earned |
| debugger | opus | Boarding custom-rate $40 vs $55 | 102,441 | 24 | 3 | Test-data root cause (contains-match helper), no bisect needed | earned |

Spec misses: (4) told a builder to edit views while the app ran -> runtime Razor compile broke the live page during demo prep (memory saved). (5) Server builder's filtered test run missed GetStoreHoursForDateTests (5 failures caught by Fable's full run).
Outcome: DRAFT PR 6177 -> develop, 6 work items linked, release-note gate [].
