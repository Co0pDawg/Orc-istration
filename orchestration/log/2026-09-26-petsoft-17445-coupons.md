# 2026-09-25/26 — Petsoft — 17445 round 2 plan 5 (coupons, products, promo codes, Task 17450)

| # | Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|-------|-------|---------|--------|-----------|-----|--------|-------|
| 1 | builder | opus | 9 cases, 7 tests, 4 suites | 302k | 113 | 48 | 3 same-day runs per class, 7/7 mutations, suites green | earned |
| 2 | playwright-reviewer | opus | review | 114k | 20 | 2.5 | 5 warnings (locators, rule id, fixed date) | earned |
| 3 | code-reviewer | opus | review | 153k | 48 | 8.7 | fixed-date capacity + data growth | earned |
| 4 | comment-analyzer | opus | review | 129k | 31 | 4.4 | doc drift | marginal |
| 5 | code-simplifier | opus | review | 118k | 14 | 1.8 | CreateAsync merge etc. | marginal |
| 6 | refuter | opus | adversarial + 2 mutations | 142k | 40 | 7.4 | REWORK (XMLDoc); confirmed Register bypass -> Bug 17476 | earned |
| 7 | builder (resumed, stalled once) | opus | fix batch | +18k | ~6 | ~40 | 10/11 items; 5/5 accessor mutations | earned |

Totals: ~980k agent tokens. Orchestrator context ~235k at start, ~290k at writing. Orchestrator inline: two UAT runs, Bug 17476, develop merge, a four-way merge test that caught a semantic clash (duplicate ProductPage.DepartmentSelect with PR 6029; 6029's duplicate of develop's new IndexReservationStatus) — fixed in both branches by declaring the shared locator identically in the same place; PR 6034.

Loop signal: textual merge checks miss semantic clashes (duplicate member names). The four-way check must BUILD the merged tree — it did, and that is what caught it. Two parallel branches that both need the same new locator should declare it byte-identically at the same line.

Spec misses (mine): didn't warn that PR 6029 adds `DepartmentSelect` to ProductPage; a list of the members each open PR adds (not just the lines it touches) would have prevented it.
