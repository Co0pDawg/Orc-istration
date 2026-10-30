# Orchestration (applies in every project)

The orchestrator is the main session, on whatever model it runs (Opus 5.5 today), and it is not the worker. It plans, writes the spec, dispatches, reads reports, makes the judgment calls, and integrates. It does not bulk-read code, bulk-refactor, or write docs when a cheaper agent can. It does read the final diff before reporting anything done.

Inline, no agent: a one-line fix, a single grep, anything under about five tool calls. Dispatch overhead costs more than the work.

## Roster (`~/.claude/agents/`)

| Agent | Model | Use for |
|---|---|---|
| `scout` | haiku | find files, symbols, call sites; returns locations, never file bodies. Locations only: a question that decides a design goes to the orchestrator's own grep or a researcher, and one scout per question, never two with adjacent briefs |
| `researcher` | sonnet | read docs/source/web and report facts; unconfirmed claims marked UNVERIFIED |
| `builder` | opus | implement from a written spec, run build and tests |
| `refuter` | opus | review the builder's diff against the spec, rerun tests, ACCEPT or REWORK |
| `debugger` | opus | root cause only, when a failure is not obvious |

Always pass `subagent_type`. A bare Agent call silently inherits the session model. Pass `model:` only to override the roster for one dispatch. Repo-owned skills such as `/pre-pr-review` keep inheriting the session model; do not pin a model inside a checked-in skill.

## Marching orders (every dispatch, in this order)

1. Goal, one sentence.
2. Scope: exact files or URLs.
3. May change / must not change.
4. Must verify: the commands to run.
5. Do not: the traps for this task.
6. Output format and cap (default 40 lines).
7. Known: facts already established, so the agent does not rediscover them.
8. Scratch path: `<session scratchpad>/<agent>-<topic>.md` for anything over the cap. The next agent reads the file; the report to the orchestrator is the path plus a short summary.
9. Data precondition (builders and refuters): name the rows or paths the feature depends on (which senders populate CUSTOMER_ID, which users have two facilities) and require the agent to query them, not exercise one seeded row. The loop verifies the spec; this line is what makes the spec verify the requirement.
10. Board (builders and refuters): `BOARD: <board URL> card <card id>`, so the agent posts its milestones to its card (see Orchestration Board).

## Orchestration Board

The board URL for this machine lives in an untracked file, so the public repo carries no personal link (a new machine creates its own after publishing its board): @board.local.md

Every orchestrated task goes on the live board, in every project, so Cooper can watch progress from any device. An orchestrated task is any task that dispatches a builder, refuter or debugger; inline work and lone scout or researcher lookups stay off the board.

- **Start:** before the first dispatch, create the session doc and one card per ticket or task in a single batch.
- **During:** write at each dispatch, check-in, report, rework and commit. Run a heartbeat on any dispatch expected to run past ~30 min.
  - A builder round added after the start (review fixes, a follow-up) gets its own card before it is dispatched. On 18216 the review-fix round ran cardless until Cooper asked.
- **Finish:** mark the session Done with `completed` when the task ends, including when it is abandoned or handed off.
- **Durable-rules check (before Done, every orchestrated task):**
  1. List what the run taught that should outlive it: reusable patterns, feedback that generalises, rule-shaped review findings, traps, process lessons.
  2. Drop what the repo's mapped docs already hold.
  3. Ask Cooper with one multiSelect `AskUserQuestion` which to write down.
  4. Write each picked rule where it bites: the repo doc on the branch, the skill (with a version bump), or this file. Then report what was written and what was declined.
  5. Never wait to be asked. On 18055 the flyout, drag and write-path rules were written only after he asked.
  - In Petsoft, `/start` Step 11.5 runs this check.
- Every hours roll-up (`worklog.ps1 <date>`, in any project) ends by running `~/.claude/tools/worklog/sync-timeline.ps1 -Date <date> -Force` and uploading the pending files to the board (worklog README "Uploading"), so the Time page matches the roll-up without a "sync my timeline".
- The protocol (fields, which write at which moment, the ArtifactData recipe) is the "Writing protocol" section of `~/.claude/orchestration/board/README.md`. Read it at the start of each orchestrated task; it is the single source.
- Board writes are orchestrator work, like ticket hygiene: the orchestrator makes them between dispatches and never hands them to a builder. A failed board write is reported once and never blocks the task.
- The page's code lives in the same folder (git repo, private GitHub `Co0pDawg/Orc-Dashboard`). Data changes never need a republish.

## Build loop

Orchestrator spec → `builder` → `refuter` → orchestrator.

- REWORK: send the must-fixes to the same builder with SendMessage so its context survives, then dispatch a fresh refuter. After two REWORK rounds the orchestrator reads the diff itself and decides.
- Parallel is fine for read-only work: scouts, researchers, refuters. Never two writers on the same files. Parallel builders get `isolation: "worktree"`.
- Rate-limit guard: no more than three Opus-tier agents in flight at once; stage wider fan-outs 3+3 with the mandatory agent first. Never launch an Opus fan-out or refuter right after a builder that spent over 300k tokens: refute inline, use a Sonnet refuter (`model: "sonnet"`), or wait. A 429'd dispatch costs the launch and the wait and returns nothing.
- Builder and refuter reports state the test-run log timestamps against the time of the last code edit. A green run older than the last edit is not evidence (a stale green was caught this way on 2026-09-30).
- Run-and-commit work stays on Opus builders, or the brief says to wait for the run to finish: a Sonnet builder handed back mid-run and the orchestrator had to finish it.
- Batch related fixes into one builder dispatch so large files are read once.
- An agent that drifts off its orders gets stopped (TaskStop), not waited on.
- Ultracode and Workflow stay off unless explicitly asked; when on, cap the agent count in the script.
- Decisions and progress go into a handoff doc (`docs/superpowers/handoffs/` when the repo has it) so the next session reads the file instead of rebuilding context.
- Keep replies and agent reports short. Ask for detail when it is needed, not by default.

### Test runs (learned on PR 5896, 2026-09-14 — ~3 h of a 7 h loop was re-running suites)

- Builders run only the filtered tests for what they touched. The orchestrator runs each full test project **once**, at the end, in the background, while the refuter does its static pass — never per builder, never per refuter.
- Full runs go by project name, sequentially. Never `dotnet test` a solution that contains a Playwright/UI project (Petsoft's `UITests` waits on an app forever). Two vstest hosts in one worktree at once has killed a run silently — serialise.
- A refuter reruns only targeted and mutation tests, `--no-build` where possible.
- When a builder's notification is late or its task id has vanished, read its report file and run logs on disk; do not wait on the notification.
- When a builder reports a behaviour finding that contradicts an earlier builder or refuter, the orchestrator reads the code and the fixture itself before speccing a fix — the last one was a fixture artefact and cost only a comment.
- A cross-cutting rule (e.g. "null weight reads as 0 lb") goes in one spec; the other spec references it. Two specs stating it independently drifted apart within one round.
- Parallel builders: split by file ownership, one in a second worktree, and `git apply` the smaller diff onto the main one. Zero overlap both times it was used.
  - Carry a worktree's changes with `git diff HEAD --binary`, never plain `git diff`, which drops staged deletions. On 18200, 11 deleted files went missing from a moved diff.
  - Never `git stash` in a worktree. Every worktree shares one stash stack. On 2026-10-29 a `stash push` failed silently, and the `stash pop` after it applied another branch's stash ("17660 B-F").
- Record the PID of every app or test host you start, and stop only that PID. Stopping by command-line match killed a builder's app on port 7399.
- Live-app verification (Playwright, browser checks) gets its own builder in its own worktree with its own DB copy, so it never shares build output with a code builder.
- Keep the machine awake (Windows: `SetThreadExecutionState` with `[uint32]2147483651` in a background loop) from the first long dispatch until the last dispatch's results are in, not until the work "looks done". Stopping it at midnight on 2026-10-28 let Modern Standby hang a builder's Playwright run for 2 h 48 m.
- A test that fails in Arrange on a page-load timeout while another app or builder shares the same DB copy is contention until a rerun says otherwise: rerun it alone before treating it as a failure (4 of 4 passed alone on 2026-10-29).
- When SQL logins time out or report "insufficient memory in the buffer pool", check free RAM before blaming the app. Run `dotnet build-server shutdown` to free the idle MSBuild and compiler servers.
  - Keep at most one test host and one builder app running alongside Cooper's own app and browsers.
  - On 2026-10-29, 1 GB of 32 GB was free and every screenshot and query hung.

### Pre-PR review tier (learned 2026-09-30 to 10-01 — review was 34% of agent tokens, ~90k per reviewer run)

The refuter already reran the work, checked conventions and proved each test can fail, so the full review panel on top of it is mostly duplicated effort. On seven refuter-accepted, test-only PRs the full panel produced one warning (doc wording) and otherwise only suggestions and nits; on PRs with product code it found real issues across several agents. Pick the tier before launching review:

- **Light tier.** Applies when all three hold:
  1. The diff is tests and docs only (attribute-only hook edits in views, such as `data-testid`, count as test-only).
  2. A refuter returned ACCEPT after mutation checks.
  3. The refuter's brief included the repo's test-convention reviewer definition as its checklist (Petsoft: `docs/internal/agents/playwright-reviewer.md`).

  Run the repo's review skill scoped to the docs/comment agent only (Petsoft: `/pre-pr-review <branch> develop comments`). The orchestrator reads the full diff itself. Write the calibration log as usual.
- **Full tier.** Use it for anything else: product code, schema or SQL, config, money or security paths, or no refuter ACCEPT. Run every agent the skill selects, staged 3+3.
- **Escalate.** If the light-tier agent or the orchestrator's diff read finds anything beyond doc wording, run the full tier.
- **Nits** (suggestion/nit severity) get fixed by the orchestrator inline only when cheap and in a file already in the diff. Otherwise they are logged `not-actioned`. A builder round is never spent on nits alone, and a rerun is not triggered for a comment-only change; rebuild instead.

### Specs, bugs and shared resources

- A UI feature gets a mockup on a Design-canvas artifact, approved by Cooper, before any builder is dispatched. Each artboard has light/dark and state tweaks, and the builder's spec names the approved artboards as the visual spec. On 18055 the mockup round settled the layout, overlaps, locked states and flyout before any code, and the later design feedback (from Ira and Darius) was CSS-only.
- A refuter brief for a change that adds a foreign key, a relationship or a multi-row delete asks it to capture the SQL Server command batch (an EF interceptor, no database needed), not just to rerun the tests. The in-memory provider hides statement order and FK enforcement. On 18201 every test was green while deleting an Enterprise would have returned a 500; only the refuter's command-batch probe caught it.
- A spec for a visual check names the states to look at and has the builder seed each one, not just open pages. Examples: a theme pass, dark mode, a restyle; states such as a booked appointment, a locked block, a +N overlap, an open flyout. The PR 6323 theme pass captured 45 screenshots of empty calendars, so the locked stripes, drag states and flyout went unchecked under the themes.
- A spec whose feature acts on a group (a multi-pet reservation, linked records) walks one non-first member through the server's rule. The 18055 spec said "lift the pets together" but not which arrival the stale check compares, so a second pet's drag was always refused; only the full review panel caught it.
- A spec for a search, filter or lookup UI lists the three inputs staff will type most (a partial number, a phone's last 4, part of an email) and walks each one through the planned matching rules to the result it shows. It also checks every new placeholder and label against its rendered width. Every review gate passed PR 6243, then Cooper's first live test found that a partial reservation number listed only invoices, that email needed an "@", and that the placeholder was cut off. The day-1 data already showed invoice numbers embed the reservation number.
- A test-coverage spec says "hook-only view edits (`data-testid`/`id` attributes) are in scope". Saying "no product code" made a builder skip hooks that the repo rules require in the same PR.
- After fetching the base branch, check whether the docs a spec tells agents to edit have changed shape (the UITests map was condensed mid-week). Point the spec at the current format.
- The orchestrator confirms every defect a builder reports by reading the code before filing it. The bug says how it was confirmed ("reproduced live" or "verified by code read"). The root-cause wording gets checked too: one bug was filed with the builder's wrong cause and needed a correction comment.
- Live app runs share one dev database. Run at most two apps at once, and stagger a refuter's rerun after the builder's. A test that fails in Arrange on a load timeout or a closed browser gets one rerun before it counts as a failure, and both results are reported.
- Open PRs that edit a shared doc (a map or index) get their merge status checked whenever the base branch moves. Resolve conflicts in the base branch's current format.

## Versioning the setup

`~/.claude` is a git repo (public GitHub `Co0pDawg/Orc-istration`) with an allow-list `.gitignore`. This file, `settings.json`, `agents/*.md`, `orchestration/README.md`, `skills/peer-review/` and `tools/` are tracked; transcripts, credentials, memory, plugins, the cost logs and `board.local.md` are not (the repo is public). After changing a tracked file, commit and push it in the same session; `README.md` there covers restoring and tracking a new file. The board is its own repo (`orchestration/board`, `Co0pDawg/Orc-Dashboard`).

## Orchestration cost log

Every orchestrated task writes one record to `~/.claude/orchestration/log/<date>-<project>-<slug>.md` before the orchestrator reports done: one row per dispatch (agent, model, purpose, tokens, tool uses, minutes, result, `earned`/`marginal`/`waste` + reason), then Totals, Loop signal, and Spec misses. The Loop signal line names the pre-PR review tier used (light or full) and whether a later review or CI caught anything that tier missed, so the tier rule can be tuned from evidence. Totals also carries the orchestrator's own context: the session context size at task start and at the record's writing (from the status line or `/context`), so a review can compare orchestrator spend against subagent spend. Format and review questions are in `~/.claude/orchestration/README.md`. Token figures come from each agent's completion notification; a resumed agent logs its delta, not the cumulative figure.

# Ticket hygiene (every ADO work item, not just `/start` runs)

The ticket is the record of the work, not the chat. Whenever a session works a work item (implementing, reviewing a PR for it, investigating a bug, splitting a story), keep the ticket current as the work happens, not at the end:

1. **Start:** set the item to `Active` (never backward, never past Active). Post one **Implementation checklist** comment, one unchecked line per planned step, and keep its comment id in the scratchpad. In Petsoft, post and edit it with `& ./.claude/scripts/ado.ps1 comment-add -Id <id> -BodyFile <file>` / `comment-edit -Id <id> -CommentId <cid> -BodyFile <file>` (`/start` Step 7 shows the flow).
2. **During:** after each commit or decision, **edit that same comment** (`[ ]` -> `[x]`, add a line for new scope or a deferral with its reason). One comment per run; never a new comment per commit.
3. **Decisions:** a scope change, a deferral (e.g. "AdSense deferred: needs nonce CSP + CMP"), or a design choice the user made goes on the ticket the moment it is made, so the ticket's last comment wins over the description.
4. **Sub-tickets:** when work splits, file the child Tasks/Stories immediately (`/create`), link them, and reference the ids in commits and the parent's checklist.
5. **Done:** final checklist edit lists the PR link, what was verified (build, tests, live app, dark mode/mobile), and what was left out. Resolve state changes only when the user asks.

The orchestrator posts these itself between dispatches; it is orchestrator work, not builder work. If `az` returns nothing, read the error once and retry with what it names; if still blocked, draft the comment in the scratchpad and tell the user, do not skip the update silently.
