# Codex CLI

- **Dispatch:** name the agent in the prompt ("use the `scout` agent to ..."); agents live in `~/.codex/agents/<name>.toml`. Parallel threads are capped by `agents.max_concurrent_threads_per_session`; the High-tier cap of three still applies.
- **Tested named dispatch:** standalone Codex CLI 0.172.0 loaded the generated project-local roles from a trusted project's `.codex/agents/`. With `multi_agent_v2` and `multi_agent_v2_dynamic_tools` enabled, select the exact `agent_type` (for example `builder`) and pass the brief with `fork_turns: "none"` for an ephemeral run.
- **Tiers:** Low `gpt-6-luna`, Mid `gpt-6.1-sol`, High `gpt-6-astra` (`models.json`), with `model_reasoning_effort` from the tier.
- **Board:** local backend only; `install --board <address> --board-repo <path>` adds this machine's Board line.
- **Review panel:** no slash command here: follow `review/PROCEDURE.md` in the setup checkout, dispatching the `review-*` agents by name. `metrics capture` reads Claude Code transcripts only, so it is unsupported here.
- **Fallback: one session per role.** If native dispatch is unavailable, give one Codex session the `developer_instructions` from `agents/builder.toml` and the written spec. Give a fresh session the refuter's instructions, the spec and the diff so it can rerun the tests and return ACCEPT or REWORK with evidence. After rework, run independent review again and read the final diff. `orc.mjs dispatch` has no Codex recipe.
