# Gemini CLI

- **Dispatch:** each agent is a tool named after it; start a prompt with `@name` to force one. Agents need `experimental.enableAgents` left on.
- **Tiers:** Low and Mid run `gemini-3-flash-preview`, High runs `gemini-3-pro-preview` (`models.json`). A headless run is `gemini -p "<orders>" -m <model> -o json`.
- **Hooks:** the `hooks` block in `~/.gemini/settings.json`.
- **Board:** local backend only; `install --board <address> --board-repo <path>` adds this machine's Board line.
- **Shared `~/.gemini`:** Antigravity may load both this `GEMINI.md` and `AGENTS.md` there; `install` warns whether the other file is orc-generated (remove it unless you also use Antigravity) or hand-written (yours to review, not remove).
- **Access:** needs a paid API key or an enterprise licence.
- **Review panel:** no slash command here: follow `review/PROCEDURE.md` in the setup checkout, dispatching the `review-*` agents by name. `metrics capture` reads Claude Code transcripts only, so it is unsupported here.
