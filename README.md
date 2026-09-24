# worklog

Logs which ticket each Claude Code session works on, and what it did, so the day can be pasted into portal.cosairus.com/Work (15-minute grid).

## How it works

- `log-event.ps1` runs as a Claude Code hook and appends one CSV line per event to `~/.claude/worklog/<yyyy-MM-dd>.csv`: `time,event,ticket,session,cwd,text`.
  - `prompt` (UserPromptSubmit, `-Kind prompt`): first 200 chars of the prompt. A prompt starting with `<task-notification>`, `<agent-message>` or `<system-reminder>` is logged as `notify` with no text.
  - `stop` (Stop, `-Kind stop`).
  - `az` / `agent` (PostToolUse, `-Kind tool`): a Bash/PowerShell command that runs `az` (at the start, or after `;` `|` `&` `(` `=` or a newline; not the word inside a sed/grep/commit message) logs its first 120 chars from `az` onward; an Agent dispatch logs `<subagent_type>: <description>`. Every other tool call is ignored.
- Ticket resolution: a five-digit id in the event itself (`PET-NNNNN`/`#NNNNN` in a prompt, or the first five-digit number in a mutating `az` command: `create|update|delete|add|set-vote` or a POST/PATCH/PUT/DELETE `--http-method` in the az command's own segment, or a `-Method`/`-X` POST/PATCH/PUT/DELETE REST call anywhere in it), stored as `PET-NNNNN*` → the session's last such explicit ticket → git branch of the session cwd (`feature/17403-...` → `PET-17403`) → the session's last ticket → `UNKNOWN`.
- `WORKLOG_DISABLE=1` makes the hook exit without logging.
- `worklog.ps1 [date] [-GapMinutes 30] [-MaxHours 1]` rolls the day into blocks: contiguous same-ticket events form one block; a prompt or notification more than `GapMinutes` after the last event starts a new one. A block with no prompt of its own (another session's events interleaving) folds into the block before it, as does a following same-ticket block. Blocks are then cut into entries of at most `MaxHours` (the portal caps an entry at 2 h); start snaps down and end snaps up to the quarter hour (10:34 → 10:30, 11:20 → 11:30), times print as AM/PM, entries never overlap, last 15 minutes to `MaxHours`, and hours are the snapped span. Each entry's own-ticket prompts, `az` commands, agent dispatches and commits (`git log` in its cwds over its time window) go to one `claude -p --model sonnet` call (haiku as fallback) that writes one task-based-billing description per entry (`<Category>: <verb> <object>; ...`), using each ticket's ADO type and title as the theme. The `TYPE` column shows the ADO work item type. If both models fail, time out (120 s each) or return the wrong line count, the raw facts are printed instead, ending in `(raw)`. The result is printed and written to `<logDir>/<date>.txt`:

```
   START       END  HOURS  TICKET  TYPE        DESCRIPTION
12:30 PM   1:30 PM   1.00  12351   Bug         Development: Checked the error logging fix for review readiness; redacted sensitive values from logged messages.
 1:30 PM   2:30 PM   1.00  12351   Bug         Development: Implemented the remaining error logging plans; resolved merge conflicts in the shared tests map.
Total: 2.00 hours
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
    "command": "powershell -NoProfile -NonInteractive -File \"C:\\Development\\worklog\\log-event.ps1\" -Kind prompt" } ] }
],
"Stop": [
  { "matcher": "", "hooks": [ { "type": "command", "async": true, "timeout": 10,
    "command": "powershell -NoProfile -NonInteractive -File \"C:\\Development\\worklog\\log-event.ps1\" -Kind stop" } ] }
],
"PostToolUse": [
  { "matcher": "Bash|PowerShell|Agent", "hooks": [ { "type": "command", "async": true, "timeout": 10,
    "command": "powershell -NoProfile -NonInteractive -File \"C:\\Development\\worklog\\log-event.ps1\" -Kind tool" } ] }
]
```

`Stop` (and possibly `PostToolUse`) already has other entries; append these objects to the existing arrays rather than replacing them.

## Known ceilings

- ponytail: a session whose cwd is not a git repo and whose prompt has no ticket id logs `UNKNOWN`; fix by naming the ticket in the first prompt.
- ponytail: no portal push. Paste the rolled-up lines by hand (edit the `.txt` first if needed).
- ponytail: the mutating-verb regex is a heuristic; a read whose text contains `add`/`update` as a word counts as mutating. Tighten to the subcommand position if it misfires.
- ponytail: commits come from each block's cwd; a worktree the session `cd`s into but never logged as cwd is missed.
