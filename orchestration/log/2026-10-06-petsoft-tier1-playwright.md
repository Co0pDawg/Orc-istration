# 2026-10-06 petsoft: Tier 1 Playwright gaps (story 17756; PRs 6130, 6131, 6132)

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result |
|---|---|---|---|---|---|---|---|
| 1 | builder | opus | 17758 agreements/TOS | 102,110 | 32 | 14.8 | earned: found the suite already covered most of it; added the one missing case |
| 2 | builder | opus | 17757 office cards | 129,491 | 39 | 18.5 | earned: 3 tests, DB-verified |
| 3 | comment-analyzer | opus | 17758 light review | 67,246 | 4 | 0.4 | marginal: 0 findings |
| 4 | refuter | opus | 17757 | 83,899 | 12 | 1.9 | earned: caught a stale green (restore came after the run) |
| 5 | builder | opus | 17759 admin, first pass | 109,821 | 25 | 6.9 | marginal: blocked on IS_INBOUND schema drift |
| 6 | comment-analyzer | opus | 17757 light review | 76,208 | 4 | 0.4 | marginal: 1 placement fix |
| 7 | builder (resumed) | opus | 17759 finish | 138,321* | 34 | 11.1 | earned: found 3 of 7 targets don't exist; fixed the stale doc rows |
| 8 | comment-analyzer | opus | 17759 light review | 76,629 | 4 | 0.5 | marginal: 0 findings |

\* resume notification; may be cumulative.

## Totals

- 8 dispatches, about 0.78M tokens, about 55 agent-minutes.
- Fable refuted 17758 and 17759 inline (small diffs) instead of dispatching refuters.

## Loop signal

- Light tier throughout. The three comment-analyzer runs found 1 trivial issue in total. On diffs under ~100 lines, Fable's own diff read plus the refuter covered it.
- The gaps doc was badly stale. Three of the four Tier 1 rows were largely or wholly covered already, and 3 Admin targets did not exist. The first step should be a coverage check (grep UITests for each target) before filing tasks.

## Spec misses

- I filed 4 tasks from a stale doc without grepping UITests first. 17760 needed no work.
- Schema drift struck twice in one day (COMPANY_NAME, then IS_INBOUND). With Cooper's new KmsDbTool permission rule, Fable now upgrades Petsoft_DEV before dispatching builders.
