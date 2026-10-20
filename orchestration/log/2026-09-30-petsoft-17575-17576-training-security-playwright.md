# Tasks 17575 (training delete) + 17576 (session expiry / antiforgery) Playwright

- Date: 2026-09-30
- Project: Petsoft
- Outcome: draft PRs 6075 (17575) and 6074 (17576). Bugs filed: 17596 (P1, client-controlled X-Forwarded-For drives IP blocks) and 17611 (P2, class delete with sessions fails; an existing test was a vacuous pass).

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | builder | opus | 17576 antiforgery/expiry tests | 194,974 | 63 | 15 | 5 tests | earned (found Bug 17596) |
| 2 | builder | opus | 17575 training delete tests | 200,261 | 71 | 43 | 2 tests, partial | earned (Bug 17611 plus a vacuous existing test) |
| 3 | refuter | opus | refute 17576 | 116,144 | 19 | 7.5 | REWORK | earned (uncited 17596 dependency would have broken silently after the fix) |
| 4 | builder (resumed) | opus | 17576 rework | ~17k delta | 24 | 8.6 | done | earned |
| 5 | refuter | opus | refute 17575 | 123,155 | 33 | 9.3 | REWORK | earned (wrong false-pass cause; roster assert proved the cancel, not the delete) |
| 6 | builder (resumed) | opus | 17575 rework | ~9k delta | 16 | 15 | done | earned |
| 7-10 | general-purpose x4 | session | /pre-pr-review 17576 | ~369k | 30 | ~2 each | approved, 2 comment fixes | marginal |
| 11-14 | general-purpose x4 | session | /pre-pr-review 17575 | ~380k | 32 | ~1.5 each | approved, 3 small fixes | marginal |

**Totals:** about 1.4M subagent tokens across 14 dispatches. Fable context: unmeasured.

**Loop signal:** both refuters returned REWORK and both were right. /pre-pr-review on refuted test-only diffs again found only comment and locator polish (third round running). Recommend: for test-only PRs a refuter has accepted, run code-reviewer + playwright-reviewer only.

**Spec misses:**
1. Machine load on the shared local DB caused SQL timeouts and 36 s logins, which failed several runs in Arrange. Two builders plus a refuter, each running an app against one Petsoft_DEV, is too many. Stagger live runs, or give each its own DB copy.
2. The first Bug 17611 description repeated the builder's wrong cause (confirm dismissed) before the refuter corrected it. Fable should verify the root-cause wording before filing, not just the defect.
