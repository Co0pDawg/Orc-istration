# 2026-10-16 Petsoft: customer feedback triage (no tickets)

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| researcher | sonnet | Check 10 feedback asks against existing code | 97,441 | 60 | 3.6 | 10 verdicts with path:line | earned: turned 3 asks into "already exists, train them" |

| researcher | sonnet | 2026-10-19: facts for the Facility Calendar spec (availability page, capacity, Quick Check-In, Book prefill) | 96,909 | 42 | 3.1 | 7 answers | earned: found Quick Check-In is a walk-in and that Book takes no prefill, which changed two decisions |

| builder | opus | #17995 set-based timeslot proc + parity (incl. rework delta ~33k) | 202,989 | 75 | 50 | DONE after 1 REWORK | earned: 16 s -> 0.5 s month, parity proven |
| refuter | opus | #17995 review | 152,295 | 38 | 20 | REWORK (parity script blind to Training + claims) | earned: caught two unguarded rules |
| builder | opus | #17997 month grid, EmployeePreference, month proc | 411,474 | 178 | 59 | DONE | earned; heavy (live app + 6 spot-check runs) |
| refuter | opus | #17997 review | 195,384 | 58 | 20 | ACCEPT + 4 should-fix | earned. RULE MISS: Opus refuter launched right after a >300k builder (no 429 hit) |
| builder | opus | p_GetDaycareAvailabilityForFacility tuning, separate worktree | 144,059 | 34 | 14 | DONE, inline-refuted by Fable | earned: one predicate, 63 parity cases, ~340 -> ~100 ms |

Rows from the 2026-10-19 researcher onward belong to the Facility Calendar task and are recorded in full in 2026-10-20-petsoft-facility-calendar.md; this file's own task is the first row.
Totals (triage only): 1 dispatch, ~97k subagent tokens. Outputs: stories 17972-17975, tasks 17979-17983, spec docs/superpowers/specs/2026-10-19-facility-calendar-design.md. Fable context: start ~45k, end ~60k (estimate).
Loop signal: no build loop, no review tier (read-only triage).
Spec misses: none; 4 items came back partly UNVERIFIED (check-in paths, notes click count, rule UI location, per-pet services).
