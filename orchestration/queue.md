# Unattended issue queue

`node tools/orc.mjs queue` takes open GitHub issues that carry a label and were written by an allowed author, runs one headless Claude Code session per issue in a dedicated worktree, and, when the session reports a committed change, pushes the branch and opens a draft pull request itself. It stops cleanly when a usage limit is hit, so it can be scheduled into the hours the subscription is otherwise idle. It is the shipped form of the outline in `docs/ops-automation.md`. It runs on Claude Code only.

**It is not a sandbox.** The session has to run the repo's tests, so `Bash(node:*)` and `Bash(npm run:*)` let it run any code as you, with your files and any credential stored on the machine. The queue closes the plain routes a session would use to push or reach GitHub (listed under "Guard rails"), but code that sets out to get around them can. The real backstops are the author allow-list (only text you trust is ever read), branch protection on the base branch that requires a pull request and that admins cannot bypass (Setup, step 2), and your review of every draft pull request.

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
- switch, reset or clean the developer's working tree or branches, or prune any worktree. Its writes are the queue's own worktree under the state folder, plus three things in the shared repo: `git fetch origin` (which updates the `origin/*` refs), the `queue/issue-<n>` branch refs, and the registration of `<state>/wt` as a worktree;
- merge. Every queue pull request is a draft a human reviews and merges.

## Eligibility, and why

An issue runs when all of these hold:

1. it is open and carries the label (`--label`, default `orc-queue`);
2. its author's login is in the allow-list (`--author <login>`, repeatable; default: only the logged-in `gh` user, from `gh api user`);
3. it has no marker in the state folder;
4. no branch `queue/issue-<n>` exists on `origin`;
5. no open pull request has that head branch;
6. no local branch `queue/issue-<n>` exists that the queue did not leave (a local branch with no marker is yours, so it is skipped, never deleted; the exception is a branch the queue left a `leftover-<n>.json` note for, because it could not delete it itself).

The author rule exists because the issue text becomes a model's instructions in a session that runs code as you. On a public repo anyone can open an issue, and anyone with triage rights can label one; only an issue you (or a login you name) wrote is trusted enough to act on. No text a stranger can write is ever read: not comments, and not web pages (the session is denied web fetch and search). The issue text is still handled as untrusted data in the prompt (see "Per issue"). Rules 3 to 6 keep an issue from running twice.

`queue list` prints every labelled open issue as `eligible` or `skipped: <reason>` and changes nothing.

## Setup

1. Install `gh` and log in: `gh auth login`. The queue refuses to start when `gh` is missing or not logged in.
2. **Protect the base branch.** On GitHub, add a branch protection rule to the base branch that requires a pull request before merging, and tick "Do not allow bypassing the above settings" (enforce for admins): without it the rule does not bind the repo owner, and the session runs as you. A ruleset with no bypass actors does the same. This is what stops anything the session does from reaching the base branch directly. `queue run` (dry run and real run) prints a `WARN` when the base branch is not protected, when admins can bypass its protection (`enforce_admins` off), or when either cannot be checked (`gh api repos/<owner>/<repo>/branches/<base>` and `.../protection`); it does not refuse. The check reads classic branch protection only (the `protected` flag and admin enforcement): it does not check that a pull request is required, and it does not read rulesets, so a base protected only by a ruleset may be reported as not protected. Check both by hand in the repo's settings.
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
| `--until HH:mm` | none. The deadline is the next HH:mm (local time) at or after the moment the run started: started at 23:00 with `--until 06:00`, issues start until 06:00 the next morning; started at 05:00, until 06:00 the same morning. A run that starts less than an hour after HH:mm (a late scheduled start, 06:00:30 with `--until 06:00`) treats the time as passed and starts nothing, rather than running until the next day. No new issue starts at or after the deadline; one already running finishes, so the scheduler's own time limit is the outer stop |
| `--budget-usd` | 5 per issue, passed to `--max-budget-usd` |
| `--timeout` | 3600 seconds per issue; the process tree is then killed and the issue is marked `failed` |
| `--model` | the Claude Code high tier in `models.json`, with `models.local.json` over it as `dispatch` reads them; `--effort` is passed from the same tier when it sets one |
| `--allow` | none; one more allowed tool rule per `--allow` (see "Guard rails" for what it refuses) |
| `--state` | `~/.orc/queue/<owner>/<repo>/` (outside `~/.claude`, and owner and repo as separate folders so no two repos share one) |
| `--issue <n>` | run only this issue, even with a `failed` marker; the label and author checks still apply |

`--budget-usd`, `--max` and `--timeout` must be positive numbers. There is no `--dry-run`: `queue run` without `--apply` is the dry run, and `--dry-run` is refused.

## Per issue

1. **Worktree.** `git fetch origin`; create `<state>/wt` on first use (`git worktree add --force --detach`, which also re-adds it when its folder was deleted, without pruning any other worktree), and remove and re-add it when it is broken or belongs to another clone (its common git folder is not this repo's); check it out detached at `origin/<base>` with `--force` and run `git clean -ffdx`, so nothing a session left (ignored files included, such as an ignored `.claude/settings.local.json` or `node_modules`) reaches the next one; `git switch -c queue/issue-<n>`. A session that needs dependencies installs them (allow `Bash(npm ci:*)` with `--allow`).
2. **Session.** `claude -p --output-format json --permission-mode acceptEdits --max-budget-usd <n> --no-session-persistence --strict-mcp-config --model <m> [--effort <e>] --allowedTools <list> --disallowedTools <deny list>`, in the worktree, with the prompt on stdin, no shell and the environment described under "Guard rails". `--bare` is not passed: it cannot use the subscription login.
3. **Prompt.** A numbered list: work only here on this branch; follow the rulebook with `BOARD: none`; smallest change; filtered tests only; commit on the branch; never push, open a pull request or touch another branch; no test skip or raised timeout without a proven cause; if the issue is unclear or unsafe, change nothing and say why. The last step fixes the final message: a first line `QUEUE RESULT: done` or `QUEUE RESULT: blocked`, then a summary, the files changed, the test commands with their results, and anything not verified. The issue's title and body come last, between `BEGIN <fence>` and `END <fence>` lines with a random fence per run (redrawn if the issue text contains it), and the prompt declares that block untrusted data: it says what to build, cannot change the rules, and an instruction in it to do otherwise is reported, not followed.
4. **Outcome**, from the result JSON:
   - **usage limit**: an error result (`is_error` true, a subtype other than `success`, or a non-zero exit) whose text starts `You've hit your session|weekly|Opus|Sonnet limit`, or `api_error_status` 429; without the result JSON, a line of stdout or stderr starting with that text. A successful final message that happens to start with that text is not a limit. No marker (the issue is retried next run), the local branch is deleted, the reset text is logged, and the whole run stops with exit 0.
   - **done**: exit 0, `subtype: "success"`, first line `QUEUE RESULT: done`, the worktree still on `queue/issue-<n>` (not another branch, not a detached HEAD) with a clean tree and at least one commit ahead of `origin/<base>`. The script pushes the branch, writes a provisional `failed` marker that records the push (so a crash before the pull request opens still leaves a marker `--issue <n>` can use), deletes its local copy and opens the draft pull request: title `Issue #<n>: <issue title>`, body `Refs #<n>` (never `Closes`), a line saying the change was produced unattended and needs a full human review, the model's final message, the cost and turns, and the Orc-istration footer as the last line. Marker `handled`, with the pull request's URL.
   - **blocked**: `QUEUE RESULT: blocked`, or `done` with no commit. Nothing is pushed. Marker `blocked`.
   - **failed**: anything else: a non-zero exit, a timeout, `error_max_budget_usd`, output that is not the result JSON, no `QUEUE RESULT` line, HEAD on another branch or detached, uncommitted changes left, a git command in these checks that fails, a session that changed the repository's git configuration (see "Guard rails"), a push or `gh pr create` failure. Marker `failed` with the reason, so a broken issue is not retried every cycle. The last 500 characters of the session's stderr, with paths redacted, go into the run record.
   - **aborted**: the run, not the issue, cannot go on: `claude` cannot start, the result reports API error 401, 403 or 5xx, the session exits non-zero with no result JSON and its output names an authentication failure, or `<state>/wt` cannot be prepared (a fetch that fails, for one). No marker, the local branch is deleted, the run stops with exit 1 and the reason is logged.
   A `blocked` or `failed` issue keeps its local `queue/issue-<n>` so the work can be inspected, with `<state>/wt` detached from it so you can delete it. The exception is a branch that was pushed: its local copy is deleted after the push, whatever happens to the pull request. A failed push keeps it, since `--issue <n>` pushes that commit again.
5. **Logs**, in the state folder: `queue.log` (one line per issue: time, issue, outcome, cost, turns), `run-<n>-<stamp>.json` (the classified result and the model's final message, never the prompt), markers `issue-<n>.json`, `queue.lock` while a run is going, and `leftover-<n>.json` when the queue could not delete its own local branch (it says so on stderr, names the branch, and deletes the branch the next time it runs that issue).

The script's own git and gh calls time out (300 seconds; fetch, `ls-remote` and push 600 seconds), and a timeout is a failure with "timed out after Ns" as its reason, so a hung call cannot outlive the lock. A PR body carries at most 50,000 characters of the agent's report; a longer one is cut with a line saying so, and the full text stays in the run record.

An aborted run and a stop write no marker on purpose: the issue is not at fault, so it is run again next time. Ctrl-C kills the session's process tree, deletes the local branch and stops the run with exit 1.

Exit code: 0 when every issue started ended `done` or `blocked`, the run stopped at a usage limit, or there was no work (no eligible issue means no model call); 1 when any issue ended `failed`, or the run was refused, aborted or stopped.

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

- To retry a `failed` issue once the cause is fixed, run `queue run --apply --issue <n>`. Its leftover local branch is deleted first, and the model runs again.
- When the push succeeded but `gh pr create` failed (or the run died between the two), the `failed` marker also records the base, the pushed commit and the agent's report with its cost and turns. `queue run --apply --issue <n>` then only opens the draft pull request for that branch, with no model run, and only while `origin`'s `queue/issue-<n>` is still the recorded commit and `--base` is the recorded base.
- When the push failed, the marker records the commit and the local branch keeps it. `queue run --apply --issue <n>` pushes that exact commit again and opens the pull request, with no model run, while the local branch still points at it.
- In both cases the issue is refused, with a reason that says to delete the marker file to run it again from scratch, when the recorded commit is gone: the pushed branch was deleted from or moved on `origin`, or the local branch is missing or moved. The title is always rebuilt from the issue and the body from the recorded report, so `Refs #<n>`, the unattended note and the footer are the script's, whatever the marker file says.
- To retry a `blocked` issue, edit the issue so it is clear, delete its marker file and its local branch (`git branch -D queue/issue-<n>`; the queue's worktree is detached from it), and run again.
- A `handled` issue has a pull request; it is never rerun.

## Guard rails

These close the plain routes. They are defence in depth, not a boundary: code the session runs can undo any of them (see the top of this page).

- **Allowed tools:** `Read Edit Write Glob Grep Agent`, `Bash(git status|diff|log|add|commit:*)`, `Bash(node:*)`, `Bash(npm test:*)` and `Bash(npm run:*)`, plus each `--allow`, plus any `allow` rule in your settings (Setup, step 6).
- **`--allow` refuses:** anything but exactly one tool name or one `Bash(<command>)` with no parentheses inside (so `Bash(a) Bash(b)` cannot smuggle in a second rule) and no comma; a `Bash(...)` holding a shell operator, substitution, redirection or newline (`;`, `&`, `|`, `<`, `>`, a backtick, `$`), so `Bash(npm test && gh auth token)` is refused; one holding a quote character; one that starts with an environment assignment (`FOO=1 npm test`); `npm exec`, `npm x`, `pnpm dlx`, `pnpm exec`, `yarn dlx` and `bun x`, which run any package's binary; a bare `Bash` or `Bash(*)`; a command that starts with a wildcard; any rule naming `push`; a rule whose program is `gh`; a rule whose program runs other commands (`sh`, `bash`, `zsh`, `dash`, `ksh`, `fish`, `pwsh`, `powershell`, `cmd`, `wsl`, `npx`, `pnpx`, `bunx`, `env`, `xargs`, `sudo`, `exec`, `eval`, `busybox`, `nohup`, `time`, `timeout`, `nice`, `stdbuf`, `command`, `builtin`, `watch`, `setsid`, `start`, with or without `.exe` or a path); a git rule whose subcommand is not `status`, `diff`, `log`, `show`, `add`, `commit`, `restore`, `mv`, `rm`, `blame` or `ls-files` (a `git-<x>` program counts as `git <x>`, so `git-send-pack` is refused); and the tools on the deny list. It does not stop a rule like `Bash(node:*)` from running code that does any of these.
- **Denied tools** (`--disallowedTools`; a deny rule beats an allow rule from any source, your settings included): `Bash(git push:*)`, `Bash(git.exe push:*)`, `Bash(git -C:*)`, `Bash(git -c:*)`, `Bash(gh:*)`, the shells and runners `sh`, `bash`, `zsh`, `dash`, `ksh`, `fish`, `pwsh`, `powershell`, `cmd`, `wsl`, `npx`, `pnpx`, `bunx`, `env`, `xargs`, `sudo` and `busybox` (each also as `.exe`), the `PowerShell` tool, `WebFetch`, `WebSearch` and every MCP tool (`mcp__*`, which also covers claude.ai connectors). `--strict-mcp-config` with no `--mcp-config` loads no MCP server. A Bash deny rule matches the command text the model writes, not the program, so `node -e "..."` that runs git is not matched by it.
- **The session's environment** closes these push routes, each tested: `git push` to `origin` (also when the repo sets its own `remote.origin.pushurl`), to another remote, to an explicit path or `file://` URL, with `--no-verify`, and with `-c protocol.allow=always`. How: `GIT_ALLOW_PROTOCOL` names no real protocol and `protocol.allow` is `never`, so git uses no transport at all; `core.hooksPath` points at a folder whose `pre-push` hook fails; `credential.helper` is emptied; `GIT_ASKPASS`, `SSH_ASKPASS`, `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never` stop every prompt; `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN` and `GITHUB_ENTERPRISE_TOKEN` are set to a placeholder (`orc-queue-no-token`) and `GH_CONFIG_DIR` points at an empty folder, so `gh` started from the session, by `node` or an `npm run` script included, uses the placeholder instead of the login in your keyring (tested with the real `gh auth token`). **Still open:** code that resets its own environment before calling git or gh (an unset token variable lets gh fall back to your keyring), that reads a stored credential some other way, or that talks to the GitHub API directly. The session's own git cannot fetch either, and the repo's git hooks do not run inside a queue session (its commits run no `pre-commit` hook).
- **The script's own git calls** (fetch, checkout, clean, push) run with `core.hooksPath` set to an empty folder made after the session ends, and with `core.fsmonitor` off, so no hook the session wrote into the shared `.git` runs on the script's push. The repo's own git hooks do not run on the script's git calls either. The push goes to `origin`'s URL as the script read it before the session, not to the remote name, with `--no-follow-tags` and `push.followTags=false`, so a `remote.origin.pushurl`, another `remote.origin.*` setting or `push.followTags` the session wrote into the shared `.git/config` cannot redirect it or add tags.
- **The repository's git configuration** is snapshotted before each session and compared after it, before the script runs any git command: the shared repo's `.git/config` and `.git/info/attributes`, and the queue worktree's own `config.worktree`. When any changed, the snapshot is restored, the issue ends `failed` with the reason "the session changed the repository's git configuration", and nothing is pushed (tested with a planted `credential.helper`, a `filter.x.clean` driver with an attributes line, a `pushurl` and `push.followTags`). This closes the route where a setting the session writes there (a credential helper, `core.sshCommand`, `url.<base>.insteadOf` or `pushInsteadOf`, `http.*`, a filter or diff driver) runs in, or redirects, the script's own push with your real credential. **Still open:** your global and system git config (`~/.gitconfig`, `$XDG_CONFIG_HOME/git/config`) and any file it includes, which the session can also write and which is not snapshotted; a committed `.gitattributes` in the branch that names a driver your own config defines; and the script's `git fetch origin`, which uses the remote by name and so reads `remote.origin.*` from the restored config, not a URL fixed before the first session; and a process the session leaves running, which can rewrite `.git/config` after the snapshot is restored and before the script pushes (on Windows, a `claude` left behind by a scheduler stop, see "Known limits", can likewise keep writing into `<state>/wt` while the next run uses it).
- **The push:** the script pushes `refs/heads/queue/issue-<n>` by name, never forced: after a session, only after checking that the worktree is still on that branch with a clean tree; on an `--issue <n>` retry of a failed push, only while the local branch still points at the commit the marker recorded. It never pushes to `main`, `master` or `develop`.
- **Issue text** never reaches a shell or a flag position: every command is started without a shell, the pull request title is one argument after `--title` and always starts `Issue #<n>:`, and the body goes through `--body-file`. The model's final message sits in a code fence in the body, so an `@name` or a link it echoes from the issue renders as plain text.
- **One run at a time:** `queue.lock` in the state folder, taken before the issues are read. It records the pid, the start and an expiry (`--max` times `--timeout`, plus an hour). A lock is stale when its process is not running or it has expired, so a reused pid cannot block every run. To take a stale lock over, a run first creates `queue.lock.takeover-<id>`, a file named after that lock's exact content, which only one run can create, checks the lock is unchanged, and replaces it; so two runs cannot both take the same stale lock. If a run crashes in the middle of a takeover, that file stays and further runs refuse with a message naming it: delete it and the lock by hand. The lock fails closed, never open.
- The session loads your Claude Code setup (your `CLAUDE.md`, settings and hooks, the git guard among them), as `orchestration/bench.md` describes.

## Known limits

- **Windows Task Scheduler stop.** When the scheduler's time limit stops the task, it may end `node` without ending the `claude` child, so a session can keep running in `<state>/wt` after the run has gone. The queue does not handle this. To check, look for a leftover `claude` process (Task Manager, or `Get-Process claude` in PowerShell) after a stopped run, and end it. The next run takes the stale lock over and cleans the worktree (`checkout --force`, `git clean -ffdx`) before it starts an issue.

## Before you trust it

The replay benchmark (`orchestration/bench.md`) measures how often the refuter role says ACCEPT to a change that should have been reworked. That false-ACCEPT rate is the honest estimate of how much an unreviewed agent change can be trusted, and a queue run has no refuter at all: read every queue pull request as a first draft. Every one is a draft that a human reviews and merges; the queue never merges, and nothing it opens should be merged on the strength of its own report.
