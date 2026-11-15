# Codex CLI

- **Dispatch:** name the agent in the prompt ("use the `scout` agent to ..."); agents live in `~/.codex/agents/<name>.toml`. Parallel threads are capped by `agents.max_concurrent_threads_per_session`; the High-tier cap of three still applies.
- **Tiers:** Low `gpt-6-luna`, Mid `gpt-6.1-sol`, High `gpt-6-astra` (`models.json`), with `model_reasoning_effort` from the tier.
- **Board:** local backend only; `install --board <address> --board-repo <path>` adds this machine's Board line.
