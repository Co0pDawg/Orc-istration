# Portal-ready daily entries

## Goal

At the end of the day, `worklog.ps1` prints lines that paste straight into the time-entry portal: start, end, hours, a bare ticket number (its own portal field), and a one-sentence description of what was actually done.

## Decisions (Cooper, 2026-09-24)

- Output is pasted by hand. No portal push.
- Ticket field is the bare number (`12351`, not `PET-12351`).
- Description is a model-written summary, generated automatically on every roll-up.

## Capture — `log-event.ps1`

CSV stays `time,event,ticket,session,cwd,text` in `~/.claude/worklog/<date>.csv`.

| Event | Hook | `text` column |
|---|---|---|
| `prompt` | UserPromptSubmit | first 200 chars of the prompt (was 60) |
| `notify` | UserPromptSubmit | none. Used when the prompt starts with `<task-notification>`, `<agent-message>` or `<system-reminder>`. Counts as activity for timing, excluded from descriptions |
| `stop` | Stop | none |
| `az` | PostToolUse, matcher `Bash\|PowerShell` | first 120 chars of the command from `az ` onward. Only logged when the command contains `az ` as a word; every other command is ignored |
| `agent` | PostToolUse, matcher `Agent` | `<subagent_type>: <description>` |

`text` has commas and newlines replaced with spaces (as today).

**Ticket resolution for each event:**

1. A five-digit id in the event's own text: `PET-NNNNN` or `#NNNNN` in a prompt, or the first `\b\d{5}\b` in a **mutating** `az` command, meaning the command matches `\b(create|update|delete|add|set-vote)\b` or `--http-method\s+(POST|PATCH|PUT|DELETE)` (case-insensitive). Read-only `az` commands (`show`, `list`, `query`, GET invokes) are still logged for descriptions but resolve their ticket by rules 2-5.
2. The session's last ticket that came from rule 1 (a ticket named in a prompt or touched by `az` sticks for the rest of the session).
3. The branch of the session's cwd.
4. The session's last ticket of any origin.
5. `UNKNOWN`.

Rule 1 events record their origin, so rule 2 can find them: the ticket is written as `PET-NNNNN*` (trailing `*` = explicit). The roll-up strips the `*`.

**Recursion guard:** when `WORKLOG_DISABLE=1` is set, the hook exits immediately. The roll-up sets it for its own `claude -p` call, so summarising does not log events.

## Roll-up — `worklog.ps1 [date] [-GapMinutes 30]`

1. **Blocks:** unchanged. Same-ticket runs form one block; a `prompt` more than `GapMinutes` after the block's last event starts a new one. Hours round up to 0.25, with a minimum of 0.25.
2. **Facts per block:** unique `prompt` texts, `az` texts and `agent` texts, plus the commits in the block's time window, taken from `git -C <cwd> log --since --until --format=%s` for each distinct cwd in the block (deduplicated).
3. **Summary:** one `claude -p --model haiku` call for the whole day. The input is numbered blocks with their facts. The call must return exactly N lines, `<n>|<description>`, each description at most 150 characters, past tense, and not containing the ticket number. The call runs with `WORKLOG_DISABLE=1`.
4. **Fallback:** if the call fails, times out (60 s) or returns the wrong line count, each description is the joined raw facts cut to 150 characters, ending in ` (raw)`.
5. **Output:** printed, and also written to `<logDir>/<date>.txt`:

```
START  END    HOURS  TICKET  DESCRIPTION
12:24  17:05   4.75  12351   Redacted card data from Elavon HPI errors; fixed pre-PR review findings.
Total: 7.25 hours
```

`UNKNOWN` prints as `-----`.

## Install

Add one `PostToolUse` entry with matcher `Bash|PowerShell|Agent` to `~/.claude/settings.json` (async, timeout 10), running `log-event.ps1 -Kind tool`. For a `tool` run, the script picks `az` or `agent` from `tool_name`, or exits without logging. Update the README's Install section to match.

## Test

`test.ps1` (no Pester) with a fixture CSV under `WORKLOG_DIR` and `WORKLOG_NOSUMMARY=1`, which forces the fallback path. It asserts:

- `notify` text never appears in a description.
- A mutating `az` event on 17393 inside a 12351 branch session attributes the following prompts to 17393; a read-only `az ... show --id 17400` does not.
- Fallback descriptions end in `(raw)`.
- The ticket column is bare digits.
- Hours round as today.

A second check pipes sample hook JSON into `log-event.ps1` for each kind and asserts the CSV line.

## Out of scope

Portal push, weekly view, in-place editing (edit the `.txt`).

## Known ceilings

- The mutating-verb regex is a heuristic: a read command whose text happens to contain `add`/`update` as a word (e.g. in a WIQL string) counts as mutating. Tighten to the subcommand position if it misfires.
- Commits come from each block's cwd. A worktree the session `cd`s into but never logged as cwd is missed.

## Amendments after the first trial run (2026-09-24)

- **az detection:** `az` counts only in command position (start, or after an unescaped `;` `|` `&` `(` `=` or newline). The word inside a sed, grep or commit message is ignored.
- **Mutating check:** verbs and `--http-method` are checked on the az command's own segment (up to the next `;` `|` `&` or newline). A REST call anywhere in the command with `-Method`/`-X` POST/PATCH/PUT/DELETE (az token + Invoke-RestMethod/curl) also counts.
- **Fold:** a block with no `prompt` event, starting within `GapMinutes` of the previous block, folds into it; so does a following same-ticket block. Facts only use events whose ticket matches the block's, so a folded-in az from another session stays out of the description.
- **1-hour cap:** `-MaxHours 1` (the portal's limit is 2 h). Blocks split into consecutive chunks; a chunk with no facts of its own uses the whole block's facts.
- **No ids to Haiku:** `PET-`/`#` + 4-5 digit numbers are stripped from facts before the summary call, so descriptions cannot mention ticket or PR ids.
- **Quarter-hour times:** start snaps down and end snaps up to :00/:15/:30/:45; an entry starts no earlier than the previous one ends and lasts 15 minutes to `MaxHours`; hours are the snapped span (replaces "round up to 0.25"). Times print as `h:mm AM/PM`.
- **Summary quality (task-based billing style):** each distinct ticket's `System.WorkItemType` and `System.Title` come from `az boards work-item show` (skipped with `WORKLOG_NOSUMMARY`; a failed lookup warns and leaves them blank). A new `TYPE` column shows the work item type (`Bug`, `Task`, `User Story`, or `-`). The prompt groups entries by block under the ticket's type and title, requires `<Category>: <verb> <object>; <verb> <object>.` with Category from Development, Code review, Testing, Planning, Documentation, DevOps, Support, bans vague words (worked on, continued, various, progressed, advanced, phase, ongoing, efforts, tasks, items), and tells the model that entries in one block are consecutive slots that must not repeat each other. The model is `sonnet` with `haiku` as fallback, each with a 120 s timeout; a wrong line count warns and tries the next, then falls back to raw facts.

## Hybrid attribution (2026-09-29)

Local prompts say *when*; ADO actions, PR links and commits say *which ticket*. Attribution moves from capture time to roll-up time.

**Capture (`log-event.ps1`)**
- `ado.ps1` calls (Petsoft's ADO helper, `.claude/scripts/ado.ps1 <verb>`) are logged as event `ado`, detected in command position like `az`; text = first 120 chars from `ado.ps1` onward.
- Mutating ado verbs: `wi-update wi-link wi-link-branch wi-attach comment-add comment-edit pr-create pr-update pr-link pr-attach` (never with `-WhatIf`). Ticket: `-Id NNNNN` -> `PET-NNNNN*`; `-WorkItems N,...` -> first id; `-Pr NNNN` -> `PR-NNNN*`.
- `az repos pr ... --id NNNN` (mutating) and a prompt naming a PR (`pr 6025`, `PR #6025`, `pull request 6025`) also record `PR-NNNN*`.
- Capture writes only: explicit ticket (`*`) -> branch ticket -> `UNKNOWN`. The session-inheritance rules (last explicit, last of any origin) are removed; the roll-up does that job with evidence.

**Roll-up (`worklog.ps1`)**
1. Per session, an evidence timeline of (time, ticket): `*` events (PR ids resolved via `ado.ps1 pr-get -Pr N -IncludeWorkItems`, preferring a linked Task, then Bug, then User Story, then any), plus own non-merge commits in the session's cwds within its first..last event window whose subject has `#NNNNN`.
2. Every event in the session takes the latest evidence ticket at or before its time; before the first evidence, the session's first evidence ticket (back-fill); a session with no evidence keeps its captured branch ticket (non-`*`), else `UNKNOWN`.
3. `<logDir>/<date>.map` overrides: lines `<session-id-prefix> <NNNNN|->`; `-` drops the session. Applied last.
4. Blocks, fold, split, snapping and summaries run unchanged on the re-ticketed events.
5. After the table (console only, not the `.txt`): a `Sessions:` list (`<8-char id>  <ticket>  <first real prompt, 60 chars>`) for writing the map, and `Touched in ADO, no time logged: ...` from one WIQL (`[System.ChangedBy] = @Me` and `[System.ChangedDate]` within the date) minus tickets already in the table.
6. ADO calls (PR resolution, type/title lookup, WIQL) go through `ado.ps1` at `$env:WORKLOG_ADO` (default `C:\Development\Petsoft\.claude\scripts\ado.ps1`), all skipped with `WORKLOG_NOSUMMARY=1`; a failed call warns and leaves that evidence unresolved.

## Quarter-hour allocation, parent roll-up, global map (2026-10-05)

Replaces block/fold/split/snap in the roll-up. Attribution (evidence re-ticketing, `.map`) runs first, unchanged.

1. **Global map:** `<logDir>/sessions.map` (same format as `<date>.map`) applies to every date, before the date's own map. Seeded with `2abeee8d -` (the worklog conversation itself).
2. **Parent roll-up:** a ticket whose ADO `System.CreatedDate` (local date) is the roll-up date and that has a `System.Parent` is re-ticketed to its parent, repeated while the parent was also created that day (max 3 hops). Applied after the maps; uses the cached `wi-get` lookup (extend `Info` with CreatedDate and Parent). Skipped with `WORKLOG_NOSUMMARY`.
3. **Session segments:** per session, consecutive events with a gap of at most `GapMinutes` form a segment. A segment with no `prompt` event is not time worked (dropped, as the old isolated prompt-less rule).
4. **Slots:** the day is cut into 15-minute slots on the clock grid. Each kept segment covers the slots from floor(first event) to the slot holding its last event, inclusive; per slot it adds weight to the ticket the segment's session held at that time: 1 for coverage, plus 3 per `prompt`, 2 per `ado`/`az`/`commit`/`agent` event in that slot (stop/notify add nothing beyond coverage).
5. **Winner:** each covered slot goes to the highest-weight ticket; a tie keeps the previous slot's ticket if it is among the tied, else the lowest ticket string. Uncovered slots are idle.
6. **Entries:** consecutive slots with the same ticket merge into one entry, split into chunks of at most `MaxHours`. Start/end are slot boundaries (h:mm AM/PM), hours = slots x 0.25. Idle gaps separate entries.
7. **Facts and summaries** come from the events inside each entry's time range whose (final) ticket is the entry's ticket; an entry with none uses the facts of all same-ticket events in the day. Summary prompt, time echo and fallbacks unchanged.
8. **Touched in ADO** excludes work items created on the roll-up date (`[System.CreatedDate] < '<date>'` in the WIQL), so filing tickets no longer floods it.
