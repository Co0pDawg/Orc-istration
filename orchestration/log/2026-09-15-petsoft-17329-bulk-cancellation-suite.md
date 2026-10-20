# 2026-09-15 Petsoft — 17329 plan 1: Bulk Cancellation Playwright suite

| # | Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | scout | haiku | locate bulk-cancel code + PW scaffolding | 65,568 | 57 | 3 | file map with ids | earned |
| 2 | researcher | sonnet | product rules with citations | 73,915 | 20 | 2 | eligibility/tiers/fallback cited; daycare-cutoff claim missed the org-rule gate | marginal — one wrong rule cost a REWORK round |
| 3 | researcher | sonnet | suite-authoring conventions | 95,003 | 16 | 1 | conventions cited | earned |
| 4 | builder | opus | Tasks 1-3 scaffolding | 111,519 | 19 | 6 | build + regression green | earned |
| 4b | builder (resumed) | opus | Tasks 4-11 | ~83,000 | 57 | 75 | 9/9 twice; found Payments-row spec flaw, stopped correctly | earned |
| 4c | builder (resumed) | opus | REWORK ×2 (daycare tier, dead locator, EditLinks) | ~14,000 | 10 | 4 | green | earned |
| 5 | refuter | opus | static + reruns + mutation | 130,900 | 21 | 13 | REWORK then ACCEPT; caught the daycare org-rule gate Fable had wrong | earned |
| 6-9 | pre-PR agents (2 opus, 2 sonnet) | mixed | code-reviewer, playwright-reviewer, code-simplifier, comment-analyzer | 402,101 | 53 | 9 | 13 findings, 6 fixed, 3 false-positive | earned |

Fable inline: plan (writing-plans, ~1,000 lines), worktree + app start, UAT runs (9/9 + 1/1), diff read, six review fixes, calibration log.

**Totals:** 9 dispatches (+2 resumes), ~976k agent tokens, 253 tool uses, ~113 agent-min; wall ≈ 3.5 h dominated by Playwright runtimes (13-14 min per full class run).

**Loop signal:** builder → refuter → REWORK (2 must-fixes) → ACCEPT. One round. Builder's mid-task stop on the Payments-row finding was the right call and cheaper than a refuter catching it later.

**Spec misses (Fable's):**
- Assumed one Payments row per reservation; a bulk deposit's row names every reservation (Payments/Index.cshtml:68-88). Should have read the row markup, which I had in context, more carefully.
- Trusted the researcher's daycare-cutoff rule without opening DepositCalculator.cs:94; the gate on the coupon org rule inverted the expected refund. Rule: any expected money value in a spec gets its own code line cited by Fable, not by a researcher.
- 1-night boarding at $40 with a $50 fixed deposit hits the invoice-total cap (DepositCalculator.cs:44); builder had to switch to 2 nights.
- Spa Bath spec needed RunSpec.Services; DaycareDefault's pattern was in context and I did not mirror it.
- Two "self-correcting" plan steps (PaymentRowVisible, DeviceRowName) slipped through the first self-review.
