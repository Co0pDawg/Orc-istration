# Rulebook notes: the incidents behind the rules

Reference material moved out of the rulebook (`core/AGENTS.md`) to keep it under Antigravity's 24,000-byte rules cap. Each
entry is the incident behind a rule, under the rule it explains, reworded without ticket numbers or product detail. The
rules themselves live in the core rulebook (`core/AGENTS.md`) and the optional profile (`profiles/dotnet-azure-devops.md`).

## Marching orders
- Board line, full `cards/<id>` path: on one ticket a builder looked the card up wrong, reported it missing and skipped every board write. [1 incident]

## Orchestration Board
- Late builder rounds get a card: on one ticket the review-fix round ran cardless until the owner asked. [1 incident]
- Durable-rules check, never wait to be asked: on one feature the rules it taught (a side panel, drag-and-drop, a new write path) were written only after the owner asked. [1 incident]

## Build loop
- Stale green: a stale green was caught this way on 2026-09-30.
- Run-and-commit on High-tier builders: a Mid-tier builder handed back mid-run and the orchestrator had to finish it.
- After stopping a builder: on one feature the pause report said the database was untouched; the builder had already upgraded it and left a half-applied mutation. [1 incident]
- Inline accept of a small rework: on the review-panel port (2026-11-16) the tooling refuter's must-fixes were two missing tests and one path guard. The orchestrator reran the tests after the last edit and both surviving mutants (now red) instead of a second refuter, which saved about 175k tokens.

## Test runs (learned 2026-09-14 — ~3 h of a 7 h review-fix loop was re-running suites)
- Full suites once, at the end: on one PR they ran during the review panel, the panel forced code changes, and they ran again. [1 incident]
- Test filter check: on one fix round the test filter missed two controller test classes; the builder noticed and widened it. [1 incident]
- Contradicting findings: the last one was a fixture artefact and cost only a comment.
- Cross-cutting rule in one spec: two specs stating it independently drifted apart within one round. [1 incident]
- Parallel builders by file ownership: zero overlap both times it was used. [2 runs]
- `git diff HEAD --binary`: on one ticket, 11 deleted files went missing from a moved diff. [1 incident]
- No `git stash` in a worktree: on 2026-10-29 a `stash push` failed silently, and the `stash pop` after it applied another branch's stash.
- `MSYS_NO_PATHCONV=1`: on 2026-11-02 this created a stray folder at the drive root and made a force-push fail.
- Restart the app after a merge: on 2026-11-02 a base-branch merge under the owner's running app left it compiling the new views on the fly against old assemblies, and every page failed until the restart.
- Timeout on long merges: on 2026-11-02 a merge stalled in the background and a feature branch stayed 3 commits behind until it was rerun.
- Stop only your PID: stopping by command-line match killed a builder's app.
- Never pipe an app-starting step: on one ticket a combined UI-test run sat 2 h 15 m after the app-start script without running a test. [1 incident]
- Browser pass without a runtime-validator browser: on one PR that pass found a phone-width overflow the static panel and the HTTP-only run could not see. [1 incident]
- Keep the machine awake: stopping it at midnight on 2026-10-28 let Modern Standby hang a builder's UI-test run for 2 h 48 m.
- Contention reruns: 4 of 4 passed alone on 2026-10-29. [4 runs]
- Free RAM: on 2026-10-29, 1 GB of 32 GB was free and every screenshot and query hung.
- `publish_files` paths: the scratchpad's 8.3 short form of the user folder. It refused two tries; the second refusal named the path to use.

## Pre-PR review tier (learned 2026-09-30 to 10-01 — review was 34% of agent tokens, ~90k per reviewer run)
- The refuter already reran the work, checked conventions and proved each test can fail, so the full review panel on top of it is mostly duplicated effort. On seven refuter-accepted, test-only PRs the full panel produced one warning (doc wording) and otherwise only suggestions and nits; on PRs with product code it found real issues across several agents. [7 PRs]
- Cheap reviewers: on one PR those three raised only suggestions and nits. This rests on that one run, and one of those suggestions was a real 500 (a 12/31/9999 end date), so drop the override if a Mid-tier run misses something like it. [1 run]

## Specs, bugs and shared resources
- Allow-list `.gitignore`: on the review-panel port (2026-11-16) the design did not list `.gitignore`; its `/*` allow-list ignored the new `review/` and `commands/` folders, so they would not have been committed and the `git ls-files` scrub test could not see them. A builder noticed only because its own docs would not stage.
- Paths in shared reports: on the same port, `metrics capture --out` outside the repo wrote `../../Users/<user>/...` into the report's `file` field, which a parent run copies; only the refuter's repro caught it.
- Shadowed agent names: the same port's live run could not happen from the session that built it, whose project already had agents named `review-*`; those would have loaded instead of the new user-level ones.
- Roles and reachability: on one epic a new action's button lived only on a page that some members could not open, so they could not create the record or stop its emails. Two refuters and the full review panel passed it; a teammate caught it. [1 incident]
- PR status before merging: on the same epic a PR completed mid-round and its branch was deleted while a merge sat unpushed; pushing it would have recreated the branch.
- PR description on scope change: on one ticket the PR completed while the description update waited for approval, so its description never mentions the added scope. [1 incident]
- Recurring jobs: on one epic two builders and two refuters passed jobs that lost a missed period and reported cancelled runs as done, until the full review panel raised them. [1 incident]
- Write-path walk: on one ticket a new manual-entry action could save an open record that then blocked the user's next normal action; two rounds passed it until the review panel read the stored procedure behind that action. [1 incident]
- Reader assumptions: on one feature the plan listed the readers of a long-lived hold on a time slot, but one reader sized the hold by the searched service and a mobile caller had no handling for the refusal; six refuter passes missed both, and the full review panel and the fix-round refuter caught them. [1 incident]
- Reused events: on one feature, approval reused an existing "record updated" event whose only email told the customer their appointment had moved; two refuters passed it and only the live pass caught it. [1 incident]
- Every path that changes the record: on the same feature two of the paths that change the record were missed until the full review panel; one would have re-billed a removed line's add-ons on approval.
- Rolled-back probes: on the same feature a refuter ran Cancel for real on a seeded booking because its request was Denied, not Pending, and could not fully restore it.
- Agent-definition changes: on one ticket a test builder followed its old rules. [1 incident]
- UI mockups first: on one feature the mockup round settled the layout, overlaps, locked states and side panel before any code, and the later design feedback (from teammates) was CSS-only. [1 incident]
- SQL command batch: on one ticket every test was green while deleting a parent record would have returned a 500; only the refuter's command-batch probe caught it. [1 incident]
- Shared logins: on one PR default-deny protected sessions inside a demo organization, and three refuter ACCEPTs and a live check missed that a visitor could attach the shared login to their own organization; the full review panel caught it. [1 incident]
- Sentinel values: on the same PR "a billing day that never matches" looked simple, then needed 6 date clamps and a second question to the owner.
- Backtest column meaning: on one ticket the acceptance criteria priced records from a column that was NULL on 99.98% of rows; the backtest caught it before any code, and the build then found the real source (pending invoices). [1 incident]
- Fresh DB copies: on the same ticket a month-old copy had no current-month revenue, so growth and earned-to-date read 0 until a recent backup was restored.
- Marketing screenshots: one feature's headline shot was taken twice more as its layout and comparisons changed under it. [1 incident]
- Showcase retakes: on one PR the first retake dispatch came back blocked on both and needed a resume. [1 incident]
- Rerun after a base merge: on one PR the six new UI tests last ran before the base-branch merge. [1 incident]
- Seeded visual states: one theme pass captured 45 screenshots of empty calendars, so the locked stripes, drag states and side panel went unchecked under the themes. [1 incident]
- Timing mutations: on one ticket three "Cancel posts nothing" tests stayed green against a delayed submit, because their next navigation ended the page first. [1 incident]
- Non-first group members: one spec said "move the group's members together" but not which member's start time the stale check compares, so a second member's drag was always refused; only the full review panel caught it. [1 incident]
- Search inputs: every review gate passed one search feature, then the owner's first live test found that a partial record number listed only invoices, that email needed an "@", and that the placeholder was cut off. The day-1 data already showed invoice numbers embed the record number. [1 incident]
- Unattended scripts: once limits were reported as "enforced by the script" before this rule; review found about 446 sensitive files passing the path filter and the session able to push. [1 incident]
- Changed doc shape: the UI-test map was condensed mid-week.
- Confirming defects: one bug was filed with the builder's wrong cause and needed a correction comment. [1 incident]

## Versioning the setup
- History scan: on 2026-11-02, 139 cost logs were found in history this way, long after they stopped being tracked.

## Ticket hygiene
- Checklist commands with the Azure DevOps tracker helper (`tools/tracker/ado.ps1`): `comment-add -Id <id> -BodyFile <file>` / `comment-edit -Id <id> -CommentId <cid> -BodyFile <file>`.

## Re-testing rules
A rule stays because its evidence holds, not because it is written down. On a model change in `models.json`, or every 10 cost logs, whichever comes first:
- List the rules whose evidence is a single incident (the entries tagged `[1 incident]` or `[1 run]` above, and any untagged entry that names one occasion).
- Re-test each with the rule removed, on the current models. A review rule (a lane, a review role, the explorer contract or the shared rules) is re-tested against the regression corpus (`review/corpus.md`): run the case the rule guards. The corpus holds review-panel cases only, so an orchestration rule (briefs, the build loop, the board, the workflows) is re-tested against the cost logs instead: read the Loop signal and Escaped defects lines of the logs written while it was out.
- Keep the rule when the failure comes back; drop it, or move it to the examples below, when it does not. Note the date and result on the entry.
- Tags give the evidence count the entry already states: `[1 incident]`, `[1 run]`, `[n runs]`, `[n PRs]`. An entry with no stated count carries no tag.
- A new entry records its date and evidence count; older entries carry a date only where one was known.

## Examples and rationale moved later (original wording, by rule)
A reason the rulebook carries again is dropped from this list (its board, inline-work, batching, handoff, live-app and data-precondition reasons are back in `core/AGENTS.md`).
- Data precondition, examples of the rows to name: (which senders populate a customer-id column, which users have two locations).
- Never `dotnet test` a solution with a UI project: AcmeApp's UI-test project waits on an app forever.
- Cross-cutting rule, example: "a missing weight reads as 0".
- Pre-PR tier, why: the refuter already reran the work and proved each test can fail, so a full panel on top of it mostly duplicates effort on test-only diffs.
- Cheap reviewers, evidence: this rests on one run, and the defect to watch for is like the 12/31/9999 end-date 500 one of them raised.
- Every path that changes the record, for a booking: arrival, removing one of its lines, extending it, editing its schedule, cancelling it.
- Visual-check states, examples: a theme pass, dark mode, a restyle; states such as a booked appointment, a locked block, a +N overlap, an open side panel.
- Search inputs, examples: a partial number, a phone's last 4, part of an email.
- Backtest column meaning, examples: a price source, a status, a date.
- Fresh DB copies, examples of today-relative checks: projections, to-date comparisons, a scorecard's today tiles.
- Hook-only view edits in scope, why: saying "no product code" made a builder skip hooks that the repo rules require in the same PR.
- SQL command batch, why: the in-memory provider hides statement order and FK enforcement.
- Ticket decisions, example deferral: "ads deferred: needs a nonce-based CSP and a consent banner".
- Cost log, why: the Loop signal lets the tier rule be tuned from evidence; the context sizes let a review compare orchestrator spend against subagent spend.
- Anomaly log, why (2026-11-22): 32 entries above rest on one incident each, because an incident with no rule had nowhere to go except into a rule; the log holds it until it repeats. No run has tested this yet.
- Rate-limit guard, why: a rate-limited dispatch costs the launch and the wait and returns nothing.
- No `git stash` in a worktree, why: every worktree shares one stash stack.
- Never pipe an app-starting step, why: the app inherits the pipe and the capture waits for it forever.
- Showcase retakes, why grep the views: a shared image needs a new file name and view edits.
- `git diff HEAD --binary`, why: plain `git diff` drops staged deletions.
