---
name: sprint
description: Timeboxed build mode (default 45 minutes) for a live AI-assisted build such as an interview exercise or a spike. Use when the user says "sprint", "sprint 45", "sprint mode" or asks to build something fast against a clock.
---

# Sprint

This skill exists only where `~/.claude/skills` holds a copy of it. Elsewhere, follow the procedure directly: the rulebook's "Sprint mode" line triggers it on any tool.

Follow `<setup>/orchestration/sprint.md`. Resolve `<setup>` from the "Setup checkout (this machine)" line in the rulebook's tool notes, else `~/.claude` when it has `tools/orc.mjs`, else ask the user. The argument, if any, is the clock in minutes (default 45).

Start by stating the start time, the deadline and the slice checklist; then follow the procedure's timebox. The refuter dispatch is `subagent_type: "refuter"` with `model: "sonnet"`.
