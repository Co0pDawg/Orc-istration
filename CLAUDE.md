# Orchestration (applies in every project)

Fable is the orchestrator, not the worker. It plans, writes the spec, dispatches, reads reports, makes the judgment calls, and integrates. It does not bulk-read code, bulk-refactor, or write docs when a cheaper agent can. It does read the final diff before reporting anything done.

Inline, no agent: a one-line fix, a single grep, anything under about five tool calls. Dispatch overhead costs more than the work.

## Roster (`~/.claude/agents/`)

| Agent | Model | Use for |
|---|---|---|
| `scout` | haiku | find files, symbols, call sites; returns locations, never file bodies. Locations only: a question that decides a design goes to Fable's own grep or a researcher, and one scout per question, never two with adjacent briefs |
| `researcher` | sonnet | read docs/source/web and report facts; unconfirmed claims marked UNVERIFIED |
| `builder` | opus | implement from a written spec, run build and tests |
| `refuter` | opus | review the builder's diff against the spec, rerun tests, ACCEPT or REWORK |
| `debugger` | opus | root cause only, when a failure is not obvious |

Always pass `subagent_type`. A bare Agent call inherits the session model and runs on Fable silently. Pass `model:` only to override the roster for one dispatch. Repo-owned skills such as `/pre-pr-review` keep inheriting the session model; do not pin a model inside a checked-in skill.

## Marching orders (every dispatch, in this order)

1. Goal, one sentence.
2. Scope: exact files or URLs.
3. May change / must not change.
4. Must verify: the commands to run.
5. Do not: the traps for this task.
6. Output format and cap (default 40 lines).
7. Known: facts already established, so the agent does not rediscover them.
8. Scratch path: `<session scratchpad>/<agent>-<topic>.md` for anything over the cap. The next agent reads the file; the report to Fable is the path plus a short summary.
9. Data precondition (builders and refuters): name the rows or paths the feature depends on (which senders populate CUSTOMER_ID, which users have two facilities) and require the agent to query them, not exercise one seeded row. The loop verifies the spec; this line is what makes the spec verify the requirement.
10. Board (builders and refuters): `BOARD: https://claude.ai/artifact/GJS9SUHY6eiX4bp32G65z1 card <card id>`, so the agent posts its milestones to its card (see Orchestration Board).

## Orchestration Board

Every orchestrated task goes on the live board at https://claude.ai/artifact/GJS9SUHY6eiX4bp32G65z1, in every project, so Cooper can watch progress from any device. An orchestrated task is any task that dispatches a builder, refuter or debugger; inline work and lone scout or researcher lookups stay off the board.

- **Start:** before the first dispatch, create the session doc and one card per ticket or task in a single batch.
- **During:** write at each dispatch, check-in, report, rework and commit. Run a heartbeat on any dispatch expected to run past ~30 min.
- **Finish:** mark the session Done with `completed` when the task ends, including when it is abandoned or handed off.
- The protocol (fields, which write at which moment, the ArtifactData recipe) is the "Writing protocol" section of `~/.claude/orchestration/board/README.md`. Read it at the start of each orchestrated task; it is the single source.
- Board writes are orchestrator work, like ticket hygiene: Fable makes them between dispatches and never hands them to a builder. A failed board write is reported once and never blocks the task.
- The page's code lives in the same folder (git repo, private GitHub `Co0pDawg/Orc-Dashboard`). Data changes never need a republish.

## Build loop

Fable spec → `builder` → `refuter` → Fable.

- REWORK: send the must-fixes to the same builder with SendMessage so its context survives, then dispatch a fresh refuter. After two REWORK rounds Fable reads the diff itself and decides.
- Parallel is fine for read-only work: scouts, researchers, refuters. Never two writers on the same files. Parallel builders get `isolation: "worktree"`.
- Rate-limit guard: no more than three Opus-tier agents in flight at once; stage wider fan-outs 3+3 with the mandatory agent first. Never launch an Opus fan-out or refuter right after a builder that spent over 300k tokens: refute inline, use a Sonnet refuter (`model: "sonnet"`), or wait. A 429'd dispatch costs the launch and the wait and returns nothing.
- Builder and refuter reports state the test-run log timestamps against the time of the last code edit. A green run older than the last edit is not evidence (a stale green was caught this way on 2026-09-30).
- Run-and-commit work stays on Opus builders, or the brief says to wait for the run to finish: a Sonnet builder handed back mid-run and Fable had to finish it.
- Batch related fixes into one builder dispatch so large files are read once.
- An agent that drifts off its orders gets stopped (TaskStop), not waited on.
- Ultracode and Workflow stay off unless explicitly asked; when on, cap the agent count in the script.
- Decisions and progress go into a handoff doc (`docs/superpowers/handoffs/` when the repo has it) so the next session reads the file instead of rebuilding context.
- Keep replies and agent reports short. Ask for detail when it is needed, not by default.

### Test runs (learned on PR 5896, 2026-09-14 — ~3 h of a 7 h loop was re-running suites)

- Builders run only the filtered tests for what they touched. Fable runs each full test project **once**, at the end, in the background, while the refuter does its static pass — never per builder, never per refuter.
- Full runs go by project name, sequentially. Never `dotnet test` a solution that contains a Playwright/UI project (Petsoft's `UITests` waits on an app forever). Two vstest hosts in one worktree at once has killed a run silently — serialise.
- A refuter reruns only targeted and mutation tests, `--no-build` where possible.
- When a builder's notification is late or its task id has vanished, read its report file and run logs on disk; do not wait on the notification.
- When a builder reports a behaviour finding that contradicts an earlier builder or refuter, Fable reads the code and the fixture itself before speccing a fix — the last one was a fixture artefact and cost only a comment.
- A cross-cutting rule (e.g. "null weight reads as 0 lb") goes in one spec; the other spec references it. Two specs stating it independently drifted apart within one round.
- Parallel builders: split by file ownership, one in a second worktree, and `git apply` the smaller diff onto the main one. Zero overlap both times it was used.
- Live-app verification (Playwright, browser checks) gets its own builder in its own worktree with its own DB copy, so it never shares build output with a code builder.

### Pre-PR review tier (learned 2026-09-30 to 10-01 — review was 34% of agent tokens, ~90k per reviewer run)

The refuter already reran the work, checked conventions and proved each test can fail, so the full review panel on top of it is mostly duplicated effort. On seven refuter-accepted, test-only PRs the full panel produced one warning (doc wording) and otherwise only suggestions and nits; on PRs with product code it found real issues across several agents. Pick the tier before launching review:

- **Light tier.** Applies when all three hold:
  1. The diff is tests and docs only (attribute-only hook edits in views, such as `data-testid`, count as test-only).
  2. A refuter returned ACCEPT after mutation checks.
  3. The refuter's brief included the repo's test-convention reviewer definition as its checklist (Petsoft: `docs/internal/agents/playwright-reviewer.md`).

  Run the repo's review skill scoped to the docs/comment agent only (Petsoft: `/pre-pr-review <branch> develop comments`). Fable reads the full diff itself. Write the calibration log as usual.
- **Full tier.** Use it for anything else: product code, schema or SQL, config, money or security paths, or no refuter ACCEPT. Run every agent the skill selects, staged 3+3.
- **Escalate.** If the light-tier agent or Fable's diff read finds anything beyond doc wording, run the full tier.
- **Nits** (suggestion/nit severity) get fixed by Fable inline only when cheap and in a file already in the diff. Otherwise they are logged `not-actioned`. A builder round is never spent on nits alone, and a rerun is not triggered for a comment-only change; rebuild instead.

### Specs, bugs and shared resources

- A spec for a search, filter or lookup UI lists the three inputs staff will type most (a partial number, a phone's last 4, part of an email) and walks each one through the planned matching rules to the result it shows. It also checks every new placeholder and label against its rendered width. Every review gate passed PR 6243, then Cooper's first live test found that a partial reservation number listed only invoices, that email needed an "@", and that the placeholder was cut off. The day-1 data already showed invoice numbers embed the reservation number.
- A test-coverage spec says "hook-only view edits (`data-testid`/`id` attributes) are in scope". Saying "no product code" made a builder skip hooks that the repo rules require in the same PR.
- After fetching the base branch, check whether the docs a spec tells agents to edit have changed shape (the UITests map was condensed mid-week). Point the spec at the current format.
- Fable confirms every defect a builder reports by reading the code before filing it. The bug says how it was confirmed ("reproduced live" or "verified by code read"). The root-cause wording gets checked too: one bug was filed with the builder's wrong cause and needed a correction comment.
- Live app runs share one dev database. Run at most two apps at once, and stagger a refuter's rerun after the builder's. A test that fails in Arrange on a load timeout or a closed browser gets one rerun before it counts as a failure, and both results are reported.
- Open PRs that edit a shared doc (a map or index) get their merge status checked whenever the base branch moves. Resolve conflicts in the base branch's current format.

## Versioning the setup

`~/.claude` is a git repo (private GitHub `Co0pDawg/Orc-istration`) with an allow-list `.gitignore`. This file, `settings.json`, `agents/*.md`, `orchestration/README.md`, the cost logs and `skills/peer-review/` are tracked, and transcripts, credentials, memory and plugins are not. After changing a tracked file, commit and push it in the same session; `README.md` there covers restoring and tracking a new file. The board is its own repo (`orchestration/board`, `Co0pDawg/Orc-Dashboard`).

## Orchestration cost log

Every orchestrated task writes one record to `~/.claude/orchestration/log/<date>-<project>-<slug>.md` before Fable reports done: one row per dispatch (agent, model, purpose, tokens, tool uses, minutes, result, `earned`/`marginal`/`waste` + reason), then Totals, Loop signal, and Spec misses. The Loop signal line names the pre-PR review tier used (light or full) and whether a later review or CI caught anything that tier missed, so the tier rule can be tuned from evidence. Totals also carries Fable's own context: the session context size at task start and at the record's writing (from the status line or `/context`), so a review can compare orchestrator spend against subagent spend. Format and review questions are in `~/.claude/orchestration/README.md`. Token figures come from each agent's completion notification; a resumed agent logs its delta, not the cumulative figure.

# Ticket hygiene (every ADO work item, not just `/start` runs)

The ticket is the record of the work, not the chat. Whenever a session works a work item (implementing, reviewing a PR for it, investigating a bug, splitting a story), keep the ticket current as the work happens, not at the end:

1. **Start:** set the item to `Active` (never backward, never past Active). Post one **Implementation checklist** comment, one unchecked line per planned step, and keep its comment id in the scratchpad. In Petsoft, post and edit it with `& ./.claude/scripts/ado.ps1 comment-add -Id <id> -BodyFile <file>` / `comment-edit -Id <id> -CommentId <cid> -BodyFile <file>` (`/start` Step 7 shows the flow).
2. **During:** after each commit or decision, **edit that same comment** (`[ ]` -> `[x]`, add a line for new scope or a deferral with its reason). One comment per run; never a new comment per commit.
3. **Decisions:** a scope change, a deferral (e.g. "AdSense deferred: needs nonce CSP + CMP"), or a design choice the user made goes on the ticket the moment it is made, so the ticket's last comment wins over the description.
4. **Sub-tickets:** when work splits, file the child Tasks/Stories immediately (`/create`), link them, and reference the ids in commits and the parent's checklist.
5. **Done:** final checklist edit lists the PR link, what was verified (build, tests, live app, dark mode/mobile), and what was left out. Resolve state changes only when the user asks.

Fable posts these itself between dispatches; it is orchestrator work, not builder work. If `az` returns nothing, read the error once and retry with what it names; if still blocked, draft the comment in the scratchpad and tell the user, do not skip the update silently.
