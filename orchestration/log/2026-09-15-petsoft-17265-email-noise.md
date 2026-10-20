# 2026-09-15 — Petsoft — 17265 reduce non-prod email noise

Branch `task/pet-17265_reduce-nonprod-email-noise`. Session split across two models (Fable → Opus 5 for the review/fix loop → Fable). Assess ticket → config-first fix → 7-agent pre-PR review → builder/refuter round → 3 inline should-fixes.

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result | Value |
|---|-------|-------|---------|--------|-------|-----|--------|-------|
| 1 | researcher | sonnet | Map every non-prod email route, gates, recipients, p_DevSetup scrub | 112,496 | 43 | 5.0 | 6-question table, all cited | **earned** — every fact fed the plan; found `.block` scrub, `[DemoEmail]` gating, `sendOnly` no-row |
| 2 | code-reviewer | opus | Pre-PR correctness/security | 114,188 | 23 | 8.1 | 4 findings, needs changes | **earned** — found THE blocker (CC/BCC bypass sink filter) nobody else saw; verified 6 handlers accept `.sink` |
| 3 | silent-failure-hunter | opus | Error-handling pass | 93,022 | 15 | 6.7 | 5 findings, needs changes | **earned** — silent sink-fallback warning + caught my doc overstating delivery; 3 pre-existing defects correctly capped |
| 4 | comment-analyzer | opus | Comments/annotations/docs | 119,787 | 27 | 7.4 | 5 findings, needs changes | **earned** — `<returns>` contract mismatch, annotation/doc duplication, history narration in test XMLDoc |
| 5 | pr-test-analyzer | opus | Coverage | 98,665 | 19 | 5.8 | 2 findings, needs changes | **earned** — fixture never seeds `SupportDisplayEmail` so changed strings rendered empty and test still passed; both-blank gap |
| 6 | code-simplifier | opus | Over-engineering | 94,291 | 14 | 4.0 | 3 findings, approved | **earned** — guard predicate inconsistency (IsNullOrEmpty vs IsNullOrWhiteSpace); confirmed extraction + helper were house idiom, saving a pointless simplification |
| 7 | code-reviewer-gpt | GPT (clodex sol) | Mirror of #2 | n/a | n/a | ~14 | 2 findings | **earned** — independent confirmation of the blocker (cross-backend agreement) + widened it to release-notes BCC + address-validation gap nobody else raised |
| 8 | comment-analyzer-gpt | GPT (clodex sol) | Mirror of #4 | n/a | n/a | ~9 | 6 findings | **earned** — PROD-DEMO swept into "demo hosts" wording; `ExceptionEmail` wrongly in per-request list; two overstated claims |
| 9 | builder | opus | 14-fix spec | 134,665 | 49 | 19.8 | DONE, 2 honest deviations, self-mutation-checked | **earned** — clean; both deviations were the spec being wrong, correctly pushed back |
| 10 | refuter | opus | Adversarial check of #9 | 130,113 | 41 | 17.6 | ACCEPT, 4 should-fixes | **earned** — reproduced build/tests/mutation independently; found fixture value == fallback (test proved nothing), `??` misses blank, doc overstated re `OrgCampaignEmail` |

**Totals:** 8 Claude dispatches ≈ 897k tokens, 231 tool uses, ~74 agent-min; 2 GPT mirrors (tokens not reported by clodex). Fable/Opus orchestration overhead not counted. Test runs: 2 full `KennelManagementSystem.Tests` runs (one after original change, one at the end) + refuter's `Core.Test ~Email` (9 min). No solution-level `dotnet test`.

**Loop signal:** one builder→refuter round, ACCEPT. Refuter's 4 items: 3 spec-dictated (mine), 1 pre-existing. Fixed the 3 inline (~6 tool calls) rather than a second builder round — right call for a property, a const, and a sentence.

**Spec misses (all mine, all caught by the refuter):**
1. Told the builder to seed the test fixture with the same value as the hardcoded fallback → assertion could not fail. Should have specified a distinct value.
2. Mandated `?? "support@petsoft.com"` to match `Error.cshtml:8` → inherits that file's blank-key gap, the exact scenario my own annotation calls out for `ExceptionEmail`. "Match precedent" is not the same as "is correct".
3. Wrote an absolute sentence ("any new sender inherits the protection") into the verbatim doc text without grepping for senders that bypass `EmailHelper.Send`. `OrgCampaignEmail` does.
4. FIX 4's parenthetical claimed sunk exception mail is "recorded to the sink" — wrong, `sendOnly` writes no row. Builder caught it.

**Process notes:**
- Cross-backend agreement (Claude + GPT code-reviewer both independently finding the CC/BCC bypass) was the decisive signal to revert live config before UAT testing. Worth the GPT mirror on code-reviewer every time the change touches a shared path.
- I started the full test run *then* edited a file → DLL lock blocked the rebuild for 10 min. Rule already in CLAUDE.md ("one full run at the end"); the miss was editing after starting it. Full run goes after the *last* edit.
- Reporting the review before the last GPT mirror landed was right: finding 1 was live-risk and the mirror only strengthened it.
