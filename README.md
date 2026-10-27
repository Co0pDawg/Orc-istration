# ~/.claude: orchestration setup

Public repo (`Co0pDawg/Orc-istration`) rooted at `~/.claude`. It holds the Claude Code orchestration rulebook, the agent roster and two outline docs, so the setup can be restored or reused on another machine.

## Tracked files

| Path | What it is |
|---|---|
| `CLAUDE.md` | Global rulebook: roster, marching orders, build loop, board, cost log, ticket hygiene |
| `settings.json` | Permissions, hooks, status line, `enabledPlugins`, `extraKnownMarketplaces`, model settings |
| `agents/*.md` | Roster: builder, debugger, refuter, researcher, scout |
| `orchestration/README.md` | Cost-log format and review questions |
| `skills/peer-review/` | Own skill (SKILL.md, score.sh); synced and plugin skills are not tracked |
| `docs/ops-automation.md` | Outline for unattended `claude -p` jobs |
| `docs/project-memory.md` | Outline for per-project memory |
| `tools/peon/peon-hook.ps1` | The single peon-ping hook entry: skips headless runs, then runs `hooks/peon-ping/peon.ps1` |
| `tools/worklog/` | Time tracking: the hooks' `log-event.ps1`, the `worklog.ps1` roll-up, the board's `sync-timeline.ps1` and its scheduled-task script, with tests. Its data (`~/.claude/worklog/`) stays untracked. Imported with history by `git subtree` |

## Which Claude do I need?

Everything here runs in **Claude Code**, which reads `~/.claude`. The claude.ai chat app does not.

| You mainly use | What works |
|---|---|
| Claude Code in a terminal (`claude`) | Everything: the rulebook, agents, build loop, worklog hooks, board writes |
| Claude Code in VS Code or JetBrains | Everything, same as the terminal (same engine, same `~/.claude`) |
| Claude desktop app, **Code** tab | Everything, same as the terminal |
| claude.ai chat (web, desktop Chat tab, mobile) | Viewing a board someone shared with you. No agents, hooks or worklog, and no board writes |

Chat-only users:

- To get the full setup, install Claude Code (`npm install -g @anthropic-ai/claude-code`, or open the desktop app's **Code** tab), sign in with the same claude.ai account, then follow "Restore on a new machine" below. The desktop Code tab needs no terminal.
- To watch someone else's work, ask the owner to share their board (Share menu on the artifact), then open the link in a browser or the app.
- To borrow only the planning discipline, paste the "Marching orders" and "Build loop" sections of `CLAUDE.md` into a claude.ai Project's instructions. Nothing runs on your machine that way.

Your own board: publish a copy of the board repo from Claude Code under **your** account (cross-organization editors cannot write another account's board data), then put its URL in `~/.claude/board.local.md`. The board repo's README covers publishing.

The setup assumes Windows with PowerShell 7 and Git Bash. On macOS or Linux, the worklog hooks and scheduled-task script need porting.

`orchestration/board/` is a separate repo, https://github.com/Co0pDawg/Orc-Dashboard (the live board page and its notes). It is ignored here; clone it on its own.

## How the .gitignore works

It is an allow-list: `/*` ignores everything in `~/.claude`, then `!` lines re-include named files and folders. Transcripts, `.credentials.json`, caches, plugins, memory and logs therefore never get staged.

To track a new file:

1. Add `!/path` for it. For a file inside an ignored folder, un-ignore the folder (`!/dir/`), re-ignore its contents (`/dir/*`), then add `!/dir/file` (see the `agents/` block).
2. Check with `git check-ignore -v <path>` (no output means it can be tracked), then `git status`.
3. Never allow-list credentials, `settings.local.json`, `projects/` or `history.jsonl`.

## Restore on a new machine

`~/.claude` usually exists already (Claude Code creates it), so do not `git clone` into it.

```
cd ~/.claude
git init -b main
git remote add origin https://github.com/Co0pDawg/Orc-istration.git
git fetch origin
git checkout -f main        # overwrites tracked files only; ignored files stay
```

If git reports "dubious ownership" (folder created by another account or an elevated shell), trust it once:

```
git config --global --add safe.directory C:/Users/<user>/.claude
```

Back up any existing `CLAUDE.md` or `settings.json` first, because `checkout -f` replaces them. Then clone the board repo into `orchestration/board`.

## Not in the repo (reinstall or recreate)

- Plugins and marketplaces named in `settings.json`: `enabledPlugins` lists pr-review-toolkit, frontend-design, superpowers, code-review, code-simplifier, mattpocock-skills (all from `claude-plugins-official`) and ponytail; `extraKnownMarketplaces` adds the `ponytail` marketplace from GitHub `DietrichGebert/ponytail`. Install via `/plugin`.
- Status line: `statusLine.command` points into `plugins/cache/ponytail/...`, so it works only after the ponytail plugin is installed. The version in the path may need updating.
- peon-ping (sound alerts, Orc Peon pack by default): install it into `hooks/peon-ping/`, then set `"default_pack": "peon"` and `"enabled": true` in its `config.json`. Its installer adds its own hook entries to `settings.json`; delete them and keep only the six async `tools/peon/peon-hook.ps1` entries (SessionStart, Stop, Notification, PermissionRequest, PreCompact, UserPromptSubmit). The installer's set registers both `peon.ps1` and `peon.sh` on every event, including each tool call, so sounds play twice and subagent tool calls flood the transcript with hook lines. The wrapper also stays silent in headless runs (`claude -p`). Without peon-ping installed, the wrapper does nothing.
- Credentials: log in again (`/login`); also `az login` and `gh auth login` if used.
- Project memory: `projects/<project>/memory/` is not tracked. See `docs/project-memory.md`.
- Scheduled tasks and their scripts (`scripts/`, `cleanup/`, `buildwatch/`): not tracked; see `docs/ops-automation.md`. Task Scheduler entries must be recreated by hand.
- Absolute paths in `settings.json` contain the user name; edit them if the new account differs. That includes the three worklog hooks (`tools/worklog/log-event.ps1`).
- The worklog's 15-minute sync task: run `pwsh -NoProfile -File ~/.claude/tools/worklog/register-timeline-task.ps1` once. It and `worklog.ps1` look for `ado.ps1` at `C:\Development\Petsoft\.claude\scripts\ado.ps1`; set `WORKLOG_ADO` if your Petsoft checkout lives elsewhere.

## Contributing

Teammates: push a branch and open a pull request against `main`. `main` is protected: a PR needs one approving review from the code owner (`CODEOWNERS`), and the owner pushes directly. Report bugs and ideas in [Issues](https://github.com/Co0pDawg/Orc-istration/issues).
