# PR 5907 pre-PR review (hotfix/17255-self-guided-demo-corrections → main)

Task: run `/pre-pr-review` 2.3.2 on Ira's #17255 self-guided demo hotfix. Read-only review, 5 agents mirrored on GPT.

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| code-reviewer | opus (session) | correctness/security/schema | 124,103 | 24 | 8.5 | 4 findings, incl. the DemoFeedbackEmailHandler downstream catch | earned |
| silent-failure-hunter | opus (session) | error handling | 113,208 | 22 | 6.0 | 2 findings, incl. the highest-value behavioural one (retry-queued → second org) | earned |
| comment-analyzer | opus (session) | comment/annotation/doc accuracy | 115,745 | 20 | 4.8 | 4 findings, 3 at issue | earned |
| pr-test-analyzer | opus (session) | test coverage | 114,530 | 17 | 7.8 | 6 findings; also ran the suite green | earned |
| code-simplifier | opus (session) | over-engineering | 95,706 | 9 | 2.1 | 6 findings, incl. the IsSyntheticRequest reuse catch | earned |
| code-reviewer-gpt | gpt-5.6-sol | GPT mirror | n/a | n/a | ~9 | 4 findings; 1 warning rested on a false premise | marginal |
| silent-failure-hunter-gpt | gpt-5.6-sol | GPT mirror | n/a | n/a | ~3 | 0 findings — missed the retry-queue finding its counterpart got | waste |
| comment-analyzer-gpt | gpt-5.6-sol | GPT mirror | n/a | n/a | ~6 | 7 findings; **uniquely caught the overstated security rationale** (3 issues) | earned |
| pr-test-analyzer-gpt | gpt-5.6-sol | GPT mirror | n/a | n/a | ~5 | 1 finding, overlapped its counterpart | marginal |
| code-simplifier-gpt | gpt-5.6-sol | GPT mirror | n/a | n/a | ~2 | 7 findings, heavy overlap | marginal |

**Totals:** 5 Claude agents ≈ 563k tokens / 92 tool uses / 29 agent-minutes (wall clock ~9 min, fully parallel). 5 GPT mirrors, tokens not reported by the worker harness. Orchestrator did ~14 direct tool calls (branch metadata, diff, worktree, agent-def extraction, 3 verification reads).

**Loop signal:** the GPT mirror paid for itself on exactly one agent — `comment-analyzer-gpt` was the only one of ten to notice that the PR's stated security motivation is factually wrong, which is the most consequential finding in the run and also affects the PR description. The other four mirrors returned overlap, one false-premise warning, and one empty result. Worth keeping the mirror on `comment-analyzer` specifically; the rest are low-yield on a diff this small.

**Orchestrator error (superseding what this line first claimed):** three agents (two GPT, one Claude) built findings on the premise that a `.sink` address makes `EmailHelper.Send` succeed. I read `EmailHelper.cs`, saw `RenderAsync()` precede the sink short-circuit, and concluded they were wrong — filing my own finding against the branch. Running one test in isolation showed *they* were right: RazorLight renders fine in the harness. The rule survives but needs its second half: **when 2+ agents share an uncited premise, verify it — and prefer the runnable check over the careful read, because static call order is not evidence about runtime behaviour.** See the fix-phase note below; this same mistake is the run's only false positive.

**Spec misses:** the `pr-test-analyzer` dispatch carried a typo'd scratchpad path for the context file; the fallback path in the same prompt covered it and the agent completed normally. Build the dispatch prompts from one variable next time rather than hand-editing each.

---

## Fix phase (same task)

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| builder | opus | apply 7-file fix spec | 133,457 | 36 | 7.4 | build clean, 54/54; flagged 2 spec-vs-code gaps | earned |
| refuter | opus | adversarial review of the diff | 105,507 | 22 | 5.0 | REWORK — caught a defect the spec itself introduced | earned |
| builder (resumed) | opus | 2 rework fixes | 138,403 (delta) | 8 | 1.7 | both applied, still green | earned |

**Fix-phase total:** ~377k tokens / 66 tool uses / 14 agent-minutes.

**Loop signal:** the refuter paid for itself outright. My spec told the builder to preserve "confirmed the previous day" in `DemoFeedbackEmailHandler`'s XMLDoc; that phrase is itself wrong (the query filters rows *created* yesterday and consumed *now*, and there is no consumed-at column). The builder obeyed the spec, the refuter caught the spec. **A refuter that reviews only against the spec would have missed this — instructing it to check claims against source, not against the spec's paraphrase, is what found it.**

Second refuter win: it mutation-tested the new window test (dropped the probe's upper bound, confirmed red, reverted). That is the check I would have taken on faith.

**Orchestrator error worth recording:** I filed a finding (#7) asserting the branch's `.sink` comment was wrong, reasoning from `RenderAsync()` preceding the sink short-circuit in `EmailHelper`. Running one test in isolation disproved it. Static call-order reading is not evidence about runtime behaviour; the 15-second experiment beat the careful read, and it also unblocked a real finding (#12) that only became visible once the harness behaviour was settled.

**Spec misses:** one substantive (the `DemoFeedbackEmailHandler` wording above). The builder's two unprompted spec-vs-code notes were both correct and both worth adjudicating — keeping "report anything in the spec that turns out wrong against the code" in the Do-not section earned its place twice.
