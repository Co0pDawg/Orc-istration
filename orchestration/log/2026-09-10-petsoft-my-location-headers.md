# Orchestration Log: Petsoft 12668 My Location headers

Date: 2026-09-10
Project: Petsoft (C:\Development\Petsoft)
Branch: task/PET-12668_MyLocationHeaders (off origin/develop, no upstream, unpushed)
Task: User story 12668 — dashboard heading, header crumb, sidebar category, and Switch page say "My Location"/"Location" instead of "Facility"; "Runs" untouched
Outcome: shipped to working tree, unstaged. Build 0 warnings, MSTests 2455/0 (builder run, before a property deletion that build-verified), ContextSwitch Playwright 3/3 twice against the running app, screenshots light/dark/mobile for single- and multi-facility employees. Not verified: DemoSignup Playwright (local site is not in demo mode — environmental), synthetic monitor against prod.

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|-------|-------|---------|--------|-------|------|--------|-------|
| 1 | fable | fable | fetch ADO story + parent, grep the two named files, layout crumb, PageTitle, tests asserting the old strings; one scope question; user added 3 more surfaces from screenshots; spec | unmeasured | ~14 | ~20 min | 40-line spec with a before/after table | earned — the story named 2 files; the real surface count was 5 and the prod-monitor trap was only visible from the grep |
| 2 | builder | opus | implement spec across 11 files, build, MSTests | 138,487 | 33 | 17.9 min | DONE, 4 deviations reported honestly; left BOMs on 4 UITests files via its edit script | earned — one-shot on all spec rows; BOM churn was a 1-line fix for Fable |
| 3 | refuter | opus | static review vs spec, greps for old-string consumers, reachability of the single-facility branch, monitor body check | 140,211 | 41 | 8.7 min | REWORK: 4 must-fix (stale locator comment, dead KennelFacilityName property, `.crumb div` scope, uitests-map row) + 2 should-fix (narrating comment, bare h1 locator) | earned — dead property and stale comment were real and Fable had not seen them; `.crumb div` was overruled (Fable's deliberate fix for a verified rendering defect) |
| 4 | fable | fable | read diff, strip BOMs, restart app, Playwright screenshot script via Microsoft.Playwright.dll from PowerShell (5 contexts, light/dark/mobile), found dark-mode crumb color + tight separator, 2 CSS fixes, applied 5 rework edits inline, rebuild, rerun ContextSwitch | unmeasured | ~22 | ~45 min | all green; 2 visual defects only a screenshot could catch | earned — the two CSS defects were invisible to build, MSTests, refuter, and Playwright text assertions |

| 5 | 5× pre-pr-review agents | fable (session) | code-reviewer, silent-failure-hunter, comment-analyzer, playwright-reviewer, code-simplifier in parallel | 518,699 | 79 | ~5 min wall | 0 issue / 1 warning / 4 suggestion / 1 nit; 3 agents clean | earned — playwright-reviewer's warning (unreachable single-facility crumb) was real and neither builder nor refuter saw it |
| 6 | 5× GPT mirrors | sol (high) | same five agents via clodex-worker | n/a (external) | n/a | ~8 min | 4 approved with 0 findings; code-simplifier-gpt failed twice (OpenAI usage limit) | waste — four empty approvals added nothing; the one mirror that might have disagreed with Claude's simplifier never ran |
| 7 | fable | fable | verify 6 findings, apply all inline (scripted byte-level edits after a heredoc quoting failure), rebuild, restart app, 10/10 Playwright, dark screenshot | unmeasured | ~12 | ~25 min | all six confirmed-fixed; two reviewer rationales refuted with evidence (Switch redirect, dark rule not a no-op) | earned |

**Totals:** 797,397 measured subagent tokens; ~40 min agent wall clock; Fable ~90 min. 1 REWORK round, resolved inline (5 small edits) rather than a builder resume. Review round: 6 findings, all fixed inline.

**Loop signal**
- Builder: 0 spec defects found; 1 tooling defect introduced (BOMs).
- Refuter: 4 must-fix → 3 accepted, 1 overruled with evidence (screenshot); 2 should-fix both applied. 0 false positives on facts, 1 on judgment.
- Visual verification found 2 defects nobody else could; keep the screenshot script pattern (PowerShell + UITests' Microsoft.Playwright.dll, no npm).

**Spec misses**
- Spec said "`.crumb span` only if needed"; reality needed span + div + a dark-mode rule. Spec should have said "verify the crumb in dark mode and with a plain-text org crumb" as a must-verify.
- Spec's test login guidance was absent; first multi-facility candidate (Test Org1) had one facility assignment. Query UserKennelFacility, not KennelFacility per org.
