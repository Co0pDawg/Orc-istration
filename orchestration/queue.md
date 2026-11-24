# Unattended issue queue

`node tools/orc.mjs queue` takes open GitHub issues that carry a label and were written by an allowed author, runs one headless Claude Code session per issue in a dedicated worktree, and, when the session reports a committed change, pushes the branch and opens a draft pull request itself. It stops cleanly when a usage limit is hit, so it can be scheduled into the hours the subscription is otherwise idle. It is the shipped form of the outline in `docs/ops-automation.md`. It runs on Claude Code only.

**It is not a sandbox.** The session has to run the repo's tests, so `Bash(node:*)` and `Bash(npm run:*)` let it run any code as you, with your files and any credential stored on the machine. The queue closes the plain routes a session would use to push or reach GitHub (listed under "Guard rails"), but code that sets out to get around them can. The real backstops are the author allow-list (only text you trust is ever read), branch protection on the base branch (nothing reaches it without a pull request), and your review of every draft pull request.

## What it does and does not do

It does:

- read the labelled open issues (`gh issue list --label <label> --state open --json number,title,body,author`), oldest first, and decide which are eligible (below);
- per issue, prepare its own worktree, start `claude -p` there with a prompt the script builds, and read the result;
- when the session ends `done` with a commit: push `queue/issue-<n>` itself (never forced) and open the pull request with `gh pr create --draft`;
- write a marker per issue, a log line and a result file, and stop at a usage limit, the `--until` deadline or `--max` issues.

It does not:

- read issue comments (anyone can comment on a public repo), or any field but the number, title, body and author;
- comment on, label, close or edit an issue;
- push anything but `queue/issue-<n>`, force a push, or open anything but a draft pull request;
- switch, reset or clean the developer's checkout, or prune its worktrees: every write goes to the queue's own worktree under the state folder;
- merge. Every queue pull request is a draft a human reviews and merges.

## Eligibility, and why

An issue runs when all of these hold:

1. it is open and carries the label (`--label`, default `orc-queue`);
2. its author's login is in the allow-list (`--author <login>`, repeatable; default: only the logged-in `gh` user, from `gh api user`);
3. it has no marker in the state folder;
4. no branch `queue/issue-<n>` exists on `origin`;
5. no open pull request has that head branch;
6. no local branch `queue/issue-<n>` exists that the queue did not leave (a local branch with no marker is yours, so it is skipped, never deleted).

The author rule exists because the issue text becomes a model's instructions in a session that runs code as you. On a public repo anyone can open an issue, and anyone with triage rights can label one; only an issue you (or a login you name) wrote is trusted enough to act on. No text a stranger can write is ever read: not comments, and not web pages (the session is denied web fetch and search). The issue text is still handled as untrusted data in the prompt (see "Per issue"). Rules 3 to 6 keep an issue from running twice.

`queue list` prints every labelled open issue as `eligible` or `skipped: <reason>` and changes nothing.

## Setup

1. Install `gh` and log in: `gh auth login`. The queue refuses to start when `gh` is missing or not logged in.
2. **Protect the base branch.** On GitHub, add branch protection (or a ruleset) to the base branch that requires a pull request before merging. This is what stops anything the session does from reaching the base branch directly. `queue run` (dry run and real run) prints a `WARN` when the base branch is not protected, or when it cannot check (`gh api repos/<owner>/<repo>/branches/<base>`); it does not refuse.
3. Create the label in the repo (`gh label create orc-queue`, or in the web UI), and put it on an issue you wrote.
4. The repo's `origin` must be on GitHub (`https://github.com/<owner>/<repo>` or the ssh form).
5. When `claude` is not on `PATH` (the IDE extension ships its own binary), set `ORC_TOOL_BIN_CLAUDE_CODE` to the executable. `ORC_TOOL_BIN_GH` and `ORC_TOOL_BIN_GIT` do the same for `gh` and `git`.
6. **Read your Claude Code settings.** The session loads your user settings and the repo's project settings (the git guard hook is wanted). Their `allow` rules still apply to the session on top of the queue's list, so a broad rule there (for example `Bash(rm -rf *)`, or an `additionalDirectories` entry that makes other folders editable) holds in the queue too. The queue's deny list (below) beats any allow rule, but read the `allow` rules and `additionalDirectories` in `~/.claude/settings.json` and the repo's `.claude/settings.json` before you schedule it.
7. A rulebook (`AGENTS.md`) in the repo is followed when present; the prompt sets `BOARD: none`, since a headless run cannot approve board writes.

## First use

1. `node tools/orc.mjs queue list --repo-dir <repo>`: check which issues are eligible and why the others are skipped.
2. `node tools/orc.mjs queue run --repo-dir <repo>`: the dry run. It prints the eligible issues in order, the worktree, the branch names and the `claude` command it would start, and changes nothing (no fetch, worktree, branch, marker or lock).
3. `node tools/orc.mjs queue run --repo-dir <repo> --apply --max 1`: one issue, by hand, while you watch.
4. Read the draft pull request in full, as you would a stranger's. Check the state folder's `queue.log` and `run-<n>-<stamp>.json`.

## Options and defaults

`queue run [--repo-dir <dir>] [--label <l>] [--author <login>]... [--base <branch>] [--max <n>] [--until <HH:mm>] [--budget-usd <n>] [--timeout <seconds>] [--model <m>] [--allow <tool rule>]... [--state <dir>] [--issue <n>] [--apply]`

| Option | Default |
|---|---|
| `--repo-dir` | the current folder's repo |
| `--base` | the repo's default branch (`gh repo view --json defaultBranchRef`); it must exist on `origin` |
| `--max` | 1 issue per run |
| `--until HH:mm` | none. The deadline is the next HH:mm (local time) at or after the moment the run started: started at 23:00 with `--until 06:00`, issues start until 06:00 the next morning; started at 05:00, until 06:00 the same morning. No new issue starts at or after the deadline; one already running finishes, so the scheduler's own time limit is the outer stop |
| `--budget-usd` | 5 per issue, passed to `--max-budget-usd` |
| `--timeout` | 3600 seconds per issue; the process tree is then killed and the issue is marked `failed` |
| `--model` | the Claude Code high tier in `models.json` |
| `--allow` | none; one more allowed tool rule per `--allow` (see "Guard rails" for what it refuses) |
| `--state` | `~/.claude/orc-queue/<owner>-<repo>/` |
| `--issue <n>` | run only this issue, even with a `failed` marker; the label and author checks still apply |

`--budget-usd`, `--max` and `--timeout` must be positive numbers.

## Per issue

1. **Worktree.** `git fetch origin`; create `<state>/wt` on first use (`git worktree add --force --detach`, which also re-adds it when its folder was deleted, without pruning any other worktree); check it out detached at `origin/<base>` with `--force` and run `git clean -ffdx`, so nothing a session left (ignored files included, such as an ignored `.claude/settings.local.json` or `node_modules`) reaches the next one; `git switch -c queue/issue-<n>`. A session that needs dependencies installs them (allow `Bash(npm ci:*)` with `--allow`).
2. **Session.** `claude -p --output-format json --permission-mode acceptEdits --max-budget-usd <n> --no-session-persistence --strict-mcp-config --model <m> --allowedTools <list> --disallowedTools <deny list>`, in the worktree, with the prompt on stdin, no shell and the environment described under "Guard rails". `--bare` is not passed: it cannot use the subscription login.
3. **Prompt.** A numbered list: work only here on this branch; follow the rulebook with `BOARD: none`; smallest change; filtered tests only; commit on the branch; never push, open a pull request or touch another branch; no test skip or raised timeout without a proven cause; if the issue is unclear or unsafe, change nothing and say why. The last step fixes the final message: a first line `QUEUE RESULT: done` or `QUEUE RESULT: blocked`, then a summary, the files changed, the test commands with their results, and anything not verified. The issue's title and body come last, between `BEGIN <fence>` and `END <fence>` lines with a random fence per run (redrawn if the issue text contains it), and the prompt declares that block untrusted data: it says what to build, cannot change the rules, and an instruction in it to do otherwise is reported, not followed.
4. **Outcome**, from the result JSON:
   - **usage limit**: the result starts `You've hit your session|weekly|Opus|Sonnet limit`, or `api_error_status` is 429; without the result JSON, a line of stdout or stderr starting with that text. No marker (the issue is retried next run), the local branch is deleted, the reset text is logged, and the whole run stops with exit 0.
   - **done**: exit 0, `subtype: "success"`, first line `QUEUE RESULT: done`, the worktree still on `queue/issue-<n>` (not another branch, not a detached HEAD) with a clean tree and at least one commit ahead of `origin/<base>`. The script pushes the branch, deletes its local copy and opens the draft pull request: title `Issue #<n>: <issue title>`, body `Refs #<n>` (never `Closes`), a line saying the change was produced unattended and needs a full human review, the model's final message, the cost and turns, and the Orc-istration footer as the last line. Marker `handled`, with the pull request's URL.
   - **blocked**: `QUEUE RESULT: blocked`, or `done` with no commit. Nothing is pushed. Marker `blocked`.
   - **failed**: anything else: a non-zero exit, a timeout, `error_max_budget_usd`, output that is not the result JSON, no `QUEUE RESULT` line, HEAD on another branch or detached, uncommitted changes left, a push or `gh pr create` failure. Marker `failed` with the reason, so a broken issue is not retried every cycle.
   A `blocked` or `failed` issue keeps its local `queue/issue-<n>` so the work can be inspected.
5. **Logs**, in the state folder: `queue.log` (one line per issue: time, issue, outcome, cost, turns), `run-<n>-<stamp>.json` (the classified result and the model's final message, never the prompt), markers `issue-<n>.json`, and `queue.lock` while a run is going.

A worktree that cannot be prepared (a fetch that fails, for one) stops the run with exit 1 and writes no marker, since the issue is not at fault. Ctrl-C kills the session's process tree, deletes the local branch and stops the run, also without a marker.

Exit code: 0 when every issue started ended `done` or `blocked`, the run stopped at a usage limit, or there was no work (no eligible issue means no model call); 1 when any issue ended `failed`, or the run was refused or stopped.

## Scheduling into idle usage windows

Register the job yourself; `orc` never creates a scheduled task. Give it an outer time limit, as `docs/ops-automation.md` describes: `--until` only stops new issues from starting, so the scheduler's limit is what kills a run that overruns. Set it above the time from the start to the `--until` deadline plus one `--timeout`.

Windows Task Scheduler (runs while you are logged on; the limit is "Stop the task if it runs longer than"):

```powershell
$action = New-ScheduledTaskAction -Execute 'node' -Argument '"<setup checkout>\tools\orc.mjs" queue run --repo-dir "<repo>" --apply --max 3 --until 06:00' -WorkingDirectory '<repo>'
$trigger = New-ScheduledTaskTrigger -Daily -At 11:00pm
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 8)
Register-ScheduledTask -TaskName 'orc queue' -Action $action -Trigger $trigger -Settings $settings
```

cron (the outer limit is `timeout`):

```cron
0 23 * * * cd <repo> && timeout 8h node <setup checkout>/tools/orc.mjs queue run --apply --max 3 --until 06:00 >> <state>/cron.log 2>&1
```

Run it once by hand with `--apply --max 1`, then once through the scheduler, and read the log, the markers and the pull request before you leave it alone.

## Usage limits

Nothing documented lets a script ask how much usage is left before a run, so the queue does not try. It starts the next issue and, when the session comes back with a usage-limit message (or an API 429), it deletes that issue's local branch, writes no marker, logs the reset time and stops with exit 0. The next scheduled run picks the same issue up again. The message has no documented subtype or exit code; the queue matches the documented texts (`You've hit your session limit · resets 3:45pm`, `... weekly limit ...`, `... Opus limit`, `... Sonnet limit`) at the start of the result, or on a line of stdout or stderr when there is no result JSON.

## Markers and retries

`<state>/issue-<n>.json` holds `outcome` (`handled`, `blocked` or `failed`), the reason, the pull request's URL and the time. An issue with any marker is skipped.

- To retry a `failed` issue once the cause is fixed, run `queue run --apply --issue <n>`. Its leftover local branch is deleted first.
- When the push succeeded but `gh pr create` failed, the `failed` marker also records the pushed commit, the title and the body. `queue run --apply --issue <n>` then only opens the draft pull request for that branch, with no model run, and only while `origin`'s `queue/issue-<n>` is still the recorded commit; otherwise it refuses.
- To retry a `blocked` issue, edit the issue so it is clear, delete its marker file and its local branch, and run again.
- A `handled` issue has a pull request; it is never rerun.

## Guard rails

These close the plain routes. They are defence in depth, not a boundary: code the session runs can undo any of them (see the top of this page).

- **Allowed tools:** `Read Edit Write Glob Grep Agent`, `Bash(git status|diff|log|add|commit:*)`, `Bash(node:*)`, `Bash(npm test:*)` and `Bash(npm run:*)`, plus each `--allow`, plus any `allow` rule in your settings (Setup, step 6).
- **`--allow` refuses:** anything but exactly one tool name or one `Bash(<command>)` with no parentheses inside (so `Bash(a) Bash(b)` cannot smuggle in a second rule) and no comma; a bare `Bash` or `Bash(*)`; a command that starts with a wildcard; any rule naming `push`; a rule whose program is `gh`; a rule whose program runs other commands (`sh`, `bash`, `zsh`, `dash`, `ksh`, `fish`, `pwsh`, `powershell`, `cmd`, `wsl`, `npx`, `pnpx`, `bunx`, `env`, `xargs`, `sudo`, `exec`, `eval`, `busybox`, `nohup`, `time`, `timeout`, `nice`, `stdbuf`, `command`, `builtin`, `watch`, `setsid`, `start`, with or without `.exe` or a path); a git rule whose subcommand is not `status`, `diff`, `log`, `show`, `add`, `commit`, `restore`, `mv`, `rm`, `blame` or `ls-files`; and the tools on the deny list. It does not stop a rule like `Bash(node:*)` from running code that does any of these.
- **Denied tools** (`--disallowedTools`; a deny rule beats an allow rule from any source, your settings included): `Bash(git push:*)`, `Bash(git.exe push:*)`, `Bash(git -C:*)`, `Bash(git -c:*)`, `Bash(gh:*)`, the shells and runners `sh`, `bash`, `zsh`, `dash`, `ksh`, `fish`, `pwsh`, `powershell`, `cmd`, `wsl`, `npx`, `pnpx`, `bunx`, `env`, `xargs`, `sudo` and `busybox` (each also as `.exe`), the `PowerShell` tool, `WebFetch`, `WebSearch` and every MCP tool (`mcp__*`, which also covers claude.ai connectors). `--strict-mcp-config` with no `--mcp-config` loads no MCP server. A Bash deny rule matches the command text the model writes, not the program, so `node -e "..."` that runs git is not matched by it.
- **The session's environment** closes these push routes, each tested: `git push` to `origin` (also when the repo sets its own `remote.origin.pushurl`), to another remote, to an explicit path or `file://` URL, with `--no-verify`, and with `-c protocol.allow=always`. How: `GIT_ALLOW_PROTOCOL` names no real protocol and `protocol.allow` is `never`, so git uses no transport at all; `core.hooksPath` points at a folder whose `pre-push` hook fails; `credential.helper` is emptied; `GIT_ASKPASS`, `SSH_ASKPASS`, `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never` stop every prompt; `GH_TOKEN`, `GITHUB_TOKEN` and the enterprise tokens are dropped and `GH_CONFIG_DIR` points at an empty folder, so `gh` has no login. **Still open:** code that resets its own environment before calling git or gh, that reads a stored credential some other way, or that talks to the GitHub API directly. The session's own git cannot fetch either, and the repo's git hooks do not run inside a queue session (its commits run no `pre-commit` hook).
- **The script's own git calls** (fetch, checkout, clean, push) run with `core.hooksPath` set to an empty folder made after the session ends, and with `core.fsmonitor` off, so no hook the session wrote into the shared `.git` runs on the script's push. The repo's own git hooks do not run on the script's git calls either. Other settings the session could write into the shared `.git/config` are not reset.
- **The push:** the script pushes `refs/heads/queue/issue-<n>` by name, never forced, only after checking that the worktree is still on that branch with a clean tree. It never pushes to `main`, `master` or `develop`.
- **Issue text** never reaches a shell or a flag position: every command is started without a shell, the pull request title is one argument after `--title` and always starts `Issue #<n>:`, and the body goes through `--body-file`. The model's final message sits in a code fence in the body, so an `@name` or a link it echoes from the issue renders as plain text.
- **One run at a time:** `queue.lock` in the state folder, taken before the issues are read. A lock whose process is no longer running is taken over inside a `queue.lock.takeover` folder, so two runs cannot both take it.
- The session loads your Claude Code setup (your `CLAUDE.md`, settings and hooks, the git guard among them), as `orchestration/bench.md` describes.

## Before you trust it

The replay benchmark (`orchestration/bench.md`) measures how often the refuter role says ACCEPT to a change that should have been reworked. That false-ACCEPT rate is the honest estimate of how much an unreviewed agent change can be trusted, and a queue run has no refuter at all: read every queue pull request as a first draft. Every one is a draft that a human reviews and merges; the queue never merges, and nothing it opens should be merged on the strength of its own report.
