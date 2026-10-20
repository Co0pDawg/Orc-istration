# 2026-09-14 — Petsoft — bug backlog closure sweep

Task: check 63 open Bug work items against origin/develop; flag those already fixed.

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | researcher | sonnet | auth/signup/layout: 8 bugs | 85,111 | 64 | 6.9 | 2 FIXED, 2 PARTIAL, 4 NOT | earned — two closures |
| 2 | researcher | sonnet | permissions/nav/settings: 9 bugs | 139,741 | 69 | 6.7 | 0 FIXED, 2 PARTIAL, 6 NOT, 1 UNVERIFIED | earned — needed to rule out; 15437 too vague to check |
| 3 | researcher | sonnet | reservations/booking: 9 bugs | 156,130 | 83 | 9.0 | 3 FIXED, 1 PARTIAL, 5 NOT | earned |
| 4 | researcher | sonnet | invoices/payments/coupons: 8 bugs | 155,496 | 81 | 10.3 | 3 FIXED, 2 PARTIAL, 3 NOT | earned |
| 5 | researcher | sonnet | misc/logging/security: 6 bugs | 104,918 | 40 | 4.0 | 0 FIXED, 6 NOT | earned — all confirmed still open |
| 6 | researcher | sonnet | Dev-Complete w/o PR: 3 bugs | 108,250 | 52 | 6.8 | 3 FIXED via later refactors | earned — corrected ADO state |

Totals: 6 dispatches, ~750k tokens, 389 tool uses, ~44 min wall (parallel ≈ 10 min). Fable: ADO fetch, bug read (48KB), git-log id grep, PR-link check, 11 spot checks.

Loop signal: none — single fan-out, no rework. Spot checks confirmed all 11 FIXED claims.

Spec misses: 15437 hint pointed at wrong surfaces (bug text is one line, no page named); 12465/13999 verdicts are "fixed by design change" and needed Fable to re-read the ticket intent — say "report FIXED-BY-CHANGE separately" in future orders.

## Phase 2 (user: "verify and update all Petsoft related ones")

Fable inline, no agents: main-vs-develop containment for 10 fixing commits, 3 extra static checks (13311/14303 on main, 12465 manual-invoice proc price expression), one test comment on 17283, then 46 `az boards work-item update` calls (14 Closed + comment, 32 comment-only). One transient CLI JSON error on 15434; retry succeeded. Under 15 tool calls — dispatching would have been waste.
