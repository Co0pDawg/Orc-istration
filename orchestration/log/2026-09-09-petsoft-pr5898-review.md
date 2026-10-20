# 2026-09-09 — Petsoft — PR 5898 pre-PR review (#17156 deposit policy on service page)

Date: 2026-09-09
Project: Petsoft
Branch: claude/deposit-policy-on-service-page (Jackson Keith) → develop, reviewed at 4e4fbef59 in worktree C:\Development\Petsoft-pr5898
Task: /pre-pr-review 2.3.2 on PR 5898 — 64 files, +1688 −2701
Outcome: report delivered — needs changes, 6 issue / 15 warning / 11 suggestion / 13 nit (45 findings after merging). No fixes dispatched yet. Calibration log: docs/internal/agents/calibration/log/2026-09-09-claude-deposit-policy-on-service-page.md

Note: these are the repo's calibrated review agents run as `general-purpose` on the session model (per the "repo-owned skills inherit the session model" rule), not roster agents. Logged anyway so the review-agent cost sits beside the builder/refuter data.

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | code-reviewer | session (Fable) | correctness / tenant / schema co-change | 232,246 | 52 | 8.8 | 2 issue 1 warn 1 sugg 4 nit | earned — both issues real (verified FK + orphan-delete path myself); multi-facility scope warning is the one nobody else saw |
| 2 | silent-failure-hunter | session (Fable) | error handling, money path | 179,345 | 38 | 9.7 | 4 issue 1 warn | earned — queried the local DB: 25/437 future agreements lose their deposit; historical-period silent delete is unique to it |
| 3 | comment-analyzer | session (Fable) | comments, docs, annotation pairs | 334,090 | 51 | 5.7 | 1 issue 5 warn 1 sugg 1 nit | earned — the "fixed at booking" comment/doc contradiction and 4 stale mapped docs; most expensive agent (two annotation pairs + 4 docs) |
| 4 | type-design-analyzer | session (Fable) | new/changed types | 130,124 | 18 | 3.1 | 1 sugg | marginal — correct ratings, one structural suggestion; cheapest agent |
| 5 | pr-test-analyzer | session (Fable) | test coverage | 208,422 | 34 | 5.1 | 3 warn 3 sugg | earned — found the stale SettingsCalendarEventsModelTests assertions (a real red test), verified by my own grep |
| 6 | playwright-reviewer | session (Fable) | UITests | 151,515 | 23 | 5.3 | 1 issue 3 warn 2 sugg 1 nit | earned — SecurityTests 403→404 is a guaranteed nightly failure; hollow-persistence-test finding is sharp |
| 7 | code-simplifier | session (Fable) | over-engineering | 155,815 | 20 | 4.8 | 4 sugg 8 nit | marginal — all plausible, none blocking; confirmed DropObjectsNotInSource=false so Up.sql drops are needed (useful negative) |
| 8 | code-reviewer-gpt | gpt-5.6-sol high | GPT mirror (Cooper's pick) | unmeasured | — | ~10 | 3 issue | marginal — 2 of 3 duplicate Claude findings; the Up.sql arbitrary-clone one raised Claude's nit to a warning |
| 9 | silent-failure-hunter-gpt | gpt-5.6-sol high | GPT mirror (Cooper's pick) | unmeasured | — | ~7 | 1 issue 2 warn | earned — dirty-tracking gap on rule add/delete was unique and verified (markDirty never called) |

Totals: 1,391,557 subagent tokens (Claude only; GPT unmeasured), 236 tool uses, ~10 min wall clock for the parallel fan-out (longest agent 9.7 min). Fable's own context: unmeasured (~90k at report time).

Loop signal: review-only run, no builder/refuter loop. Cross-agent agreement: the two FK-delete issues were found independently by 4 agents each (2 Claude + 2 GPT); the SecurityTests break by 2. Unique-to-one-agent findings that I verified: SFH DB-backed horizon gap, PTA red test, SFH-gpt dirty tracking. Fable's own pre-read of Up.sql + DepositCalculator flagged the "periods discovered only via Price rows" concern that became CR nit 34 and part of SFH issue 3.

Spec misses: none that cost a dispatch. Two things to keep: (1) telling agents the exact scratchpad diff path + worktree path meant no agent read the wrong branch; (2) the GPT worker prompt's "no git fetch" line held — clean git status afterward. code-reviewer-gpt ran right up to the 600s Bash timeout; give GPT workers a longer timeout or a smaller file list next time.

---

## Fix phase (same task, continued)

Outcome: 35 of 45 findings fixed, UNSTAGED in the worktree. Build 0 warnings; 349 + 89 filtered tests green (both reproduced by Fable independently). 8 deferred as design calls for the author, 2 partial. Nothing committed.

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 10 | scout | haiku | locate price-by-date resolution, IsHistoricalPeriod rule, markDirty wiring | 47,696 | 27 | 1.7 | answered 4 of 5 questions; missed the invoice-side price lookup | marginal — the markDirty and HasEnded answers fed the spec, but Fable had to grep f_GetItemPrice itself, which was the one that mattered (it became the precedent for the whole horizon fix) |
| 11 | fable | fable | read Up.sql + DepositCalculator hunks; grep the pricing horizon; write the 12-group spec + horizon addendum | unmeasured | ~10 | ~25 min | 200-line spec | earned — the f_GetItemPrice precedent is what turned "product call" into an implementable fix |
| 12 | builder | opus | implement A–L across 30 files | 344,027 | 198 | 42.8 | DONE, all 12 groups; 3 self-reported deviations; 2 spec items challenged with evidence | earned — one dispatch, 30 files, build+tests green first pass; both challenges were correct |
| 13 | refuter | opus | adversarially verify the fix diff | unmeasured (died) | unknown | ~2 | DIED — HTTP 429 Opus session limit, right after "Build: 0 warnings" | waste — bought one build result; the refutation had to be redone inline |
| 14 | fable | fable | full refutation inline: rerun all 4 verify commands; 3 mutation checks; reproduce the migration CTE proof; audit the re-arranged test, the Price Checker path, the SQL fallback scoping, UITests leftovers, docs | unmeasured | ~16 | ~20 min | ACCEPT — every mutation failed its test as required; CTE reproved 396->427 with 0 pairs lost; Price Checker confirmed protected not broken | earned — and it is the only reason the accept is trustworthy after the refuter died |

**Totals (whole task):** 1,783,280 measured subagent tokens across 11 measured dispatches (9 review + scout + builder); refuter and both GPT mirrors unmeasured. Review phase 1,391,557 (78%); fix phase 391,723 (22%). Fable's own context unmeasured.

**Loop signal (fix phase)**
- Builder challenged 2 spec items and was right on both: the `EffectiveDate` null-RateSet branch is unreachable through the public API, and the today-fallback also fires for stays *before* the first period (a consequence the spec had not stated). Both disclosed rather than silently absorbed.
- Builder self-reported 3 deviations, all legitimate: the `NewPeriodStart` read-order trap, the `TestUrl` helper discarding route values, and the re-arranged propagation test whose premise change C invalidated.
- Refuter contributed nothing before dying. Fable's inline refutation found no defects the builder had not disclosed — the first run in this log where the adversarial pass came back clean.
- Mutation testing (3 of 3) is what made the accept evidence-based rather than trust-based. Worth making a standing step in the refuter's orders.

**Spec misses**
- The spec sent the scout after the pricing horizon but Fable found the decisive precedent (`f_GetItemPrice`) with one grep after the scout returned. Scouting a *question that decides a design* is a poor fit for haiku; scout locations, decide with Fable.
- The spec did not anticipate that change C would invalidate an existing propagation test's premise. A "list the tests whose premise your change breaks" line in the marching orders would have surfaced it before the edit.
- Dispatching an Opus refuter immediately after a 344k-token Opus builder ran into the session limit. Sequence Opus-tier dispatches with the limit in mind, or refute inline when the builder's spend was already large.
