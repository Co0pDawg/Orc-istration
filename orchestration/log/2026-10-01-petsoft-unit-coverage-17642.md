# 2026-10-01 petsoft unit-test coverage round 2 (story 17642)

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | builder | opus | 17643 Cards | 199.4k (+18.2k rework) | 48+19 | 18+6 | 7->75%, 18->87%; bugs 17650, 17651 | earned |
| 2 | refuter | opus | 17643 | 137.5k | 12 | 4.6 | REWORK: no UrlHelper, 1 redirect row, tokenize rejections | earned |
| 3 | builder | opus | 17644 PaymentDevices | 176.5k (+10.5k, +15.1k) | 36+12+8 | 17+4+3 | 34->88%, 28->80%; bug 17649 | earned |
| 4 | refuter | opus | 17644 | 143.2k | 19 | 6.1 | REWORK: Commerce creds, gratuity readback | earned |
| 5 | builder | opus | 17645 Org billing | 304.9k (+25.9k) | 72+18 | 22+7 | 44->95%, 21->80%; 17652, 17653 | earned |
| 6 | refuter | sonnet | 17645 (>300k guard) | 97.6k | 12 | 5.4 | REWORK: only 1 exact charge assert | earned |
| 7 | builder | opus | 17646 Customer/Contact/Vet | 243.4k (+14.7k) | 53+11 | 21+4 | 0-51% -> 89-99%; P1 17656, 17657-17659 | earned |
| 8 | refuter | opus | 17646 | 173.6k | 26 | 6.2 | REWORK: same-org variants, controls | earned |
| 9 | builder | opus | 17647 Employees/Profile | 264.7k (+35.3k) | 71+18 | 24+5 | 0 -> 87-99%; P1 17660, 17661-17663 | earned |
| 10 | refuter | opus | 17647 | 169.5k | 18 | 8.5 | REWORK: P1 tests pass vs partial fix | earned: critical |
| 11 | general-purpose x3 | session | /pre-pr-review (reviewer, test-analyzer, simplifier) | 807k | 99 | ~6 | 3 warnings; bug 17665 | earned |
| 12 | builder | opus | review fixes (stopped once for budget, resumed) | 243.0k | 73 | 15 | all 15 items | earned |

## Totals
~12 dispatches + 7 resumes, ~2.9M subagent tokens. Fable context not re-read.

## Loop signal
- 5 of 5 refuters returned REWORK; every one found a real gap (vacuous security tests, missing money asserts). The refuter stage is the main quality gate on Opus-built tests.
- The [Admins] = platform-admin misread cost one builder rework (17644); now in builder-common.
- Stop/resume via SendMessage kept builder context across the user's budget pause; cheap to resume.

## Spec misses
- Didn't tell builders that tenant tests must survive a PARTIAL fix (own id + foreign id mixes); the 17647 refuter caught it. Add to builder-common for future rounds.
- Ignored-bug tests over-specified the remedy (exception type/message); /pre-pr-review caught 8. Rule: ignored tests assert unchanged state, not the shape of the refusal.
