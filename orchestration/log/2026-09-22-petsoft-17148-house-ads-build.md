# 17148 house ads build (tasks 17407 + 17408)

- Date: 2026-09-22
- Project: Petsoft
- Branch: feature/17148-house-ads (worktree C:\Development\Petsoft-17148-ads, off origin/develop 1b2aea306)
- Task: 17407 house ad table + Admin CRUD; 17408 Parent Portal slot + per-org Hide rule
- Outcome: shipped as DRAFT PR 5990 -> develop (commit 24c57b3aa). 17407 + 17408 + 17411 (+ sidebar) built, refuted, pre-PR reviewed (30 findings: 25 fixed, 5 wont-fix), tier gate added. Solution build 0 warnings; full unit project 2951/0/7; houseads UITest suite 8/8 twice.

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | fable | fable | Precedent greps (Maintenance CRUD, org rules, ImageUtility, ViewComponents), worktree, two specs | - | ~9 | - | specs written | earned |
| 2 | builder | opus | 17407 table, entity, model, controller, views, nav, 13 unit tests, 1 PW test, KmsDbTool + app run | 158,158 | 76 | 16.7 | DONE, screenshots | earned - complete on first pass; all claims later confirmed |
| 3 | refuter | opus | 17407 review, own mutation, sys.check_constraints query | 103,478 | 14 | 4.7 | REWORK: 1 must-fix (HasImage lost on invalid POST) + 3 should-fix | earned - real UX defect Fable did not see in the screenshots |
| 4 | builder (resume) | opus | rework: RefreshHasImage + test, drop spin(), RequestSizeLimit | 4,109 | 6 | 2.2 | 13/13 | earned |
| 5 | fable | fable | inline refute of the 3-edit rework instead of a second refuter | - | 1 | - | ACCEPT | earned - saved ~100k |
| 6 | builder | opus | 17408 slot component, HidePetsoftAds rule + Identifiers regen, Parents image action, 10 tests, 2 PW | 216,735 | 94 | 20.2 | BLOCKED: local jobs.JobType drift broke generator; UPDATE refused twice -> user ran it | earned - code complete; blocker was environment, correctly escalated |
| 7 | builder (resume) | opus | regen, build, 23 tests, mutation, app + 2 PW, screenshots | 36,930 | 35 | 10.8 | DONE | earned |
| 8 | fable | fable | line-ending repair of 8 views (3 attempts: sed CRLF, sed a, perl), Up.sql check, mobile screenshot review | - | 8 | - | 8-line diff | marginal - should have told the builder to fix its own sed edits |
| 9 | refuter | opus | 17408 review, own mutation on START_DATE (survived), db checks | 106,488 | 18 | 3.9 | REWORK: 2 flex-header placements + missing boundary test; 4 should-fix | earned - two visible layout defects on pages the builder never screenshotted |
| 10 | builder (resume) | opus | rework: move 3 slot lines (found Training itself), boundary test, cache header on hit only, log cleanup catches, 8 screenshots | 27,347 | 36 | 8.0 | DONE 24/24, 2/2 PW | earned |
| 11 | fable | fable | inline refute of rework; caught 2 XMLDoc misses both refuters passed (// block on HouseAdFeature, undocumented Invoke) | - | 3 | - | ACCEPT + 2 comment fixes | earned |
| 12 | fable | fable | full KennelManagementSystem.Tests run, background | - | 1 | 9.8 | 2935 pass / 0 fail / 7 skip | earned |
| 13 | builder | opus | 17411 Office dashboard slot + per-ad audience bits, component moved to shared, [Authenticated] image action, 31 tests, 3 UITest classes, app run | 202,074 | 149 | 25.8 | DONE; flagged cross-class UITest interference as "harness only" | earned - complete; the interference call is being refuted |
| 14 | refuter | opus | 17411 review; read pipeline YAML + AssemblyInfo to test the builder's CI-isolation claim | 108,357 | 23 | 4.0 | REWORK: UITest assertions flaky by construction (nightly runs all classes in one process); CK should-fix | earned - disproved a builder claim with file:line; would have been a red nightly |
| 15 | builder (resume) | opus | rework: per-ad href assertions + unique URLs, CK_HouseAd_AUDIENCE, single-invocation 3-class UITest run x2 | 19,315 | 27 | 8.7 | DONE 4/4 twice | earned |
| 16 | fable | fable | inline refute of rework: caught // block above a locator declaration and Assert.IsTrue on UI state (both refuters passed them) | - | 1 | - | 2 rule fixes sent | earned |
| 17 | builder (resume) | opus | XMLDoc on layout locators; ReloadUntilHouseAdAsync + Expect() instead of Assert.IsTrue | 8,249 | 42 | 12.2 | DONE 4/4 | earned |
| 18 | fable | fable | rebuild + full unit run #2 (1 fail, name lost to tail -3), HouseAd filter, full rerun #3 with trx: MarketingControllers_ClassifiesEveryNonAreaController - new root HouseAdsController unclassified; one-entry fix, Sitemap class 24/24 | - | 9 | ~25 | fixed | earned - but the lost failure name cost a 10-min rerun |

| 19 | fable | fable | seeded 3 test ads via sqlcmd, ran app for user testing, sidebar-vs-dashboard analysis | - | 6 | - | user chose sidebar main + dashboard kept | earned |
| 20 | builder | opus (user asked to try Opus 5.5) | Office sidebar slot: Sidebar.cshtml, _Layout + navigation.css, navigation.md, 1 UITest with CSS-selector mutation check | 146,558 | 64 | 11.0 | DONE; caught a spec error (.collapsed vs :not(.expanded)) by reading navigation.md | earned - accepted inline with zero fixes, first builder this task to do so |

| 21 | pre-pr-review x7 | fable (session model) | code-reviewer 142k, silent-failure 108k, playwright 112k, comment-analyzer 162k, type-design 94k, pr-test 102k, code-simplifier 136k | 856,031 | 80 | ~3 each, staged 3+3+1 | 1 issue / 7 warn / 13 sugg / 8 nit; 0 false positives at triage | earned - DISPLAY_ADS tier flag (code-reviewer) and both-portals rule copy (comment-analyzer) were real product findings the build loop missed |
| 22 | pre-pr-review-gpt x7 | gpt-5.6-sol via clodex | mirrors; 2 relaunched after a ~/.claude.json write race at 7-way launch | n/a | - | ~6 | 14 findings, 6 distinct from Claude (RevertAdminState doc, cleanup-before-mutation, NetworkIdle, random-render negatives) | earned |
| 23 | builder | opus | review fixes: 24 findings fixed + verified each; found DISPLAY_ADS=0 on every tier and held #22 for a decision | 186,724 | 66 | 18.8 | PARTIAL, correctly escalated | earned - the held finding would have shipped ads to nobody |
| 24 | builder (resume) | opus | #22 tier gate + Up.sql Free/Starter; 2 negative UITests; found suite orgs on Professional, stopped per orders with 3 options | 36,408 | 31 | 18.6 | PARTIAL, correctly escalated | earned |
| 25 | builder (resume) | opus | dedicated houseads UITest suite on Starter (Setup, TestBase, merged test class, runsettings, map doc) | 28,600 | 20 | 11.4 | DONE 8/8 x2 | earned |
| 26 | fable | fable | inline refute of gate + Up.sql; final full unit run 2951/0/7; ADO AC update; PR draft + memory updates | - | 8 | ~10 | ACCEPT | earned |

| 27 | builder | opus | 13 PR screenshots via throwaway Playwright test on the Starter suite org, real theme toggle, both viewports | 126,629 | 36 | 5.2 | DONE, repo clean | earned |
| 28 | fable | fable | upload 13 attachments, gallery comment thread 40345, description pointer (4000-char cap hit once) | - | 4 | - | done | earned |

| 29 | builder | opus | PR 5990 comments: downscale + CSS cap (Jackson), pending-upload cache (Darrius); 48 unit tests, 2 mutations, live check, 2 UITest classes | 188,405 | 75 | 21.0 | DONE; committed 7b151b09b | earned - both fixes right first pass; token-scoped cache key was its own security improvement over the spec |

## Totals
- Subagent tokens: build phase 1,105,806 (12 dispatches) + sidebar 146,558 + review 856,031 (7 Claude) + GPT mirrors (n/a) + fixes 251,732 (3) = 2,360,127 across 23 Claude dispatches + 7 GPT. Builders 1,110,000 = 47%; review agents 856,000 = 36%; refuters 318,000 = 13%.
- Full unit runs: 3 (one wasted on a lost failure name). Rule for next time: never pipe a full test run through tail; write to a file and grep it.
- Fable context: unmeasured (VSCode session, no status line available to the model)

## Loop signal
- 17407: 1 must-fix confirmed, 0 rejected, 1 REWORK round.
- 17408: 3 must-fix confirmed (2 layout, 1 boundary test), 0 rejected, 1 round; builder found a 3rd layout case itself.
- 17411: 1 must-fix confirmed (UITest isolation - refuter disproved a builder claim), 0 rejected, 1 round + 1 inline-refute round for 2 rule misses both refuters passed.
- Fable inline refutes caught 4 comment/Playwright-rule misses across the task that no refuter reported; refuters are strong on behaviour, weak on CLAUDE.md style rules.

## Spec misses
- Office spec named the component "HouseAdSlot"; builder kept "HouseAdSlotComponent" (correct - suffix not stripped). Spec should not rename things it did not read.
- No spec told any builder that a new non-area controller must be classified in SitemapControllerTests; cost a full-run failure. Belongs in the Known line for any root-controller task.
- The Office builder asserted a CI fact ("one suite per runsettings") without reading the YAML; the refuter brief had to ask for file:line. Builders should be told: claims about CI cite the pipeline file.
- 17407 spec said `default newid()`; builder used newsequentialid() (better). Spec should say "PK default per MaintenanceWindow precedent" instead of naming a function.
- Spec did not say "invalid POST must preserve load-only state" - the pattern is generic to the view-model convention and belongs in the template's Do-not list.
