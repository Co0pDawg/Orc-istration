# worklog

Logs which ticket each Claude Code session works on, and what it did, so the day can be pasted into portal.cosairus.com/Work (15-minute grid).

## How it works

- `log-event.ps1` runs as a Claude Code hook and appends one CSV line per event to `~/.claude/worklog/<yyyy-MM-dd>.csv`: `time,event,ticket,session,cwd,text`.
  - `prompt` (UserPromptSubmit, `-Kind prompt`): first 200 chars of the prompt. A prompt starting with `<task-notification>`, `<agent-message>` or `<system-reminder>` is logged as `notify` with no text.
  - `stop` (Stop, `-Kind stop`).
  - `az` / `agent` (PostToolUse, `-Kind tool`): a Bash/PowerShell command containing `az` logs its first 120 chars from `az` onward; an Agent dispatch logs `<subagent_type>: <description>`. Every other tool call is ignored.
- Ticket resolution: a five-digit id in the event itself (`PET-NNNNN`/`#NNNNN` in a prompt, or the first five-digit number in a mutating `az` command: `create|update|delete|add|set-vote` or a POST/PATCH/PUT/DELETE `--http-method`), stored as `PET-NNNNN*` → the session's last such explicit ticket → git branch of the session cwd (`feature/17403-...` → `PET-17403`) → the session's last ticket → `UNKNOWN`.
- `WORKLOG_DISABLE=1` makes the hook exit without logging.
- `worklog.ps1 [date] [-GapMinutes 30]` rolls the day into blocks: contiguous same-ticket events form one block; a prompt or notification more than `GapMinutes` after the last event starts a new one; each block rounds up to 0.25 h (minimum 0.25). Each block's prompts, `az` commands, agent dispatches and commits (`git log` in its cwds over its time window) go to one `claude -p --model haiku` call that writes a one-sentence description per block. If that fails, times out (60 s) or returns the wrong line count, the raw facts are printed instead, ending in `(raw)`. The result is printed and written to `<logDir>/<date>.txt`:

```
START  END    HOURS  TICKET  DESCRIPTION
12:24  17:05   4.75  12351   Redacted card data from Elavon HPI errors; fixed pre-PR review findings.
Total: 7.25 hours
```

```
pwsh C:\Development\worklog\worklog.ps1            # today
pwsh C:\Development\worklog\worklog.ps1 2026-09-22
```

Set `WORKLOG_DIR` to redirect the log folder and `WORKLOG_NOSUMMARY=1` to skip the model call (both used by `test.ps1`). Run `pwsh -NoProfile -File test.ps1` (or `powershell`) to self-check.

## Install

Add to `hooks` in `~/.claude/settings.json`:

```json
"UserPromptSubmit": [
  { "matcher": "", "hooks": [ { "type": "command", "async": true, "timeout": 10,
    "command": "powershell -NoProfile -NonInteractive -File \"C:\Development\worklog\log-event.ps1\" -Kind prompt" } ] }
],
"Stop": [
  { "matcher": "", "hooks": [ { "type": "command", "async": true, "timeout": 10,
    "command": "powershell -NoProfile -NonInteractive -File \"C:\Development\worklog\log-event.ps1\" -Kind stop" } ] }
],
"PostToolUse": [
  { "matcher": "Bash|PowerShell|Agent", "hooks": [ { "type": "command", "async": true, "timeout": 10,
    "command": "powershell -NoProfile -NonInteractive -File \"C:\Development\worklog\log-event.ps1\" -Kind tool" } ] }
]
```

`Stop` (and possibly `PostToolUse`) already has other entries; append these objects to the existing arrays rather than replacing them.

## Known ceilings

- ponytail: a session whose cwd is not a git repo and whose prompt has no ticket id logs `UNKNOWN`; fix by naming the ticket in the first prompt.
- ponytail: no portal push. Paste the rolled-up lines by hand (edit the `.txt` first if needed).
- ponytail: the mutating-verb regex is a heuristic; a read whose text contains `add`/`update` as a word counts as mutating. Tighten to the subcommand position if it misfires.
- ponytail: commits come from each block's cwd; a worktree the session `cd`s into but never logged as cwd is missed.
