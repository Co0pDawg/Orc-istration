# PR 5895 pre-PR review + fixes

Project: Petsoft
Task: `/pre-pr-review` on PR 5895 (`claude/sitemap-coverage-test-19796c` → `develop`, Christopher Fleming, #17242 — sitemap coverage guard + promo campaign trace data quality), then verify and address the findings.
Date: 2026-09-09 (review) / 2026-09-10 (fixes)
Worktree: `C:\Development\Petsoft-pr5895`, branch `pr5895-review-fixes`

## Dispatches

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| code-reviewer | opus | Correctness, security, schema co-change | 137,459 | 30 | 7.3 | 1 issue / 1 warning / 1 suggestion / 2 nits | **earned** — found the `SmsWebhookController` guard failure and, more valuably, that the PR's own deferral rationale ("needs an `Up.sql` migration") was wrong, which unblocked the IPv6 fix |
| pr-test-analyzer | opus | Test coverage and quality | 145,105 | 32 | 8.9 | 2 issue / 3 suggestion / 1 nit | **earned** — the only agent that actually ran `dotnet test`; independently proved `SPIDER-X1` matches by exercising the shipped regex, and verified the headline drift-guard claim rather than accepting it. Also produced the run's single false positive (see Loop signal) |
| silent-failure-hunter | opus | Error handling, swallowed failures | 101,647 | 22 | 5.7 | 1 warning / 3 suggestion / 1 nit | **earned** — the `ValueTask<T>` gap in `UnwrapTask` was a real hole in the PR's central guarantee that nothing else found; also verified the author's `ZenSqlLoggerProvider` log-level claim instead of repeating it |
| comment-analyzer | sonnet | Comment/annotation accuracy, doc co-change | 148,535 | 31 | 4.3 | 2 suggestion | **marginal** — both findings applied, but low-severity. Earned its keep on the negative result: fact-checked all five `.cs.md` pairs and the "no doc covers sitemap/SEO" claim, which would otherwise have been an open question at hand-off |
| code-simplifier | sonnet | Over-engineering, dead flexibility | 112,085 | 11 | 2.2 | 1 suggestion / 2 nits | **marginal** — 2 nits applied, 1 suggestion (move `SitemapPolicy` to the test project) wont-fixed as churn in another author's PR |
| type-design-analyzer | sonnet | Type/attribute design | 96,470 | 12 | 2.2 | 1 suggestion / 1 nit | **waste** — the suggestion was wont-fixed as speculative (agent itself noted every call site is well-formed) and the nit was self-labelled a non-defect. Nothing actionable came out of it. Two new attributes and one record are not enough surface to warrant the dispatch; skip this agent unless a diff adds a real domain type |
| builder | opus | Apply fixes A–H from spec | 138,462 | 54 | 21.1 | 10 files, all in scope, 3 declared deviations, all verifications rerun | **earned** — clean first pass, no REWORK round. Declared its deviations rather than hiding them, and caught a `sed` CRLF mishap on the `.sql` file and redid it byte-preserving |
| refuter | opus | Adversarially attack the fix diff | 112,234 | 24 | 4.9 | ACCEPT, 0 must-fix, 2 should-fix | **earned** — re-derived the regex behaviour independently across 16 real crawler UAs and found a third accepted ceiling the builder had not recorded (`bot-collector/1.0` no longer matches) plus a stale `DataRow` DisplayName |

| builder (2) | opus | Split `SitemapPolicy` — engine to the test project, attributes stay | 97,195 | 24 | 6.7 | 4 files added, 2 deleted, 1 modified; 56/56 tests unchanged | **earned** — clean first pass on the risky part (annotation renumbering discipline, `See also:` pointer integrity across two directories) and surfaced a real CS8632 that needed `#nullable enable`, citing two sibling precedents rather than reaching for a `NoWarn` |

The follow-on deferral fixes (annotation paired-edit rule, the `logs.Log` "moves not drops" note, the `[SitemapPath]` leading-slash test guard, the `LogError` one-liner) were done inline by Fable — four small edits plus a build and test run, below the dispatch-overhead threshold.

## Totals

- 8 dispatches: 6 review (parallel), 1 builder, 1 refuter
- 991,997 subagent tokens, 216 tool uses, ~56.7 min of agent time (wall clock far lower — the 6 reviewers ran in parallel)
- 0 REWORK rounds
- Outcome: 19 findings → 11 fixed, 6 wont-fix (documented with reasons), 1 false positive, 1 not-actioned. Build 0 warnings / 0 errors; 55/55 filtered, 2468/2474 full project (6 pre-existing skips)

## Loop signal

**One false positive, and it was the most expensive shape available: a build-breaking `issue:` backed by a fabricated-sounding command result.** `pr-test-analyzer` reported that `[DataTestMethod]` triggers MSTEST0044 under `TreatWarningsAsErrors` and that the test project therefore does not compile, stating that `-p:NoWarn=MSTEST0044` "is what let me run the suite at all." It does not reproduce: the solution builds at 0 warnings and the suite runs with no `NoWarn`, because this repo references `MSTest.TestAdapter`/`MSTest.TestFramework` but not `MSTest.Analyzers`. The rule is real in MSTest v4; the analyzer that emits it is absent.

Fable caught it by running the build first instead of trusting the report — which is the lesson worth keeping: **verify the agent's claimed command output before acting on a finding that asserts a broken build.** Candidate agent-definition fix for the next `/calibration-report`: before citing an `MSTEST####`/`CA####` rule as a build error, confirm the analyzer package is referenced, and quote the actual failing output.

Cheap-model tiering held up: the three sonnet reviewers produced no false positives and no missed issue in their domains. The one waste dispatch was a scope misjudgement by Fable (running `type-design-analyzer` on two attributes and a record), not a model-tier problem.

## Spec misses

- **Over-constrained Fix H1.** The spec said "trim to a one-line comment" *and* "must still name the `)` ceiling" — mutually exclusive. Builder correctly shipped two lines and declared the deviation. Should have stated the intent (pointer, not content) and let the line count follow.
- **Did not anticipate a second sentence going stale.** Widening the column made an unrelated sentence in `PromosController.cs.md` #2 (about `BaseController.GetIPAddress()` hardcoding 50 "while the column is 32") false. Builder spotted and fixed it. A schema-change spec should carry a standing instruction to re-read the whole annotation for sentences the change invalidates, not just the numbered entry being edited.
- **Did not ask for the new ceiling to be recorded.** The spec named the `)` ceiling to document but not the non-letter-hyphen one the fix newly introduced (`bot-collector/1.0`). The refuter found it. When a spec narrows a predicate, it should require the builder to enumerate what the narrowing newly excludes.
- Fable also had to fix a logic error in the builder's annotation prose itself: the justification for keeping the `)` delimiter argued "a visitor misread is not recoverable" and then kept a visitor misread. **Annotation prose needs the same adversarial read as code** — the refuter's remit already covered it, but Fable's own diff read caught this one first.
