# 2026-10-19 Petsoft #17979 (Story 17972): dashboard times + per-employee sort

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result | Rating |
|---|---|---|---|---|---|---|---|---|
| 1 | builder | opus | implement schema/controller/view/tests | 121.8k | 26 | 14 | DONE, green | earned |
| 2 | refuter | opus | refute round 1 | 109.8k | 23 | 9 | REWORK (missing Playwright test) | earned: caught repo-rule gap |
| 3 | builder (resumed) | opus | Playwright test + 2 should-fixes | 151.4k (as notified) | 19 | 7 | DONE, green | earned |
| 4 | refuter | sonnet | refute rework | 77.8k | 6 | 3 | ACCEPT; flagged rerun-reset risk | earned |
| 5 | silent-failure-hunter | session | pre-PR full tier | 85.2k | 9 | 2 | 0 findings | marginal |
| 6 | code-reviewer | session | pre-PR full tier | 101.7k | 12 | 3 | 0 findings | marginal |
| 7 | architecture-reviewer | session | pre-PR full tier (schema trigger) | 95.7k | 10 | 3 | 0 findings | marginal |
| 8 | comment-analyzer | session | pre-PR full tier | 95.3k | 8 | 2 | 1 suggestion (PR note) | marginal |
| 9 | playwright-reviewer | session | pre-PR full tier | 85.6k | 9 | 2 | 1 nit (Arriving reset) fixed | marginal |
| 10 | code-simplifier | session | pre-PR full tier | 79.5k | 6 | 1 | 1 nit fixed | marginal |
| 11 | debugger | opus | UITest booking 500 | 105.5k | 28 | 13 | environmental: another session's sqlcmd tx on shared Petsoft_DEV | earned: avoided a wrong product fix |

Totals: ~1.11M subagent tokens, 11 dispatches. Fable context at start/end: not captured this run.
Loop signal: pre-PR tier = full (schema + product code); it found only 1 suggestion + 2 nits after two refuter rounds. No later review/CI result yet.
Spec misses: (1) the builder spec did not require Playwright coverage, although .claude/rules/tests.md does; the refuter caught it, costing one rework round. Put "UI change => UITest + hooks in scope" in every UI builder spec. (2) The shared local DB was used by a parallel session's long transaction, which made the UITest fail twice and cost a debugger run. Check sys.dm_exec_sessions for open transactions before live runs.
