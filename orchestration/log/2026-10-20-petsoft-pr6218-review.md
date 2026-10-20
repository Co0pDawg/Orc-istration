# 2026-10-20 Petsoft PR 6218 peer review (#17942, Ira Endres, hotfix → main)

score=458 tier=XL (size L + risk bump). risk hits: Admin HomeController, OrganizationSearchModel, OrganizationSearch.cshtml (Admin area, platform-wide id-driven POSTs). Product 370, tests 344, docs 10. Clean trial merge with main. The branch alone failed the NuGet audit because it lacked the #17928 bump; Jackson's a770354c5 merged main mid-review. The tip moved 980bc4272 → aedf326f2 (Jackson) during stage 1. GPT mirror declined.

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | silent-failure-hunter | opus (session) | panel | 104,593 | 17 | 5.5 | 1 warning, 2 suggestions | earned: SMS-flag-off message (fixed) |
| 2 | architecture-reviewer | opus (session) | panel (forced at XL) | 146,307 | 24 | 8.5 | 1 issue, 3 warnings, 1 question | earned: Safety rule 2 promo hole, facility cap (money path), ToS grace |
| 3 | code-reviewer | opus (session) | panel | 128,620 | 22 | 8.6 | 1 issue, 1 warning, 2 nits | earned: co-found the promo hole; answered the author's SQL-translation question |
| 4 | type-design-analyzer | opus (session) | panel | 97,621 | 11 | 3.7 | 4 nits | marginal: none actioned |
| 5 | comment-analyzer | opus (session) | panel | 126,937 | 20 | 5.9 | 2 warnings, 1 suggestion | earned: stale gotcha + coverage-gaps row + remark order |
| 6 | playwright-reviewer | opus (session) | panel | 91,234 | 12 | 3.6 | 1 warning, 1 suggestion | marginal: duplicated comment-analyzer's gotcha finding |
| 7 | code-simplifier | opus (session) | panel, stopped at launch | ~0 | 0 | 0 | killed | waste: launched as 4th Opus in flight; relaunched on Sonnet |
| 8 | code-simplifier | sonnet | panel | 85,151 | 5 | 1.3 | 3 suggestions, 3 nits (line refs unreliable) | marginal: none actioned |
| 9 | refuter | opus | verify findings | 143,141 | 35 | 10.3 | A1/A3/C2 confirmed, A2/S1 deliberate | earned: rejected Fable's proposed C2 predicate (would exempt every Free org); DB counts |
| 10 | builder | opus | fixes F1-F9 | 152,812 | 51 | 23.7 | done, 4 mutations red | earned |
| 11 | refuter | opus | refute fix diff | 169,596 | 43 | 20.0 | REWORK (2 must-fix) | earned: COST>0 guard untested; F1 made the Trial caveat lie for promo orgs |
| 12 | builder (resumed) | opus | rework 1 | 34,278 (delta) | 36 | ~14 | done, R1/R2 red | earned |
| 13 | refuter | opus | refute rework 1 | 129,993 | 25 | 10.8 | ACCEPT, 2 nits | earned |
| 14 | builder | opus | live How-to-Test + fix paths, own worktree, Petsoft_PR6200 | 165,022 | 77 | 47.0 | 11/11 PASS, UI 2/2, 2 observations | earned: found the thead filter clipped at 1280px (O2), which no static agent saw |
| 15 | builder (resumed) | opus | live re-check of the O2 fix | 14,017 (delta) | 16 | 4.9 | 5/5 PASS | earned |

Totals: 1,589,322 subagent tokens over 15 dispatches. Panel 780,463 = 49%; verify + fix loop 629,819; live 179,039. KennelManagementSystem.Tests ran twice, by Fable (6283 at 5:48-5:55 PM, then 6285 at 6:33-6:37 PM after rework, both after the last code edit). The O2 view fix (37c6c1d77) was verified live and by build only, with no unit-test rerun (view-only). Fable context: session counter 15.00M remaining at start → ~14.79M at writing (~210k used).
Loop signal: tier XL, full panel. Stage 1 (arch, code, errors) found every issue and money-path warning. Stage 2 (types, playwright, simplifier) produced only nits, plus one finding duplicated from comment-analyzer. The live check found a real layout defect (filter clipped at 1280px) that every static agent missed, so XL's live run earned its cost here. No later review/CI catch known yet.
Spec misses: (1) Fable's verify brief floated `approved || CalculateInitialAmountDue == 0`, which the refuter rejected (every Free org would become Active forever); state such candidates as "check this", never as a proposed fix. (2) The F1 spec missed that changing the restore status also changes which ActivationCaveat branch fires; a status-rule change should list the downstream readers of that status. (3) The rate-limit guard was briefly broken: 4 Opus agents were in flight until the simplifier was stopped. (4) Board timestamps were guessed ahead of the clock for the first hour; take every time from `date`.
Outcome: pushed 916f032f2 + 37c6c1d77 to hotfix/17942-admin-organization-search (fast-forward from aedf326f2); PR thread 42483 (7 questions for Ira). Calibration sweep trigger tripped (460 new verdicts); /calibration-report offered.
