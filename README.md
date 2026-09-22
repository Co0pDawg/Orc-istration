# worklog

Logs which ticket each Claude Code session works on, with start and end times, so the day can be entered into the Cosairus portal (15-minute grid).

## How it works

- `log-event.ps1` runs as a Claude Code hook on **UserPromptSubmit** (`-Kind prompt`) and **Stop** (`-Kind stop`). Each run appends one CSV line to `~/.claude/worklog/<yyyy-MM-dd>.csv`: `time,event,ticket,session,cwd,prompt-snippet`.
- Ticket resolution order: `PET-NNNNN` or `#NNNNN` (five digits) in the prompt → git branch name of the session cwd (`feature/17403-...` → `PET-17403`) → last ticket seen for this session → `UNKNOWN`.
- `worklog.ps1 [date] [-GapMinutes 30]` rolls the day into portal-shaped blocks: contiguous same-ticket events form one block; a new prompt more than `GapMinutes` after the last event starts a new block; each block rounds up to 0.25 h (minimum 0.25).

```
pwsh C:\Development\worklog\worklog.ps1            # today
pwsh C:\Development\worklog\worklog.ps1 2026-09-22
```

Set `WORKLOG_DIR` to redirect the log folder (used for testing).

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
]
```

`Stop` already has peon-ping entries; append this object to that array rather than replacing it.

## Known ceilings

- ponytail: a session whose cwd is not a git repo and whose prompt has no ticket id logs `UNKNOWN`; fix by naming the ticket in the first prompt.
- ponytail: no portal push. Copy the rolled-up lines into the portal by hand; automate only if that gets tedious.
