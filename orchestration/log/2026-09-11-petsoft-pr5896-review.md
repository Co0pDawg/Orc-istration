# PR 5896 pre-PR review (bugfix/PET-17230-Facility-Service-Page-Forces-Zero-Weight → develop)

Task: run `/pre-pr-review` 2.3.2 on Darrius's #17230 (109 files, +3010/−380). Read-only review, 6 agents, all 6 mirrored on GPT at Cooper's request.

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| code-reviewer | opus (session) | correctness/security/schema | 345,190 | 57 | 9.0 | 6 findings, incl. two only it found: the Kennel Card varchar(5) overflow (confirmed on the local DB) and the null weight on a 0-based ladder | earned |
| silent-failure-hunter | opus (session) | error handling | 339,551 | 53 | 10.3 | 12 findings; independently matched code-reviewer on 3 and added the 0-writers (importer, qa proc) and the stale ConfirmWarnings gate | earned |
| type-design-analyzer | opus (session) | type design | 207,926 | 45 | 8.3 | 5 findings; WeightBand.Fits(null) and PetEditModel double?/decimal? are real | earned |
| comment-analyzer | opus (session) | comment/annotation/doc accuracy | 578,952 | 47 | 14.3 | 20 findings, 11 at issue — the doc drift from the allowLowestTierWeightFallback rule changing mid-branch | earned |
| pr-test-analyzer | opus (session) | test coverage | 395,622 | 55 | 11.7 | 56 findings (46 warning); 5 test-quality catches (3 assertions that can never fail, 1 test passing by construction) verified | earned (volume high; 18 near-identical fallback-site rows) |
| code-simplifier | opus (session) | over-engineering | 279,665 | 39 | 6.6 | 14 findings; the ComputeUnderweightPets/GetWeightWarning duplication fed a comment-analyzer issue | earned |
| silent-failure-hunter-gpt | gpt-5.6-sol | GPT mirror | n/a | n/a | <1 | HTTP 429 usage_limit_reached | waste |
| type-design-analyzer-gpt | gpt-5.6-sol | GPT mirror | n/a | n/a | <1 | HTTP 429 usage_limit_reached | waste |
| comment-analyzer-gpt | gpt-5.6-sol | GPT mirror | n/a | n/a | <1 | HTTP 429 usage_limit_reached | waste |
| pr-test-analyzer-gpt | gpt-5.6-sol | GPT mirror | n/a | n/a | <1 | HTTP 429 usage_limit_reached | waste |
| code-simplifier-gpt | gpt-5.6-sol | GPT mirror | n/a | n/a | <1 | HTTP 429 usage_limit_reached | waste |
| code-reviewer-gpt | gpt-5.6-sol | GPT mirror | n/a | n/a | ~20 (stopped) | no output after 19 min, no Codex rollout for the day; stopped, treated as failed | waste |

**Totals:** 6 Claude agents ≈ 2.15M tokens / 296 tool uses / 60 agent-minutes (wall clock ~14 min, fully parallel). Orchestrator ≈ 25 direct tool calls: branch metadata, ADO PR and work item, worktree, agent-def extraction, prompt build, and 3 verification batches.

**Loop signal:** the quota preflight in memory (`feedback_subagent_model_tiering`) only reads the newest `~/.codex/sessions` rollout, and the newest one was from 2026-07-20. A stale snapshot reads "0% used" and gets reported as fine. Five mirrors 429'd within seconds. **Fix:** when the snapshot is more than a day old, treat quota as unknown and say so in the mirror question. Better still, send one cheap sol call as a probe before fanning out six.

**Verification:** 2+ agents shared a premise on 5 findings. All were checked before the report, and all held: the Kennel Card cast raises Msg 8115 on the local DB; `Resolve` line 83 lifts null to false; Mobile `decimal Weight` became `decimal?`; the PetServiceRates assertions sit next to an override that never writes that table; the TrainingController catch zeroes the deposit. The runnable DB check again beat reading, and it took seconds.

**Spec misses:** the pr-test-analyzer cap (40 lines) forced a file hand-off at 56 findings. That was fine, but on a 109-file diff the per-call-site rows are mostly one finding repeated 18 times. Next time on a diff this size, tell pr-test-analyzer to group repeated call-site gaps into one row per pattern, listing the sites.

---

## Fix phase (2026-09-11 → 09-14, spanned a session restart)

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| builder A | opus | Core pricing + staff portal + comments + tests (spec-A, 13 parts) | 400,651 | 200 | 42.3 | 49 files; all rows done; 2 justified deviations (Fits(null) reads as 0, not false — better than spec) | earned |
| builder B | opus | Mobile API + schema audit + importer + Invoice Edit flag (spec-B) | 267,894 | 89 | 17.6 | 15 files, 12-object schema audit, 228 tests green; surfaced the RunGroupPetWeight null→0 decision | earned |
| refuter r1 | opus | adversarial review of merged diff | 238,808 | 53 | 44.3 | REWORK — caught the ExtendItinerary re-render dead end (ServiceWeightBands not repopulated) + 5 should-fixes; mutation-tested 3 rules | earned |
| builder A (resumed) | opus | rework 1: re-render fix, one null rule for mobile, PII in log, docs | 429,548 (delta) | 22 | 6.4 | done; found a third `return View` path with the same hole unprompted | earned |
| refuter r2 | opus | second-round review | ~239k (est; session ended before completion record) | ~50 | ~45 | REWORK on docs only — "a band is only emitted for a positive minimum" false in 4 places; JS/C# parity claim wrong | earned |
| builder A (resumed) | opus | rework 2: JS parity + 4 doc sites + test wording | 460,118 (delta) | 16 | 10.7 | done | earned |

**Fix-phase total:** ≈ 2.04M tokens / ~430 tool uses / ~167 agent-minutes. Full MSTest suite (4 projects, run by the orchestrator): 826 + 2478 + 47 + 0(12 skipped) passed, 0 failed.

**Loop signal:** two-builder parallel split by file ownership worked — zero overlap, B's patch applied clean. Refuter r1 found a real dead-end the builder's own tests could not see (a re-render bug needs the view's state, not the action's return value) — the "trace one staff path end to end" order is what found it. Refuter r2's value was catching over-confident doc prose written to justify a deviation; when a builder deviates from spec, tell the next refuter to verify the *stated invariant* the deviation rests on, not just the code.

**Orchestrator errors:** (1) ran `dotnet test KennelManagementSystem.sln` — UITests is in the .sln and hangs with no app; cost ~45 min before I noticed. Run the four MSTest projects by name. (2) Two REWORK rounds meant I read the final diff myself (per the rule) instead of a third refuter — right call, the diff was clean.

**Spec misses:** spec A said `Fits(null)` must be false; the builder correctly argued null-as-0 (a 0-based band is exactly what Resolve can price). Spec B's B1b then contradicted A2 by asking mobile to block null outright — reconciled in rework 1. Write the cross-cutting rule once, in one spec, and reference it from the other.

---

## Fix phase 2 — "address the rest" (2026-09-14)

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| builder C | opus | 23 MSTest rows + CreateClaim tenant filter (spec-C) | 282,133 | 113 | 44 | 11 rows + C1; hit the TestKmsDbContext FromSqlInterpolated wall, 4 tests [Ignore]d, 17 unattempted | earned |
| builder C (resumed) | opus | unblock the test double (proc mirrors), finish rows | ~125k (delta) | 85 | 76 | 12 more rows, 0 [Ignore]; two behaviour findings (one overstated, one real); mutation check caught its own pass-by-construction test | earned |
| builder D | opus | 6 Playwright gaps with a private DB copy + live app (spec-D) | 423,042 | 283 | 129 (incl. ~45 waiting on suites) | 5/6 green live; row 29 proven unreachable through the UI; 1 view id; map + coverage-gaps docs; fixed a pre-existing UITests bug that blocked run seeding | earned |
| builder E | opus | AdvancedBook gate + orphan cleanup, fixture correction, last 9 rows (spec-E) | n/a (no completion record) | n/a | ~60 | all items done, 3 mutation checks red/restored; its Tests suite run died at startup, orchestrator re-ran it | earned |

**Phase total:** ≈ 0.83M+ tokens (E unrecorded) / ~480 tool uses / ~310 agent-minutes; wall clock ≈ 3h20 (C ∥ D, then E). Six full MSTest suite runs happened across the phase (each builder ran both projects, ~22 min a pair) plus two by the orchestrator.

**Loop signal:** (1) The "two disjoint builders in two worktrees, patch-apply the smaller one" split worked a second time with zero overlap — keep it. (2) Sequencing cost: every builder was told to run BOTH full suites (~22 min) as its own verification, and then the orchestrator ran them again — that is ~90 min of pure re-running. Next time: builders run the filtered tests they touched; the orchestrator runs each full project ONCE at the end, in the background, while the refuter does its static pass. (3) A builder's notification can arrive twice (interim + final) and its Agent task id can vanish before the final notification — read the report file and the run logs on disk rather than waiting on the notification. (4) When a builder asserts a behaviour finding that contradicts an earlier builder + refuter, read the code and the fixture yourself before speccing a fix: C's "bands key on rate levels, not prices" was an inactive-level fixture artefact, and the fix was a comment + fixture correction, not a code change.

**Orchestrator errors:** told E "nothing else runs in this worktree" and then let it run both full suites concurrently — its Tests run died at startup (log stopped after the header, no testhost). Likely the two vstest hosts contending; unproven. Serialise the two suites next time.

**Spec misses:** spec C's row-36 assumption ("AddTrainingClassSessionTests seeds a class") was wrong — C caught it. Spec C also under-called the InMemory-provider wall; a one-line "TestKmsDbContext may be extended with proc mirrors" would have saved the resume round.
