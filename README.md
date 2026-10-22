# worklog

Logs which ticket each Claude Code session works on, and what it did, so the day can be pasted into portal.cosairus.com/Work (15-minute grid).

## How it works

- `log-event.ps1` runs as a Claude Code hook and appends one CSV line per event to `~/.claude/worklog/<yyyy-MM-dd>.csv`: `time,event,ticket,session,cwd,text`.
  - `prompt` (UserPromptSubmit, `-Kind prompt`): first 200 chars of the prompt. A prompt starting with `<task-notification>`, `<agent-message>` or `<system-reminder>` is logged as `notify` with no text.
  - `stop` (Stop, `-Kind stop`).
  - `az` / `agent` (PostToolUse, `-Kind tool`): a Bash/PowerShell command that runs `az` (at the start, or after `;` `|` `&` `(` `=` or a newline; not the word inside a sed/grep/commit message) logs its first 120 chars from `az` onward; an Agent dispatch logs `<subagent_type>: <description>`. Every other tool call is ignored.
  - `ado` (PostToolUse, `-Kind tool`): a Petsoft `ado.ps1 <verb>` call, detected in command position like `az` (also after `&` or `pwsh -File`), logs its first 120 chars from `ado.ps1` onward.
  - `commit` (PostToolUse, `-Kind tool`): a `git commit` in command position (also `git -C <dir> commit`) logs its first 120 chars from `git` onward; a `#NNNNN` anywhere in the command (`-m`, `-F` heredoc) makes it explicit.
- Capture ticket: an explicit id in the event itself, stored with a trailing `*`, → git branch of the session cwd (`feature/17403-...` → `PET-17403`) → `UNKNOWN`. Explicit ids: `PET-NNNNN`/`#NNNNN` in a prompt, else a PR named in it (`pr 6025`, `PR #6025`, `pull request 6025` → `PR-6025*`); the first five-digit number in a mutating `az` command (`create|update|delete|add|set-vote` or a POST/PATCH/PUT/DELETE `--http-method` in the az command's own segment, or a `-Method`/`-X` POST/PATCH/PUT/DELETE REST call anywhere in it), else `--id NNNN` on a mutating `az repos pr` → `PR-NNNN*`; a mutating `ado.ps1` verb (`wi-update wi-link wi-link-branch wi-attach comment-add comment-edit pr-create pr-update pr-link pr-attach`, never with `-WhatIf`): `-Id`, else the first `-WorkItems` id, else `-Pr` → `PR-NNNN*`. Capture does not carry a ticket across a session's events; the roll-up does that from evidence.
- `WORKLOG_DISABLE=1` makes the hook exit without logging.
- `worklog.ps1 [date] [-GapMinutes 30] [-MaxHours 1]` first re-tickets every event from evidence, per session: its `*` events (a PR counts as its linked Task, else Bug, else User Story, else any linked item, via `ado.ps1 pr-get -IncludeWorkItems`), including its own `commit` events. For logs from before commit capture, a checkout only this session used that day also contributes its HEAD reflog `commit:` entries over the session's first..last event whose subject names `#NNNNN`; a checkout shared by several sessions contributes none. Each event takes the latest evidence at or before it, or the session's first evidence before any; a session with no evidence keeps its captured branch ticket, else `UNKNOWN`. Prompts in logs from before PR capture are re-read for a PR name. `<logDir>/sessions.map` (every date) and then `<logDir>/<date>.map` override last, one `<session-id-prefix> <NNNNN|->` per line (`-` drops the session). A ticket created that day (ADO `System.CreatedDate`, local date) that has a `System.Parent` bills to its parent, hop by hop while the parent was also created that day (at most 3 hops). Each session's events at most `GapMinutes` apart form a segment; a segment without a prompt (notifications while away, another session's az) is not time worked. The day is cut into 15-minute slots on the clock grid: a segment covers its slots (1 point to the ticket its session holds there), and each event adds 3 (prompt) or 2 (`ado`/`az`/`commit`/`agent`) to its ticket in its slot. Each slot goes to the heaviest ticket; a tie keeps the previous slot's ticket if it is tied, else the lowest ticket string. Consecutive same-ticket slots form one entry, cut into chunks of at most `MaxHours` (the portal caps an entry at 2 h); times print as AM/PM and hours are slots x 0.25. Each entry's own-ticket prompts, `az`/`ado` commands, agent dispatches and commits (`git log` in the ticket's cwds over the entry's window), or the ticket's whole day when the entry has none of its own, go to one `claude -p --model sonnet` call (haiku as fallback) that writes one task-based-billing description per entry (`<Category>: <verb> <object>; ...`), using each ticket's ADO type and title as the theme. The log goes inside `<worklog>` tags and each reply line must echo its entry's start time (`<n>|<HH:mm>|<description>`); a line whose time does not match its entry is rejected, so a shifted reply never labels the wrong row. The `TYPE` column shows the ADO work item type. Entries neither model described with a matching time (failure, 120 s timeout each) print their raw facts instead, ending in `(raw)`. Under the entries, a second view lists hours per ticket (most first) with the ticket's ADO type and title, and the periods worked (touching entries merged) on the line below. Both views are printed and written to `<logDir>/<date>.txt`:

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

After the table (console only, not the `.txt`) come `Sessions:` (`<8-char id>  <tickets>  <first prompt>`, for writing the `.map`) and `Touched in ADO, no time logged: ...` (work items you changed that day but did not create that day, from one WIQL, minus the table's tickets).

ADO calls (PR resolution, type/title/created/parent via `wi-get -Relations`, WIQL) run `pwsh -NoProfile -File` on `$env:WORKLOG_ADO` (default `C:\Development\Petsoft\.claude\scripts\ado.ps1`) with `WORKLOG_DISABLE=1`; a failed call warns and leaves that evidence unresolved. Set `WORKLOG_DIR` to redirect the log folder and `WORKLOG_NOSUMMARY=1` to skip the model call and every ADO call (both used by `test.ps1`, which also runs the ADO path against `test\fake-ado.ps1`). Run `pwsh -NoProfile -File test.ps1` (or `powershell`) to self-check.

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

## Timeline sync

`sync-timeline.ps1` feeds the Orchestration Board's Time page. For each day it runs `worklog.ps1 <date> -ExportJson <file>` with `WORKLOG_DISABLE=1` and `WORKLOG_NOSUMMARY` cleared, so the export keeps the worklog's full attribution: evidence rules, PR resolution, `sessions.map`, `<date>.map` and the parent roll-up. `-ExportJson` exits before the model call and the `.txt`. The sync then builds the `timeline/<date>` doc and writes it to `~/.claude/timeline-sync/pending/timeline-<date>.json`, overwriting that date's pending file. It never calls a model and never uploads; see [Uploading](#uploading).

```
{date, synced, tz, events:[{at, kind, session, ticket}], sessions:{id:{project, review}}, notes:{ticket:text}, titles:{ticket:title}, blocks:[{start, end, ticket, text}], flags:{ticket:{unplanned:true}}}
```

- `at` is ISO with the local offset at that instant, so backfills across DST are right; `ticket` is `null` for `UNKNOWN`.
- `project` is the leaf folder of the session's cwd; `review` is true when a prompt in the session starts with `/peer-review`.
- `notes` has one entry per ticket in the day's events, from the first source that has one: (1) the first model-written description in `<date>.txt` (`(raw)` rows are prompt text and are skipped); (2) that day's `#NNNNN <subject>` commit subjects (`git log --all` in each distinct repo root of the day's session cwds), up to two joined with `; `, cut at 200 characters on a word boundary; (3) `<Work item type>: <title>` from ADO. A ticket with none of these gets no note. Prompt text is never a source.
- `titles` maps each ticket in the day's events to its ADO title, when the type lookup that sets `flags` returned one (no extra ADO call). The board's Scrum summary labels its Yesterday lines with it.
- `blocks` is every model-written row of `<date>.txt` (`(raw)` rows and the indented `ADO:` lines skipped), in start order: `start`/`end` ISO with the local offset (an end of 12:00 AM after a PM start is next midnight), `ticket` as `PET-NNNNN`, `text` the row's description. The Time page gives each entry the blocks it overlaps. A day with no `.txt` has `blocks: []`.
- `flags.<ticket>.unplanned` is set for Support Items (ADO type and title cached in `types.json` as `{type, title}`; an old string entry is read as the type and refreshed for its title on next use).
- Prompt text never leaves the machine.

```powershell
pwsh -NoProfile -File sync-timeline.ps1                      # today, then yesterday (the scheduled tick)
pwsh -NoProfile -File sync-timeline.ps1 -Date 2026-10-19     # one day
pwsh -NoProfile -File sync-timeline.ps1 -From 2026-09-22     # every CSV from that day to today (backfill)
pwsh -NoProfile -File sync-timeline.ps1 -Date 2026-10-19 -DryRun C:\temp\tl   # writes timeline-<date>.json there, no pending file
```

- A date whose inputs (CSV, `sessions.map`, `<date>.map`, `<date>.txt`) hash the same as at its last build prints `unchanged, skipped` and costs nothing; `-Force` rebuilds it.
- A failed or timed-out (60 s) ADO type lookup writes no marker, so the next tick rebuilds the day and retries the flag.
- Timing: an export with ADO takes about 95 s for a busy day, plus up to 60 s per uncached type lookup. A tick builds today, and builds yesterday only while yesterday's marker is missing or stale. So a tick costs at most two builds, usually one: 164 s on a quiet machine, 8.5 minutes seen under load, inside the 30-minute task limit (`IgnoreNew` stops overlapping ticks).
- State lives in `~/.claude/timeline-sync/` (`<date>.hash`, `types.json`, `sync.log`, `pending/`); `TIMELINE_SYNC_STATE` overrides it.
- `register-timeline-task.ps1` registers the "Worklog timeline sync" task: every 15 minutes, interactive only, stopped after 30 minutes, no start on batteries.

### Uploading

A Claude session uploads each pending file in `~/.claude/timeline-sync/pending/`:

1. ArtifactData `get` with url `https://claude.ai/artifact/GJS9SUHY6eiX4bp32G65z1`, collection `timeline`, doc_id = the file's date.
2. ArtifactData `set` with the same url, collection and doc_id, `file_path` = the pending file, and `if_version` = the version from step 1 when the doc exists.
3. Delete the pending file.

Fable sessions do this at the start of every orchestrated task. Any session does it when Cooper says "sync my timeline".

## Known ceilings

- ponytail: a session with no evidence whose cwd is not a git repo rolls up as `UNKNOWN`; name the ticket in a prompt or add a `.map` line.
- ponytail: a `commit` event is logged whether or not the commit succeeded (a failed pre-commit hook still counts).
- ponytail: in logs from before commit capture, commits in a checkout several sessions shared are not evidence at all; use a `.map` line.
- ponytail: a PR mentioned only as a reference ("is Jackson's pr 6033 already included?") still counts as evidence for its work item.
- ponytail: PR ids in prompts are four digits (`pr 6025`) until PR 10000.
- ponytail: `ado.ps1` calls have no timeout of their own; a hung REST call stalls the roll-up.
- ponytail: no portal push. Paste the rolled-up lines by hand (edit the `.txt` first if needed).
- ponytail: the mutating-verb regex is a heuristic; a read whose text contains `add`/`update` as a word counts as mutating. Tighten to the subcommand position if it misfires.
- ponytail: commits come from the cwds of the entry's ticket; a worktree the session `cd`s into but never logged as cwd is missed.
- ponytail: `project` is the cwd's leaf folder, so a session started in a subfolder shows that subfolder; use the git top level if it misleads.
- ponytail: in the DST fall-back hour (01:00-02:00 on the first Sunday of November) both passes get the standard offset; the CSV has no offset, so they cannot be told apart.
- ponytail: ADO lookups are not cached across ticks; cache worklog's Info results to disk if ticks approach 30 min.
