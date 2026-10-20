# PR 5932 pre-PR review + fix loop

Date: 2026-09-17
Project: Petsoft
Branch: task/PET-17284_UserAgreementSigningGuarentee (Jackson's PR 5932), worktree Petsoft-pr5932, detached @ 18ad7ad54
Task: /pre-pr-review 2.3.2 of PR 5932 (#17284 consent at signup / portal invite), then verify and fix findings
Outcome: shipped — 25 of 39 findings fixed, pushed 9adc9546f, ADO thread 40064; full runs 2,739 + 822 green; build 0/0; filtered tests 46 + 10 green (builder and refuter); refuter ACCEPT; security mutation check NOT run (permission classifier refused it for the builder; left for Cooper); UITests compiled only

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | general-purpose (code-reviewer) | fable (inherited) | review agent | 130,566 | 16 | 1.3 | 8 findings, 1 issue | earned — SaveAsync ordering + unverified token |
| 2 | general-purpose (silent-failure-hunter) | fable | review agent | 126,075 | 15 | 1.4 | 7 findings, 2 issue | earned — only agent to find the omit-OrganizationId bypass |
| 3 | general-purpose (pr-test-analyzer) | fable | review agent | 113,261 | 12 | 1.2 | 7 findings | earned — test hid the partial write; Register POST untested |
| 4 | general-purpose (type-design-analyzer) | fable | review agent | 124,547 | 13 | 1.6 | 6 findings | earned — retry-succeeds-silently angle; save-in-model |
| 5 | general-purpose (playwright-reviewer) | fable | review agent | 91,325 | 22 | 1.5 | 5 findings, 1 issue | earned — raw selectors; cleared the IsVisibleAsync race with evidence |
| 6 | general-purpose (comment-analyzer) | fable | review agent | 125,522 | 14 | 1.2 | 5 findings | marginal — all suggestion/nit, one self-declared unverified |
| 7 | general-purpose (code-simplifier) | fable | review agent | 107,151 | 9 | 1.1 | 9 findings | earned — ~55 deletable lines, most applied |
| 8 | clodex sol (code-reviewer-gpt) | gpt | GPT mirror | unmeasured | — | ~25 | 4 findings | earned — distinct: agreement-version drift; raised antiforgery + token to issue |
| 9 | clodex sol (silent-failure-hunter-gpt) | gpt | GPT mirror | unmeasured | — | ~20 | 1 finding | marginal — duplicate of row 1's top issue |
| 10 | builder | opus | apply spec A-E | 217,699 | 87 | 18.0 | DONE minus mutation check | earned — all sections, real-token test fixture, data precondition counts |
| 11 | refuter | opus | adversarial review of fix diff | 115,692 | 16 | 4.1 | ACCEPT, 0 must-fix, 3 notes | earned — confirmed self-signup GET unaffected by unconditional Validate (my open worry) |
| 12 | researcher | sonnet | UITest facts: AgreementPolicyPage, suite orgs, run recipe | 91,754 | 31 | 1.9 | 7 answers with citations | earned — Policy-suite-owns-its-org fact decided the design; saved the builder the discovery |
| 13 | builder | opus | 5 org-agreement UITests, live app on :7399 / Petsoft_DEVELOP | 140,164 | 60 | 21.8 | DONE, Policy 7/7 x2, ParentTests 19 pass, mutation red as expected | earned — also disproved Fable's predicted ParentTos regression with code + DB evidence |
| 14 | fable | fable | inline refute of the UITest diff (refuter cannot run the live app) | — | 5 | 3 | accept; checked Logout-URL convention and that LoginAsync throws on failed login (negative gate assert not vacuous) | earned |
| 15 | general-purpose x4 (code-reviewer, playwright-reviewer, code-simplifier, comment-analyzer) | fable | pre-PR review of the UITest diff | 385,988 | 42 | ~4 | 13 findings, 5 warning | earned — playwright-reviewer + code-reviewer caught a vacuous negative Fable's inline refute had passed |
| 16 | clodex sol x2 (code-reviewer-gpt, playwright-reviewer-gpt) | gpt | GPT mirrors | unmeasured | — | ~20 | 1 finding each, both duplicates | marginal — no distinct defect this round |
| 17 | builder (resumed) | opus | rework: 10 review items, live re-run | 46,178 (delta) | 38 | 18.1 | DONE, Policy 7/7 x2, ParentTests 19 pass, 2 mutations red | earned — observed the wizard really did win at login, so the old assertion was passing on the wrong page |

**Totals** — ~1.81M subagent tokens measured (GPT unmeasured), ~125 min wall clock.
Fable context: ~70k → ~240k (estimated from the session token budget; status line not readable from inside the session).

**Loop signal** — one builder round, zero REWORK. Refuter must-fixes: 0. Builder deviations (inverted ConfirmLandingModel test, new test file, SubscriptionTier seeding) all accepted. Builder's mutation check of the token-verification clause was refused by the auto-mode permission classifier ("Security Weaken"); Fable did not run it on the builder's behalf and the refuter was ordered to judge the test by reading.

**Spec misses** — (1) spec required a mutation that removes a security check; the classifier blocks that class of edit, so the "Do not" line should ask for a read-based mutation argument or reserve the mutation for the user up front. (2) Spec did not name the ConfirmLandingModelTests self-signup test that making AgreeToTerms unconditional would invert. (3) Seven review agents ran on the session model (Fable) per the repo-skill rule, staged 3+1+3 under the fan-out cap — no 429s.

**Follow-up (UITests, same day)** — Spec miss: Fable predicted ParentTos_BlocksBookingUntilAccepted would break; it does not (gate keys on the newest active TOS id). Cost only a first-step check, as specced. No refuter dispatched for the UITest diff: static refute adds little over a twice-green live run plus a mutation; Fable read the 200-line diff instead.

**Loop signal (UITest round)** — Fable's inline refute of the UITest diff MISSED a vacuous negative assertion (checked only the failed-login path, not the onboarding-wizard redirect); the pre-PR agents caught it and the builder confirmed it live. One REWORK round, all 10 items done. Lesson: an inline refute is not a substitute for playwright-reviewer on new UITests — a negative Expect needs a positive anchor, and that belongs in the builder spec's Do-not list.
