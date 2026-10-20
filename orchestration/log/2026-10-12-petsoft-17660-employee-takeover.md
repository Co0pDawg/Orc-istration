# 2026-10-12 Petsoft 17660 - employee account/credential/token cross-org takeover

Date: 2026-10-12
Project: Petsoft
Branch: feature/17660-employee-account-credential-and-token (off develop; 7 commits, last 3f464c79e)
Task: Bug 17660 (P1 grouped bug: 17661/17663/17630/17629/17631/17665/17610 + 4 comment extensions), via /start
Outcome: shipped to branch (no PR, per /start). Build clean; full KMS.Tests 6277/0/253 on final commit; Core.Test 1767/0/12; live Playwright: clock-in 2/2, EmployeeLifecycle 4/5 (1 = local DB drift), ProfileSecurity 2/2, session cookie flags observed; supervisor override NOT verified (local DB lacks develop #17738 columns).

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | researcher | sonnet | Spec cluster A (Employees/Profile) from ignored tests | 187269 | 46 | 10.5 | 111-line spec; found stale ignore (#17584), exception-type constraint, CreateRole dropdown + Facilities gaps | earned - spec drove builder, surfaced 2 scope additions |
| 2 | researcher | sonnet | Spec clusters B/C/F | 144314 | 40 | 6.7 | Spec; SetPassword already fixed; InviteToPortal multi-org conflict | earned - produced the one user decision |
| 3 | researcher | sonnet | Spec clusters D/E | 104724 | 23 | 4.7 | Spec; SameSite reasoning, PURPOSE only on deletion issuer | earned |
| 4 | builder | opus | Build cluster A | 164803 | 36 | 13.8 | DONE 203/0/16, 6 mutation checks | earned |
| 5 | builder | opus | Build clusters B-F (second worktree) | 169877 | 50 | 15.1 | DONE 158/0/7, mutation checks | earned |
| 6 | refuter | opus | Refute A | 170680 | 38 | 10.1 | REWORK: Profile antiforgery, unpinned CreateRole UserId, cross-tenant PII in header | earned - 3 real defects |
| 7 | refuter | opus | Refute B-F | 140781 | 39 | 7.7 | REWORK: dead session id never cleared ("stay logged in" breaks) | earned - real defect |
| 8 | builder (resume) | opus | Rework B-F | 16395 (delta) | 11 | 5.7 | DONE 159/0/7 | earned |
| 9 | refuter | sonnet | Re-refute B-F rework | 80263 | 6 | 1.3 | ACCEPT | earned (cheap, confirmed) |
| 10 | builder (resume) | opus | Rework A | 27911 (delta) | 17 | 7.6 | PARTIAL: stopped correctly on admin org-switch case | earned - caught a spec flaw in Fable's must-fix 3 |
| 11 | builder (resume) | opus | Apply summary-filter decision | 8906 (delta) | 24 | 11.8 | DONE 224/0/16 | earned |
| 12 | refuter | sonnet | Re-refute A rework | 89244 | 10 | 4.1 | ACCEPT | earned |
| 13 | general-purpose | opus | pre-pr-review code-reviewer | 152153 | 30 | 5.5 | 1 warning (ProfileCredentials posted UserId), 1 nit | earned - pre-existing takeover-adjacent defect loop missed |
| 14 | general-purpose | opus | pre-pr-review silent-failure-hunter | 140212 | 25 | 4.1 | 4 warnings (merge link 500, silent DeleteRole, wording, hidden catch) | earned |
| 15 | general-purpose | opus | pre-pr-review architecture-reviewer | 126735 | 16 | 3.2 | 1 warning (same-request dead-cookie sign-in, StartDemo) + ChangeEmailModel leftover | earned |
| 16 | general-purpose | opus | pre-pr-review pr-test-analyzer | 168710 | 36 | 4.7 | Playwright locator breakage + 4 coverage gaps | earned - would have broken a UITest |
| 17 | general-purpose | opus | pre-pr-review comment-analyzer | 129441 | 18 | 2.1 | no findings | marginal - clean, but docs map check is its job |
| 18 | general-purpose | opus | pre-pr-review code-simplifier | 104250 | 8 | 1.3 | 2 suggestions (1 taken, 1 wont-fix) | marginal |
| 19 | builder (resume) | opus | Review fix batch (15 items) | 68303 (delta) | 40 | 11.8 | PARTIAL (item 5 untestable), 333/0/36, 11 mutation checks | earned |
| 20 | refuter | sonnet | Refute review fix batch | 92593 | 9 | 3.5 | ACCEPT + 1 doc-placement nit (fixed inline) | earned |
| 21 | builder | opus | Live Playwright verification in own worktree | 95104 | 37 | 11.8 | 4 suites run, cookie flags confirmed; override blocked by DB drift | earned |

## Totals
- Subagent tokens: ~2,583k across 21 dispatch rows (Opus ~1,850k, Sonnet ~733k). Wall clock ~2 h 45 m including waits.
- Fable context: unmeasured (status line / `/context` not readable from inside the session) - format miss, again.

## Loop signal
- Refuter must-fixes: 5 confirmed (all by Fable code read), 0 rejected. Two REWORK rounds on A (second was a decision, not a defect), one on B-F.
- Pre-PR review (full tier: product code, auth, schema) found 11 warnings after both loops ACCEPTed: 1 pre-existing security gap on a touched action (ProfileCredentials), 1 same-request session edge that a refuter-round builder had flagged and Fable waved off, 1 broken Playwright locator, 4 UX/error-path issues, 4 coverage gaps. Full tier justified; loop alone would have shipped a broken UITest.
- Live run caught nothing new; supervisor override unverified (local DB drift).

## Spec misses
- Fable's patch export (`git add -N .` + `git diff`) dropped a file deletion (ChangeEmailModel.cs); caught by architecture-reviewer. Next time: `git diff --binary` with `git add -A -N`-free path, or compare `git status` of both worktrees after apply.
- Fable's commit script used `$t` and `$T` in PowerShell (case-insensitive): 6 pushed commit messages carry a stray "KennelManagementSystem.Tests" and no trailer. Use Bash heredoc for commit messages.
- Fable's must-fix 3 (org filter on EmployeeSummaryModel) missed the admin org-switch case; builder stopped correctly.
- Fable waved off the builder's same-request dead-cookie edge case; two review agents then flagged it with a real trigger (StartDemo). Treat builder-flagged edges as findings until disproved.
- Initial `git checkout -q origin/develop --` detached the user's checkout (harmless, clean tree).
