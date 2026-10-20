# 2026-10-05 Petsoft: functional test of PR 6073 (#12238 Emergency Vet contacts, Hunter Wall)

| # | Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Rating |
|---|---|---|---|---|---|---|---|---|
| 1 | builder | opus | baseline, build, unit; DB copy blocked on disk | 104,771 | 20 | 8 | BLOCKED (C: 24 GB free < 27 GB restore) | earned: baseline + unit reused |
| 2 | builder (resumed) | opus | copy, migration, T5, Playwright; cut off at session end | (no completion record) | - | ~15 | partial: migration + PW 27/27; login failed | marginal: walkthrough had to be redone |
| 3 | builder (resumed) | opus | fix login on copy, T1-T4, tenant probes, screenshots | 215,404 (cumulative; delta unknown) | 34 | 13 | DONE, all pass | earned |

Totals: ~320k subagent tokens, ~36 agent minutes. Fable context: unknown at start; not measured at writing.
Loop signal: no refuter (test-only task, no code change); pre-PR review tier n/a.
Spec misses: (1) brief never checked free disk before a 27 GB restore; (2) brief assumed real-user logins work on a p_DevSetup copy (emails scrubbed to <id>@petsoft.block, password unknown); next time say "set the qa.p_ReleaseTestOrgSetup PasswordHash on the copy"; (3) builder's walk script didn't assert login before GOTO, so screenshots of the Login page looked like results.
