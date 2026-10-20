# 2026-10-19 · petsoft · Orchestration Board v6-v14 (agent progress probe)

Board design work was done inline (single HTML file, v6 to v14); one dispatch only.

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| builder | haiku (override) | Probe: can a subagent write to the board's ArtifactData store without a prompt | 69k | 7 | 1.9 | set + pinned update OK, no prompt | earned (settled the open question before rewriting builder/refuter defs) |

**Totals:** 1 dispatch, 69k subagent tokens. Fable context at start and at writing: not captured (no status-line reading taken).

**Loop signal:** no build loop and no pre-PR review tier; this is not repo code. One cross-session miss: two board-rule messages went to the worklog session (petsoft-17) because the target was picked from the list by start time. Fixed by matching the transcript's first write today to the process start time (10:51 AM, renamed "Unified monthly calendar").

**Spec misses:** none in the probe brief. A haiku builder was enough for a tool-permission probe.

## Addendum: v15 module split (same day)

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| builder | opus | Split the 845-line page into css/js modules plus README, STANDARDS, tests and a preview harness | 202k | 71 | 27.1 | DONE: 9/9 tests, DOM parity with v14 in both skins | earned |
| refuter | opus | Review the split against v14: inventory, CSS cascade, publish readiness, standards | 161k | 20 | 6.7 | REWORK: 5 STANDARDS/escaping must-fixes, fixed inline by Fable (no second builder round) | earned (found 2 real escaping gaps carried from v14) |

**Totals (split):** 2 dispatches, 363k subagent tokens. **Loop signal:** builder, then refuter REWORK; doc-level fixes made inline, then tests rerun 9/9. No pre-PR review tier, since this is not repo code. **Spec misses:** `node --test tests/` fails on Node 22, so the glob form is needed. Headless Edge left about 27 unkillable processes; future previews should reuse one user-data-dir and one Edge run at a time.
