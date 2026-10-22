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
| `tools/worklog/` | Time tracking: the hooks' `log-event.ps1`, the `worklog.ps1` roll-up, the board's `sync-timeline.ps1` and its scheduled-task script, with tests. Its data (`~/.claude/worklog/`) stays untracked. Imported with history by `git subtree` |

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
- peon-ping hook: `hooks/peon-ping/` (many hook entries in `settings.json` call `peon.ps1` / `peon.sh` there). Reinstall peon-ping, or remove those hook entries.
- Credentials: log in again (`/login`); also `az login` and `gh auth login` if used.
- Project memory: `projects/<project>/memory/` is not tracked. See `docs/project-memory.md`.
- Scheduled tasks and their scripts (`scripts/`, `cleanup/`, `buildwatch/`): not tracked; see `docs/ops-automation.md`. Task Scheduler entries must be recreated by hand.
- Absolute paths in `settings.json` contain the user name; edit them if the new account differs. That includes the three worklog hooks (`tools/worklog/log-event.ps1`).
- The worklog's 15-minute sync task: run `pwsh -NoProfile -File ~/.claude/tools/worklog/register-timeline-task.ps1` once. It and `worklog.ps1` look for `ado.ps1` at `C:DevelopmentPetsoft.claudescriptsado.ps1`; set `WORKLOG_ADO` if your Petsoft checkout lives elsewhere.

## Contributing

Teammates: push a branch and open a pull request against `main`. `main` is protected: a PR needs one approving review from the code owner (`CODEOWNERS`), and the owner pushes directly. Report bugs and ideas in [Issues](https://github.com/Co0pDawg/Orc-istration/issues).
