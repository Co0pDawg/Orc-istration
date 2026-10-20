# 2026-10-12 Petsoft #17897 Permanent Free tier: foundation slice (17771/17772/17773/17786)

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result | Value |
|---|-------|-------|---------|--------|-------|-----|--------|-------|
| 1 | researcher | sonnet | trial lifecycle / pricing / org search | 92k | 34 | 2 | report | earned: shaped Active-on-Free design |
| 2 | researcher | sonnet | entitlement enforcement map | 129k | 53 | 3 | report | earned: no pet enforcement, central email gate |
| 3 | researcher | sonnet | Cosairus Pay signal / CPS | 67k | 15 | 4 | report | earned: PaymentDevice signal, IS_VIRTUAL_TERMINAL contradiction |
| 4 | builder A | opus | limits, schema, job | 314k | 137 | 39 | 3 commits | earned; rename later reverted by Fable (spec miss) |
| 5 | builder B | opus | lifecycle + copy | 237k | 85 | 23 | 2 commits | earned: surfaced promo/no-card billing throw |
| 6 | builder B r2 | opus (resume) | card rule, dead code | ~49k delta | 29 | 11 | 1 commit | earned |
| 7 | refuter B | sonnet | lifecycle refute | 116k | 18 | 9 | REWORK (Promos copy) | earned |
| 8 | refuter A | sonnet | limits refute | 124k | 26 | 11 | ACCEPT + should-fixes | earned: N+1, prod pet-limit risk |
| 9 | builder D | opus | should-fixes | 126k | 30 | 12 | 1 commit | earned |
| 10 | builder C | opus | Playwright + live + DB copy | 347k | 158 | 43 | PARTIAL (schema drift blocker) | marginal: blocked by #17738 drift on DB copy |
| 11 | builder C r2 | opus (resume) | finish Playwright | ~13k delta | 14 | 12 | 1 commit | earned |
| 12 | code-reviewer | opus | pre-PR | 160k | 34 | 4 | 3 findings | earned |
| 13 | silent-failure-hunter | opus | pre-PR | 148k | 39 | 4 | 1 finding | earned |
| 14 | architecture-reviewer | opus | pre-PR | 172k | 38 | 4 | 3 findings (1 FP) | earned: customer-reactivation bypass |
| 15 | comment-analyzer | opus | pre-PR | 218k | 40 | 4 | 3 findings | earned |
| 16 | code-simplifier | opus | pre-PR | 110k | 11 | 1 | 4 nits | marginal |
| 17 | playwright-reviewer | opus | pre-PR | 105k | 9 | 1 | 5 findings | earned: 17263 guard |
| 18 | type-design-analyzer | opus | pre-PR | 100k | 10 | 1 | 1 dup | waste: duplicate of comment-analyzer |
| 19 | code-reviewer-gpt | gpt sol | pre-PR mirror | n/a | n/a | ~25 | 8 findings | earned: PII log, copy-ahead-of-features |
| 20 | architecture-reviewer-gpt | gpt sol | pre-PR mirror | n/a | n/a | ~22 | 4 findings | marginal: 1 useful (N+1 filter) |
| 21 | builder E | opus | review fixes + Identifiers | 269k | 120 | 20 | 3 commits | earned |
| 22 | builder (PW rerun) | sonnet | final Playwright rerun | 74k | 13 | 8 | all green | earned |

Totals: ~3.43M subagent tokens (Claude) across 20 dispatches + 2 GPT mirrors; Fable context at start and end not captured (no status line read).
Loop signal: pre-PR review tier = FULL (product code, schema, billing). Review caught what two refuters missed: Office New-pet tenant trust, gate-after-mutation, customer-trigger bypass, owner definition drift, PII log, copy ahead of features. GPT code-reviewer found 2 issues Claude agents missed (PII log, pricing claims).
Spec misses: (1) plan said rename MAXIMUM_PETS_PER_FACILITY; rename breaks shared local DB + generated Identifiers.sql — reverted. (2) Up.sql "re-apply when different" would overwrite ops tuning — Fable changed to set-once. (3) Copy brief followed mockup that promised #17776/#17778 features. (4) DB copy from Petsoft_DEV inherited other-branch schema drift (#17738) — live-verification builders should check wizard works on the copy first.

## Round 2 (2026-10-12 evening to 2026-10-13)

| # | Agent | Model | Purpose | Tokens | Min | Result | Value |
|---|-------|-------|---------|--------|-----|--------|-------|
| 23 | researcher | sonnet | round-2 code map | 117k | 4 | report (inline, saved by Fable) | earned: invoice gap, wrong report ids |
| 24 | builder F | opus | entitlements + email | 262k (+39k rework) | 32+13 | 6 commits | earned |
| 25 | builder G | opus | billing/admin/marketing | 250k (+20k) | 31+13 | 7 commits | earned |
| 26 | builder H | opus | #17903 money path | 286k (+~110k over 3 resumes) | 32+... | 4 commits | earned; 2 REWORK rounds |
| 27 | refuter H | opus | money-path refute | 158k | 14 | REWORK | earned: stay lock, non-atomic loop |
| 28 | refuter F | sonnet | entitlements refute | 118k | (slept) | ACCEPT | earned: clock-in gap |
| 29 | refuter G | sonnet | billing refute | 120k | (slept) | ACCEPT | earned |
| 30 | refuter H2 | sonnet | rework refute | 97k | 10 | REWORK | earned: dishonest note, 2 untested paths |
| 31 | builder (fix batch) | sonnet | refuter should-fixes | 123k | 17 | 3 commits | earned |
| 32 | builder (Playwright r2) | opus | UI tests + live check | 300k | 43 | 1 commit | earned: dead Clock In/Out link |
| 33-39 | pre-pr-review x7 | opus | round-2 review | ~1.07M | ~6 each | 14 findings | earned (new-pet 500, check-in lock, clock-out, promo tenant) ; playwright-reviewer marginal (0 findings) |
| 40-42 | GPT mirrors x3 (+2 retries) | gpt sol | round-2 mirror | n/a | ~25 | all FAILED (429 / own timeout) | waste |
| 43 | builder (review fixes) | opus | 14 findings + 2 deviations | 352k cumulative | 35 | 6 commits | earned |
| 44 | builder (PW rerun) | sonnet | final Playwright | n/a | 8 | 84/84 | earned |

Round-2 totals: ~3.9M Claude subagent tokens; Fable context not captured.
Loop signal: FULL tier both rounds. Round-2 review still found real defects after 4 refuter passes (new-pet 500, overdue-arrival lock, clock-out lock, pre-existing promo tenant) -> full tier justified for product code with money paths. GPT mirrors produced nothing in round 2 (server 429 even after usage reset): check gateway health before choosing mirrors.
Spec misses round 2: (1) spec said gate "store credit" without checking an issuing action existed; (2) #17903 spec kept a date filter that conflicted with the strict checkout guard; (3) PC slept 1:27-10:29 AM mid-run: keep-awake before overnight dispatch; (4) my own `git checkout --` to undo a mutation reverted an uncommitted real edit: restore mutations from a byte copy, never git checkout, when the file has uncommitted work.
