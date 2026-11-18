# Sprint mode

A timeboxed build: something working and reviewed inside a fixed clock (default 45 minutes), such as a live AI-assisted interview exercise or a spike. Sprint mode keeps the build loop's core — a spec, a builder, an adversarial read, the orchestrator's own diff read — and drops the ceremony that dominates wall clock on normal tasks.

Why: in the cost logs, agent runs take 2 to 7 minutes each, but tasks take hours. headhunter #37 ran 3h 40m: slice REWORK chains, a three-reviewer pre-PR stage, a 21-item fix round and a 19-minute refuter of that round. Sprint mode cuts those, not the agents.

## When it applies

Only when the user asks for it: "sprint", "sprint 45", "sprint mode", or the `/sprint` skill in Claude Code. The number is the clock in minutes (default 45). It lasts for that one task. Nothing switches it on by itself.

## Start (minute 0 to 5)

1. Note the start time and the deadline (12-hour clock). Every status line to the user carries the elapsed time, for example `[12/45 min]`.
2. Restate the goal in one sentence and the demo you will show at the end. Ask at most one question, and only if the goal is ambiguous; otherwise pick sensible defaults and say which.
3. Write the plan as at most 3 vertical slices, each runnable on its own. Slice 1 is the thinnest end-to-end path (a walking skeleton). Show it as the visible checklist.
4. Create a branch (never `main` or `develop`).

## Timebox

| By | State |
|---|---|
| ~15 min | Slice 1 runs end to end and is committed |
| T-10 | Feature freeze: no new slices, only fixes to what exists |
| T-5 | Final diff read done, app run once, committed |

If a slice is not done at its mark, cut its scope rather than move the mark. At T-10, an unfinished slice is reverted or left behind a clear "not done" note, never shipped half-wired.

## The loop, shrunk

- **Inline first.** The orchestrator does a slice itself when it is under ~10 tool calls. Most scaffolding (create the app, install, hello-world) is inline.
- **Builder.** One builder for the sprint, resumed with SendMessage for each slice so it keeps context. Brief: Goal, Scope, May change, Must verify, Do not. Skip Known/Data/Board unless they matter. Builders run the smoke test for their slice only.
- **One writer at a time.** The orchestrator edits only while no builder is running.
- **Pipelining.** While the builder works on slice N+1, a refuter reviews slice N statically from its commit (`git show <slice-N sha>`), never from the working tree the builder is editing. Its targeted test runs after the builder stops, or in a `git worktree add` checkout at that sha.
- **Refuter.** Mid tier (`model: "sonnet"` in Claude Code), static read plus the slice's targeted test, report capped at 15 lines, must-fixes only (anything that breaks the demo, loses data, or is a security hole). Should-fixes and nits are logged, not actioned.
- **Rework.** At most one REWORK round per slice. A REWORK for slice N is queued and sent to the builder when it finishes N+1. Anything left after that round the orchestrator fixes inline (with no builder running) or cuts.
- **Parallel builders.** Only with clean file ownership and a worktree made by `git worktree add` (pass the path; `isolation: "worktree"` has failed on Windows checkouts). Usually not worth the setup inside 45 minutes.
- **Tests.** Smoke and happy-path tests that prove the demo. No full-suite runs until the end, and then only if the suite takes under 2 minutes.
- **Commit per slice.** Each green slice is a commit, so there is always a demoable state to fall back to.

## Waived for the sprint

Each of these is a standing rule that sprint mode turns off for this task only:

- the live board (Start/During/Finish writes): skip it, or write one card at the end if the user wants a record; ignore board-reminder hook markers during the sprint;
- the standards setup before the first build: use the language's common conventions and say so;
- scouts and researchers: the orchestrator greps and reads docs inline;
- the Light/Full pre-PR review (the review panel, `review/PROCEDURE.md`): replaced by the per-slice refuter and the orchestrator's diff read; run `/pre-pr-review` after the clock if the work will ship;
- the 2-round REWORK limit: it is 1;
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

Report in under 10 lines: what works (the demo steps), what was cut, known defects (the logged should-fixes), the branch and the last commit, and total elapsed time.

## Before the clock starts (optional prep)

Permission prompts cost minutes under a clock. Before a timed session, pre-approve the read-only and build commands the stack will need (Claude Code: `/fewer-permission-prompts` or `permissions.allow` in settings), and have the toolchain installed. In Claude Code, `/fast` speeds up the orchestrator's own output.
