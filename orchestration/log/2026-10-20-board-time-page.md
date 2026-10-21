# 2026-10-20 · board + worklog · Time page (day/week/month timeline, portal entries, scrum summary)

Spec docs/2026-10-20-time-site-design.md, plan docs/superpowers/plans/2026-10-20-time-page.md (Orc-Dashboard repo). SDD with the builder/refuter roster; 3 builder batches + Fable T8. Result: board v24 live, main 65ef4af; worklog sync scheduled build-only (worklog repo changes left uncommitted for Cooper); 26 timeline days uploaded.

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| general-purpose | sonnet | Builder check of the design | 73k | 4 | 0.7 | 8 questions, 2 to Cooper | earned |
| builder | opus | T1-2 worklog export + sync | 175k | 66 | 45 | PARTIAL: headless db write refused | earned (found the approval wall) |
| builder | sonnet | T3-5 segments, entries, scrum | 125k | 29 | 12 | DONE 49/49 | earned |
| refuter | opus | T3-5 | 136k | 18 | 6.4 | REWORK 5 must-fix | earned (agent-span pairing bug) |
| builder (resumed) | sonnet | T3-5 fix round 1 | +23k | 17 | 4 | 8/8 fixed | earned |
| refuter | sonnet | T3-5 re-review | 74k | 2 | 0.6 | ACCEPT | earned |
| builder | opus | T6-7 UI | 317k | 100 | 33 | DONE 63/63 | earned |
| refuter | opus | T1-2 | 136k | 25 | 11 | REWORK: NOSUMMARY broke attribution | earned (41/410 events mis-ticketed) |
| refuter | sonnet | T6-7 (rate guard after 317k builder) | 124k | 18 | 4.2 | ACCEPT + 5 should-fix | earned |
| builder (resumed) | opus | T6-7 fix round 1 | +28k | 29 | 9.8 | 5/5 | earned |
| refuter | sonnet | T6-7 re-review | 74k | 3 | 0.8 | ACCEPT | earned |
| builder (resumed) | opus | T1-2 fix round 1 (attribution + build-only) | +46k | 37 | 34 | DONE | earned |
| builder (resumed) | opus | T1-2 follow-up (30 min limit + backfill) | +18k | 50 | 30 | DONE | earned |
| refuter | opus | Final whole-branch review on real data | 183k | 34 | 10 | REWORK: joins/spans wrong on real data | earned (the most valuable review: agents 17 h/55.6 h) |
| builder | opus | Final fix wave + residuals R1/R2 | 206k | 95 | 17 | DONE 78/78 | earned |
| refuter | sonnet | Final fix re-review | 88k | 4 | 0.8 | ACCEPT | earned |
| refuter | sonnet | T1-2 fix re-review | 82k | 9 | ~6 | ACCEPT | earned |

**Totals:** 17 dispatches, ~1.91M subagent tokens. Fable context at start and at writing: not captured.

**Loop signal:** every batch took exactly one fix round; the per-task refuters missed the real-data join problems that the final whole-branch review caught by running the modules on real docs — next time put a real-data run in each task refuter's brief, not only the final one. No pre-PR review tier (personal repos). Sonnet builders skipped BOARD posts twice; the BOARD report line fixed it.

**Spec misses:** (1) the plan told the sync to set WORKLOG_NOSUMMARY, which skips PR resolution and parent roll-up (caught by refuter); (2) the design assumed headless claude -p could write the db — reads work, writes need approval (Cooper chose session uploads); (3) the board's card task/ticket vs the worklog's parent roll-up meant columns did not join (final review).

## Rulings (from the SDD ledger)
- Ruling: board-repo builders COMMIT their task locally on feature/time-page (no push) so review packages have a BASE..HEAD range; Fable pushes and merges at the end — the plan's "unstaged" line predates the SDD choice; cost if wrong: extra local commits, squashable.
- Ruling: worklog-repo builders never commit (Cooper's uncommitted work lives there); Fable builds that review package from `git diff -- <task files>` plus new-file contents — keeps his WIP untouched; cost if wrong: review package must be built by hand.
- Ruling: batch T1+T2 into one builder (worklog track) and T3+T4+T5 into one builder (pure modules), T6+T7 into one builder (UI); one refuter per batch, each refuter reviews every task in its batch against its brief — user's CLAUDE.md batching rule; cost if wrong: a larger review surface per refuter.
- Ruling: worklog track and model track run in parallel (different repos, zero shared files) — user's parallel-builder rule; cost if wrong: none (no overlap).
- Ruling: T6 Step 5 preview hash means the dev harness gains a `time` flag (e.g. `#time`, `#time-week`, `#leet-time`) that opens the Time view with fixture timeline data — loose plan wording; cost if wrong: preview harness flag naming only.
- Ruling: refuter MF2/MF3/MF5 follow the spec over the brief (spec binding) — cost if wrong: small logic change in segments/scrum
- Ruling: spec Entries rule 5 wording ("touching neighbor, gap of one unit or less") is narrowed to "touches after rounding" per refuter — extension broke rule 6's bound; update spec in Task 8 — cost if wrong: a few minutes per day land in "Not entered" instead of a neighbor
- Ruling: T3-5 note 'dispatch-only span with no updated is dropped' accepted — sessions always carry updated per protocol — cost if wrong: one missing span
- Ruling: plan T2 brief's WORKLOG_NOSUMMARY instruction overruled by spec ("worklog's existing attribution") — export runs with ADO, still no model — cost if wrong: ~95 s per export tick
- Ruling: ticks build today, plus yesterday only while its marker is missing/stale — keeps ticks under the 10-min limit — cost if wrong: yesterday's late changes need -Force
- Ruling: send all 5 should-fixes as one round (SF3 is a spec "Scrum button on every day" gap, SF1 an untested rule) — cheap, same files — cost if wrong: one extra round
- Ruling: raise task limit 10 -> 30 min instead of caching ADO lookups now — IgnoreNew prevents overlap; caching is the upgrade path (ponytail note) — cost if wrong: a slow machine still kills a two-day tick, next tick retries
- Ruling: one shared cardTicket(card, sessionTicket, drivenTickets): prefer normTicket(task) or normTicket(ticket) whichever is driven that day, else task, else ticket, else session ticket — spec said task-first, but the worklog bills parent stories so a driven-match is the only way columns join — cost if wrong: an agent span lands in the parent's column
- Ruling: unanswered dispatch ends at next card event, else next session event matching /\b(done|accept\w*|rework|partial|blocked|report\w*)\b/i, else card's last progress, else min(updated, dispatch+2h) — cost if wrong: a long silent agent run is cut at 2 h
- Ruling: README protocol Report row now requires `card` on outcome events (Fable doc fix, uncommitted until the fix wave)
- Ruling: merge same-ticket entries touching after rounding (<=120 min), restating rule 6 as one unit per source segment — fewer Work Detail forms; cost if wrong: bound test changes
- Ruling: dispatch start regex widened to /\b(dispatched|re-?dispatch\w*|sent to the same builder|fix round)\b/i — cost if wrong: a non-dispatch event starts a span
- Ruling: R1 cap every span at max(start+2h, last progress inside +15 min) — paused-then-redispatched runs inflated agent time; display-only — cost if wrong: a silent >2 h agent run shows shorter
- Ruling: R2 cardTicket also accepts a driven session ticket — closes agent-only columns — cost if wrong: an agent span lands on the session's ticket
- Ruling: R1+R2 folded into the same fix wave (arose inside it); one scoped re-review covers 87743e3..residuals — cost if wrong: none (still reviewed)
- Final fix: parked R3 — card-less outcome events in a parent-ticket session go to the parent, so the child's scrum line falls back to its timeline note — Ruling: acceptable, notes are a faithful summary — cost if wrong: one scrum line less specific
- Deferred minor (now fixed in the final wave): controller.js pointercancel.
