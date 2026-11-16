# `Orc-istration`

<img src="docs/images/orc-istration-banner.svg" alt="Orc-istration banner in a green terminal style: the name, the line 'Run AI coding agents like a small (orc) engineering team', and the build loop from spec to builder to refuter to diff read to pull request, with a rework arrow back to the builder" width="880">

[![Tests on main](https://github.com/Co0pDawg/Orc-istration/actions/workflows/test.yml/badge.svg?branch=main&event=push)](https://github.com/Co0pDawg/Orc-istration/actions/workflows/test.yml?query=branch%3Amain+event%3Apush)

**Run AI coding agents like a small engineering team.**

`Orc-istration` is a method and a toolkit for multi-agent coding work. One orchestrator plans and reviews, cheap agents search, expensive agents build, and an adversarial reviewer tries to break each built change before a person sees it. One tool-neutral rulebook and five agent roles are turned into native files for seven agent tools.

It is not an autonomous swarm. A person stays in charge: a spec is written before any code, each built change gets an independent review, and nothing counts as done until the orchestrator has read the final diff.

> **Status: developed and used on Claude Code; early on other tools.** The full loop has run live only on Claude Code. Antigravity CLI has had one live run of a generated agent, and the other five adapters are verified by tests against each tool's documented format. See [Limits](#limits).

Full documentation lives in the [wiki](https://github.com/Co0pDawg/Orc-istration/wiki).

## How it works

- **A spec comes first.** The orchestrator is the main chat session. Before anything is built it writes a ten-item brief called the marching orders.
- **Cheap agents look, expensive agents build.** A subagent is a separate agent the orchestrator starts with that brief; it works in its own context and returns a short report. Each role runs on a tier (Low, Mid or High), which maps to a cheaper or more capable model per tool. Scouts (Low) find files, researchers (Mid) read docs and report cited facts, and a builder (High) implements exactly the spec and runs the filtered tests.
- **Every built change is attacked.** A refuter (High), which did not write the code, reviews the diff against the spec, reruns the tests, mutation-checks them, and returns ACCEPT or REWORK.
- **Rework is bounded.** REWORK goes back to the same builder. After two rounds the orchestrator reads the diff and decides.
- **The orchestrator signs off.** It reads the final diff itself, picks a pre-PR review tier, and opens a pull request.
- **You can watch it happen.** Agents post their progress to a live board, one card per task.
- **Costs are counted.** Every task writes a cost record, and the rules are tuned on that data.

```mermaid
flowchart LR
  S["Scout: locations"] --> O
  R["Researcher: cited facts"] --> O
  O["Orchestrator writes spec"] --> B["Builder implements"]
  B --> F["Refuter tries to break it"]
  F -- "REWORK" --> B
  F -- "ACCEPT" --> D["Orchestrator reads diff"]
  D --> P["Pre-PR review"]
  P --> PR["Pull request"]
```

## What is in the box

**The roster** (`roles/*.md`):

| Role | Tier | What it does |
|---|---|---|
| scout | Low | Find files, symbols and call sites. Returns locations only, never file bodies. |
| researcher | Mid | Read docs, source or the web; every fact cited or marked UNVERIFIED. |
| builder | High | Implement exactly the spec, run the build and filtered tests, mutation-check one new test. |
| refuter | High | Try to prove the diff wrong against the spec; rerun tests; ACCEPT or REWORK. Never edits. |
| debugger | High | Root cause for a failure that is not obvious. Reproduces first. |

Six more roles (`review-*`) make up the [review panel](#review-panel) the Full review tier runs.

**The marching orders.** Every dispatch carries the same ten items, in order:

1. Goal, in one sentence.
2. Scope: exact files or URLs.
3. May change and must not change.
4. Must verify: the commands to run.
5. Do not: the known traps.
6. Output format and cap (40 lines by default).
7. Known: facts already established.
8. Scratch path for anything over the cap.
9. Data precondition: the real rows or paths the feature depends on.
10. Board: the card and stage the agent updates.

**The board.** A live status page with one block per session and one card per task moving through its stages, so the person running the agents can follow the work without reading transcripts. It lives in its own repo, [Orc-Dashboard](https://github.com/Co0pDawg/Orc-Dashboard).

![The board in its Sleek skin: a session with its activity log on the left and task cards showing stages and progress lines, using demo data](https://raw.githubusercontent.com/Co0pDawg/Orc-Dashboard/main/docs/screenshots/board-sleek.png)

**The cost log.** Every orchestrated task writes one record: a row per dispatch with agent, model, tokens, minutes, result and a value label (`earned`, `marginal` or `waste`). The format and the review questions are in [`orchestration/README.md`](orchestration/README.md).

## Evidence

The first cost review ([`orchestration/README.md`](orchestration/README.md), 13 records) covered about 14.5M subagent tokens over about 110 dispatches. Of those the review labelled, 80 were earned, 9 marginal and 4 waste. The High tier took about 75% of the spend. Scouts were half marginal, and all four wastes were rate-limit failures or a dispatch in the wrong folder. The rules changed because of it: a cap of three High-tier agents in flight, scouts limited to locations, a data-precondition item in the marching orders, and a mandatory orchestrator-context line in each record.

Every change that goes through the build loop gets an independent adversarial review before a person sees it; only small inline fixes (a one-line change, anything under about five tool calls) skip it. The refuter reruns the tests itself and mutation-checks them (it breaks the code and confirms a test fails). The incidents behind each rule are recorded in [`docs/rulebook-notes.md`](docs/rulebook-notes.md).

## Works with

| Tool | What gets generated | Verified how | Main gap |
|---|---|---|---|
| Claude Code | `CLAUDE.md` + `agents/*.md` in `~/.claude` | The loop has run on the earlier Claude-only rulebook; the files generated from this repo have not run live yet | Builder and debugger keep MCP tools (no allowlist) |
| Antigravity CLI | `~/.gemini/AGENTS.md` + `config/agents/` | One headless live run of the scout (2026-11-15) | Models only `flash` or `pro`; no per-agent effort |
| Gemini CLI | `~/.gemini/GEMINI.md` + `agents/` | Golden-file tests against documented formats | No nested or documented parallel subagents |
| Codex CLI | `~/.codex/AGENTS.md` + `agents/*.toml` | Golden-file tests against documented formats | No tool allowlist; Windows through WSL2 |
| Cursor | Project `AGENTS.md` + `~/.cursor/agents/` | Golden-file tests against documented formats | No global rulebook; model ids must be set |
| GitHub Copilot CLI | `copilot-instructions.md` + `agents/*.agent.md` | Golden-file tests against documented formats | Model ids must be set; coarse tool aliases |
| OpenCode | `~/.config/opencode/AGENTS.md` + `agents/` | Golden-file tests against documented formats | One documented model id for every tier |

Details per tool: [Supported Tools](https://github.com/Co0pDawg/Orc-istration/wiki/Supported-Tools).

## Quick start

Requires Node 22 or later. No dependencies.

**Claude Code.** This repo is rooted at `~/.claude` (see "Restore on a new machine"). After editing `AGENTS.md`, `roles/` or `adapters/`:

```
node tools/orc.mjs sync      # regenerates CLAUDE.md and agents/*.md
npm test                     # golden files, install tests, and check
```

**Antigravity CLI.** From a clone of this repo:

```
node tools/orc.mjs check
node tools/orc.mjs install --tool antigravity                 # dry run
node tools/orc.mjs install --tool antigravity --apply --board http://localhost:8377/ --board-repo <path to Orc-Dashboard>
agy models | node tools/orc.mjs models --tool antigravity --from-stdin
```

Save the last command's output as `models.local.json`. The rest: [Install and Quick Start](https://github.com/Co0pDawg/Orc-istration/wiki/Install-And-Quick-Start).

## Repository layout

| Path | What it is |
|---|---|
| `AGENTS.md` | The tool-neutral rulebook (the source) |
| `CLAUDE.md`, `agents/*.md` | Generated Claude Code files (`node tools/orc.mjs sync`) |
| `roles/*.md` | The agent roles (the five above and the six `review-*` panel roles): tier, access, capabilities, body |
| `review/` | The review panel: `PROCEDURE.md`, the explorer contract, shared rules, lane selection and `lanes/*.md` |
| `commands/*.md` | Claude Code slash commands: the review panel's three are generated (`node tools/orc.mjs sync`); the six workflow wrappers are hand-written |
| `workflows/` | Tool-neutral workflows around the build loop: `start`, `grill`, `draft-pr`, `peer-review`, `create`, `fix-ci` |
| `templates/AGENTS.md` | Starting rulebook for a repo you work on, with its Project settings block (`docs/adopt-a-repo.md`) |
| `tools/tracker/` | `ado.ps1`, the Azure DevOps tracker helper (`docs/tracker-contract.md`), and its offline self-check |
| `profiles/*.md` | Optional rulebook additions (`--profile <name>`); `dotnet-azure-devops` holds the long rulebook's stack rules and general lessons |
| `models.json` | Tier to model, per tool; `models.local.json` (untracked) overrides |
| `adapters/<tool>.mjs`, `.notes.md` | One adapter per tool: format, install paths, gaps, notes |
| `tools/orc.mjs`, `tools/lib/` | Generator and installer: `build`, `check`, `sync`, `install`, `uninstall`, `status`, `models`; method tooling: `brief`, `review-tier`, `costlog`, `dispatch`, `hooks` |
| `tests/` | `npm test`: golden files per tool, install and check tests |
| `orchestration/README.md` | Cost-log format and review questions |
| `docs/` | Rulebook incident notes; the tracker contract and how to adopt a repo; outlines for unattended runs and project memory |
| `settings.example.json` | Claude Code hooks, status line and plugins, with no permissions |
| `hooks.node.example.json` | The board-reminder hooks on Node (`hooks --node`) |
| `tools/board-reminder.ps1`, `tools/board-reminder.mjs`, `tools/peon/` | Claude Code hooks: board reminder (PowerShell or Node), sound alert while input is pending |
| `tools/worklog/` | A Windows-only example of time tracking on the hooks (one ticket format, Azure DevOps); not part of the method |
| `.github/workflows/` | CI: tests and `check` on Ubuntu and Windows |

## Limits

- The full loop has run live only on Claude Code, and that was with the earlier Claude-only rulebook: the rulebook and agent files generated from this repo have not run a live session yet. Antigravity CLI has had one headless run of the generated scout.
- Gemini CLI, Codex, Cursor, Copilot and OpenCode are verified by tests against documented formats only.
- Cursor and Copilot need model ids set in `models.local.json`; until then they use `inherit` or the default model.
- Hooks, the worklog and sound alerts are Claude Code extras. On other tools the board update after each report is a build-loop step.
- The artifact board backend can be written only from Claude Code; other tools use the local board.
- The setup assumes Windows with PowerShell 7 and Git Bash; the worklog hooks need porting for macOS or Linux.

## Which Claude do I need?

The full setup runs in Claude Code (terminal, IDE extension, or the desktop app's Code tab), which reads `~/.claude`. The claude.ai chat app can only view a board someone shared. To use the planning discipline there, paste the "Marching orders" and "Build loop" sections of `AGENTS.md` into a Project's instructions.

## Other tools

`build` prints each tool's full gap list and appends it to that tool's rulebook:

```
node tools/orc.mjs build --tool all              # writes dist/<tool>/... (untracked)
node tools/orc.mjs install --tool antigravity    # dry run: prints create / replace / unchanged per file
```

`--apply` writes; a replaced file is first copied to `<file>.orc-backup-<stamp>`. `install` refuses `--tool claude-code` without `--home`, because this repo is designed to be checked out as `~/.claude`. `--board` and `--board-repo` add this machine's board address to the installed rulebook. Installing both Antigravity and Gemini CLI puts two rulebooks in `~/.gemini`; `install` warns and names the file to remove.

**Manifest.** `install --apply` records every file it wrote, with the sha256 of the bytes, in `<home>/<tool folder>/.orc-manifest.<tool>.json` (for example `~/.gemini/.orc-manifest.antigravity.json`, so Antigravity and Gemini CLI keep separate manifests in the shared folder). It is written last, only when the install succeeded. On re-install a file still matching its recorded hash is replaced without `--force`, so role edits need no `--force`. A file edited by hand since install (`REPLACE EDITED`), or a differing file not in the manifest and without the generated-by marker (`REPLACE HAND-WRITTEN`), refuses the whole install unless `--force` is given (with a backup). A file whose role was removed is deleted when untouched and kept (and reported) when edited; the dry run lists both. A corrupt or foreign manifest, or one naming a path outside the tool folder, is refused and nothing is deleted. Before any write, backup or delete, every target's real path must stay inside the tool folder, and a symlink or junction below the tool folder refuses the whole install or uninstall; so does a manifest entry that is not a regular file.

`uninstall --tool <id> [--home <dir>] [--apply] [--force]` is a dry run by default. It deletes exactly the manifest's files that still match their hash, keeps edited ones (`--force` deletes them after a backup), removes the empty folders install created, and touches nothing else. When it keeps a file, the manifest stays and lists exactly the kept files, so `uninstall --apply --force` can remove them later; otherwise the manifest is removed. Without a manifest it refuses; remove the files by hand. `--tool claude-code` needs `--home`.

`status --tool <id> [--home <dir>]` compares an installed copy with what would be generated now, without writing: each file is `same`, `differs (first difference at line N)`, `edited since install, differs (...)`, `missing`, `stale (role removed)` or `extra` (a file in the agents folder that no role generates, marked `not installed by orc` when a manifest exists; install backups are skipped). It exits 0 only when everything is `same`.

`install --apply` records its `--profile`, `--board` and `--board-repo` values in the manifest (`options`). A later `install` or `status` without those flags reuses them and says so in one line; a flag given replaces the recorded value for that option, and `--no-profile` / `--no-board` clear it.

`build`, `install` and `status` take `--profile <name>` (repeatable or comma-separated) to append `profiles/<name>.md` after the tool notes; `check` and `sync` reject `--profile`, and the goldens use no profile. The rulebook core is the compact, generic `AGENTS.md`; `dotnet-azure-devops` is too large for Antigravity's 24,000-byte cap (the build fails with the size message), so use it with uncapped tools or as a project-level rules file.

## Method tooling

These commands check or do the manual steps the rulebook asks for. None of them writes to the board.

- `brief new [--role <name>] [--out <file>]` (with `--out`, as for `costlog`, an existing file is refused unless `--force` is given) prints the marching-orders template, parsed from the numbered list under "Marching orders" in `AGENTS.md` (items 9 and 10 only for builder, refuter and debugger). `brief lint <file> [--role <name>]` checks a brief: every item present, in order and filled in; nothing but an optional title heading before item 1 and nothing but the `BOARD:` line after the items' own (indented or fenced) lines; item 4 names a command (a code span, a fence, or a line starting with a runner word such as `npm` or `node` and an argument); item 6 states a cap; `BOARD: none` is accepted; a `BOARD:` line has the form `BOARD: <address> card cards/<id> stage <label>` (Claude Code's `slug <uuid>` after the address is accepted). It exits 1 with one line per problem.
- `review-tier [--base <ref>] [--repo-dir <dir>]` reads `git diff --name-only --no-renames <base>...HEAD` (default base `origin/main`) and prints `Light-eligible` when every path is a test (`tests/`, `test/`, `__tests__/`, `spec/`, `*.test.*`, `*.spec.*`, `*_test.*`) or a doc (`*.md`, `docs/`), else `Full` with the first three deciding paths. Light still needs a refuter ACCEPT after mutation checks (conditions 2 and 3 of "Pre-PR review tiers"). Prompts count as product, not docs: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `SKILL.md`, `*.agent.md`, `roles/`, `agents/`, `profiles/`, `.claude/`, `.agents/`, `.codex/`, `.cursor/`, `.gemini/` and `adapters/*.notes.md` make it `Full`; uncommitted changes print a warning, since they are not in `<base>...HEAD`.
- `costlog --session <id> (--board-export <file> | --board <http://localhost:port> --board-repo <dir>) [--out <file>]` drafts a cost log in the "Record format" of `orchestration/README.md`: one row per `<agent> dispatched on #<task>` event, ended by the next top-level event naming the same card (its text is the Result). Card `tokens` go in a per-card table, because the board records tokens per card, not per dispatch. Model, tools, value, project, orchestrator context, loop signal and spec misses are `TODO`. `--board` reads through `node <board-repo>/local/board.js export`.
- `dispatch --tool <id> --role <name> --brief <file> [--dry-run] [--timeout <seconds>] [--no-lint]` runs one role headlessly at its tier: Antigravity as `agy -p <brief> --agent <role> --model <models.json headless slug> --output-format json` (agy reads stdin only in stream-json mode, so the brief is one argument), Claude Code as `claude -p --agent <role> --model <tier model>` with the brief on stdin. Other tools exit 1 with "no headless recipe". The brief is linted first, is never put through a shell, `--dry-run` prints the command and exits 0, a real run streams the tool's output and exits with its code, and `--timeout` (whole seconds, 1 to 86,400) kills the process tree (exit 124); Ctrl-C or a kill of orc kills the tree too (exit 130 or 143). The brief is read once, BOM-stripped and UTF-16 decoded, and that text goes to the tool. `ORC_TOOL_BIN_<TOOL>` (e.g. `ORC_TOOL_BIN_CLAUDE_CODE`) points at the executable; a Windows `.cmd` shim is not started. A brief passed as an argument is refused (nothing started) when it holds a NUL byte or the command line would pass about 32,000 bytes; a tool that is not installed is named with its override variable.
- `hooks --home <dir> [--apply] [--node]` merges only the `hooks` block of `settings.example.json` (or, with `--node`, of `hooks.node.example.json`: the board reminder as `node <home>/.claude/tools/board-reminder.mjs`, no PowerShell) into `<home>/.claude/settings.json`, creating it when absent. `<you>` paths become the real home. A hook is added only when no hook under that event and matcher runs the identical command; the same command under a different matcher is added beside it, with a note naming the existing matcher; existing keys and hooks are never removed, reordered or rewritten. It is a dry run without `--apply`; `--apply` backs the file up first (only once the new content could be written), keeps a UTF-8 BOM, and refuses a file whose top level is not a JSON object. `--home` has no default.
- `check` also validates `models.json` and `models.local.json`: tool ids must be adapters, tiers `low`, `mid`, `high` (plus `headless` slugs per tier), values strings, and `effort` one of `low`, `medium`, `high`, `xhigh`, `max`, `ultra`.

CI (`.github/workflows/test.yml`) runs `npm test` and `check` on Ubuntu and Windows, and the worklog self-test on Windows.

## Review panel

The Full pre-PR review tier runs the review panel, ported from a production setup and made tool-neutral. `review/PROCEDURE.md` is the orchestrator's procedure: select lanes for the diff (`review/selection.md`), run read-only explorers over them in parallel (code, failure, docs, checklist, and design on large diffs), settle each lead with `review-verifier` or the owning explorer, raise under-rated items in a severity review, then write one report and a run log. Each lane is a checklist in `review/lanes/` (code-reviewer, silent-failure-hunter, comment-analyzer, type-design-analyzer, architecture-reviewer, code-simplifier, pr-test-analyzer, ui-test-reviewer, secondary-artifacts, ticket-coverage); `review/contract.md` and `review/shared-rules.md` hold the rules every explorer follows.

Stack-specific checks (tenant scoping, CSRF, migration co-change, UI test hooks, generated files, a documentation map) come from the reviewed repo's own `REVIEW.md`, or the file its rulebook names; without one the lanes skip those checks. A ticket brief comes from ticket text or a brief file you give. Run logs and metrics land in the reviewed repo's `.orc/` folder (`review/calibration.md`, `review/metrics.md`).

In Claude Code, `/pre-pr-review [branch] [base] [scope keywords] [lite|full]`, `/review-verdict` and `/calibration-report` are generated into `commands/`. They find this checkout through the `ORC_HOME` environment variable, else `~/.claude`. Other tools follow `review/PROCEDURE.md` by hand.

## Workflows

The work around the build loop, ported from the same production setup and made repo-neutral (`workflows/README.md`):

- `start <ticket>` works a ticket end to end: judge it, plan, branch, grill, build loop with a commit per accepted task, full tests once, pre-PR review, durable-rules check, with a live checklist on the ticket. It never opens the PR.
- `grill [plan]` interviews you on a plan until no decision is open.
- `draft-pr` writes the description and opens a draft PR linked to its work items.
- `peer-review <PR>` reviews and fixes a teammate's PR at a tier sized to its diff.
- `create` files a work item from the conversation.
- `fix-ci [run]` gets a failing pipeline back to green in capped cycles.

A workflow reads every repo-specific fact (tracker, base branch, branch naming, build and test commands, review rules) from the target repo's rulebook **Project settings**, then git, then one question. Start a repo's rulebook from `templates/AGENTS.md` and follow `docs/adopt-a-repo.md`. Work items, PRs and CI go through one tracker helper command (`docs/tracker-contract.md`); `tools/tracker/ado.ps1` implements it for Azure DevOps, with organization, project and repository from `ORC_ADO_ORG`, `ORC_ADO_PROJECT` and `ORC_ADO_REPO` and no defaults. In Claude Code they run as `/start`, `/grill`, `/draft-pr`, `/peer-review`, `/create` and `/fix-ci`; other tools follow `workflows/<name>.md` by hand.

## How the .gitignore works

It is an allow-list: `/*` ignores everything in `~/.claude`, then `!` lines re-include named files and folders. Transcripts, credentials, caches, plugins, memory and logs never get staged.

To track a new file:

1. Add `!/path` for it. For a file inside an ignored folder, un-ignore the folder (`!/dir/`), re-ignore its contents (`/dir/*`), then add `!/dir/file` (see the `agents/` block).
2. Check with `git check-ignore -v <path>` (no output means it can be tracked), then `git status`.
3. Never allow-list credentials, `settings.local.json`, `projects/` or `history.jsonl`.

## Restore on a new machine

`~/.claude` usually exists already (Claude Code creates it), so do not `git clone` into it. Back up any existing `CLAUDE.md` first, because `checkout -f` replaces it.

```
cd ~/.claude
git init -b main
git remote add origin https://github.com/Co0pDawg/Orc-istration.git
git fetch origin
git checkout -f main        # overwrites tracked files only; ignored files stay
```

If git reports "dubious ownership", run `git config --global --add safe.directory C:/Users/<user>/.claude` once. Do not copy `settings.example.json` over `settings.json`: run `node tools/orc.mjs hooks --home <your home>` to see the hook entries it would add, then add `--apply` (it backs up `settings.json` and adds only missing hooks, with `<you>` replaced). Use `--node` for the board reminder without PowerShell. The example's other keys (`model`, `statusLine`, `enabledPlugins`, `extraKnownMarketplaces`, `effortLevel`, `env`, `modelSettings`, `autoUpdatesChannel`, `theme`, `agentPushNotifEnabled`) are optional preferences: copy any you want by hand. Clone the board repo into `orchestration/board`, and put the board address in `~/.claude/board.local.md`.

## Not in the repo (reinstall or recreate)

- Plugins and marketplaces named in `settings.example.json` (`enabledPlugins`, `extraKnownMarketplaces`): install them with `/plugin`. The status line points into the ponytail plugin's cache, so it works only after that plugin is installed.
- peon-ping (sound alerts): install it into `hooks/peon-ping/` and keep only the `tools/peon/peon-hook.ps1` entries on PermissionRequest and Notification; delete the entries its installer adds. Turn every category off except `input.required`. Without peon-ping the wrapper does nothing.
- Credentials: log in again (`/login`, and `gh auth login` if used).
- Project memory (`projects/<project>/memory/`): see `docs/project-memory.md`.
- Scheduled tasks and their scripts: see `docs/ops-automation.md`; recreate Task Scheduler entries by hand.
- The worklog's 15-minute sync task: run `pwsh -NoProfile -File ~/.claude/tools/worklog/register-timeline-task.ps1` once, and set `ORC_ADO_SCRIPT` or `WORKLOG_ADO` to `tools/tracker/ado.ps1` (`tools/worklog/README.md`).

## Contributing

Push a branch and open a pull request against `main`. Report bugs and ideas in [Issues](https://github.com/Co0pDawg/Orc-istration/issues).

---

<sub>Built with Orc-istration 🧌</sub>
