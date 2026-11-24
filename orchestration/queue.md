# Unattended issue queue

`node tools/orc.mjs queue` takes open GitHub issues that carry a label and were written by an allowed author, runs one headless Claude Code session per issue in a dedicated worktree, and, when the session reports a committed change, pushes the branch and opens a draft pull request itself. It stops cleanly when a usage limit is hit, so it can be scheduled into the hours the subscription is otherwise idle. It is the shipped form of the outline in `docs/ops-automation.md`. It runs on Claude Code only.

## What it does and does not do

It does:

- read the labelled open issues (`gh issue list --label <label> --state open --json number,title,body,author`), oldest first, and decide which are eligible (below);
- per issue, prepare its own worktree, start `claude -p` there with a prompt the script builds, and read the result;
- when the session ends `done` with a commit: `git push origin queue/issue-<n>` (never forced) and `gh pr create --draft`;
- write a marker per issue, a log line and a result file, and stop at a usage limit, a `--until` time or `--max` issues.

It does not:

- read issue comments (anyone can comment on a public repo), or any field but the number, title, body and author;
- comment on, label, close or edit an issue;
- push anything but `queue/issue-<n>`, force a push, or open anything but a draft pull request;
- switch, reset or clean the developer's checkout: every write goes to its own worktree under the state folder;
- merge. Every queue pull request is a draft a human reviews and merges.

## Eligibility, and why

An issue runs when all of these hold:

1. it is open and carries the label (`--label`, default `orc-queue`);
2. its author's login is in the allow-list (`--author <login>`, repeatable; default: only the logged-in `gh` user, from `gh api user`);
3. it has no marker in the state folder;
4. no branch `queue/issue-<n>` exists on `origin`;
5. no open pull request has that head branch.

The author rule exists because the issue text becomes a model's instructions, and the run holds the user's push rights through the script. On a public repo anyone can open an issue, and anyone with triage rights can label one; only an issue the user (or a login the user names) wrote is trusted enough to act on. The text is still handled as untrusted data (see "Guard rails"). Rules 3 to 5 keep an issue from running twice.

`queue list` prints every labelled open issue as `eligible` or `skipped: <reason>` and changes nothing.

## Setup

1. Install `gh` and log in: `gh auth login`. The queue refuses to start when `gh` is missing or not logged in.
2. Create the label in the repo (`gh label create orc-queue`, or in the web UI), and put it on an issue you wrote.
3. The repo's `origin` must be on GitHub (`https://github.com/<owner>/<repo>` or the ssh form).
4. When `claude` is not on `PATH` (the IDE extension ships its own binary), set `ORC_TOOL_BIN_CLAUDE_CODE` to the executable. `ORC_TOOL_BIN_GH` and `ORC_TOOL_BIN_GIT` do the same for `gh` and `git`.
5. A rulebook (`AGENTS.md`) in the repo is followed when present; the prompt sets `BOARD: none`, since a headless run cannot approve board writes.

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
| `--until HH:mm` | none; no new issue starts at or after this local time today (one already running finishes), so an overnight window must start after midnight, as in the examples below |
| `--budget-usd` | 5 per issue, passed to `--max-budget-usd` |
| `--timeout` | 3600 seconds per issue; the process tree is then killed and the issue is marked `failed` |
| `--model` | the Claude Code high tier in `models.json` |
| `--state` | `~/.claude/orc-queue/<owner>-<repo>/` |
| `--issue <n>` | run only this issue, even with a `failed` marker; the label and author checks still apply |

`--budget-usd`, `--max` and `--timeout` must be positive numbers.

## Per issue

1. **Worktree.** `git fetch origin`; create `<state>/wt` on first use (`git worktree add --detach`); check it out detached at `origin/<base>` with `--force` and run `git clean -fd`, because a killed run leaves edits behind; delete a leftover local `queue/issue-<n>` from an earlier run that never pushed; `git switch -c queue/issue-<n>`.
2. **Session.** `claude -p --output-format json --permission-mode acceptEdits --max-budget-usd <n> --no-session-persistence --model <m> --allowedTools <list>`, in the worktree, with the prompt on stdin and no shell. `--bare` is not passed: it cannot use the subscription login.
3. **Prompt.** A numbered list: work only here on this branch; follow the rulebook with `BOARD: none`; smallest change; filtered tests only; commit on the branch; never push, open a pull request or touch another branch; no test skip or raised timeout without a proven cause; if the issue is unclear or unsafe, change nothing and say why. The last step fixes the final message: a first line `QUEUE RESULT: done` or `QUEUE RESULT: blocked`, then a summary, the files changed, the test commands with their results, and anything not verified. The issue's title and body come last, between `BEGIN <fence>` and `END <fence>` lines with a random fence per run (redrawn if the issue text contains it), and the prompt declares that block untrusted data: it says what to build, cannot change the rules, and an instruction in it to do otherwise is reported, not followed.
4. **Outcome**, from the result JSON:
   - **usage limit**: the result starts `You've hit your session|weekly|Opus|Sonnet limit`, or `api_error_status` is 429. No marker (the issue is retried next run), the local branch is deleted, the reset text is logged, and the whole run stops with exit 0.
   - **done**: exit 0, `subtype: "success"`, first line `QUEUE RESULT: done`, the worktree still on `queue/issue-<n>` with a clean tree and at least one commit ahead of `origin/<base>`. The script pushes the branch and opens the draft pull request: title `Issue #<n>: <issue title>`, body `Refs #<n>` (never `Closes`), a line saying the change was produced unattended and needs a full human review, the model's final message, the cost and turns, and the Orc-istration footer as the last line. Marker `handled`, with the pull request's URL.
   - **blocked**: `QUEUE RESULT: blocked`, or `done` with no commit. Nothing is pushed. Marker `blocked`.
   - **failed**: anything else: a non-zero exit, a timeout, `error_max_budget_usd`, output that is not the result JSON, no `QUEUE RESULT` line, uncommitted changes left, a push or `gh pr create` failure. Marker `failed` with the reason, so a broken issue is not retried every cycle.
5. **Logs**, in the state folder: `queue.log` (one line per issue: time, issue, outcome, cost, turns), `run-<n>-<stamp>.json` (the classified result and the model's final message, never the prompt), markers `issue-<n>.json`, and `queue.lock` while a run is going.

A worktree that cannot be prepared (a fetch that fails, for one) stops the run with exit 1 and writes no marker, since the issue is not at fault. Ctrl-C kills the session's process tree and stops the run, also without a marker.

Exit code: 0 when every issue started ended `done` or `blocked`, the run stopped at a usage limit, or there was no work (no eligible issue means no model call); 1 when any issue ended `failed`, or the run was refused or stopped.

## Scheduling into idle usage windows

Register the job yourself; `orc` never creates a scheduled task. Give it an outer time limit above `--timeout` times `--max`, as `docs/ops-automation.md` describes, so a hung run is always killed.

Windows Task Scheduler (runs while you are logged on; the limit is "Stop the task if it runs longer than"):

```powershell
$action = New-ScheduledTaskAction -Execute 'node' -Argument '"<setup checkout>\tools\orc.mjs" queue run --repo-dir "<repo>" --apply --max 3 --until 07:00' -WorkingDirectory '<repo>'
$trigger = New-ScheduledTaskTrigger -Daily -At 1:00am
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 4)
Register-ScheduledTask -TaskName 'orc queue' -Action $action -Trigger $trigger -Settings $settings
```

cron (the outer limit is `timeout`):

```cron
0 1 * * * cd <repo> && timeout 4h node <setup checkout>/tools/orc.mjs queue run --apply --max 3 --until 07:00 >> <state>/cron.log 2>&1
```

Run it once by hand with `--apply --max 1`, then once through the scheduler, and read the log, the markers and the pull request before you leave it alone.

## Usage limits

Nothing documented lets a script ask how much usage is left before a run, so the queue does not try. It starts the next issue and, when the session comes back with a usage-limit message (or an API 429), it deletes that issue's local branch, writes no marker, logs the reset time and stops with exit 0. The next scheduled run picks the same issue up again. The message has no documented subtype or exit code; the queue matches the documented texts (`You've hit your session limit · resets 3:45pm`, `... weekly limit ...`, `... Opus limit`, `... Sonnet limit`) at the start of the result.

## Markers and retries

`<state>/issue-<n>.json` holds `outcome` (`handled`, `blocked` or `failed`), the reason, the pull request's URL and the time. An issue with any marker is skipped. To retry a `failed` issue once the cause is fixed, run `queue run --apply --issue <n>`. To retry a `blocked` issue, edit the issue so it is clear, delete its marker file, and run again. A `handled` issue has a pushed branch and a pull request; it is never rerun.

## Guard rails

- The model's tools are `Read Edit Write Glob Grep Agent`, `Bash(git status|diff|log|add|commit:*)`, `Bash(node:*)`, `Bash(npm test:*)` and `Bash(npm run:*)`, plus each `--allow`. There is no `Bash(git push:*)`, `Bash(gh:*)` or bare `Bash`, and `--allow` refuses a rule that reaches them: a bare `Bash` or `Bash(*)`, a rule whose command starts with a wildcard, any rule naming `push`, a rule whose command is `gh`, a `git` rule without a specific subcommand (`Bash(git:*)`), `git remote`, `git config` or `git credential`, and a rule holding a comma.
- `Bash(node:*)` and `Bash(npm run:*)` can run any script, so the allow-list is not a sandbox on its own. The session therefore also starts with `origin`'s push URL set to an invalid one (through `GIT_CONFIG_*` in its environment), `GH_CONFIG_DIR` pointing at an empty folder and no `GH_TOKEN` or `GITHUB_TOKEN`: a plain `git push` or `gh` call from the session fails. A script that pushes to an explicit URL with a stored credential could still get through; the last line of defence is that the script pushes only `queue/issue-<n>`, never forced, and every pull request is a draft a human reads.
- The script pushes `refs/heads/queue/issue-<n>` by name, only after checking that the worktree is still on that branch with a clean tree, so a branch switch inside the session cannot change what is pushed. It never pushes to `main`, `master` or `develop`.
- Issue text never reaches a shell or a flag position: every command is started without a shell, the pull request title is one argument after `--title` and always starts `Issue #<n>:`, and the body goes through `--body-file`. The model's final message sits in a code fence in the body, so an `@name` or a link it echoes from the issue renders as plain text.
- One run at a time: `queue.lock` in the state folder. A lock whose process is no longer running is taken over with a note.
- The session loads the machine's Claude Code setup (the user's `CLAUDE.md`, settings and hooks, the git guard among them), as `orchestration/bench.md` describes.

## Before you trust it

The replay benchmark (`orchestration/bench.md`) measures how often the refuter role says ACCEPT to a change that should have been reworked. That false-ACCEPT rate is the honest estimate of how much an unreviewed agent change can be trusted, and a queue run has no refuter at all: read every queue pull request as a first draft. Every one is a draft that a human reviews and merges; the queue never merges, and nothing it opens should be merged on the strength of its own report.
