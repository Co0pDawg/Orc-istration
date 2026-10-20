# 2026-10-05/06 petsoft unit-test coverage round 4 (story 17741)

Rework rows give the resume delta. Figures come from the task notifications in session c24f041c. All refuters ran on sonnet.

| # | Agent | Model | Purpose | Tokens | Result | Value |
|---|---|---|---|---|---|---|
| 1 | builder | opus | 17742 Customers Reservations | 232.9k (+18.6k) | 33->~57%; 17589 x3, new 17751 | earned |
| 2 | refuter | sonnet | 17742 | 98.4k | REWORK: mixed bulk cancel, ExtendClaim success, QuickBook branches | earned |
| 3 | builder | opus | 17743 Parents Reservations | 168.7k (+23.5k) | 21->61%; 17619, 17650 | earned |
| 4 | refuter | sonnet | 17743 | 107.6k | REWORK: booking success paths reachable; NRE = prod bug | earned |
| 5 | builder | opus | 17745 Customers Invoices | 174.9k (+22.1k) | 14->35%; 17589, 17586 | earned |
| 6 | refuter | sonnet | 17745 | 111.6k | REWORK: surviving mutant, unpinned bug, edit/new saves | earned |
| 7 | builder | opus | 17744 Facilities Services | 190.5k (+39.9k) | 11->78%; 9 tenant gaps | earned |
| 8 | refuter | sonnet | 17744 | 147.8k | REWORK: PriceCheck reachable; daycare mixed cases found 2 bugs | earned |
| 9 | builder | opus | 17747 MobileApi Pets | 143.9k | 25->96%; new 17753 | earned |
| 10 | refuter | sonnet | 17747 | 119.0k | ACCEPT; mobile is JWT (no antiforgery gap) | earned |
| 11 | builder | opus | 17746 Customers Pets | 200.7k (+5.7k) | 12->89%; 17589 | earned |
| 12 | refuter | sonnet | 17746 | 91.4k | REWORK: VetDoctorChange GET cross-org leak | marginal: leak removed by develop #12238 a day later |
| 13 | builder | opus | 17748 Customers Portal | 145.4k (+19.5k) | 0->90-100%; P1 takeover (17660) | earned: critical |
| 14 | refuter | sonnet | 17748 | 95.2k | REWORK: second takeover vector (own customer + foreign email) | earned: critical |
| 15 | builder | opus | 17750 Org Settings/Campaigns | 199.8k (+10.3k) | 19->88%, 41->60%; new 17754 | earned |
| 16 | refuter | sonnet | 17750 | 120.6k | REWORK: surviving size mutant, orphan Job | earned |
| 17 | builder | opus | 17749 Parents Setup/Onboarding/Pets | 231.5k (+11.9k, +16.0k) | 77-88%; 17619 | earned |
| 18 | refuter | sonnet | 17749 | 105.4k | REWORK: NRE pinned as expected; ConfirmGet/Register reachable | earned |
| 19 | builder | opus | reconcile 17746 with develop #12238 | 107.0k | 6 obsolete vet tests dropped, Vet list covered | earned (forced by develop) |
| 20 | general-purpose x2 | session | /pre-pr-review light + test analyzer | 186.6k | PASS; 1 real test fix | earned |

## Totals
20 rows (about 30 dispatches with resumes), about 4.3M subagent tokens: builders ~2.6M, refuters ~1.0M (all sonnet), review ~0.19M. Fable context: not recorded at start; the session spanned a pause and a restart.

## Loop signal
- Pre-PR review tier: **light + pr-test-analyzer** (test-only, every task refuted; the refuters' brief was builder-common, not the Playwright reviewer checklist, so the third light-tier condition was only partly met, and Cooper chose this tier). It caught 1 test-quality issue (the AddPet ignored test would pass a partial fix) that the refuter had already half-fixed. Later review/CI catches: none yet (PR 6128 just opened).
- 8 of 9 refuters returned REWORK. The recurring miss: builders called success paths "needs setup" when the RealisticTestKmsDbContext hooks reach them (4 of 9 tasks). Putting "try before you report needs setup" in the brief halved it in later waves but did not remove it.
- Sonnet refuters were enough: they found both P1 takeover vectors and every surviving mutant.
- Stale-binary false flake (twice): a refuter's production mutation plus a rebuild left mutated DLLs, and the builder's next `--no-build` run failed. Refuter briefs now say "rebuild after restoring".
- The develop merge after all tasks were done broke 5 tests (#12238). Merging develop before the last wave would have been cheaper.

## Spec misses
- builder-common did not say to rebuild after restoring a mutation (the stale-binary flake).
- Round-4 briefs did not ask builders to check develop for in-flight changes to the target area (#12238 landed during the run).
