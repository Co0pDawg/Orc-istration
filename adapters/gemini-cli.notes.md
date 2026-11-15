# Gemini CLI

- **Dispatch:** each agent is a tool named after it; start a prompt with `@name` to force one. Agents need `experimental.enableAgents` left on.
- **Tiers:** Low and Mid run `gemini-3-flash-preview`, High runs `gemini-3-pro-preview` (`models.json`). A headless run is `gemini -p "<orders>" -m <model> -o json`.
- **Hooks:** the `hooks` block in `~/.gemini/settings.json`.
- **Board:** local backend only. Installing Antigravity too puts a second rulebook (AGENTS.md) in `~/.gemini`.
- **Access:** needs a paid API key or an enterprise licence.
