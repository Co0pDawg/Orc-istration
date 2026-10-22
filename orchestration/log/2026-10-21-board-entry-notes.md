# 2026-10-21 · board + worklog · Accurate entry notes (per-entry roll-up blocks, waiting notes)

Cooper: "Descriptions still need some work." Diagnosis by code read: `sync-timeline.ps1` kept only the first roll-up row per ticket, and the board showed it on every entry of that ticket. Cooper chose A (roll-up time blocks per entry) and B (waiting notes from agent runs); C (`sessions.map` for this session) is still undecided. Result: v33 live, board main 08e038a, worklog `sync-timeline.ps1`/`test.ps1`/`README.md` edited and left uncommitted. 10/19-10/21 were rebuilt with blocks and uploaded.

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| builder | opus | A + B across both repos, real-data printout | 166k | 60 | 17 | DONE, 93/93, 108 worklog checks | earned |
| builder (resumed) | opus | Round 2: nearest-block fallback, clean joins | +14k | 11 | 3 | DONE, 95/95 | earned (4 entries still showed the day's first note) |
| refuter | sonnet | Both repos on the real 10/21 entries | 85k | 10 | 6 | ACCEPT + 2 should-fix | earned |

Inline by Fable: the zero-length roll-up row guard (`-le` to `-lt`); fixing my own real-data loader (export files carry the id only in the filename, so cards had been invisible to the scripts; recomputed totals were unchanged).

**Totals:** 3 dispatches, ~265k subagent tokens. Fable context at start and at writing: not captured.

**Loop signal:** the real-data printout (OLD vs NEW note per entry) made the review concrete and exposed both round-2 issues and my loader bug. Diffing the worklog against a pre-change snapshot let a refuter review uncommitted work. No pre-PR tier (personal repos).

**Spec misses:** (1) the first spec's fallback (`notes[ticket]`) reproduced the original bug for entries next to, not inside, a roll-up block; (2) the join format did not account for roll-up texts ending in ".".

**Not actioned:** the nearest-block fallback has no distance cap (refuter SF1).
