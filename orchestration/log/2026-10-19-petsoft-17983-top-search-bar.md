# 2026-10-19 — Petsoft — #17983 top search bar rework

Date: 2026-10-19
Project: Petsoft
Branch: feature/17983-rework-the-top-search-bar-card-results (off develop)
Task: Task #17983 under Story #13520 — header search finds reservations/invoices/employees/classes, partial phone match, card results, typeahead (/start run)
Outcome: shipped to branch, PR not opened (Cooper runs /draft-pr). Verified:
- full KMS.Tests and Core.Test runs passed (twice);
- new and rerun Playwright tests passed on the local app, except PaymentCard_AddCardOnFile_Persists, red twice in the external Converge iframe after the search step passed;
- screenshots at 1280 and 375 px, light and dark.

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | Explore | sonnet | map current search flow | 79k | 35 | 3 | full flow, proc, tests, indexes | earned: grounded the plan; found primary-phone-only join |
| 2 | Explore | sonnet | record ids + typeahead patterns | 63k | 18 | 3 | DISPLAY_NUMBER/REPORT_ID facts, nav-search.js pattern | earned: data shapes and the JS model to copy |
| 3 | Plan | opus | design plan | 156k | 50 | 10 | plan + 3 spec corrections | earned: no Training flag; phone strip eats invoice numbers; locators tied to table rows |
| 4 | builder A | opus | groups 1-3 (proc, indexes, cards, lookups) | 219k | 100 | 38 | DONE, 3 commits | earned |
| 5 | refuter | opus | review groups 1-3 | 184k | 49 | 19 | REWORK: 2 must-fix + 5 should | earned: 5k-read invoice scan; cross-facility 500 |
| 6 | builder A (resume) | opus | rework round 1 | ~40k | 33 | 20 | DONE 3c0fe7fb9 | earned |
| 7 | fable | — | inline re-review of rework | — | 1 | 3 | ACCEPT | earned: saved an Opus refuter after a big builder |
| 8 | builder B | opus | groups 4-5 (typeahead, Playwright) | ~258k | 87 | 36 | group 4 committed; BLOCKED on stale DB | earned |
| 9 | builder B (resume) | opus | after KmsDbTool upgrade | ~15k | 14 | 11 | BLOCKED: product-invoice defect | earned: live run found a real requirement gap |
| 10 | builder B (resume) | opus | id-prefix fix + group 5 | ~55k | 68 | 47 | DONE 4b770e215, 5b069f7c0 | earned |
| 11 | refuter | sonnet | static review groups 4-5 | 95k | 9 | 3 | ACCEPT, 3 should-fixes | marginal: no must-fixes; nits only |
| 12 | researcher | sonnet | board drag/resize practices (side request) | 36k | 7 | 2 | SortableJS + WCAG 2.5.7 | earned (board work, spun off) |
| 13-19 | pre-pr-review x7 | opus (inherited) | full tier | 105k+113k+143k+97k+143k+120k+138k = 859k | 122 | ~7 each | 1 issue / 2 warning / 6 suggestion / 3 nit | code-reviewer earned (full-width-digit permission bypass); playwright-reviewer earned (vacuous assertion, selector in test); comment-analyzer + code-simplifier marginal; arch, silent-failure, type-design waste-ish (0 findings, all approved) |
| 20 | builder C | opus | review fixes | 163k | 79 | 41 | DONE a08e22e32 | earned |

Totals: ~2.24M subagent tokens across 20 dispatches, ~4.7 h wall clock (14:16 to ~19:00 ET). Fable context: start ~15k → end ~220k (budget counter 15.0M → 14.78M; /context not read, so this is an estimate).

Loop signal:
- Builder→refuter caught 2 must-fixes on round 1: the nvarchar seek and the cross-facility link. Both were confirmed and fixed in one REWORK round.
- Live Playwright (builder B) caught a requirement defect that both refuters and the spec missed: product invoices show an id prefix, not DISPLAY_NUMBER.
- Pre-PR review (full tier) caught a security defect the loop missed: full-width digits bypass the phone strip. It was pre-existing, widened by the contains-match.
- Review tier: full. Tier missed nothing known at time of writing.

Spec misses:
- The plan and spec assumed every invoice has DISPLAY_NUMBER. One DB query (`count where DISPLAY_NUMBER is null`) in the data-precondition line would have caught it at spec time. Template idea: "for every display value the feature searches, query how the UI renders it (function/fallback), not just the column".
- Local DB schema drift (Petsoft_DEV missing PR 6190 columns) cost one blocked builder round. Check `git log origin/develop -- KmsDbTool/Up.sql` against the DB before any live-run dispatch.
- I relayed a nit (typeahead raw phone) into a change (c57b5f097) without updating the security assertion it made vacuous. playwright-reviewer caught it.

## Round 2: 2026-10-20, Cooper's live testing of draft PR 6243

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 21 | builder D | opus | reservation number prefix (numeric ranges), invoices only for dashed terms, shorter placeholder | 165k | 76 | 25 | DONE b6524de6d; 32 MSTest, 6/6 Playwright pass; seek of 39 reads | earned |
| 22 | fable | - | inline: hint banner removal, Name sort highlight, email prefix (proc), filter/sort bar restyle, typeahead spinner | - | ~60 | ~90 | 5bbf68c1b, a3c2cfa25, e8f19b35b, 506a40450 | earned (each was 1-20 lines; a builder round would have cost more) |

Totals (round 2): ~165k subagent tokens, ~2 h wall clock. Fable context: not measured.

Loop signal (round 2):
- Seven of Cooper's findings came from clicking through the running app. The builder-refuter loop and the full-tier pre-PR review (7 agents) caught none of them.
- They fall into three kinds:
  - search-result design: digits listed only invoices; email matched only with "@"; Relevance was highlighted when it had no effect;
  - layout and copy: the placeholder was cut off; the hint banner was redundant; the filters didn't match the sort controls;
  - missing feedback: no spinner while the typeahead loads.
- Review tier: full. It missed every one of these UX issues. They are judgement calls, not defects.
- One process slip: `build; git commit` ran in one command and committed after a build that reported 4 errors (DLL locks, not code). The commit was verified clean afterwards. The run-facts memory now carries the rule.

Spec misses (round 2):
- The spec chose invoice prefix-matching for any digit term without checking what a staff member types most: a partial reservation number. Invoice numbers embed the reservation number, so every digit search flooded with invoices. The data showed this on day 1 ("DISPLAY_NUMBER = <report id>-NNN") and the spec did not follow it through.
- The placeholder text was specified without checking it fit the box (80 characters in a box about 38 wide).
- Email search semantics were inherited unexamined from the old proc.

## Round 3: 2026-10-20 follow-ups

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 23 | builder E | sonnet | retake 5 PR screenshots | 90k | 22 | 7 | DONE, all 5 valid; app stopped | earned (a live-app run with interaction; Sonnet was enough) |
| 24 | fable | - | CLAUDE.md spec rule, 2 repo gotchas (7b18164cc), Story 18022, PR description update | - | ~12 | ~15 | done | earned |

Builder E skipped its board milestones ("to keep the run short"). The builder rules require them, so remind a Sonnet builder explicitly next time.
