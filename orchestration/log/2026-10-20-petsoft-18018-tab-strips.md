# 2026-10-20 Petsoft: Tab strip restyle + Admin tab groups (#18018 / Task #18019) -> branch pushed, PR not opened

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| builder | opus | site.css restyle, site.js active-tab scroll, _AdminLayout 5 dropdown groups, 1 Playwright test, map rows, live screenshots | 186,019 | 104 | 25.5 | DONE | earned: specificity trap handled, popper clip avoided, 13 screenshots, mutation proven |
| refuter | opus | review of builder diff | 136,512 | 50 | 12.9 | ACCEPT + 2 should-fix | earned: clipped keyboard focus ring (real a11y gap) |
| playwright-reviewer | session (opus) | pre-PR review | 81,624 | 9 | 1.7 | approved | marginal |
| silent-failure-hunter | session (opus) | pre-PR review | 86,514 | 8 | 2.8 | approved | marginal |
| comment-analyzer | session (opus) | pre-PR review | 96,154 | 8 | 1.8 | 2 suggestion | earned: stale "Campaigns tab" wording in a mapped doc; dropdown-in-strip rule now in ui-style-rules.md |
| code-reviewer | session (opus) | pre-PR review | 103,415 | 12 | 4.4 | approved | marginal (surfaced pre-existing Book.cshtml duplicate id, out of diff) |
| code-simplifier | session (opus) | pre-PR review | 89,235 | 6 | 1.5 | 1 suggestion / 1 nit | earned (cheap: -3 CSS lines, one aria-current helper) |
| builder | opus | customer tabs 7 + More menu (scope added after Cooper tested), page objects, 1 assertion | 160,446 | 65 | 28.9 | DONE, Fable reviewed inline | earned: one row at 1400px measured; flagged 2 GA failures, which Fable proved pre-existing with a develop baseline run |

| silent-failure-hunter | session (opus) | final pre-PR review | 94,016 | 12 | 2.6 | approved | marginal |
| playwright-reviewer | session (opus) | final pre-PR review | 91,840 | 12 | 2.7 | 1 suggestion | earned: map note that More-menu tabs need ClickMoreMenuItemAsync |
| code-reviewer | session (opus) | final pre-PR review | 113,332 | 15 | 4.0 | approved | marginal |
| code-simplifier | session (opus) | final pre-PR review | 91,529 | 5 | 1.5 | 1 nit | earned (cheap: -4 lines) |
| comment-analyzer | session (opus) | final pre-PR review | 111,665 | 14 | 2.8 | 1 suggestion (same as playwright-reviewer) | marginal |

Totals: 13 dispatches, ~1.44M subagent tokens. Fable context: start and end not measured (no /context reading taken). Outputs: Story 18018, Task 18019, commits 51af30251, 1a0fce182, 783ad1b50, 64508ef71, 4a5674f81 (develop merge), b7853da85; DRAFT PR 6254; follow-up story 18028 on feature/18018-modernize-office-portal-tab-strips (worktree C:\Development\Petsoft-18018).
Loop signal: full pre-PR review tier (product CSS/view). Refuter found the only behavior gap (focus ring); review found only doc/simplification items. A CSS + one-view diff with a refuter ACCEPT might fit a "light-plus" tier (code-reviewer + comment-analyzer + simplifier) next time. Second full-tier run (after the More menu) found 1 suggestion + 1 nit; ~500k for that is heavy for a view-only follow-up - a scoped rerun (code-reviewer + playwright-reviewer) would have caught both. No CI result yet.
Spec misses: spec did not anticipate the scroll container clipping Bootstrap's focus ring; spec omitted a ui-style-rules.md note for dropdowns inside tab strips. Ops miss: Fable's AdminTests rerun hit a foreign app on :7199 (our app failed to bind, the health check passed against the other app) -> 8/18 connection-refused failures; fixed by checking the listener's process path before testing. Left one QA_HouseAd_Happie432135 house ad in local Petsoft_DEV from that aborted run's failed cleanup.
