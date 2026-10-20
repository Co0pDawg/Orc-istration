# 2026-10-06 petsoft unit-test coverage round 6 (story 17817) + bug dupe-check

Rework rows give the resume delta. Figures come from the task notifications in session c24f041c. All refuters ran on sonnet.

| # | Agent | Model | Purpose | Tokens | Result | Value |
|---|---|---|---|---|---|---|
| 0 | builder | sonnet | dupe-check 14 new bugs | 91.7k | 1 clear match (linked Related), 4 borderline | earned |
| 1 | builder | opus | 17818 report/dashboard hooks | 130.9k | 1 virtual, 2 hooks, report mirror | earned |
| 2 | refuter | sonnet | 17818 | 83.1k | ACCEPT; mirror equivalent to the proc | earned |
| 3 | builder | opus | 17825 SignUp + onboarding | 171.2k (+3.7k) | 39->57 / 35->90%; ResendVerification 500 -> 17731 | earned |
| 4 | refuter | sonnet | 17825 | 79.9k | REWORK: pinned 500, network socket test | earned |
| 5 | builder | opus | 17819 reports | 169.2k (+2.8k) | Reports 18->42%; P1 17837 | earned: critical |
| 6 | refuter | sonnet | 17819 | 91.1k | REWORK: mixed POST case | earned |
| 7 | builder | opus | 17823 Customers Invoices gaps | 276.5k | 35->91%; Post 500 -> 17751 | earned |
| 8 | refuter | sonnet | 17823 | 89.9k | ACCEPT | earned |
| 9 | builder | opus | 17822 Customers Reservations gaps | 328.9k (+31.3k) | 59->93% | earned |
| 10 | refuter | sonnet | 17822 | 97.4k | REWORK: tenant guard, supervisor gate, deposit redirects | earned |
| 11 | builder | opus | 17821 Tag report + TOS | 125.5k | 0->100% | earned |
| 12 | refuter | sonnet | 17821 | 88.8k | ACCEPT | earned |
| 13 | builder | opus | 17820 Dashboard | 200.1k (+4.2k) | 98-100%, cross-org check-in/out | earned: critical |
| 14 | refuter | sonnet | 17820 | 125.3k | REWORK: CheckOut success reachable | earned |
| 15 | builder | opus | 17824 Parents Reservations gaps | 196.1k (+33.8k) | 55->77% | earned |
| 16 | refuter | sonnet | 17824 | 109.3k | REWORK: 8 cheap branches | earned |
| 17 | builder | opus | 17826 Base + Home controllers | 169.1k (+13.7k) | session cookie / expiry -> 17660; 17841 | earned: critical |
| 18 | refuter | sonnet | 17826 | 103.8k | REWORK: ViewBag block reachable | earned |
| 19 | general-purpose x3 | session | /pre-pr-review comment + test + code reviewer | 283.3k | PASS; found 17589 closed early | earned: critical |
| 20 | builder | sonnet | check 60 17589 ignores vs develop | 94.4k | 0/60 pass -> umbrella 17843 | earned: critical |
| 21 | builder | sonnet | round-6 review fixes | 78.4k | refusal predicate, JSON leak check | earned |

## Totals
22 rows (about 31 dispatches with resumes). Roughly 3.9M subagent tokens net of resume double-counting: builders ~2.5M, refuters ~0.87M, review ~0.28M, checks ~0.19M. Fable context was not recorded. A rate-limit pause (resets 3:30 PM) stopped one builder mid-rework; its edits survived and it resumed cleanly.

## Loop signal
- Pre-PR review tier: **light + test analyzer + code-reviewer** (Cooper's choice for one approved `virtual`). The comment-analyzer ADO check found that 17589 had been closed as fixed while all 60 pinned instances still fail. That is worth keeping: ignored tests double as a regression check on bug closures.
- 7 of 9 refuters returned REWORK. "Not tested this round" and "needs setup" claims were reversed 4 times (17822, 17820, 17824, 17826). The Round-6 brief told builders to try first, but the habit persists.
- Merge conflicts: develop changes to NavMenuItemTests conflicted PR 6128 and PR 6124. Fixing the lowest branch and merging up the chain worked. Teammate PR 6136 (UITests map) was resolved with Cooper's OK.
- Bug filing followed the new dupe-check rule. Most findings went to existing bugs (17589/17843, 17650, 17660, 17731, 17751). Only 17837, 17841 and 17843 are new.

## Spec misses
- None in the round-6 brief. The 17589 closure was external, and only the ADO check in the review caught it. Consider adding "re-check cited bug states" to the builder brief.
