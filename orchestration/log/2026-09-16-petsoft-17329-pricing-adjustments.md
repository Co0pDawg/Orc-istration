# 2026-09-16 Petsoft — 17329 plan 4: Pricing adjustments (PricingAdjustmentTests)

| # | Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | researcher | sonnet | verify every expected amount in 17072-17076 against the adjustment engine | 105,896 | 20 | 2 | all confirmed with citations; flagged confirm strings as unverified | earned — the plan's numbers were right first time because of this |
| 2 | scout | haiku | adjustment editor + Price Check + tag markup ids | 64,702 | 48 | 5 | ids mostly right; missed per-pet rate level in summary (was in the file) | earned |
| 3 | builder | opus | Tasks 1-9 (page objects, 6 tests, docs) | 367,550 | 147 | 96 | 18/18 twice; 8 selector deviations; 2 product findings | earned — the product findings alone justify it |
| 3b-3e | builder (resumed ×4) | opus | REWORK (paging + consts + dead API), paging proof runs, 7 review fixes | ~45,000 | 79 | 66 | paging proven with logs at 53 services | earned; the drifted-org run (3 fails) was a wasted 6 min |
| 4 | refuter | opus | static + amounts + durability + reruns + mutation | 178,530 | 30 | 10 | REWORK (paging durability, raw selectors) → ACCEPT | earned — the durability catch would have broken the nightly within a week |
| 5-8 | pre-PR agents (2 opus, 2 sonnet) | mixed | 4 reviewers | 435,779 | 53 | 7 | 9 findings, 7 fixed, 2 wont-fix | earned |

Fable inline: plan (~650 lines) + self-review fixes, worktree, UAT run 18/18, PR description, two Bug work items (17370, 17371), commit/push/draft PR.

**Totals:** 8 dispatches (+4 resumes), ~1.2M agent tokens, 377 tool uses, ~186 agent-min. Wall ≈ 4 h, the largest plan so far.

**Loop signal:** builder → refuter REWORK → builder (+3 proof runs) → refuter ACCEPT → review → builder fixes. One rework round, but the paging proof cost three extra builder resumes; next time state the durability proof requirement in the original spec (seeded-fixture suites must prove the cached org survives N runs).

**Spec misses (Fable's):**
- Did not anticipate the 50-row list paging against a suite that seeds ~7 permanent services per run. Rule: any suite that seeds into a cached org needs a "what happens after 10 runs" paragraph in the plan.
- Passed selector strings from tests into the page object via AdjustmentSpec; that is "selectors in tests" by another name. Constants on the page object from the start.
- Two placeholder lines and a page-object assertion slipped into the first draft; caught in self-review, but the self-review should run before the file is written, not after.
- Assumed the Price Checker could enter any time; its store-hours rescue (bug 17370) made two manual steps unreachable. A researcher question "can the Price Checker enter a time outside opening hours" would have caught it.
