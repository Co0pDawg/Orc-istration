# 2026-10-06 petsoft: Tier 2 Playwright gaps (story 17827; PRs 6136, 6137, 6138, 6140, 6141, 6143, 6144, 6145, 6147)

| # | Agent | Model | Purpose | Tokens | Result |
|---|---|---|---|---|---|
| 1 | scout | haiku | Tier 2 coverage check | 66,556 | earned: cut 13 targets to 9 tasks |
| 2 | builder | opus | 17828 per-pet TOS | 145,181 | earned |
| 3 | refuter | sonnet | 17828 | 79,408 | earned: ACCEPT |
| 4 | comment-analyzer | opus | 17828 | 77,973 | marginal: 0 |
| 5 | builder (+rework) | opus | 17829 reactivation | 156,438 + 163,180* | earned: found the reactivation overcharge (17594) |
| 6 | refuter | sonnet | 17829 | 79,496 | earned: REWORK (actionability guard) |
| 7 | comment-analyzer | opus | 17829 | 85,483 | marginal: 0 |
| 8 | builder | opus | 17830 reports | 214,584* | earned: found 17839 (no-auth Metrics) and 17840 |
| 9 | refuter | sonnet | 17830 | 85,702 | earned: ACCEPT + 2 cheap fixes |
| 10 | comment-analyzer | opus | 17830 | 72,954 | marginal: 3 nits |
| 11 | builder | opus | 17832 deletion/history | 97,123 | earned |
| 12 | comment-analyzer | opus | 17832 | 74,779 | earned: 1 wording fix |
| 13 | builder | opus | 17833 training | 121,980 | earned |
| 14 | comment-analyzer | opus | 17833 | 81,578 | marginal: 1 nit |
| 15 | builder (+resume) | opus | 17834 itinerary | 103,206* | earned; cut off by rate limit once |
| 16 | builder (+resume) | opus | 17835 weight gate | 184,392* | earned; cut off by rate limit once |
| 17 | builder | opus | 17836 cards | 125,383 | earned |
| 18 | builder (+resume) | opus | 17831 campaigns | 149,118 + 155,465* | earned: found bug 17844 |

\* resume notifications; may be cumulative.

## Totals

- 18 dispatches, about 2.4M tokens (lower bound about 2.0M if the resumes are cumulative).
- Fable ran KmsDbTool on Petsoft_DEV three times (new permission rule); that cleared every schema-drift block within minutes.

## Loop signal

- Light tier. comment-analyzer runs found 1 real wording fix in 5 runs. After the rate limit I skipped them for small diffs and read the docs myself, with no loss.
- Sonnet refuters were cheap (~80k) and caught one real REWORK.
- CI caught a Metrics render test that passed locally but failed on the seeded container DB (PR 6141, build 20696). Lesson: render-only tests of cross-org admin reports are fragile; skip them.
- An API rate limit (HTTP 429) killed two Opus builders mid-run. Several Opus agents had run back to back all day. Keep at most 2 builders in flight, and use Sonnet for refuters.

## Spec misses

- The gaps doc was stale again (History un-ignored months ago; ManagePromoCode never had a test). The scout check up front paid off.
- Builders twice reported a DB-drift block; upgrading Petsoft_DEV before each dispatch would have prevented both.

## Bugs filed or extended

- New: 17839, 17840, 17844.
- Extended umbrella: 17594 (reactivation overcharge).
- Noted: 17669 reproduced live.
