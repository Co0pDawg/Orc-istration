# Unattended Claude ops jobs: outline

Generic pattern for jobs that run with nobody watching. Two jobs on this machine are the worked examples: a **build watcher** (every 6 hours; when the main integration pipeline has failed, it runs `claude -p` in a dedicated worktree to fix it and open a draft PR) and a **worktree cleanup** (daily; plain script, no model). The scripts are not copied here.

## 1. Trigger: Task Scheduler

Settings of the two example tasks, read from `schtasks /query /fo LIST /v`:

| | Build watcher | Worktree cleanup |
|---|---|---|
| Schedule | one-time start, repeat every 6 h | daily at 7:00 AM |
| Action | `pwsh -NoProfile -File <script>` | `pwsh.exe -NoProfile -NonInteractive -File "<script>"` |
| Run as | the user, "Interactive only" | the user, "Interactive only" |
| Stop if runs longer than | 3 h | 30 min |
| Battery | no start on batteries | stop on battery, no start on batteries |

"Interactive only" means the job runs only while the user is logged on (no stored credentials). Always set an execution time limit as the outer kill switch.

## 2. Wrapper script

One PowerShell 7 script per job (`#Requires -Version 7`). Skeleton:

```powershell
$ErrorActionPreference = 'Stop'
$env:GIT_TERMINAL_PROMPT = '0'          # fail fast, never wait on a prompt
$state = Join-Path $HOME '.claude\<job>'; New-Item -ItemType Directory -Force $state | Out-Null
Start-Transcript -Path (Join-Path $state 'job.log') -Append | Out-Null
# 1. cheap check: is there work? return early if not (no model call)
# 2. idempotency check
# 3. prepare isolated worktree
# 4. run claude -p
# 5. write the handled marker
```

Do the cheap deterministic check in script (a CLI query of the pipeline or PR list) and call the model only when there is work. The build watcher also sets an environment switch that keeps unattended runs out of time tracking.

## 3. The `claude -p` call

Shape used by the build watcher:

```powershell
claude -p $prompt --permission-mode acceptEdits --max-budget-usd <cap> --no-session-persistence `
  --model <model> --allowedTools 'Bash(git:*)' 'Bash(<cli>:*)' Read Edit Write Glob Grep
```

- `acceptEdits` plus an explicit `--allowedTools` list: anything outside the list cannot run, and nobody is there to answer a prompt. Do not use a bypass-permissions mode.
- `--max-budget-usd` caps spend per run; `--no-session-persistence` keeps unattended runs out of the session list.
- The prompt is a numbered list: check for existing work first (stop and report if a PR already covers it), smallest fix, verify with filtered tests only, branch name, draft PR, final message format. State the forbidden things in the prompt as well.
- Run it in a background thread job (`Start-ThreadJob`) so the wrapper can enforce its own timeout.

## 4. Idempotency markers

Write the id of the thing handled (pipeline run id, PR id) to a `last-handled-*.txt` in the state folder and skip when it matches. Provide a `-Force` switch to re-handle by hand. Write the marker even after a timeout, or a hung item is retried every cycle. Also skip when the pipeline is still running or already green.

## 5. Logging and rotation

- Transcript for the wrapper (`Start-Transcript -Append`), so even a crash before `claude` starts leaves a trace.
- One log per handled item (`run-<id>.log`) for the model output via `Tee-Object`.
- Daily jobs: one dated file per day (`yyyy-MM-dd.log`); rotation is by file name.
- Neither example prunes old logs. Add a step that deletes files older than N days and renames the append-only transcript when it passes a size.

## 6. Guard rails

- Branches: the job pushes only to a new branch with a fixed prefix (`fix/<thing>-<id>`); the prompt and allow-list forbid touching `main` or the integration branch directly.
- Draft PRs only; a human reviews and merges.
- No timeout bumps, test skips or ignores without a proven cause; an infrastructure cause means change nothing and report.
- Cleanup rules: remove a worktree only when its HEAD is merged into the remote integration branch, the tree is clean and nothing is unpushed; never touch the main checkout, remote branches or databases (report extras only).
- Verify with filtered tests only; never run a suite that waits on a running app.

## 7. Worktree isolation

Give the job its own worktree outside the main checkout. Each run: fetch, check the worktree out detached at the remote branch with `--force`, then `git clean -fd`, because a killed run leaves uncommitted edits that leak into the next. Create the worktree on first use. The developer's main checkout is never touched.

## 8. Failure reporting

- Hung model: after the wrapper timeout, kill the child process tree (`taskkill /T /F`), stop the job, still write the marker.
- Fail loud on missing prerequisites (`throw` when the CLI returns nothing, for example when not logged in).
- The prompt's last step asks for cause, files changed, PR url and anything not verified; that lands in the per-item log.
- Gap in both examples: nothing sends a notification. Add one (mail, chat webhook, or a "last result" file read at session start) if a failure must not wait for someone to open the log.

## 9. Checklist for a new job

1. One-sentence goal and the cheap "is there work?" check; no work means exit without a model call.
2. State folder `~/.claude/<job>/`, transcript, per-item log.
3. Marker file and `-Force`.
4. Dedicated worktree; forced detached checkout and clean each run.
5. Prompt with numbered steps, existing-work check and explicit prohibitions.
6. `--permission-mode acceptEdits`, explicit `--allowedTools`, budget cap, model, no session persistence.
7. Thread job plus wrapper timeout; Task Scheduler time limit set above it.
8. Branch prefix, draft-only, never the protected branches.
9. Register the task (`schtasks /create` or the UI), run the script once by hand, then once via `schtasks /run`.
10. After the first scheduled run, check the log, the marker and the branch.
11. Document the job in the repo docs; keep org URLs (`<org>/<project>`) in parameters, and credentials in the CLI login, never in the script or prompt.
