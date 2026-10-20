# 2026-09-29 worklog — hybrid attribution

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Verdict |
|---|---|---|---|---|---|---|---|
| debugger | opus | PR 6049 pipeline root cause (2026-09-28) | n/a (stopped) | n/a | ~2 | stopped by user: wrong prompt | waste: dispatched on a prompt the user sent to the wrong session |
| builder | opus | hybrid attribution round 1 | 203,635 | 72 | 31 | DONE; flagged shared-checkout commit leak + summary truncation | earned: found reflog-vs-history trap and the truncation |
| builder (resumed) | opus | R1 session-owned commits, R2 summary root cause | ~57,000 delta | 68 | 43 | DONE; root cause = prompt layout (log read as examples), fixed with <worklog> delimiters + echoed start times | earned |

## Totals
- Subagents ~261k tokens (builder). No refuter: builder >300k-adjacent and <300 lines of diff; Fable read the full worklog.ps1 diff and reran both test hosts + a live roll-up inline.
- Fable context: not captured.

## Loop signal
- One REWORK round, sent to the same builder via SendMessage; accepted after inline review.

## Spec misses
- Spec used git history for commit evidence; history includes merged-in commits from other sessions. Reflog + commit capture was needed.
- Spec did not consider parallel sessions sharing one checkout for commit evidence.
- Summary prompt lacked a delimiter around the log; intermittent "no blocks" replies.
