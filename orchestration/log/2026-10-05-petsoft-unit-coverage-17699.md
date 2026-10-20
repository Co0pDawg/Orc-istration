# 2026-10-05 petsoft unit-test coverage round 3 (story 17699)

Rework rows give the resume delta. Figures come from the task notifications in session c24f041c.

| # | Agent | Model | Purpose | Tokens | Result | Value |
|---|---|---|---|---|---|---|
| 1 | researcher | sonnet | inventory of private DbContext stand-ins | 152.5k | inventory a-f; drove spec 17700 | earned |
| 2 | builder | opus | 17700 shared realistic test DB | 351.0k (+7.4k) | 12 mirrors + hooks, 3 virtual, dedup | earned |
| 3 | refuter | opus | 17700 (launched after a >300k builder: guard miss) | 182.8k | REWORK: null-org perms, facility org test | earned |
| 4 | builder | opus | 17701 MobileApi Booking | 335.2k (+14.0k) | 21->94%; bug 17724; AsEnumerable decision | earned |
| 5 | refuter | sonnet | 17701 | 82.3k | ACCEPT | earned |
| 6 | builder | opus | 17702 Coupons | 192.0k (+3.2k, +12.6k) | 8->100%; bug 17725 | earned |
| 7 | refuter | opus | 17702 | 112.6k | REWORK: Index negatives, refusal ids | earned |
| 8 | builder | opus | 17703 Reservations | 196.5k (+2.3k) | 13 tests; 17721 | earned |
| 9 | refuter | opus | 17703 | 105.0k | ACCEPT | earned |
| 10 | builder | opus | 17704 Settings | 173.7k (+12.4k) | 7->80%; bug 17726 | earned |
| 11 | refuter | opus | 17704 | 111.4k | REWORK: global dup-email proof | earned |
| 12 | builder | opus | 17705 ItemAdjustment | 206.2k (+33.7k) | 10->88% | earned |
| 13 | refuter | opus | 17705 | 146.3k | REWORK: literal configs, foreign-id placement | earned |
| 14 | builder | opus | 17706 JournalModel | 122.6k | 0->88%; bug 17728 | earned |
| 15 | refuter | opus | 17706 | 81.5k | ACCEPT | earned |
| 16 | builder | opus | 17707 ConvertService | 262.5k (+7.6k, +12.1k) | 42->98% | earned |
| 17 | refuter | sonnet | 17707 | 133.7k | ACCEPT + leak-assert hardening | earned |
| 18 | builder | opus | 17708 KennelProductEdit | 140.7k + 66.5k + 113.0k (+8.3k) | 0->100%; restarted twice (disk full lost brief) | marginal: 180k lost to disk-full restarts |
| 19 | refuter | opus | 17708 | 94.9k | REWORK: mixed-flag rows | earned |
| 20 | builder | opus | 17709 Parents stay edit/details | 206.8k (+16.2k) | 98/99% | earned |
| 21 | refuter | opus | 17709 | 115.4k | REWORK: seed-derived price, AtCapacity | earned |
| 22 | builder | opus | 17710 AvailabilityResult | 134.6k (+14.8k) | 0->100%; 17727 | earned |
| 23 | refuter | opus | 17710 | 91.3k | REWORK: throwing-fix acceptance | earned |
| 24 | builder | opus | 17711 RunDetails/PetReview | 262.9k (+6.6k) | 91/88% | earned |
| 25 | refuter | sonnet | 17711 | 144.2k | static ACCEPT (classifier refused runs) | marginal |
| 26 | builder | opus | 17712 ChangeContactInfo | 147.6k (+7.6k) | 0->100% | earned |
| 27 | refuter | opus | 17712 | 97.0k | ACCEPT + extra tests | earned |
| 28 | builder | opus | 17713 SMTP settings | 145.7k (+23.0k) | 12->97%; P1 17729 | earned: critical |
| 29 | refuter | opus | 17713 | 100.9k | REWORK: gate tests could not fail | earned: critical |
| 30 | builder | opus | 17714 Support tickets | 200.3k (+5.7k) | 19->98%, 32->83%; 17730 | earned |
| 31 | refuter | opus | 17714 | 136.1k | REWORK: exact counts | earned |
| 32 | builder | opus | 17715 ScheduleEdit/SignUp | 217.5k (+21.6k) | 0->100%, 13->43%; 17731 | earned |
| 33 | refuter | opus | 17715 | 124.4k | REWORK: proc-row leak, PII test | earned |
| 34 | builder | opus | 17700 follow-up (FreeRuns hook) | 139.5k | Reservations Index covered | earned |
| 35 | general-purpose x6 | session | /pre-pr-review full tier | 860.3k | 4 warnings, 0 production defects | earned (see loop signal) |
| 36 | builder | opus | review fixes | 114.9k | cbbc89f84; mutation-proven | earned |

## Totals
36 rows (about 50 dispatches including resumes), about 6.8M subagent tokens: builders 3.94M, refuters 1.86M, review 0.86M, researcher 0.15M. Fable context: not recorded at task start (session was compacted mid-task); not re-measured.

## Loop signal
- Pre-PR review tier: **full** (production `virtual` and `.AsEnumerable()` changes). It caught 2 things all refuters missed: an ignored test that passes against a partial fix (cancel covered only Checked-In), and 7 Ignore reasons citing bugs closed as duplicates on 10/01. 0 production findings. Later review/CI catches: none yet (PR 6124 just opened).
- 10 of 16 refuters returned REWORK; refuters remain the main quality gate.
- Disk-full (0 bytes on C:) cost one builder its brief and ~180k tokens of restarts; bin/obj cleanup after each cherry-pick is now a memory rule.
- The classifier refused mutation/test runs for some refuters; those leaned on builders' un-ignore proofs and the final full run.

## Spec misses
- 17706 called JournalModel a viewer; it is the manual journal-entry form (builder adapted).
- The review context listed 17634/17635 as umbrellas; ADO had closed them as duplicates of 17633 (and 17663 of 17660). Check bug state before citing umbrellas in a spec.
