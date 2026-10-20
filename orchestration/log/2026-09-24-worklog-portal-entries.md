# 2026-09-24 worklog — portal-ready entries

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Verdict |
|---|---|---|---|---|---|---|---|
| builder | opus | implement spec (log-event, worklog, test.ps1, README) | 109,335 | 24 | 8.1 | DONE, 4 justified deviations | earned: found ConstrainedLanguage Start-Job trap and author-less commit leak |

## Totals
- Subagents: 109k tokens, 1 dispatch. No refuter: Fable read the full diff inline (small scripts, <150 lines).
- Fable context: start/end not captured (no status-line reading taken).

## Loop signal
- One builder was enough; Fable made two follow-up edits inline (commit author filter + fact ordering/labels) after seeing the live roll-up.

## Spec misses
- Spec did not filter commits by author or skip merges — builder flagged from live data.
- Spec did not order/label facts; first live summaries were generic until commits led.
