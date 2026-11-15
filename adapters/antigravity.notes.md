# Antigravity CLI

- **Dispatch:** call `invoke_subagent` with the roster name and the marching orders; `@name` in the CLI messages one. Subagents run concurrently with a clean context; the High-tier cap of three still applies.
- **Tiers:** subagent `model` is `flash` (Low, Mid) or `pro` (High). A headless run (`agy -p`) takes `--model <slug>` from `models.json` `headless`; refresh the slugs with `agy models | node tools/orc.mjs models --tool antigravity --from-stdin`.
- **Hooks:** `hooks.json` (SessionStart, PreToolUse, PostToolUse, PreInvocation, PostInvocation, Stop).
- **Shared `~/.gemini`:** Antigravity may load both `AGENTS.md` and a Gemini CLI `GEMINI.md` there, so two rulebook copies; `install` warns. Remove `~/.gemini/GEMINI.md` unless you also use Gemini CLI.
