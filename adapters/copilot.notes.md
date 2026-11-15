# GitHub Copilot CLI

- **Dispatch:** agents live in `~/.copilot/agents/<name>.agent.md`; ask for one by name. Tools are the aliases `read`, `search`, `execute`, `edit`, `web`; no agent gets `agent`.
- **Tiers:** set model ids per tier in `models.local.json`; until then agents use the default model. Agent bodies are capped at 30,000 characters.
- **Board:** local backend only; `install --board <address> --board-repo <path>` adds this machine's Board line.
