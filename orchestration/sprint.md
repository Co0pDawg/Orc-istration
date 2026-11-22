# Sprint mode

A timeboxed build: something working and reviewed inside a fixed clock (default 45 minutes), such as a live AI-assisted interview exercise or a spike. Sprint mode keeps the build loop's core — a spec, a builder, an adversarial read, the orchestrator's own diff read — and drops the ceremony that dominates wall clock on normal tasks.

Why: in the cost logs, agent runs take 2 to 7 minutes each, but tasks take hours. One multi-slice task ran 3h 40m, most of it slice REWORK chains, a three-reviewer pre-PR stage, a 21-item fix round and a 19-minute refuter of that round. Sprint mode cuts those, not the agents.

## When it applies

Only when the user explicitly asks for a timeboxed build: "sprint mode", "sprint 45 min", "a 45-minute sprint", or the `/sprint` skill in Claude Code (where `~/.claude/skills` has it). The number is the clock in minutes (default 45). A mention of a sprint as an iteration or backlog period ("put this in sprint 45", "this sprint's tickets") is not a request. When unsure, confirm in one line before starting. It lasts for that one task; nothing switches it on by itself.

Sprint mode overrides the lite modes (`Orc orchestration: lite`, `Orc review: lite`) for that task. On a `/start` run, it skips Step 12 (the review panel) like any other review; the rest of `/start` runs as written.

## Start (minute 0 to 5)

1. Note the start time and the deadline (12-hour clock). Every status line to the user carries the elapsed time, for example `[12/45 min]`.
2. Restate the goal in one sentence and the demo you will show at the end. Ask at most one question, and only if the goal is ambiguous; otherwise pick sensible defaults and say which. The sprint delivers a package, not only a build: the working app plus whatever polish the clock allows (see "Leftover time" below).
3. Write the plan as at most 3 vertical slices, each runnable on its own. Slice 1 is the thinnest end-to-end path (a walking skeleton). Show it as the visible checklist.
4. Create a branch (never `main` or `develop`).

## Timebox

| By | State |
|---|---|
| ~15 min | Slice 1 runs end to end and is committed |
| Core done | The last slice is committed: note the time ("core complete at 12 min") and start the polish ladder |
| T-10 | Feature freeze: no new slices or code rungs, only fixes to what exists |
| T-5 | Final diff read done, app run once, committed |

If a slice is not done at its mark, cut its scope rather than move the mark. At T-10, an unfinished slice or rung is reverted or left behind a clear "not done" note, never shipped half-wired.

## Leftover time: the polish ladder

Finishing the slices early is not the end of the sprint: the clock is the budget, and the time left goes into making the work presentable. Climb the ladder in order, one commit per rung with a subject naming it, so stopping at any rung leaves a demoable, committed state. Skip a rung that does not fit the project.

1. **Review fixes.** Fix the refuters' logged should-fixes, each with a test.
2. **Edge-case tests.** The bad inputs and boundaries the refuters probed by hand become tests.
3. **API and usage docs.** The stack's usual form: OpenAPI or Swagger for a web API, `--help` text for a command-line tool, a `.http` file or a curl demo script.
4. **A small UI or mockup**, when it shows the work better: one page served by the app that drives the main flow. Say in the report that it goes beyond the brief.
5. **README.** What it does, how to run and test it, the design decisions and trade-offs, and what would come next.
6. **Sprint report** (`SPRINT.md` or the README's last section): a timeline from `git log` (slice and rung commits with times), when the core was complete, the tests, the refuters' verdicts, what was cut, and a plain statement of how AI was used and who drove.

Rules for the ladder:

- Polish never changes behaviour the brief defines unless a test covers the change.
- Before rung 1, the last slice's refuter report is in and its must-fixes are applied (by the builder, resumed, or inline). A REWORK still pending for the last slice comes first: there is no next slice to queue it behind.
- Each rung gets the same treatment as a slice: a commit, and a refuter when it changes code (rungs 1 to 4). Docs-only rungs get the orchestrator's read.
- Builders for separate rungs (tests, a UI page, docs) own separate files, so parallel builders in their own worktrees can pay off here when 20 minutes or more are left; otherwise keep one builder.
- The freeze and the T-5 mark still hold. Stop starting code rungs at T-10. The docs-only rungs (README, sprint report) may be written between T-10 and T-5, since they record what exists rather than add to it.

## The loop, shrunk

- **Inline first.** The orchestrator does a slice itself when it is under ~10 tool calls. Most scaffolding (create the app, install, hello-world) is inline.
- **Builder.** One builder for the sprint, resumed for each slice so it keeps context (the tool notes say how to resume). Brief: Goal, Scope, May change, Must verify, Do not. Skip Known/Data/Board unless they matter. Builders run the smoke test for their slice only.
- **One writer at a time.** The orchestrator edits only while no builder is running.
- **Pipelining.** While the builder works on slice N+1, a refuter reviews slice N statically from its commit (`git show <slice-N sha>`), never from the working tree the builder is editing. Its targeted test runs after the builder stops, or in a checkout the orchestrator makes with `git worktree add <path> <sha>` and passes to the refuter.
- **Refuter.** Mid tier (in Claude Code, `model: "sonnet"`), static read plus the slice's targeted test, report capped at 15 lines, must-fixes only (anything that breaks the demo, loses data, or is a security hole). Should-fixes and nits are logged, not actioned during the slices; they are the first rung of the polish ladder.
- **Rework.** At most one REWORK round per slice. A REWORK for slice N is queued and sent to the builder when it finishes N+1. Anything left after that round the orchestrator fixes inline (with no builder running) or cuts.
- **Parallel builders.** Only with clean file ownership and their own worktrees (the tool notes cover worktree isolation). Usually not worth the setup for the slices inside 45 minutes; the polish ladder is the exception above.
- **Tests.** During the slices, smoke and happy-path tests that prove the demo; edge cases wait for the ladder's rung 2. No full-suite runs until the end, and then only if the suite takes under 2 minutes.
- **Commit per slice.** Each green slice is a commit, so there is always a demoable state to fall back to.

## Waived for the sprint

Each of these is a standing rule that sprint mode turns off for this task only:

- the live board (Start/During/Finish writes): skip it, or write one card at the end if the user wants a record; ignore board-reminder hook markers during the sprint;
- the standards setup before the first build: use the language's common conventions and say so;
- scouts and researchers: the orchestrator greps and reads docs inline;
- the inline threshold: ~10 tool calls instead of ~5;
- marching-orders items 6 to 11 in a brief (a headless `orc dispatch` then needs `--no-lint`);
- the Light/Full pre-PR review (the review panel, `review/PROCEDURE.md`): replaced by the per-slice refuter and the orchestrator's diff read; run `/pre-pr-review` after the clock if the work will ship;
- the 2-round REWORK limit: it is 1;
- the end-of-task full suite when it takes 2 minutes or more;
- live-app verification by its own builder, worktree and DB copy: the orchestrator runs the app once itself, on a local or throwaway database;
- the cost log before reporting done: write a short one afterwards, outside the clock, if wanted;
- the durable-rules question and the handoff doc.

## Never waived

- The orchestrator reads the final diff before calling it done.
- The app is run once, for real, before the deadline.
- No commits to `main` or `develop`; PRs are drafts.
- Confirm anything destructive or outward-facing.
- No migrations against a non-local database.
- No secrets in the code or the commit.

## Finish (T-5)

The sprint ends at T-5, not when the slices land; a sprint that is recorded somewhere (such as a practice log) is recorded as finished then.

Report in under 10 lines: what works (the demo steps), the polish rungs done, what was cut, known defects (the should-fixes not fixed), the branch and the last commit, when the core was complete and the total elapsed time. Point to the package: whichever of the README, the sprint report and a UI exist.

## Before the clock starts (optional prep)

Permission prompts cost minutes under a clock. Before a timed session, have the toolchain installed and pre-approve the stack's read-only and build commands (Claude Code: `permissions.allow` in the user-level `~/.claude/settings.json`; `/fewer-permission-prompts` helps only in an existing project with past sessions, and only for read-only calls). In Claude Code, `/fast` speeds up the orchestrator's own output.
