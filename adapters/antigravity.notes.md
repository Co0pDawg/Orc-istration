# Antigravity CLI

- **Dispatch:** call `invoke_subagent` with the roster name and the marching orders; `@name` in the CLI messages one. Generated agents set `mainAgent: true` alongside `subagent: true` so `agy --agent <name>` accepts them (older agy fell back to the default agent on an unknown `--agent`). Subagents run concurrently with a clean context; the High-tier cap of three still applies.
- **Tiers:** subagent `model` is `flash` (Low, Mid) or `pro` (High). A headless run (`agy -p`) takes `--model <slug>` from `models.json` `headless`; refresh the slugs with `agy models | node tools/orc.mjs models --tool antigravity --from-stdin [--family <name>]` (default `flash`).
- **Hooks:** `hooks.json` (SessionStart, PreToolUse, PostToolUse, PreInvocation, PostInvocation, Stop).
- **Shared `~/.gemini`:** Antigravity may load both `AGENTS.md` and a Gemini CLI `GEMINI.md` there, so two rulebook copies; `install` warns, whether that file is orc-generated or hand-written. Remove an orc-generated `~/.gemini/GEMINI.md` unless you also use Gemini CLI.
- **Mid-flight messages:** a chat message sent to an Antigravity orchestrator while subagents or background commands run force-cancels all of them. To relay a message mid-flight, wait for the agents to finish, or run the orchestrator on another tool.
- **Review panel:** no slash command here: follow `review/PROCEDURE.md` in the setup checkout, dispatching the `review-*` agents by name. `metrics capture` reads Claude Code transcripts only, so it is unsupported here.
