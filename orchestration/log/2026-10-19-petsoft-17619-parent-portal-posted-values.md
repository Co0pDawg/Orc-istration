# Bug 17619 - Parent Portal trusts posted card, coupon pack, pet and total values (/start)

Dates: 2026-10-16 to 2026-10-19. Branch feature/17619-parent-portal-trusts-posted-card-token, draft PR 6236 -> develop.

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | Explore | inherit | Coupon/card/totals save path | 92k | 24 | 5 | Line-level facts + test asserts | earned - spec built from it directly |
| 2 | Explore | inherit | BoardingEdit, Availability, New, Onboarding | 99k | 38 | 5 | Found CustomerScopeExtensions helpers | earned |
| 3 | Explore | inherit | MobileApi coupon packs | 79k | 20 | 3.5 | Shared fix point in Parents code | earned |
| 4 | builder | opus | Groups 1-3, 17 un-ignores, 3 new tests | 304k | 104 | 71 | 3 commits, mutation-checked | earned |
| 5 | refuter | sonnet | Static refute (builder >300k rule) | 140k | 26 | 5.5 | ACCEPT + 3 real gaps | earned - found BoardingEdit re-render, packages 400, stale card |
| 6 | builder (resume) | opus | Rework round 1 | 0 (429) | 0 | 0 | Rate-limited before any edit | waste - Fable did it inline (74b6039b6) |
| 7-12 | pre-pr-review x6 | inherit | Full tier, staged 3+3 | 754k (139/138/138/96/114/128) | 122 | 5-6.5 each | 0/3/7/3; 10 fixed | earned (sfh, tests, arch, simplifier); marginal (code-reviewer 1 nit, comments 0) |
| 13 | builder (resume) | opus | Review-fix batch, 9 items | 58k delta (362k cum.) | 21 | 12 | 1966cc300, mutation-checked | earned |
| 14 | builder | opus | Live-app check | 153k | 73 | 17 | BLOCKED: Petsoft_DEV missing Persistence.PERSISTENT | marginal - found env blocker, verified nothing |

## Totals
Subagents ~1.68M tokens. Fable context: start and end sizes not captured (session restarted twice across 3 days). Full test runs: 3 (one stopped as stale, two green).

## Loop signal
Pre-PR review tier: full (product code, payment path). Review caught real items the refuter missed: shop checkout re-render 500, two untested guards (Availability org check, check ordering). CI not yet run.

## Spec misses
- Spec did not name the Shop controller re-render path (refuter and builder missed it; silent-failure-hunter caught it).
- Live check assumed a working local login; next spec should first check `COL_LENGTH` for recent develop columns (Persistence.PERSISTENT) per the existing memory note.
- /start skill changed mid-run (P1 Bugs -> main); branch had already been cut from develop; user kept develop.
