# Cursor

- **Dispatch:** subagents live in `~/.cursor/agents/<name>.md`; ask for one by name. Cursor also reads `.claude/agents` and `.codex/agents`.
- **Tiers:** set real model ids per tier in `models.local.json` (options in brackets, e.g. `[effort=high]`); until then every agent uses `inherit`.
- **Rulebook:** Cursor has no global rules file. Put this file in a project as `AGENTS.md`, or paste it into User Rules.
- **Board:** local backend only.
- **Review panel:** no slash command here: follow `review/PROCEDURE.md` in the setup checkout, dispatching the `review-*` agents by name. `metrics capture` reads Claude Code transcripts only, so it is unsupported here.
