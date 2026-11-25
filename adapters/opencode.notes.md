# OpenCode

- **Dispatch:** agents live in `~/.config/opencode/agents/<name>.md` with `mode: subagent`; ask for one by name. Read-only roles carry a `permissions` rule denying `edit`.
- **Tiers:** models are `provider/model#variant`; only `anthropic/claude-sonnet-5-5#high` is documented, so set others in `models.local.json`.
- **Board:** local backend only; `install` adds this machine's Board line from `--board <address> --board-repo <path>`, else `board` in `~/.orc/config.json`.
- **Review panel:** no slash command here: follow `review/PROCEDURE.md` in the setup checkout, dispatching the `review-*` agents by name. `metrics capture` reads Claude Code transcripts only, so it is unsupported here.
