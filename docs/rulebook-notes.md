# Rulebook notes: the incidents behind the rules

Reference material moved out of the rulebook (`AGENTS.md`) to keep it under Antigravity's 24,000-byte rules cap. Each
entry is the original wording, under the rule it explains. The rules themselves stay in `AGENTS.md`.

## Marching orders
- Board line, full `cards/<id>` path: on 10729 a builder looked the card up wrong, reported it missing and skipped every board write.

## Orchestration Board
- Late builder rounds get a card: on 18216 the review-fix round ran cardless until Cooper asked.
- Durable-rules check, never wait to be asked: on 18055 the flyout, drag and write-path rules were written only after he asked.

## Build loop
- Stale green: a stale green was caught this way on 2026-09-30.
- Run-and-commit on High-tier builders: a Sonnet builder handed back mid-run and the orchestrator had to finish it.
- After stopping a builder: on 18356 the pause report said the database was untouched; the builder had already upgraded it and left a half-applied mutation.

## Test runs (learned on PR 5896, 2026-09-14 — ~3 h of a 7 h loop was re-running suites)
- Full suites once, at the end: on PR 6393 they ran during the review panel, the panel forced code changes, and they ran again.
- Test filter check: on 18356 the fix-round filter `~ChangeRequest` missed two controller test classes; the builder noticed and widened it.
- Contradicting findings: the last one was a fixture artefact and cost only a comment.
- Cross-cutting rule in one spec: two specs stating it independently drifted apart within one round.
- Parallel builders by file ownership: zero overlap both times it was used.
- `git diff HEAD --binary`: on 18200, 11 deleted files went missing from a moved diff.
- No `git stash` in a worktree: on 2026-10-29 a `stash push` failed silently, and the `stash pop` after it applied another branch's stash ("17660 B-F").
- `MSYS_NO_PATHCONV=1`: on 2026-11-02 this created a stray folder at the drive root and made a force-push fail.
- Restart the app after a merge: on 11/02 a develop merge under his running app left it compiling the new views on the fly against old assemblies, and every page failed until the restart.
- Timeout on long merges: on 11/02 a merge stalled in the background and the investor branch stayed 3 commits behind until it was rerun.
- Stop only your PID: stopping by command-line match killed a builder's app on port 7399.
- Never pipe an app-starting step: on 18298 a combined Playwright run sat 2 h 15 m after `ticket-env.ps1 start` without running a test.
- Browser pass without a runtime-validator browser: on PR 6425 that pass found a phone-width overflow the static panel and the HTTP-only run could not see.
- Keep the machine awake: stopping it at midnight on 2026-10-28 let Modern Standby hang a builder's Playwright run for 2 h 48 m.
- Contention reruns: 4 of 4 passed alone on 2026-10-29.
- Free RAM: on 2026-10-29, 1 GB of 32 GB was free and every screenshot and query hung.
- `publish_files` paths: the scratchpad's short form was `COOPER~1.DAV`. On 18242 it refused two tries; the second refusal named the path to use.

## Pre-PR review tier (learned 2026-09-30 to 10-01 — review was 34% of agent tokens, ~90k per reviewer run)
- The refuter already reran the work, checked conventions and proved each test can fail, so the full review panel on top of it is mostly duplicated effort. On seven refuter-accepted, test-only PRs the full panel produced one warning (doc wording) and otherwise only suggestions and nits; on PRs with product code it found real issues across several agents.
- Cheap reviewers: on PR 6372 those three raised only suggestions and nits. This rests on that one run, and one of those suggestions was a real 500 (a 12/31/9999 end date), so drop the override if a Sonnet run misses something like it.

## Specs, bugs and shared resources
- Roles and reachability: on Epic 18199 the Schedule button lived only on a page rollup-only members could not open, so they could not create a schedule or stop one's emails. Two refuters and the full review panel passed it; a teammate caught it.
- PR status before merging: on Epic 18199, PR 6367 completed mid-round and its branch was deleted while a merge sat unpushed; pushing it would have recreated the branch.
- PR description on scope change: on 18193 PR 6397 completed while the update waited for approval, so its description never mentions time off.
- Recurring jobs: on Epic 18199 two builders and two refuters passed jobs that lost a missed period and reported cancelled runs as done, until the full review panel raised them.
- Write-path walk: on 18192 Add punch could save an open punch that then blocked the employee's clock-in; two rounds passed it until the review panel read the clock-in proc.
- Reader assumptions: on 18356 the plan listed the readers of a long-lived timeslot hold, but availability sized a hold by the searched service and the mobile claim had no catch for the refusal; six refuter passes missed both, and the full review panel and the fix-round refuter caught them.
- Reused events: on 18274 approval reused `ReservationUpdated`, whose only email is the reminder "appointment has moved" one; two refuters passed it and only the live pass caught it.
- Every path that changes the record: on 18274 check-in and guest removal were missed until the full review panel; a removed guest's add-ons would have been re-billed on approval.
- Rolled-back probes: on 18274 a refuter ran Cancel for real on a seeded reservation because its request was Denied, not Pending, and could not fully restore it.
- Agent-definition changes: on 18245 a test builder followed its old rules.
- UI mockups first: on 18055 the mockup round settled the layout, overlaps, locked states and flyout before any code, and the later design feedback (from teammates) was CSS-only.
- SQL command batch: on 18201 every test was green while deleting an Enterprise would have returned a 500; only the refuter's command-batch probe caught it.
- Shared logins: on PR 6393 default-deny protected sessions inside the demo org, and three refuter ACCEPTs and a live check missed that a visitor could attach the login to their own org; the full review panel caught it.
- Sentinel values: on PR 6393 "a bill day that never matches" looked simple, then needed 6 date clamps and a second question to Cooper.
- Backtest column meaning: on 18208 the AC priced bookings from a column that was NULL on 99.98% of rows; the backtest caught it before any code, and the build then found the real source (Pending invoices).
- Fresh DB copies: on 18208 the 9/30 copy had no October revenue, so growth and earned-to-date read 0 until a 10/27 backup was restored.
- Marketing screenshots: the 18220 projection shot was taken twice more as the KPI layout and comparisons changed under it.
- Showcase retakes: on PR 6425 the first retake dispatch came back blocked on both and needed a resume.
- Rerun after a base merge: on PR 6425 the six new tests last ran before the develop merge.
- Seeded visual states: the PR 6323 theme pass captured 45 screenshots of empty calendars, so the locked stripes, drag states and flyout went unchecked under the themes.
- Timing mutations: on 10729 three "Cancel posts nothing" tests stayed green against a delayed submit, because their next navigation ended the page first.
- Non-first group members: the 18055 spec said "lift the guests together" but not which arrival the stale check compares, so a second guest's drag was always refused; only the full review panel caught it.
- Search inputs: every review gate passed PR 6243, then Cooper's first live test found that a partial reservation number listed only invoices, that email needed an "@", and that the placeholder was cut off. The day-1 data already showed invoice numbers embed the reservation number.
- Unattended scripts: on 18261 I reported limits as "enforced by the script" before this; review found about 446 sensitive files passing the path filter and the session able to push.
- Changed doc shape: the UITests map was condensed mid-week.
- Confirming defects: one bug was filed with the builder's wrong cause and needed a correction comment.

## Versioning the setup
- History scan: on 2026-11-02, 139 cost logs were found in history this way, long after they stopped being tracked.

## Ticket hygiene
- AcmeApp checklist commands: `& ./.claude/scripts/ado.ps1 comment-add -Id <id> -BodyFile <file>` / `comment-edit -Id <id> -CommentId <cid> -BodyFile <file>`.

## Examples and rationale moved later (original wording, by rule)
- Data precondition, examples of the rows to name: (which senders populate CUSTOMER_ID, which users have two facilities). Why: the loop verifies the spec; this line is what makes the spec verify the requirement.
- Board line, why the full path matters: otherwise the agent may look the card up wrong and skip every board write.
- Durable-rules check, what to list: reusable patterns, feedback that generalises, rule-shaped review findings, traps, process lessons.
- Never `dotnet test` a solution with a UI project: AcmeApp's `UITests` waits on an app forever.
- Browser pass without a runtime-validator browser, how: a builder drives Chromium with `playwright-core` from `UITests/bin/Debug/net10.0/.playwright` against a `ticket-env.ps1` app.
- Keep the machine awake, how (Windows): `SetThreadExecutionState` with `[uint32]2147483651` in a background loop.
- Cross-cutting rule, example: "null weight reads as 0 lb".
- Pre-PR tier, why: the refuter already reran the work and proved each test can fail, so a full panel on top of it mostly duplicates effort on test-only diffs.
- Cheap reviewers, evidence: this rests on one run, and the defect to watch for is like the 12/31/9999 end-date 500 one of them raised.
- Every path that changes the record, for a reservation: check-in, guest removal, extend, itinerary edits, cancel.
- Visual-check states, examples: a theme pass, dark mode, a restyle; states such as a booked appointment, a locked block, a +N overlap, an open flyout.
- Search inputs, examples: a partial number, a phone's last 4, part of an email.
- Backtest column meaning, examples: a price source, a status, a date.
- Fresh DB copies, examples of today-relative checks: projections, to-date comparisons, a scorecard's today tiles.
- Hook-only view edits in scope, why: saying "no product code" made a builder skip hooks that the repo rules require in the same PR.
- SQL command batch, why: the in-memory provider hides statement order and FK enforcement.
- Ticket decisions, example deferral: "AdSense deferred: needs nonce CSP + CMP".
- Cost log, why: the Loop signal lets the tier rule be tuned from evidence; the context sizes let a review compare orchestrator spend against subagent spend.
