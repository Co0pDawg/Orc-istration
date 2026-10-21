# 2026-10-21 · board + worklog · Fallback notes, portal-scale calendar, scrolling entries

Cooper's asks after the first real use of the Time page: today's entries had no notes; copy on click instead of copy buttons; a portal-scale full 24 h calendar; entries scroll beside the calendar. Result: board v25 + v26 live, main 39aeda5; worklog sync-timeline.ps1 notes fall back to commit subjects, then ADO "type: title" (worklog repo still uncommitted for Cooper); 26 timeline days rebuilt and uploaded.

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| builder | sonnet | Fallback notes in sync-timeline.ps1 + 26-day rebuild | 119k | 58 | 95 | DONE | earned (a ~35 min sleep gap; most of the wall time was ADO lookups) |
| builder | opus | Portal-scale 24 h calendar + click-to-copy | 168k | 38 | 11 | DONE 78/78 | earned |
| refuter | sonnet | Portal-scale | 89k | 8 | 2 | ACCEPT + 3 should-fix | earned (past-midnight overflow; Fable clamped inline) |
| refuter | sonnet | Fallback notes on real 10-20 data | 87k | 12 | 9 | ACCEPT + 5 should-fix | marginal (confirmed, found nothing blocking) |

Inline by Fable: clamp boxes to the axis (e9b71e8); strip "- "/":" after #NNNNN in commit notes; entries panel takes the calendar's height and keeps its scroll (39aeda5, previewed); upload in 3 pinned batches.

**Totals:** 4 dispatches, ~463k subagent tokens. Fable context at start and at writing: not captured.

**Loop signal:** both builds passed review on the first try. Sonnet refuters were enough for a UI diff of about 90 lines and for a PowerShell notes path. No pre-PR review tier (personal repos). The scale builder posted BOARD progress; neither refuter did.

**Spec misses:** (1) the notes brief named the "#NNNNN " prefix but not the "#NNNNN - " house style, so notes began "- Fix" (the builder flagged it). (2) The scale spec left out the entries panel's height, which Cooper asked for after v25.

**Not actioned:** test.ps1 has no check for the separator strip; no check for the 200-char cap; scroll and sticky behaviour have no test (no DOM harness).
