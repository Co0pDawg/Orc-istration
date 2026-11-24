# Codex CLI

- **Dispatch:** name the agent in the prompt ("use the `scout` agent to ..."); agents live in `~/.codex/agents/<name>.toml`. Parallel threads are capped by `agents.max_concurrent_threads_per_session`; the High-tier cap of three still applies.
- **Tiers:** Low `gpt-6-luna`, Mid `gpt-6.1-sol`, High `gpt-6-astra` (`models.json`), with `model_reasoning_effort` from the tier.
- **Board:** local backend only; `install --board <address> --board-repo <path>` adds this machine's Board line.
- **Review panel:** no slash command here: follow `review/PROCEDURE.md` in the setup checkout, dispatching the `review-*` agents by name. `metrics capture` reads Claude Code transcripts only, so it is unsupported here.
- **Fallback: one session per role.** Dispatch by name is not yet verified live. If it fails, run each role as its own Codex session: a builder session given the `developer_instructions` from `agents/builder.toml` and the written spec; then a fresh session given `agents/refuter.toml`'s, the spec and the diff, which reruns the tests and returns ACCEPT or REWORK with evidence. After a rework, a fresh refuter session reviews again, and the orchestrator reads the final diff. `orc.mjs dispatch` has no Codex recipe.
