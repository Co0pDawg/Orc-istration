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

**Repo standards.** `node tools/orc.mjs standards` (run from the setup checkout) sets up a project's coding standards: `STANDARDS.md` at its root, which builders follow and refuters check diffs against, section by section. It detects the project's stacks and composes the file from a cited archive (`standards/`: ASP.NET Core, C#, Go, Java, Playwright, PowerShell, Python, React, Rust, SQL, TypeScript), from the team's own files (`--from`), or both. Before the first build in a repo without one, the orchestrator runs the setup in [`orchestration/standards.md`](orchestration/standards.md): it detects the stacks, then asks you in one several-picks question which to adopt and whether you have your own standards to import, then applies. A re-apply never overwrites a file the team has edited, or drops a stack or import it was applied with, unless forced, and then keeps a backup. `install` writes the setup checkout's path into the installed rulebook ("Setup checkout (this machine)"), so any tool can find the procedure and the command. Claude Code also gets the procedure as the `repo-standards` skill, but only where `~/.claude` is the setup checkout, since skills load from `~/.claude/skills`.

**Sprint mode.** For a timeboxed build, such as a live AI-assisted interview exercise, ask for a sprint ("sprint mode", "a 45-minute sprint"). For that one task the orchestrator follows [`orchestration/sprint.md`](orchestration/sprint.md): at most three runnable slices, a walking skeleton by about minute 15, a feature freeze ten minutes before the deadline, one builder resumed per slice, Mid-tier refuters reviewing each slice's commit while the next is built, and one rework round. It skips the board, the standards setup, the review panel and the cost log; it never skips the orchestrator's diff read, one real run of the app, or the PR and safety rules. A sprint as an iteration name ("put this in sprint 45") does not trigger it. Claude Code also gets it as the `sprint` skill where `~/.claude/skills` has it.

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

Then, in each project, set up its coding standards with the `repo-standards` skill ([`orchestration/standards.md`](orchestration/standards.md)). The skill is there because `~/.claude` is this checkout; from a separate clone, follow the procedure with that clone as `<setup>`.

**Antigravity CLI.** From a clone of this repo:

```
node tools/orc.mjs check
node tools/orc.mjs install --tool antigravity                 # dry run
node tools/orc.mjs install --tool antigravity --apply --board http://localhost:8377/ --board-repo <path to Orc-Dashboard>
agy models | node tools/orc.mjs models --tool antigravity --from-stdin
```

Save the last command's output as `models.local.json`. Then, in each project, run the standards setup in [`orchestration/standards.md`](orchestration/standards.md); `install` prints this pointer too, and writes this clone's path into the rulebook as the setup checkout. The rest: [Install and Quick Start](https://github.com/Co0pDawg/Orc-istration/wiki/Install-And-Quick-Start).

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
| `tools/orc.mjs`, `tools/lib/` | Generator and installer: `build`, `check`, `sync`, `golden`, `install`, `uninstall`, `status`, `models`; method tooling: `brief`, `review-tier`, `costlog`, `dispatch`, `hooks`, `standards`; review panel: `calibration`, `metrics`; `help` |
| `tests/` | `npm test`: golden files per tool (`node tools/orc.mjs golden` regenerates them), install and check tests |
| `CONTRIBUTING.md` | How to change this repo: sources vs generated files, the edit loop, traps |
| `docs/cli.md` | The full command reference |
| `orchestration/README.md` | Cost-log format and review questions |
| `standards/`, `orchestration/standards.md`, `skills/repo-standards/` | The coding-standards archive (format in `standards/README.md`), the tool-neutral setup procedure, and its Claude Code skill |
| `orchestration/sprint.md`, `skills/sprint/` | Sprint mode: a timeboxed build (default 45 minutes) that waives the board, standards setup, review panel and cost log for one task, and its Claude Code skill |
| `docs/` | Rulebook incident notes; the tracker contract and how to adopt a repo; outlines for unattended runs and project memory |
| `settings.example.json` | Claude Code hooks, status line and plugins, with no permissions |
| `hooks.node.example.json` | The board-reminder hooks on Node (`hooks --node`) |
| `tools/board-reminder.ps1`, `tools/board-reminder.mjs`, `tools/peon/` | Claude Code hooks: board reminder (PowerShell or Node), sound alert while input is pending and when a turn finishes |
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

## Command reference

Every command is `node tools/orc.mjs <command>`. Options: `node tools/orc.mjs help <command>`. Full reference: [docs/cli.md](docs/cli.md).

| Command | Purpose |
|---|---|
| `build` | Write every tool's generated files to `dist/<tool>/` (untracked), with sizes and gaps |
| `check` | Check caps and `models.json`, and that `CLAUDE.md` and `agents/*.md` match the build |
| `sync` | Regenerate the checked-in `CLAUDE.md` and `agents/*.md` |
| `golden` | Regenerate `tests/golden/<tool>/` |
| `install` | Install one tool's files into a home folder (dry run without `--apply`) |
| `uninstall` | Delete the files an install recorded (dry run without `--apply`) |
| `status` | Compare an installed copy with the current build |
| `models` | Turn `agy models` output into a `models.local.json` fragment |
| `brief` | Print or lint a marching-orders brief |
| `review-tier` | Say whether a branch diff is Light-eligible or Full |
| `costlog` | Draft a cost log from the board |
| `calibration` | Per-lane precision of the review panel from its run logs |
| `metrics` | Capture or report per-run review metrics from Claude Code transcripts |
| `dispatch` | Run one role headlessly at its tier |
| `hooks` | Merge the example hooks into `settings.json` (dry run without `--apply`) |
| `standards` | List, show or detect archive coding standards, or compose a project's `STANDARDS.md` (dry run without `--apply`) |
| `help` | List the commands, or one command's options |

CI (`.github/workflows/test.yml`) runs `npm test` and `check` on Ubuntu and Windows, and the worklog self-test on Windows.

## Review panel

The Full pre-PR review tier runs the review panel, ported from a production setup and made tool-neutral. `review/PROCEDURE.md` is the orchestrator's procedure: select lanes for the diff (`review/selection.md`), run read-only explorers over them in parallel (code, failure, docs, checklist, and design on large diffs), settle each lead with `review-verifier` or the owning explorer, raise under-rated items in a severity review, then write one report and a run log. Each lane is a checklist in `review/lanes/` (code-reviewer, silent-failure-hunter, comment-analyzer, type-design-analyzer, architecture-reviewer, code-simplifier, pr-test-analyzer, ui-test-reviewer, secondary-artifacts, ticket-coverage); `review/contract.md` and `review/shared-rules.md` hold the rules every explorer follows.

Stack-specific checks (tenant scoping, CSRF, migration co-change, UI test hooks, generated files, a documentation map) come from the reviewed repo's own `REVIEW.md`, or the file its rulebook names; without one the lanes skip those checks. A ticket brief comes from ticket text or a brief file you give. Run logs and metrics land in the reviewed repo's `.orc/` folder (`review/calibration.md`, `review/metrics.md`).

In Claude Code, `/pre-pr-review [branch] [base] [scope keywords] [lite|full]`, `/review-verdict` and `/calibration-report` are generated into `commands/`. They find this checkout through the `ORC_HOME` environment variable, else the rulebook's "Setup checkout (this machine)" line, else `~/.claude`. Other tools follow `review/PROCEDURE.md` by hand.

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
2. Check with `git check-ignore <path>` (no output means it can be tracked; `-v` also prints the `!` rule that re-includes it), then `git status`.
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
- peon-ping (sound alerts): install it into `hooks/peon-ping/` and keep only the `tools/peon/peon-hook.ps1` entries on PermissionRequest, Notification and Stop; delete the entries its installer adds. Turn every category off except `input.required` (a question or approval is waiting) and `task.complete` (the turn finished). Without peon-ping the wrapper does nothing.
- Credentials: log in again (`/login`, and `gh auth login` if used).
- Project memory (`projects/<project>/memory/`): see `docs/project-memory.md`.
- Scheduled tasks and their scripts: see `docs/ops-automation.md`; recreate Task Scheduler entries by hand.
- The worklog's 15-minute sync task: run `pwsh -NoProfile -File ~/.claude/tools/worklog/register-timeline-task.ps1` once, and set `ORC_ADO_SCRIPT` or `WORKLOG_ADO` to `tools/tracker/ado.ps1` (`tools/worklog/README.md`).

## Contributing

Agents and people changing this repo: start with [CONTRIBUTING.md](CONTRIBUTING.md).

Push a branch and open a pull request against `main`. Report bugs and ideas in [Issues](https://github.com/Co0pDawg/Orc-istration/issues).

---

<sub>Built with Orc-istration 🧌</sub>
