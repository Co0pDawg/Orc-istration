---
name: board
description: Write an orchestrated task to the live board (open the session and cards, write at each dispatch, report and commit, mark it Done). Use at the start of any task that dispatches a builder, refuter or debugger, and at each of those moments after; not for inline work or a lone scout or researcher lookup.
---

# Board

This skill exists only where `~/.claude/skills` holds a copy of it. Elsewhere, follow the protocol directly.

The protocol is the "Writing protocol" section of the board's `README.md`: read it at the start of each orchestrated task, and follow it over anything here. The board is its own repo (Orc-Dashboard). Find its README at `<setup>/orchestration/board/README.md`, else `~/.claude/orchestration/board/README.md`. Resolve `<setup>` in this order: the `ORC_HOME` environment variable, the "Setup checkout (this machine)" line in the rulebook's tool notes, `~/.claude` when it has `tools/orc.mjs`. The board address is in `board.local.md` beside the rulebook, or the Board line of the tool notes. No address: skip the board and say so once.

## Backend

- **Artifact** (`claude.ai/artifact/...`): load ArtifactData with ToolSearch `select:ArtifactData`. If it is absent, load `select:mcp__claude-artifacts__db_get,mcp__claude-artifacts__db_write`, resolve the address to its UUID slug first (the short id fails), and pass `ifVersion` on every write to an existing doc.
- **Local** (`http://localhost:<port>`): `node <board repo>/local/board.js batch` for the Start write, `append` for progress and events, `update` for fields. Exit 2 is a version conflict.

## Every write

- Take times from `date -Iseconds` at the moment of the write, never an estimate.
- Pin each write to an existing doc to the version last read. On a conflict, re-read and redo.
- Bump the session's `updated`, so it sorts first.
- Write more than one doc in one `batch`.
- A failed write is reported once and never blocks the task.

## The moments

1. **Start**, before the first dispatch, as one batch: the session doc `sessions/<YYYY-MM-DD>-<project>-<slug>` and one `cards/<id>` per task, every planned stage `pending`. `stages` is an array in plan order, never an object. Add `github: "owner/repo"` when the repo's tickets are GitHub issues. Then do any other Start steps the README lists for this machine.
2. **Dispatch**: set the card's `agent`, append `{at, text: "<agent> dispatched on #<task>", card}`, update `now` and `status`. Put `BOARD: <address> card cards/<id> stage <label>` in the brief (artifact backend: add `slug <uuid>` after the address). When the agent will not move its own stage (see below), turn it `active` with `started` yourself in this write.
3. **Check-in** and **heartbeat**: append to that dispatch event's `sub` only when something changed. Schedule a check every 20 to 30 minutes for a dispatch expected to run past about 30 minutes.
4. **Report**: write `tokens` from the completion notice. In that same write, read the card and correct any stage the agent did not move. Append the outcome as a top-level event naming the card (`refuter ACCEPT`, `builder done: 40 tests pass`).
5. **Commit**: set the card's `commit` and append an event naming the hash. **PR opened**: set the session's `pr: {id, url, status: "draft"}`.
6. **Finish**, also when the task is abandoned or handed off: session `status: "Done"`, `completed`, a closing `now` and a final event.

## Who writes which card

- **Builders** write their own card's `progress`, `note` and the stage their brief names, on either backend.
- **Refuters** write their card on a local board through `board.js`, so give them the normal `BOARD:` line there. On the artifact board they cannot: on Claude Code their tools allowlist has no MCP tools. Give them the `BOARD:` line anyway (they report `BOARD: skipped: artifact backend`) or `BOARD: none`, and after they report, write their stage, `note` and milestones yourself.
- **Debuggers** have no board protocol in their role. Write their stage and `note` yourself.
- Agents never write the session doc, and `tokens` is always yours.
