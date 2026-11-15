# Gemini CLI

- **Dispatch:** each agent is a tool named after it; start a prompt with `@name` to force one. Agents need `experimental.enableAgents` left on.
- **Tiers:** Low and Mid run `gemini-3-flash-preview`, High runs `gemini-3-pro-preview` (`models.json`). A headless run is `gemini -p "<orders>" -m <model> -o json`.
- **Hooks:** the `hooks` block in `~/.gemini/settings.json`.
- **Board:** local backend only; `install --board <address> --board-repo <path>` adds this machine's Board line.
- **Shared `~/.gemini`:** Antigravity may load both this `GEMINI.md` and its own `AGENTS.md`, so two rulebook copies; `install` warns. Remove `~/.gemini/AGENTS.md` unless you also use Antigravity.
- **Access:** needs a paid API key or an enterprise licence.
