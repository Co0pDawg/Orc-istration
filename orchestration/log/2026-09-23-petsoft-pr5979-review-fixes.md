# 2026-09-23 — Petsoft — PR 5979 pre-PR review + fixes

Date: 2026-09-23
Project: Petsoft
Branch: task/PET-17394_HidePhoneNumbersPermission (Jackson's PR 5979 → develop)
Task: /pre-pr-review 2.3.2 on PR 5979, then verify and fix all findings (#17394, parent story #17383)
Outcome: shipped — pushed b019bd323. Solution build 0 warnings. Full KMS.Tests 2919 / Core.Test 884 / KmsDbTool.Tests 47 pass (before the rebase onto Jackson's develop merge; after it: build + targeted 58+26 pass). 5 new Playwright tests 5/5 on 3 runs, on an isolated DB copy. 24/25 findings confirmed and fixed, 1 false positive.

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | code-reviewer (general-purpose) | Opus 5.5 | pre-PR review | 158,370 | 30 | 3.2 | 8 findings | earned — only agent to find the Price Checker bypass and the unmasked Pending/Tag surfaces |
| 2 | silent-failure-hunter (general-purpose) | Opus 5.5 | pre-PR review | 120,706 | 14 | 1.7 | 4 findings | earned — empty-after-strip returns the full list; re-render drops the typed number |
| 3 | comment-analyzer (general-purpose) | Opus 5.5 | pre-PR review | 138,031 | 34 | 3.1 | 6 findings | earned — the Account Owner rationale was backwards; the Identifiers drift |
| 4 | type-design-analyzer (general-purpose) | Opus 5.5 | pre-PR review | 112,004 | 14 | 2.0 | 2 findings | earned — quantified the reachable Required bypass (33 real rows) |
| 5 | pr-test-analyzer (general-purpose) | Opus 5.5 | pre-PR review | 112,116 | 17 | 2.1 | 5 findings | earned — Playwright gap with named sibling tests; the wildcard bypass |
| 6 | code-simplifier (general-purpose) | Opus 5.5 | pre-PR review | 95,905 | 9 | 1.2 | 6 findings | earned — proved the Hide→View rename UPDATE was dead with git log -S |
| 7 | code-reviewer-gpt | gpt-5.6-sol | GPT mirror | n/a | n/a | ~12 | 6 findings | earned — distinct: session-cached permissions (How to Test step 6 false), missing antiforgery. 1 false positive (MobileApi) |
| 8 | silent-failure-hunter-gpt | gpt-5.6-sol | GPT mirror | n/a | n/a | ~8 | 2 findings | marginal — both duplicated Claude findings |
| 9 | builder | Opus 5.5 | fix 22 findings from spec | 268,283 | 114 | 20.3 | DONE, 81+26 pass, 2 mutations | earned — also surfaced the legacy-number edge itself |
| 10 | builder (resume) | Opus 5.5 | unparseable legacy number must not be rewritten | 14,754 | ~12 | 6.2 | DONE, found 1,080 real rows; round-trip rule stricter than "fails to parse" | earned |
| 11 | refuter | Opus 5.5 | refute the fix diff | 155,284 | 28 | 9.0 | REWORK (1 must-fix: posted phone type dropped on legacy rows) + 4 should-fix | earned — the must-fix was caused by Fable's rework wording (see Spec misses) |
| 12 | builder (resume) | Opus 5.5 | rework: type write + CustomersContactId scoping + XMLDoc + Review help text | 16,824 | ~11 | 15.5 | DONE, 84 pass, 3 mutations | earned |
| 13 | fable | Opus 5.5 | inline refute of the rework delta (builder was near 300k) | — | 3 | 3 | ACCEPT | earned |
| 14 | builder (Playwright) | Opus 5.5 | 5 PW tests; Petsoft_17394 copy; :7399 | 191,828 | 58 | 16.3 | 5/5 x2, mutation red | earned |
| 15 | builder (Playwright resume) | Opus 5.5 | rerun after Fable added id="customer-phone" | ~175 | 9 | 4.3 | 5/5 | earned |

**Totals:** Claude subagents about 1,384k tokens across 13 Claude dispatches, about 88 min of agent wall clock; plus 2 GPT mirrors (unmetered here). Fable context: unmeasured by /context. Session token budget went from 15.00M left at the request to 14.92M left at the time of writing (about 85k of Fable usage for this task).

**Loop signal:**
- The builder raised 1 spec gap itself: legacy stored numbers that fail a parse/store round trip.
- The refuter returned 1 must-fix, which was confirmed and fixed. It was introduced by Fable's rework instruction.
- There were 4 should-fixes; 3 were folded in, and the Price Checker unit test was skipped as low risk.
- 1 REWORK round.
- The pre-PR review agents caught every requirement-level defect before the loop started. After the loop, no defect was found that the loop missed.

**Spec misses:**
1. Rework wording contradicted the spec. "Leave that stored row exactly as is" conflicted with spec item 4 ("keep the posted type"), and it cost a refuter REWORK round. Lesson: a rework message that restates a rule must be checked against the spec items it touches.
2. The spec never anticipated legacy data. Unparseable stored numbers (1,080 rows) were raised by the builder, not the data-precondition line, because the line asked for "no primary"/"primary+alternate" shapes but not "malformed value" shapes. Lesson: add "malformed stored values" to the data-precondition prompts for any field that is parsed on save.
3. Fable committed without fetching first. The PR branch had gained an 84-commit develop merge, so the push was rejected and the branch needed a rebase and re-verification. Lesson: fetch the PR branch right before committing onto a teammate's branch.
4. Tooling: a Fable sed deleted one comment line too many in CustomerLayout.cs. It was caught by reading the output; the Edit tool would have avoided it.
