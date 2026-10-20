# 17266 — full UITests run on develop, fix failures

- Date: 2026-09-11
- Project: Petsoft
- Branch: bugfix/PET-17266_DevelopUITestFailures (worktree C:\Development\Petsoft-17266, off origin/develop c73b17cb6, unstaged)
- Task: #17266, run the full Playwright suite on develop after a batch of PR merges and fix what broke
- Outcome: shipped (unstaged). Run 1 (066cd3d0d) 271/22/6; run 2 (c73b17cb6 + fixes, Workers=2) 296/1/6, and the one failure (standby) passed on rerun; Demo category 1 pass / 1 PROD-only skip; solution build 0/0.

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | fable | opus (session) | DB copy + KmsDbTool on copy, app on :7399, run 1, diagnose deposit duplicate-id, dashboard reload race, `__Invariant` locator, order-dependent test; fixes; run 2; Demo run | unmeasured | ~110 | ~260 (mostly test wall clock) | 4 fixes + 2 doc updates | n/a |
| 2 | debugger | opus | Root-cause the 11:42 SQL timeout episode (onboarding "never returned" + login stalls) | 210,528 | 44 | 14.2 | Not locks: host RAM exhaustion paged out SQL Server memory (ring buffer + system_health evidence) | earned — stopped me from chasing a lock or code fix; explains Onboarding/StandardCancellation failures |
| 3 | debugger (resumed) | opus | Live-capture the ParentDiffFacility 35-min "POST hang" | 30,195 (delta) | 16 | 3.5 | Not a hang: Modern Standby, ERR_NETWORK_IO_SUSPENDED, Kernel-Power 506/507 | earned — decisive in minutes; revealed my keep-awake had to exist (and later that it was broken) |

| 4 | general-purpose (code-reviewer) | opus (session) | /pre-pr-review 2.3.2 on the unstaged diff | 137,219 | 23 | 3.4 | approved, 1 nit (merged) | earned — confirmed the reload wait has no early-return race and the order change is safe |
| 5 | general-purpose (code-simplifier) | opus (session) | /pre-pr-review | 101,934 | 8 | 1.4 | approved, 1 nit (dead guard) | marginal — correct, small |
| 6 | general-purpose (silent-failure-hunter) | opus (session) | /pre-pr-review | 110,901 | 12 | 1.9 | approved, 1 pre-existing suggestion | earned — the silent '' fallback is what hid the original bug |
| 7 | general-purpose (comment-analyzer) | opus (session) | /pre-pr-review | 137,357 | 27 | 3.4 | approved, 1 suggestion + 1 nit | earned — found the Demo-instructions mismatch I introduced |
| 8 | general-purpose (playwright-reviewer) | opus (session) | /pre-pr-review | 139,316 | 26 | 3.2 | approved, 2 nits | earned — error-surfacing in check-in helper |

Review: 5 findings (after merging), 0 false positives, all fixed in session and re-verified (11 UI tests + Demo).

**Totals:** subagents 867,450 tokens (review 626,727), ~31 min. Fable context unmeasured. Test wall clock dominates: run 1 1.3 h, run 2 2.7 h (of which ~65 min was the machine asleep).

**Loop signal:** no builder/refuter loop, since the fixes were 1-3 line edits verified by targeted Playwright reruns and then a full run. The diagnoses that needed breadth (DB DMVs, event logs, live stacks) went to the debugger; both reports changed the next action.

**Spec misses:**
- Did not keep the machine awake at the start of a multi-hour unattended run. It cost a failed test plus ~65 min of paused run. My first SetThreadExecutionState script silently failed (PowerShell parses 0x80000003 as a negative Int32; use [uint32]2147483651) and I did not check its output for 70 min.
- Did not check host free RAM, or the user's second app instance, before starting at Workers=3.
- Local `sa` SQL login fails; the connection override needs Integrated Security (cost one app restart).
- Demo instance needs DemoSiteUrl/MarketingSiteUrl/Hostname overrides (cost one Demo rerun; now documented).
