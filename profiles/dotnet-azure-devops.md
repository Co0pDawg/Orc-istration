Optional profile: rules from the long rulebook that the core leaves out, in their original wording. Add it with `node tools/orc.mjs build|install --tool <id> --profile dotnet-azure-devops`. It is too large for tools with a rules-size cap (Antigravity); use it with uncapped tools or as a project-level rules file.

Incidents behind these rules: `docs/rulebook-notes.md`.

## General lessons not in the core

### Roster detail

| Agent | Tier | Use for |
|---|---|---|
| `scout` | Low | find files, symbols, call sites; returns locations, never file bodies. Locations only: a question that decides a design goes to the orchestrator's own grep or a researcher, and one scout per question, never two with adjacent briefs |
| `researcher` | Mid, high effort | read docs/source/web and report facts; unconfirmed claims marked UNVERIFIED |
| `builder` | High, high effort | implement from a written spec, run build and tests |
| `refuter` | High, high effort | review the builder's diff against the spec, rerun tests, ACCEPT or REWORK |
| `debugger` | High, high effort | root cause only, when a failure is not obvious |

### Orchestration Board

- **Durable-rules check (before Done, every orchestrated task):**
  1. List what the run taught that should outlive it: reusable patterns, feedback that generalises, rule-shaped review findings, traps, process lessons.
  2. Drop what the repo's mapped docs already hold.
  3. Ask the user with one multiple-choice question (several picks allowed) which to write down.
  4. Write each picked rule where it bites: the repo doc on the branch, the skill (with a version bump), or this file. Then report what was written and what was declined.
  5. Never wait to be asked.
- The session doc and `tokens` are orchestrator work, like ticket hygiene: the orchestrator writes them between dispatches and never hands them to a builder. Agents write only their own card: its progress lines, `note` and the stage named in their `BOARD:` line. When the orchestrator sets `tokens` it reads the card and corrects any stage the agent did not move. Where the tool's hook system allows it, a hook reminds the orchestrator to update the session when an agent finishes; otherwise that update is a step after every agent report. A failed board write is reported once and never blocks the task.

### Build loop

- After stopping a builder (a pause, a stop), report its state from its last actions (notes file, logs, `git status`, any database it upgraded), not from the plan. It may be mid-mutation, so the resume brief says to check for a leftover mutation and restore from the builder's backups first.
- Multi-agent automation features (the tool notes name them) stay off unless explicitly asked; when on, cap the agent count in the script.
- Decisions and progress go into a handoff doc (`docs/superpowers/handoffs/` when the repo has it).
- Keep replies and agent reports short. Ask for detail when it is needed, not by default.

### Test runs

- Builders run only the filtered tests for what they touched. The orchestrator runs each full test project **once**, at the end, in the background, while the refuter does its static pass — never per builder, never per refuter. "The end" is after the review's fix round.
- Parallel builders: carry a worktree's changes with `git diff HEAD --binary`, never plain `git diff`.
- Parallel builders: never `git stash` in a worktree.
- In Git Bash with `MSYS_NO_PATHCONV=1`, native tools (`git -C`, `python`, `pip --target`) misread `/c/...` paths. Pass them `C:/...`.
- After merging into the worktree the user's app runs from, rebuild and restart that app and apply the branch's schema to its DB.
- Give a long git merge or push a timeout and read its result before the next step.
- Record the PID of every app or test host you start, and stop only that PID.
- A script that starts an app never captures or pipes that step's output (`$x = & step`, `if (-not (step))`, `*> file`). Start it with `Start-Process ... -WindowStyle Hidden -PassThru` and `WaitForExit()`.
- Keep the machine awake (Windows: `SetThreadExecutionState` with `[uint32]2147483651` in a background loop) from the first long dispatch until the last dispatch's results are in, not until the work "looks done".
- A test that fails in Arrange on a page-load timeout while another app or builder shares the same DB copy is contention until a rerun says otherwise: rerun it alone before treating it as a failure.
- `publish_files` attaches a file only by the path it resolves to: the long path in its real casing, not the scratchpad's 8.3 short form or a differently cased folder.

### Pre-PR review tier

- **Nits** (suggestion/nit severity) get fixed by the orchestrator inline only when cheap and in a file already in the diff. Otherwise they are logged `not-actioned`. A builder round is never spent on nits alone, and a rerun is not triggered for a comment-only change; rebuild instead.

### Specs, bugs and shared resources

- A spec for a new action lists each role and whether it can reach the action, turn it off, and open any page an email names.
- Check a PR's status right before merging work into its branch.
- When a push widens an open PR's scope, update its description in the same step, before asking about anything else.
- A spec for a recurring job says what happens to a missed run, a cancelled run and a failed item.
- A spec that reuses an existing event, email or notice names what that event actually sends, read from its handler.
- A spec for a feature that closes or blocks on other actions lists every path that changes the record and says for each whether the customer is told.
- A refuter's database probe runs every mutating action inside a transaction it rolls back, and reads the row's state before acting on it.
- A change to an agent definition cannot be tested from the session that made it, and a headless run cannot approve board writes. Test it in a new session, or paste the new rule into the brief and say the definition file itself is unproven.
- A spec that relies on a hook confirms in the tool's hooks docs where the output goes before design (see the tool notes).
- A UI feature gets a mockup on a Design-canvas artifact, approved by the user, before any builder is dispatched. Each artboard has light/dark and state tweaks, and the builder's spec names the approved artboards as the visual spec.
- A spec for a shared or public login lists every path that can reach that login from outside its own organization: attach by email, set a password, rename.
- Before offering a sentinel value as an option, grep what reads the column.
- A ticket rule that depends on what a column means gets a backtest on real data before the plan locks it.
- Live checks of anything relative to today run on a DB copy restored within the last few days.
- Marketing screenshots of a feature are taken after that feature's review and performance fixes land.
- A showcase-retake brief first confirms the restored backup holds the image's org, or names the seed procedure to run on the throwaway copy, and greps how many views use the image.
- A spec for a visual check names the states to look at and has the builder seed each one, not just open pages.
- A test that claims something did not happen gets a timing mutation from the refuter (the action delayed a few hundred ms), not only a logic one.
- A spec whose feature acts on a group (a booking with several members, linked records) walks one non-first member through the server's rule.
- A spec for a search, filter or lookup UI lists the three inputs staff will type most and walks each one through the planned matching rules to the result it shows. It also checks every new placeholder and label against its rendered width.
- A spec for a script that runs unattended tests each limit it claims on real data (a path filter over `git ls-files`, a real diff through the real gate) and checks native exit codes, because PowerShell's `$ErrorActionPreference = 'Stop'` does not cover them.
- A cheap model's yes/no check saves usage; it does not enforce anything. Put the real limit in code after the expensive step.
  - On one unattended run a Low-tier model gave opposite size verdicts on identical tickets across two runs.
- The orchestrator confirms every defect a builder reports by reading the code before filing it. The bug says how it was confirmed ("reproduced live" or "verified by code read"). The root-cause wording gets checked too.
- Live app runs share one dev database. Run at most two apps at once, and stagger a refuter's rerun after the builder's. A test that fails in Arrange on a load timeout or a closed browser gets one rerun before it counts as a failure, and both results are reported.
- Open PRs that edit a shared doc (a map or index) get their merge status checked whenever the base branch moves. Resolve conflicts in the base branch's current format.

### Versioning the setup

`~/.claude` is a git repo (public GitHub `Co0pDawg/Orc-istration`) with an allow-list `.gitignore`. This file, `CLAUDE.md`, `roles/`, `adapters/`, `models.json`, `settings.example.json`, `agents/*.md`, `orchestration/README.md` and `tools/` are tracked; transcripts, credentials, memory, plugins, `settings.json`, the cost logs, `models.local.json` and `board.local.md` are not (the repo is public). `CLAUDE.md` and `agents/*.md` are generated from this file, `roles/` and `adapters/` (`node tools/orc.mjs sync`). After changing a tracked file, commit and push it in the same session; `README.md` there covers restoring, tracking a new file and installing for other tools. The board is its own repo (`orchestration/board`, `Co0pDawg/Orc-Dashboard`).

When anything leaves a public repo's allow-list, scan all of that repo's history for people's names and internal terms, not just the current files. Untracking keeps the old commits.

### Orchestration cost log

Every orchestrated task writes one record to `~/.claude/orchestration/log/<date>-<project>-<slug>.md` before the orchestrator reports done: one row per dispatch (agent, model, purpose, tokens, tool uses, minutes, result, `earned`/`marginal`/`waste` + reason), then Totals, Loop signal, and Spec misses. The Loop signal line names the pre-PR review tier used (light or full) and whether a later review or CI caught anything that tier missed. Totals also carries the orchestrator's own context size at task start and at the record's writing. Format and review questions are in `~/.claude/orchestration/README.md`. Token figures come from each agent's completion notification; a resumed agent logs its delta, not the cumulative figure.

## Stack-specific (.NET, Playwright, Azure DevOps, AcmeApp)

### Orchestration Board

- In AcmeApp, `/start` Step 15 runs the durable-rules check.
- Every hours roll-up (`worklog.ps1 <date>`, in any project) ends by running `~/.claude/tools/worklog/sync-timeline.ps1 -Date <date> -Force` and uploading the pending files to the board (worklog README "Uploading"), so the Time page matches the roll-up without a "sync my timeline".

### Test runs

- Check a spec's test filter against the real class names before dispatch (`dotnet test --list-tests --filter ...`, or a grep of the test classes the diff touches).
- Full runs go by project name, sequentially. Never `dotnet test` a solution that contains a Playwright/UI project. Two vstest hosts in one worktree at once has killed a run silently — serialise.
- When the runtime-validator comes back with no browser (the chrome-devtools servers did not connect), an XL peer review still gets a browser pass before its fixes count as verified: a builder drives Chromium with `playwright-core` from `UITests/bin/Debug/net10.0/.playwright` against a `ticket-env.ps1` app.
- When SQL logins time out or report "insufficient memory in the buffer pool", check free RAM before blaming the app. Run `dotnet build-server shutdown` to free the idle MSBuild and compiler servers.
  - Keep at most one test host and one builder app running alongside the user's own app and browsers.

### Pre-PR review tier

- **Light tier.** Applies when all three hold:
  1. The diff is tests and docs only (attribute-only hook edits in views, such as `data-testid`, count as test-only).
  2. A refuter returned ACCEPT after mutation checks.
  3. The refuter's brief included the repo's test-convention reviewer definition as its checklist (AcmeApp: `docs/agents/playwright-reviewer.md`).

  Run the repo's review skill scoped to the docs/comment agent only (AcmeApp: `/pre-pr-review <branch> develop comments`). The orchestrator reads the full diff itself. Write the calibration log as usual.
- **Cheap reviewers.** In a full-tier run, give a Mid-tier model override when dispatching `secondary-artifacts`, `type-design-analyzer` and `code-simplifier`; the skill itself stays unpinned. Drop the override if a Mid-tier run misses a real defect.

### Specs, bugs and shared resources

- A spec for a new write path into a table lists the procs and queries that read that table and walks each one.
  - The walk covers what each reader assumes about the row (its length, its lifetime), and every caller of a shared proc, the Mobile API included.
- A refuter brief for a change that adds a foreign key, a relationship or a multi-row delete asks it to capture the SQL Server command batch (an EF interceptor, no database needed), not just to rerun the tests.
- When the base branch is merged in after a Playwright run, rerun the touched suite before pushing, or say plainly in the report that it was not rerun.

### Ticket hygiene (every ADO work item, not just `/start` runs)

The ticket is the record of the work, not the chat. Whenever a session works a work item (implementing, reviewing a PR for it, investigating a bug, splitting a story), keep the ticket current as the work happens, not at the end:

1. **Start:** set the item to `Active` (never backward, never past Active). Post one **Implementation checklist** comment, one unchecked line per planned step, and keep its comment id in the scratchpad. In AcmeApp, post and edit it with `ado.ps1 comment-add` / `comment-edit` (`/start` Step 7 shows the flow).
2. **During:** after each commit or decision, **edit that same comment** (`[ ]` -> `[x]`, add a line for new scope or a deferral with its reason). One comment per run; never a new comment per commit.
3. **Decisions:** a scope change, a deferral, or a design choice the user made goes on the ticket the moment it is made, so the ticket's last comment wins over the description.
4. **Sub-tickets:** when work splits, file the child Tasks/Stories immediately (`/create`), link them, and reference the ids in commits and the parent's checklist.
5. **Done:** final checklist edit lists the PR link, what was verified (build, tests, live app, dark mode/mobile), and what was left out. Resolve state changes only when the user asks.

The orchestrator posts these itself between dispatches; it is orchestrator work, not builder work. If `az` returns nothing, read the error once and retry with what it names; if still blocked, draft the comment in the scratchpad and tell the user, do not skip the update silently.
