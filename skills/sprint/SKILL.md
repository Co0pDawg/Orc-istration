---
name: sprint
description: Timeboxed build mode (default 45 minutes) for a live AI-assisted build such as an interview exercise or a spike. Use when the user explicitly asks for a timeboxed build ("sprint mode", "a 45-minute sprint", "sprint 45 min", /sprint). Not for a sprint as an iteration or backlog period ("put this in sprint 45").
---

# Sprint

This skill exists only where `~/.claude/skills` holds a copy of it. Elsewhere, follow the procedure directly: the rulebook's "Sprint mode" line triggers it on any tool.

Follow `<setup>/orchestration/sprint.md`. Resolve `<setup>` in this order: the `ORC_HOME` environment variable, the "Setup checkout (this machine)" line in the rulebook's tool notes, `~/.claude` when it has `tools/orc.mjs`, else ask the user. The argument, if any, is the clock in minutes (default 45).

Start by stating the start time and the deadline. The sprint begins with the Discover step (a live or a practice client) unless the user hands over a finished brief; then show the slice checklist and follow the procedure's timebox. The refuter dispatch is `subagent_type: "refuter"` with `model: "sonnet"`.

Beside this skill: `story-template.html`, the "How this was built" story page, filled by `make-story.mjs`; and `theme/`, the shared look to copy into the project.
