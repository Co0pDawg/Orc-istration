# 2026-09-30/10-01 petsoft unit-test coverage story 17597 (build loop)

Research phase is logged separately in 2026-09-30-petsoft-unit-coverage-research.md.

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | builder | opus | 17599 ReservationDetailValidator | 109.5k | 18 | 7.7 | 13 tests, 9.7->96% | earned |
| 2 | refuter | opus | 17599 | 93.0k | 9 | 4.0 | REWORK: arrival-day off-by-one survived; NRE pin | earned |
| 3 | builder (resume) | opus | 17599 rework | +2.8k | 4 | 3.5 | fixed | earned |
| 4 | builder | opus | 17600 InvoiceRefundModel | 163.3k | 42 | 19.5 | 0->70%; bugs 17608, 17609 | earned |
| 5 | refuter | opus | 17600 | 99.9k | 15 | 5.2 | ACCEPT | marginal: no must-fix |
| 6 | builder | opus | 17601 AccountDeletionConfirmModel | 178.0k | 44 | 21.1 | 0->80%; token-purpose bug 17610 | earned |
| 7 | refuter | opus | 17601 | 98.5k | 12 | 9.1 | ACCEPT + bystander hardening | earned: data-loss asserts |
| 8 | builder (resume) | opus | 17601 hardening | +3.9k | 4 | 1.2 | done | earned |
| 9 | builder | opus | 17602 PriceCheckInvoice | 188.8k | 45 | 25.0 | 0->96.5%; bug 17618 | earned |
| 10 | refuter | opus | 17602 | 99.8k | 8 | 6.6 | REWORK: dead asserts, buggy-throw comment | earned |
| 11 | builder (resume) | opus | 17602 rework | +5.9k | 5 | 3.6 | 98.5% | earned |
| 12 | builder | opus | 17603 ParentReservationSaveUtility | 227.4k | 54 | 20.6 | 29->90.5%; P1 17619, 17620, 17621 | earned |
| 13 | refuter | opus | 17603 | 116.0k | 18 | 9.9 | ACCEPT | marginal: confirmed regressions map |
| 14 | builder | opus | 17604 InvoiceEdit+PaymentModel | 314.4k | 79 | 35.3 | 48->98%, 62->95%; 17623, 17624 | earned |
| 15 | refuter | opus | 17604 | 151.9k | 25 | 9.1 | REWORK: 2 surviving mutants; msg bug 17626 | earned |
| 16 | builder (resume) | opus | 17604 rework | +14.7k | 13 | 7.3 | fixed, mutants red | earned |
| 17 | builder | opus | 17605 BookReservations+StayReview | 318.5k | 84 | 40.1 | 67->96%, 67.5->98%; 17627, 17628 | earned |
| 18 | refuter | opus | 17605 | 166.7k | 30 | 8.5 | REWORK: Throws<Exception> | earned |
| 19 | builder (resume) | opus | 17605 rework | n/a (cumulative fell to 300.8k after compaction) | 5 | 2.2 | fixed | earned |
| 20 | builder | opus | 17606 Mfa+Authentication controllers | 253.4k | 67 | 32.6 | 0->100%, 0->89%; 17629, 17630 | earned |
| 21 | refuter | opus | 17606 | 140.3k | 18 | 5.0 | REWORK: wrong-password gap, verb gaps -> 17631 | earned |
| 22 | builder (resume) | opus | 17606 rework | +15.7k | 11 | 3.8 | fixed | earned |
| 23 | builder | opus | 17607 MobileApi auth + tenant sweep | 306.0k | 83 | 28.7 | Auth 0->93%; P1 17633, 17634, 17635 | earned |
| 24 | refuter | sonnet (override: builder >300k guard) | 17607 | 113.0k | 17 | 4.2 | ACCEPT | marginal |

Inline (Fable): runsettings fix 17598, 21 bug verifications by reading code, 21 bug filings, cherry-picks + Ignore-id edits, develop merge, one full run (4 projects, ~4 min). PR 6075 pipeline triage interleaved (infra, ~6 calls).

## Totals
24 dispatches (~3.66M subagent tokens; ~3.55M Opus). Builders ~2.47M, refuters ~1.18M. Fable context: ~45k at start of build phase; not re-read at end (session spanned a compaction-free resume next day).

## Loop signal
- 4 of 9 refuters returned REWORK on Opus-built tests; every REWORK found a real weakness (surviving mutant, dead assert, wrong exception type). Refuters on tests earn their cost.
- Parallel builders in hand-made worktrees off origin/develop + cherry-pick onto the feature branch: zero conflicts across 10 tasks.
- Guard miss: Opus refuter launched right after the 314k 17604 builder (no 429 hit). Caught it at 17607 and used a Sonnet refuter.

## Spec misses
- Common orders said "Ignore reason: pending ticket" so Fable had to sed bug ids in at cherry-pick 6 times; next time file the bug first and SendMessage the id, or let the builder leave a placeholder Fable greps for.
- Spec asked for Validate over-refund cases that don't exist (InvoiceRefundModel has no amount rule) - read the target's surface before writing required cases.
- Wrong bug id (17611) guessed in a refuter prompt; never predict ADO ids.
