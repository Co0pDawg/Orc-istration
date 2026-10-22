# 2026-10-19 to 10-20 Petsoft: Facility Calendar (#17994) -> DRAFT PR 6246

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| researcher | sonnet | Facts for the spec (availability page, capacity, Quick Check-In, Book prefill) | 96,909 | 42 | 3.1 | 7 answers | earned: Quick Check-In is a walk-in and Book takes no prefill; changed two decisions |
| builder | opus | #17995 set-based timeslot proc + parity (incl. ~33k rework delta) | 202,989 | 75 | 50 | DONE after 1 REWORK | earned: month 16 s -> 0.5 s, parity proven |
| refuter | opus | #17995 review | 152,295 | 38 | 20 | REWORK | earned: parity script was blind to the Training and claim rules |
| builder | opus | #17997 month grid, EmployeePreference, month proc | 411,474 | 178 | 59 | DONE | earned; heavy (live app + 6 spot-check runs) |
| refuter | opus | #17997 review | 195,384 | 58 | 20 | ACCEPT + 4 should-fix | earned. RULE MISS: Opus refuter right after a >300k builder (no 429) |
| builder | opus | p_GetDaycareAvailabilityForFacility tuning, separate worktree | 144,059 | 34 | 14 | DONE, Fable refuted inline | earned: one predicate, 63 parity cases, ~340 -> ~100 ms |
| builder | opus | #17999 + #18001 drawer and actions, + rework round 1 (~127k delta) | 643,142 | 99 | 81 | DONE after 1 REWORK | earned but heavy: 516k first pass (live checks + Playwright on a loaded shared DB) |
| refuter | sonnet | #17999/#18001 review | 210,160 | 53 | 25 | REWORK | earned: holiday rule had no failing check; drawer budget unmeasured; fail-open Awaiting rows |
| refuter | sonnet | #17999/#18001 rework review | 165,129 | 54 | 21 | ACCEPT | earned: stays-query old/new parity on 5 dates |
| silent-failure-hunter | session (opus) | pre-PR review | 120,868 | 19 | 5 | approved, 2 suggestion | marginal |
| code-reviewer | session (opus) | pre-PR review | 154,678 | 19 | 6 | approved, 1 nit | marginal (tenant scoping re-confirmed) |
| architecture-reviewer | session (opus) | pre-PR review | 148,221 | 25 | 8 | needs changes, 2 warning | earned: cross-facility toggle loss; duplicated count rule |
| comment-analyzer | session (opus) | pre-PR review | 211,421 | 20 | 6 | needs changes, 1 issue | earned (doc wording) |
| type-design-analyzer | session (opus) | pre-PR review | 99,228 | 12 | 4 | approved | marginal |
| playwright-reviewer | session (opus) | pre-PR review | 96,706 | 13 | 3 | needs changes, 1 warning | earned: culture-dependent date in a test |
| code-simplifier | session (opus) | pre-PR review | 137,692 | 14 | 3 | approved, 3 suggestion / 4 nit | marginal |
| builder | opus | review fixes, first dispatch | not reported | - | 15 | stopped on pause before any edit | waste (pause; no output) |
| builder | opus | review fixes, redispatch + fixture rework | 315,111 | 160 | 50 | DONE | earned: Playwright fixture gap found (no-hours orgs) |
| refuter | sonnet | review-fix round | 110,517 | 13 | 3 | ACCEPT | earned |
| builder | opus | follow-up from Cooper's live testing: compact drawer stay lists (412a5ae32) | 129,471 | 45 | 20 | DONE, Fable reviewed inline | earned: user-visible polish; inline review instead of a refuter (view-only diff) |

| builder | opus | bug from Cooper's live testing: stale drawer after booking + Back (7d1bd73f4) | 193,926 | 89 | 31 | DONE, Fable reviewed inline | earned: repro-first overturned Fable's bfcache guess (real cause: HTTP-cached Day fetch) |

| builder | opus | Cooper's request: adjacent-month days as muted cards (7b580d477) | 175,267 | 53 | 19 | DONE, Fable reviewed inline + CSS tweak | earned; Fable strengthened the too-faint light-mode muting itself |

| builder | opus | Cooper's request: collapsible drawer sections (c39a2c673) | 198,357 | 75 | 33 | DONE; Fable review found 3 issues and fixed them inline | marginal: missed the ALL-CAPS header, a lost spaces-left figure, and wrote a test that assumed empty grooming on a shared cached org |

| builder | opus | Cooper's decision: toggles per browser, EmployeePreference removed (c00b88521) | 200,900 | 96 | 76 | DONE | earned: thorough removal + no-flash mutation proof. Fable missed arming a heartbeat at dispatch (armed at 57 min) |

Board note: three builders in a row (fc-back-stale, fc-collapse, fc-toggles-browser) reported their card "does not exist" although Fable created each before dispatch; subagent board writes look broken on this board, worth checking against the agents' board instructions.
| builder | opus | 2026-10-21: Service Calendar Month view + team feedback + style toggle (9b60e7803) | 450,815 | 232 | 89 | DONE | earned; kept the old Department dropdown against the one-filter decision (fixed next round) |
| refuter | sonnet | Month-view round | 155,690 | 27 | 9 | ACCEPT + 4 should-fix + perf diagnosis | earned: the perf diagnosis (per-row subqueries) drove a 1.5 s -> 0.44 s fix |
| builder | opus | all-day band, employee multi-select, dropdown removal, perf, 6a-d (59e13f1b2) | 476,797 | 164 | 66 | DONE | earned |
| refuter | sonnet | all-day round | 188,904 | 39 | 9 | ACCEPT + 4 should-fix (one pre-existing permission gap) | earned: found the Day/Week no-employee-record gap |
| builder | opus | fix round: permission gap, zero chips, drawer employee filter, tests (796650f1f) | 283,278 | 100 | 39 | DONE, Fable reviewed the permission diff inline | earned |

| builder | opus | header unification across Day/Week/Month (f5e750159) | 184,480 | 79 | 29 | DONE, Fable reviewed screenshots inline | earned |

| builder | opus | resizable day drawer (ba034d677) | 162,217 | 65 | 30 | DONE, Fable reviewed inline | earned |

| builder | opus | Day/Week grid scrolls inside the window (a80ec6a8e) | 228,885 | 116 | 49 | DONE, Fable reviewed inline | earned |

| builder | opus | remove Minimal/Cards month styles, Grid only (8472c4c64) | 177,371 | 63 | 29 | DONE, Fable reviewed inline | earned |

| researcher | sonnet | 2026-10-22: facts for the drag-and-drop reschedule spec (story 18055) | 111,183 | - | - | spec facts | earned: found Edit Reservation's save path and that conflicts go unchecked today |
| debugger | opus | 2026-10-22: PR 6246 Playwright failures (57871d483) | 163,344 | 72 | 36 | A fixed test-only, B root-caused | earned: A reproduced locally by making the day load instant; B is a pipeline TZ mismatch, also red on develop |
Totals: 35 dispatches, ~7.10M subagent tokens (excluding the paused builder). Fable context: start ~45k (2026-10-16), end ~420k (estimate; no /context reading taken). Outputs: commits 64f857fff, f3bfe5956, 68006fffe, 9e7b3d56b, 0aa85cbf9; DRAFT PR 6246; stories/tasks 17994-18002; follow-up story 18015.
Loop signal: full pre-PR review tier (product code + SQL). It found 3 warnings and 1 issue the three refuter passes missed (cross-facility toggle loss, card/drawer rule duplication, test culture), so the full tier earned its cost here. CI (2026-10-22): two Playwright failures no review tier would catch: a slide-in race that only shows when the server is fast, and a pipeline time-zone mismatch that predates this PR.
Spec misses: spec said "holiday -> 0 open" without noting that booking ignores holidays (became #18015); spec's drawer budget (300 ms) could not be measured locally on a shared DB; spec did not say which preference storage to use (Fable chose EmployeePreference); Playwright fixture orgs lacking store hours were not anticipated.
