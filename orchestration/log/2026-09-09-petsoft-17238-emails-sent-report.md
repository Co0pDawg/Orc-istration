# Orchestration Log: Petsoft 17238 Emails Sent report

Date: 2026-09-09
Project: Petsoft (worktree C:\Development\Petsoft-17238)
Branch: support/17238-Emails-Sent-Report
Task: Support item 17238 — facility-scoped date-range report of sent emails with customer link, preview, and View link
Outcome: shipped to working tree, unstaged. Build 0 warnings, Reports MSTests 4/4, Playwright reports suite 3/3 against the running app. Not verified: dark mode/mobile of the RDLC body, Excel export, DACPAC deploy.

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|-------|-------|---------|--------|-------|------|--------|-------|
| 1 | scout | haiku | locate email persistence (Message table, writers, existing viewer, HTML strip helpers) | 44,138 | 31 | 1.6 min | 6 groups of path:line; found the SMS Messages Sent report as the template | earned — the SMS-report pointer set the whole design |
| 2 | scout | haiku | Reports area conventions, date-range template, nav, permissions | 57,036 | 43 | 2.3 min | full RDLC/ReportFactory/Up.sql recipe | earned — but overlapped #1 on the SMS report; one scout with both briefs would have done |
| 3 | scout | haiku | Playwright reports suite layout, EmailSink helpers | 34,389 | 22 | 1.2 min | page object, base class, keystone test, map lines | marginal — correct, but ~4 greps; Fable could have inlined it |
| 4 | fable | fable | read SMS proc, factory, rdlc, Up.sql block, identifiers commit, Playwright page; write spec | unmeasured | ~8 | ~10 min | 130-line spec | earned — the spec is what made the builder one-shot most of it |
| 5 | builder | opus | implement spec: function, proc, rdlc, factory, Up.sql, identifiers, MSTest, Playwright, docs | 276,639 | 137 | 38.4 min | DONE; 2 spec defects found and fixed (block email domain; ViewMessage route binds `id` only, so `?messageId=`); 5 deviations reported | earned — caught two spec errors that would have shipped a dead link and an empty test |
| 6 | refuter | opus | adversarially verify the diff; rerun build/tests; probe f_HtmlToText; check route binding, tenant scope, rdlc widths | 126,834 | 29 | 8.5 min | REWORK: 1 must-fix (null-name `+` concat → "(Unknown Customer)"), 2 should-fix (`&#x27;`/`&copy;` decode; stale coverage-gaps doc) | earned — must-fix was real (Fable had also spotted it on its own read); the 3,000-body entity scan found the `&#x27;` gap Fable would not have |
| 7 | builder (resumed) | opus | apply the three fixes, re-verify SQL + build + tests | ~15,000 (delta from 291,707 cumulative) | 14 | 3.4 min | DONE; one wrong claim in its note (said the SMS proc still had the null bug — it does not) | earned — cheap because context survived the resume |
| 8 | fable | fable | read full diff, verify rework lines, rerun Reports MSTests, disprove builder's SMS-proc claim | unmeasured | ~6 | ~5 min | confirmed; skipped a second refuter on a 3-line rework | earned |

| 9 | fable | fable | commit (b13278070) + push to origin | unmeasured | ~6 | ~3 min | committed clean, remote in sync; 2 earlier attempts blocked by the permission classifier for chaining `add && commit` | earned |
| 10 | 6× pre-pr-review agents | fable (session model) | code-reviewer, silent-failure-hunter, comment-analyzer, pr-test-analyzer, code-simplifier, playwright-reviewer, launched in parallel | 0 | 0 | 0 | ALL FAILED — HTTP 429 session limit, all six within seconds of launch. No findings returned | waste — 6 simultaneous dispatches on a nearly-exhausted quota; nothing recoverable |

| 14 | fable | fable | round-2 spec: org-scope toggle + 10 folded review fixes; read ReportViewerModel/View.cshtml/ParameterEnum, found the `Inner` command-only-bit precedent and the `ShowOrganization` header trap | unmeasured | ~6 | ~15 min | 130-line spec with the data-precondition proofs written in as must-verify | earned — the precedent hunt is what kept the RDLC and shared-view churn to a few lines |
| 15 | builder | opus | implement round-2 spec across 16 files | unknown (died) | unknown | ~25 min | died on HTTP 429 (Opus session limit) after all 16 file edits, before any verification; no scratch report written | earned — the edits were complete and correct; the death cost only the verification, which Fable then did |
| 16 | fable | fable | read the full round-2 diff; build + MSTests; apply SQL and run the data proofs; check RDLC cell layout, Excel-path claim, port owner; restart the stale app; run Playwright; fix one locator; rerun | unmeasured | ~18 | ~35 min | build 0 warnings, MSTests 4/4, proofs: facility 194 rows / org 17,041 incl. 16,492 named campaign rows / 0 cross-org leaks; Playwright 3/4 then 4/4 after a one-line `tr:not(:has(tr))` fix | earned — also disproved review nit #10 (Excel is ClosedXML over the DataTable, not an RDLC render) |

| 17 | fable | fable | commit 0f171d62a + push; release note on WI 17238 (first attempt rejected as too long, 218-char version accepted); /draft-pr: branch/target checks, comments (none), description trimmed 489→402 words; PR create; REST PATCH for the attribution line | unmeasured | ~14 | ~20 min | draft PR 5904 → develop, linked to 17238. `az repos pr create/list` in Git Bash exited 0 with no output and created nothing, twice; PowerShell worked first time | earned — but two dispatches were wasted on the Git Bash az trap before switching shells |

| 18 | fable | fable | PR screenshots: located the reports suite's cached org login, wrote a 50-line Node Playwright script in the scratchpad (local chromium-1228 already present, no download), captured `#content` in both scopes light+dark, uploaded 4 attachments via REST, replaced the marker | unmeasured | ~8 | ~10 min | 4 images embedded in PR 5904; description at 3,707/4,000 chars | earned — inline was right: no spec to write, and every step was a known recipe |

**Totals:** 1,216,969 measured subagent tokens (round-2 builder unmeasured); ~2 h 15 min agent wall clock; Fable context unmeasured. Two rate-limit deaths (six review agents, then the round-2 builder), both on the model the roster pins for that role.

| 11 | 6× review agents, staged 3+3 | opus (session) | pre-PR review rerun after the 429: code-reviewer, playwright-reviewer, comment-analyzer, then silent-failure-hunter, pr-test-analyzer, code-simplifier | 662,933 | 131 | ~35 min | 2 issue / 2 warning / 8 suggestion / 5 nit. Found what the builder+refuter loop missed entirely: the report shows 3% of sent emails and 99% of those lack the customer name and View link | earned — the two issues are ticket-level defects no earlier pass caught |
| 12 | 2× GPT mirrors | sol (high) | code-reviewer-gpt, playwright-reviewer-gpt | n/a (external) | n/a | ~3 min | 1 issue + 1 issue/1 warning. GPT found the null-CUSTOMER_ID half of the headline defect that Claude's code-reviewer missed; agreed with Claude's playwright agent on the row-ordering finding | earned — cheap, external quota, and it caught a distinct half of the main defect |
| 13 | fable | fable | verify both issues by querying the dev DB, verify the TRANSLATE equivalence, write the consolidated report + calibration log | unmeasured | ~10 | ~8 min | both issues confirmed with row counts; TRANSLATE confirmed SAME + null-safe | earned |

**Loop signal**
- Builder found 2 spec defects (both real, both would have shipped broken behaviour without the Playwright run).
- Refuter: 1 must-fix confirmed (also independently found by Fable), 2 should-fixes both applied, 0 false positives. 1 REWORK round.
- Builder's closing note carried one false claim (SMS proc bug); caught by Fable with a one-line grep.

**Spec misses**
- Assumed customer creation sends a welcome email — it does not. Cost the builder discovery time inside a 38-minute round.
- Gave the ViewMessage URL in path form; the Customers area route only binds a trailing `id`. Builder caught it via the Playwright run.
- Named `&#39;` only for apostrophe decoding; .NET emits `&#x27;`.
- Spec §4 (tag → space) contradicted §5's expected string (no space before the comma). Builder resolved it with punctuation normalization.
- Named `Names.RandomEmail` implicitly; its domain is a block address that leaves no Message row.

**Notes for the roster**
- Scouts #1 and #2 overlapped; scope adjacent scouts so exactly one owns the "find the template" question.
- Builder cost was dominated by verification (app run + Playwright), not the edit. That is the right place to spend, but a spec that names a known-good email trigger would have cut it.
- **Fan-out has no quota guard.** Six parallel review agents launched after ~554k tokens of dispatch all died on one session limit, returning nothing. Two lessons: check remaining quota before a wide fan-out, and stage a review as 2-3 agents at a time (mandatory `code-reviewer` first) so a limit costs one agent, not six. A failed dispatch is not free — it consumes the launch and the wait.
- Chaining `git add -A && git commit` tripped the permission classifier twice, in both Bash and PowerShell. Separate calls went through. Stage and commit as two dispatches.
- **The builder→refuter loop verified the spec, not the requirement.** Both passes confirmed the code did what the spec said, and the Playwright test passed because the one email path it seeds happens to set both ids. Neither asked whether real rows carry those ids. The review agents did, and that is where the two ticket-level defects came from. Lesson for the spec template: name the data precondition the feature depends on ("which send paths populate CUSTOMER_ID and KENNEL_FACILITY_ID") and require the builder to query it, not just exercise one seeded row.
- Staging the rerun as 3+3 held where 6-at-once died. Two GPT mirrors ran on external quota for free and one of them caught half the headline defect — cheap insurance worth repeating.
