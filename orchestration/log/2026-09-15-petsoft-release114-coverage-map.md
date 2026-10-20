# 2026-09-15 Petsoft — Release 114 UAT run + plan-wide Playwright coverage map (story 17329)

| # | Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | scout | haiku | map 7 manual suites -> Playwright classes + runsettings | 82,971 | 32 | 3 | 12 classes identified, correct | earned — picked the run list without Fable reading UITests |
| 2 | researcher | sonnet | per-case coverage map, Cooper's 53 cases | 208,923 | 41 | 6 | 12/23/18, 10 candidates | earned — read method bodies, not names |
| 3 | researcher | sonnet | per-case map, Darrius's 63 cases | 139,679 | 53 | 7 | 5/27/31, found Bulk Cancellation has zero page object | earned |
| 4 | researcher | sonnet | per-case map, Jackson's 60 cases | 144,355 | 59 | 7 | 2/26/32, PriceCheckTests covers one adjustment type | earned |
| 5 | researcher | sonnet | per-case map, Hunter's 40 cases | 151,981 | 65 | 9 | 4/14/22 | earned |

Fable inline: ADO fetches + step dump script, worktree at 953cbdb38, 12-class UAT loop (81 pass / 0 fail / 2 expected skips, ~75 min wall), map merge, story 17329 + attachment.

**Totals:** 5 dispatches, ~728k agent tokens, 250 tool uses, ~32 agent-min; 4 researchers ran in parallel with the UAT loop so wall clock was the test run.

**Loop signal:** none — no builder/refuter loop; read-only research only.

**Spec misses:**
- Scout's suggested run command had the env var in the wrong place (harmless, Fable wrote its own loop).
- Two researchers reported large heredoc file writes failing in Bash; they split into appends. Add "write big files in chunks" to researcher orders next time.
- Fable's first PowerShell step-dump script failed on `$rid:` string interpolation; writing scripts to a file first would have saved one round trip.
