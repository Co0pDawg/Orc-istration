# 2026-10-22 Petsoft PR 6242 peer review (#18009, Jackson Keith, pet cards + inline note edit)

score=994 tier=XL (size L + risk bump). risk hits: KennelManagementSystem.Schema/dbo/Tables/PetNote.sql, history/Tables/PetNoteHistory.sql; also id-driven tenant POSTs (NoteInline, DescriptionInline, NoteCreateInline). Product 875, tests 471, docs 8. Clean trial merge with develop. GPT mirror not offered (Claude only).

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | code-reviewer | opus (session) | panel | 149,555 | 29 | 8.4 | 2 issues, 2 warnings | earned: history hides pre-edit text, ToDictionary 500 |
| 2 | architecture-reviewer | opus (session) | panel (forced at XL) | 153,427 | 32 | 6.4 | 3 warnings | earned: history text, non-idempotent clear, deleted-account text (became round 2) |
| 3 | silent-failure-hunter | opus (session) | panel | 122,882 | 22 | 5.6 | 1 issue, 2 warnings, 3 suggestions | earned: error page appended as a note (reproduced live), session-expiry loop |
| 4 | builder | opus | live How-to-Test + 3 UITests, own worktree, Petsoft_PR6200 | 198,523 | 91 | 41.6 | 6/6 PASS, UI 3/3, F4 reproduced | earned: live proof of F4 incl. stack trace in notes list |
| 5 | comment-analyzer | opus (session) | panel | 162,646 | 24 | 6.1 | 1 issue, 1 warning, 1 suggestion | earned: stale UITests map |
| 6 | type-design-analyzer | opus (session) | panel | 118,793 | 16 | 4.1 | 1 warning, 1 nit | marginal: warning duplicated code-reviewer/arch |
| 7 | playwright-reviewer | opus (session) | panel | 115,866 | 17 | 3.7 | approved, 0 findings | marginal |
| 8 | code-simplifier | opus (session) | panel | 146,189 | 22 | 5.5 | 2 suggestions, 5 nits | marginal: none actioned |
| 9 | refuter | opus | verify 9 findings | 151,529 | 48 | 10.3 | 7 confirmed, 1 partial, 1 refuted | earned: F8 pre-existing on Bug 17586; DB facts (2 multi-org users, 36 deleted-customer pets) |
| 10 | builder | opus | fix F1-F5, F7, F9 | 168,900 | 67 | 21.1 | done, 5 mutations red | earned |
| 11 | refuter | opus | refute fix diff | 139,783 | 29 | 15.9 | REWORK (1 must-fix, test-only) | earned: OrderBy-by-history-key untested |
| 12 | builder (resumed #4) | opus | live re-check of fixed paths | 39,615 (delta) | 30 | 19.4 | 4/4 PASS, UI 3/3 (1 Arrange-timeout rerun) | earned |
| 13 | builder (resumed #10) | opus | rework 1 | 9,887 (delta) | 12 | 5.1 | done, OrderBy removal red | earned |
| 14 | builder (resumed #10) | opus | round 2: deleted-customer guard + facility time | 27,414 (delta) | 32 | 11.0 | done, 3 tests red/green | earned |

Totals: 1,705,009 subagent tokens over 14 dispatches. Panel 969,358 = 57%; verify 151,529; fix loop 345,984; live 238,138. KennelManagementSystem.Tests ran twice in full, by Fable: 6821 pass at 12:24-12:28 PM (after the 12:21 PM edit), then 6825 pass at 12:44-12:48 PM (after round 2's 12:41 PM edit). A comment-only reword after that got a rebuild, not a rerun. Round 2 was not re-checked live; views are compile-checked by the build only. Fable context: ~15.00M remaining at start → 14.71M at writing (~290k used).
Loop signal: tier XL, full panel. Stage 1 (code, arch, errors) found every confirmed issue. Stage 2 (types, playwright, simplifier) added only duplicates and nits, the same pattern as PR 6218, so stage 2 on XL looks like the place to trim. The refuter's verify pass cut 9 findings to 7 and kept a pre-existing defect from being re-filed. The fix refuter caught a mutation gap a builder self-check missed. The live run reproduced F4 end to end and confirmed the fixes. Light tier not applicable (product code). No later review or CI catch known yet.
Spec misses:
(1) The F3 spec asked for a general "same as the previous version" dedupe without sizing it. It hides about 12.5k of 25.8k DEV Edited rows; the builder flagged it. Size a filter's data impact in the spec before choosing it.
(2) The live brief's probe (e) suggested an invalid NOTE_TYPE to force a server error, but it does not fail (no FK). State such probes as "find a way to force X", not as a recipe.
(3) The builder's first test filter named a nonexistent class, so pass counts differed between runs (108 vs 100) and cost a check. Name only real classes in filters.
(4) Fable's own comment Edit was refused for want of a Read; read the lines before an inline edit.
Outcome: pushed d216f2943 + d57331b11 to task/PET-18009_ImproveNotes (fast-forwards from 1ada10b47; auto-complete set). PR threads 42626 (summary) and 42635 (round 2). Calibration sweep trigger tripped (503 new verdicts since the 2026-10-01 marker); /calibration-report offered.
