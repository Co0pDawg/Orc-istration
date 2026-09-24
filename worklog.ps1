# Rolls a day's raw hook events into portal-ready time entries, printed and written to <logDir>/<date>.txt.
# Usage: worklog.ps1 [yyyy-MM-dd] [-GapMinutes 30] [-MaxHours 1]   (default: today)
# Rules: contiguous same-ticket activity = one block; a prompt more than $GapMinutes after the block's last event starts a new one;
# prompt-less blocks fold into the one before; blocks split into entries of at most $MaxHours;
# start snaps down and end up to the quarter-hour grid the Cosairus portal uses (no overlap, 15 minutes to $MaxHours). One `claude -p --model haiku` call writes the descriptions;
# WORKLOG_NOSUMMARY=1, a failure, a 60 s timeout or a wrong line count falls back to the raw facts, marked (raw).
param(
    [string]$Date = (Get-Date).ToString("yyyy-MM-dd"),
    [int]$GapMinutes = 30,
    [double]$MaxHours = 1
)

$logDir = if ($env:WORKLOG_DIR) { $env:WORKLOG_DIR } else { Join-Path $HOME ".claude\worklog" }
$file = Join-Path $logDir "$Date.csv"
if (-not (Test-Path $file)) { Write-Host "No log for $Date"; exit 0 }

$i = 0
$events = Get-Content $file | ForEach-Object {
    $p = $_ -split ',', 6
    $ev = $p[1]
    # Logs from before the notify event recorded agent/task notifications as prompts.
    if ($ev -eq "prompt" -and $p[5] -match '^\s*<(task-notification|agent-message|system-reminder)') { $ev = "notify" }
    [pscustomobject]@{ Time = [datetime]"$Date $($p[0])"; Event = $ev; Ticket = $p[2].TrimEnd('*'); Cwd = $p[4]; Text = $p[5]; Seq = $i++ }
} | Sort-Object Time, Seq

$blocks = @()
$cur = $null
foreach ($e in $events) {
    # notify counts too: old logs gapped on notifications, and an overnight hand-back should not stretch the block over the idle time.
    $gap = $e.Event -in "prompt", "notify" -and $cur -and ($e.Time - $cur.End).TotalMinutes -gt $GapMinutes
    $newBlock = -not $cur -or $e.Ticket -ne $cur.Ticket -or $gap
    if ($newBlock) {
        if ($cur) { $blocks += $cur }
        $cur = [pscustomobject]@{ Ticket = $e.Ticket; Start = $e.Time; End = $e.Time; Events = @(); Facts = @() }
    }
    $cur.End = $e.Time
    $cur.Events += $e
}
if ($cur) { $blocks += $cur }

# Parallel sessions interleave, so a block with no prompt of its own (stops, notifications, another session's az) folds into the
# block before it, as does a same-ticket block that follows; otherwise each flip would round up to its own 0.25 h sliver.
$folded = @()
foreach ($b in $blocks) {
    $prev = if ($folded) { $folded[-1] } else { $null }
    $near = $prev -and ($b.Start - $prev.End).TotalMinutes -le $GapMinutes
    if ($near -and ($b.Ticket -eq $prev.Ticket -or -not ($b.Events | Where-Object Event -eq "prompt"))) { $prev.End = $b.End; $prev.Events += $b.Events }
    else { $folded += $b }
}

# The portal caps an entry at 2 h; cut blocks into consecutive chunks of at most $MaxHours.
$bi = 0
$blocks = @(foreach ($b in $folded) {
    $bi++
    $s = $b.Start
    while ($true) {
        $e = $s.AddHours($MaxHours); $last = $e -ge $b.End
        if ($last) { $e = $b.End }
        $in = @($b.Events | Where-Object { $_.Time -ge $s -and ($_.Time -lt $e -or $last) })
        [pscustomobject]@{ Ticket = $b.Ticket; Block = $bi; Start = $s; End = $e; Events = $in; All = $b.Events; Facts = @() }
        if ($last) { break }
        $s = $e
    }
})

foreach ($b in $blocks) {
    $since = $b.Start.ToString("s"); $until = $b.End.ToString("s")
    $commits = $b.All.Cwd | Sort-Object -Unique | ForEach-Object { git -C $_ log --no-merges --author="$(git -C $_ config user.email)" --since=$since --until=$until --format=%s 2>$null }
    # Strongest evidence first, labelled so the summary leans on commits and ADO actions over chat prompts.
    # Only this ticket's events: a folded-in az from another session belongs to that session's ticket.
    $of = { param($evs, $kind, $label) $evs | Where-Object { $_.Event -eq $kind -and $_.Text -and $_.Ticket -eq $b.Ticket } | ForEach-Object { "${label}: $($_.Text)" } }
    $facts = { param($evs) @(@($commits | ForEach-Object { "commit: $_" }) + @(& $of $evs az "ado") + @(& $of $evs agent "agent") + @(& $of $evs prompt "asked") | Where-Object { $_ } | Select-Object -Unique) }
    $b.Facts = & $facts $b.Events
    # A chunk of a long block with nothing of its own (waiting on agents) describes the block as a whole.
    if (-not $b.Facts) { $b.Facts = & $facts $b.All }
}

# Ticket type and title from ADO fill the TYPE column and give the summary its theme (skipped with WORKLOG_NOSUMMARY).
$info = @{}
if ($env:WORKLOG_NOSUMMARY -ne "1") {
    foreach ($t in ($blocks.Ticket | Where-Object { $_ -match '^PET-\d{5}$' } | Sort-Object -Unique)) {
        try {
            $f = (az boards work-item show --id $t.Substring(4) -o json 2>$null | Out-String | ConvertFrom-Json).fields
            $info[$t] = [pscustomobject]@{ Type = $f.'System.WorkItemType'; Title = $f.'System.Title' }
        } catch { Write-Warning "ADO lookup failed for $t (type and title left blank): $_" }
    }
}

$desc = @{}
if ($env:WORKLOG_NOSUMMARY -ne "1" -and $blocks) {
    $strip = { param($s) $s -replace '(PET-|#)?\b\d{4,5}\b', '' }  # ticket/PR ids stripped so they can't leak into the description
    $n = 0
    $body = ($blocks | Group-Object Block | ForEach-Object {
        $t = $_.Group[0].Ticket; $i = $info[$t]
        $theme = if ($i) { "$($i.Type) `"$(& $strip $i.Title)`"" } else { "untitled ticket" }
        "Block of work on $theme`:`n" + (($_.Group | ForEach-Object {
            $n++
            $f = if ($_.Facts) { $_.Facts } else { "(no prompts: only waited on agent/task notifications)" }
            "  Entry $n ($($_.Start.ToString('HH:mm'))-$($_.End.ToString('HH:mm'))):`n" + (($f | ForEach-Object { "  - " + (& $strip $_) }) -join "`n")
        }) -join "`n")
    }) -join "`n`n"
    # Task-based billing style (the ABA/UTBMS time-entry discipline): specific verb + concrete object, no vague filler.
    $ask = @"
You write timesheet entries in task-based billing style. Reply with exactly $($blocks.Count) lines formatted <n>|<description>, one per numbered entry, and nothing else.

Rules:
- Format: <Category>: <verb> <specific object>; <verb> <specific object>.
- Category is one of: Development, Code review, Testing, Planning, Documentation, DevOps, Support.
- Past tense, plain ASCII, at most 150 characters, understandable on its own.
- Every clause starts with a specific action verb (Implemented, Fixed, Reviewed, Redacted, Wrote, Configured, Filed, Merged).
- Never use: worked on, continued, various, progressed, advanced, phase, ongoing, efforts, tasks, items.
- Entries inside one block are consecutive time slots of the same piece of work: each says what its own slot did, in order, and never repeats another entry.
- Use commit and ado facts first, agent facts next; asked facts are the developer's chat prompts, context only.
- Never mention ticket, work item or PR numbers.

Examples:
1|Development: Recorded the exception's own message in the log table; handled a null formatted message.
2|Code review: Reviewed the deposit refund PR; fixed two tenant-scoping findings.

$body
"@
    # Start-Process, not Start-Job: jobs fail under a system-wide constrained language mode.
    # WORKLOG_DISABLE (inherited by claude and its hooks) stops the summarising session from logging itself.
    foreach ($model in "sonnet", "haiku") {
        $tmp = 1..3 | ForEach-Object { New-TemporaryFile }
        $ask | Set-Content $tmp[0] -Encoding UTF8
        $old = $env:WORKLOG_DISABLE; $env:WORKLOG_DISABLE = "1"
        $p = Start-Process claude "-p --model $model" -NoNewWindow -PassThru -WorkingDirectory $logDir -RedirectStandardInput $tmp[0] -RedirectStandardOutput $tmp[1] -RedirectStandardError $tmp[2]
        $env:WORKLOG_DISABLE = $old
        Wait-Process -Id $p.Id -Timeout 120 -ErrorAction SilentlyContinue
        $reply = @()
        if ($p.HasExited) { $reply = @(Get-Content $tmp[1] -Encoding UTF8 | Where-Object { $_ -match '^\s*\d+\|' }) } else { Stop-Process -Id $p.Id -Force }
        $tmp | Remove-Item -ErrorAction SilentlyContinue
        if ($reply.Count -eq $blocks.Count) { foreach ($l in $reply) { if ($l -match '^\s*(\d+)\|(.+)$') { $desc[[int]$Matches[1]] = $Matches[2].Trim() } }; break }
        Write-Warning "Summary with $model returned $($reply.Count) of $($blocks.Count) lines; trying the next model or raw facts."
    }
}

$lines = @("   START       END  HOURS  TICKET  TYPE        DESCRIPTION")
$total = 0
$n = 0
$prevEnd = [datetime]::MinValue
# Times snap to the portal's quarter-hour grid: start down (10:34 -> 10:30), end up (11:20 -> 11:30). An entry starts no earlier
# than the previous one ends, lasts 15 minutes to $MaxHours, and hours are what the snapped times show.
$snap = { param($t) $t.Date.AddMinutes([math]::Floor($t.TimeOfDay.TotalMinutes / 15) * 15) }
foreach ($b in $blocks) {
    $n++
    $start = & $snap $b.Start
    if ($start -lt $prevEnd) { $start = $prevEnd }
    $end = $b.End.Date.AddMinutes([math]::Ceiling($b.End.TimeOfDay.TotalMinutes / 15) * 15)
    if ($end -lt $start.AddMinutes(15)) { $end = $start.AddMinutes(15) }
    if ($end -gt $start.AddHours($MaxHours)) { $end = $start.AddHours($MaxHours) }
    $prevEnd = $end
    $hours = ($end - $start).TotalHours
    $total += $hours
    $d = $desc[$n]
    if (-not $d) {
        $d = $b.Facts -join "; "
        if ($d.Length -gt 144) { $d = $d.Substring(0, 144) }
        $d = "$d (raw)".TrimStart()
    } elseif ($d.Length -gt 150) { $d = $d.Substring(0, 150) }
    $ticket = if ($b.Ticket -eq "UNKNOWN") { "-----" } else { $b.Ticket -replace '^PET-', '' }
    $ci = [Globalization.CultureInfo]::InvariantCulture
    $type = if ($info[$b.Ticket].Type) { $info[$b.Ticket].Type } else { "-" }
    $lines += "{0,8}  {1,8}  {2,5:0.00}  {3,-6}  {4,-10}  {5}" -f $start.ToString("h:mm tt", $ci), $end.ToString("h:mm tt", $ci), $hours, $ticket, $type, $d
}
$lines += "Total: {0:0.00} hours" -f $total
$lines | Set-Content (Join-Path $logDir "$Date.txt")
$lines
