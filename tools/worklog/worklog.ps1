# Rolls a day's raw hook events into portal-ready time entries, printed and written to <logDir>/<date>.txt.
# Usage: worklog.ps1 [yyyy-MM-dd] [-GapMinutes 30] [-MaxHours 1]   (default: today)
# Rules: events are re-ticketed from evidence, maps and parent roll-up; each session's events at most $GapMinutes apart form a segment
# (prompt-less ones dropped); each quarter-hour slot of the clock grid goes to the ticket with the most weight in it; consecutive
# same-ticket slots form an entry of at most $MaxHours. One `claude -p --model sonnet` call (haiku fallback) writes the descriptions;
# WORKLOG_NOSUMMARY=1, a failure, a timeout or a reply line whose echoed start time is not its entry's falls back to the raw facts, marked (raw).
param(
    [string]$Date = (Get-Date).ToString("yyyy-MM-dd"),
    [int]$GapMinutes = 30,
    [double]$MaxHours = 1,
    # Writes the re-ticketed events (no prompt text) as JSON for sync-timeline.ps1 and exits before slots, entries and the .txt.
    [string]$ExportJson
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
    # Logs from before PR capture did not mark a prompt naming a PR.
    $raw = $p[2]
    if ($ev -eq "prompt" -and -not $raw.EndsWith('*') -and $p[5] -match '\b(?:pr|pull request)\s*#?(\d{4})\b') { $raw = "PR-$($Matches[1])*" }
    [pscustomobject]@{ Time = [datetime]"$Date $($p[0])"; Event = $ev; Raw = $raw; Ticket = $raw.TrimEnd('*'); Session = $p[3]; Cwd = $p[4]; Text = $p[5]; Seq = $i++ }
} | Sort-Object Time, Seq

# ADO goes through Petsoft's ado.ps1 (pwsh, JSON on stdout, exit 1 on failure); every call is skipped with WORKLOG_NOSUMMARY.
# WORKLOG_DISABLE (inherited) keeps anything it starts from logging itself.
$skipAdo = $env:WORKLOG_NOSUMMARY -eq "1"
$adoScript = if ($env:WORKLOG_ADO) { $env:WORKLOG_ADO } else { "C:\Development\Petsoft\.claude\scripts\ado.ps1" }
function Ado {
    $old = $env:WORKLOG_DISABLE; $env:WORKLOG_DISABLE = "1"
    $out = pwsh -NoProfile -File $adoScript @args 2>$null | Out-String
    $code = $LASTEXITCODE; $env:WORKLOG_DISABLE = $old
    if ($code) { throw "ado.ps1 $args exited $code" }
    $out | ConvertFrom-Json
}
# Ticket type, title, created date and parent (cached): TYPE column, summary theme, which of a PR's work items counts, parent roll-up.
# System.Parent comes back only with -Relations.
$info = @{}
function Info($t) {
    if (-not $info.ContainsKey($t)) {
        $info[$t] = $null
        try {
            $f = (Ado wi-get -Id $t.Substring(4) -Relations).fields
            # pwsh parses the ISO UTC date into a DateTime, Windows PowerShell leaves the string: [datetime] then local either way.
            $info[$t] = [pscustomobject]@{ Type = $f.'System.WorkItemType'; Title = $f.'System.Title'; Created = ([datetime]$f.'System.CreatedDate').ToLocalTime().ToString("yyyy-MM-dd"); Parent = $f.'System.Parent' }
        }
        catch { Write-Warning "ADO lookup failed for $t (type and title left blank): $_" }
    }
    $info[$t]
}
# A PR counts as its linked Task, else Bug, else User Story, else any linked item.
$prs = @{}
function PrTicket($n) {
    if (-not $prs.ContainsKey($n)) {
        $prs[$n] = $null
        try {
            $ids = @((Ado pr-get -Pr $n -IncludeWorkItems).workItemIds | ForEach-Object { "PET-$_" })
            $pick = foreach ($type in "Task", "Bug", "User Story") { $ids | Where-Object { (Info $_).Type -eq $type } }
            $prs[$n] = @(@($pick) + $ids | Where-Object { $_ })[0]
        } catch { Write-Warning "PR $n lookup failed (its evidence is left unresolved): $_" }
    }
    $prs[$n]
}

# Attribution from evidence, per session: explicit (*) events, including the session's own `git commit` events. Each event takes
# the latest evidence at or before it (the first before any); no evidence keeps the captured branch ticket.
# Legacy fallback for logs from before commit capture: #NNNNN commits in the HEAD reflog of a checkout that only this session used
# that day, over its first..last event. A same-second commit counts from the start of that second (Seq -1).
$top = @{}
foreach ($c in $events.Cwd | Sort-Object -Unique) { $top[$c] = "$(git -C $c rev-parse --show-toplevel 2>$null)" }
$shared = @{}
$events | Where-Object { $top[$_.Cwd] } | Group-Object { $top[$_.Cwd] } | ForEach-Object { $shared[$_.Name] = @($_.Group.Session | Sort-Object -Unique).Count -gt 1 }
foreach ($s in $events | Group-Object Session) {
    $evs = $s.Group
    $evidence = @(foreach ($e in $evs | Where-Object { $_.Raw.EndsWith('*') }) {
        $t = $e.Ticket
        if ($t -match '^PR-(\d+)$') { $t = if ($skipAdo) { $null } else { PrTicket $Matches[1] } }
        if ($t) { [pscustomobject]@{ Time = $e.Time; Seq = $e.Seq; Ticket = $t } }
    })
    $since = $evs[0].Time.ToString("s"); $until = $evs[-1].Time.ToString("s")
    $evidence += foreach ($root in $evs.Cwd | ForEach-Object { $top[$_] } | Where-Object { $_ -and -not $shared[$_] } | Sort-Object -Unique) {
        # The HEAD reflog, not history: history also holds commits merged in later from other branches and sessions.
        git -C $root log -g --since=$since --until=$until --date=format-local:%H:%M:%S --format="%gd %gs" 2>$null |
            Where-Object { $_ -match '^\S+@\{(\S+)\} commit(?: \(amend\))?: .*#(\d{5})\b' } | ForEach-Object { [pscustomobject]@{ Time = [datetime]"$Date $($Matches[1])"; Seq = -1; Ticket = "PET-$($Matches[2])" } }
    }
    $evidence = @($evidence | Sort-Object Time, Seq)
    $branch = ($evs | Where-Object { -not $_.Raw.EndsWith('*') -and $_.Ticket -ne "UNKNOWN" } | Select-Object -Last 1).Ticket
    foreach ($e in $evs) {
        $t = ($evidence | Where-Object { $_.Time -lt $e.Time -or ($_.Time -eq $e.Time -and $_.Seq -le $e.Seq) } | Select-Object -Last 1).Ticket
        if (-not $t -and $evidence) { $t = $evidence[0].Ticket }
        if (-not $t) { $t = $branch }
        $e.Ticket = if ($t) { $t } else { "UNKNOWN" }
    }
}

# Overrides, applied last: sessions.map (every date), then <date>.map; "<session-id-prefix> <NNNNN|->", where - drops the session.
foreach ($mapFile in (Join-Path $logDir "sessions.map"), (Join-Path $logDir "$Date.map")) {
    if (-not (Test-Path $mapFile)) { continue }
    foreach ($m in Get-Content $mapFile) {
        if ($m -notmatch '^\s*(\S+)\s+(\d{5}|-)\s*$') { continue }
        $prefix = $Matches[1]; $to = $Matches[2]
        if ($to -eq "-") { $events = @($events | Where-Object { -not $_.Session.StartsWith($prefix) }) }
        else { $events | Where-Object { $_.Session.StartsWith($prefix) } | ForEach-Object { $_.Ticket = "PET-$to" } }
    }
}

# A ticket filed today under a parent bills to the parent, hop by hop while the parent was also filed today (max 3 hops).
if (-not $skipAdo) {
    $up = @{}
    foreach ($t in $events.Ticket | Where-Object { $_ -match '^PET-\d{5}$' } | Sort-Object -Unique) {
        $p = $t
        foreach ($hop in 1..3) { $i = Info $p; if ($i.Created -eq $Date -and $i.Parent) { $p = "PET-$($i.Parent)" } else { break } }
        $up[$t] = $p
    }
    $events | Where-Object { $up[$_.Ticket] } | ForEach-Object { $_.Ticket = $up[$_.Ticket] }
}

if ($ExportJson) {
    $sessions = [ordered]@{}
    foreach ($s in $events | Group-Object Session) {
        $sessions[$s.Name] = [ordered]@{ cwd = $s.Group[-1].Cwd; review = [bool]($s.Group | Where-Object { $_.Event -eq "prompt" -and $_.Text -match '^\s*/peer-review' }) }
    }
    $out = [ordered]@{ date = $Date; sessions = $sessions; events = @($events | ForEach-Object {
        [ordered]@{ time = $_.Time.ToString("HH:mm:ss"); kind = $_.Event; session = $_.Session; ticket = $(if ($_.Ticket -in "UNKNOWN", "-", "") { $null } else { $_.Ticket }) }
    }) }
    ConvertTo-Json -InputObject $out -Depth 5 | Set-Content $ExportJson -Encoding UTF8
    exit 0
}

# Session segments: events at most $GapMinutes apart. A segment without a prompt (agent notifications while away) is not time worked.
# Built with += : @() would flatten a lone segment into its events. The trailing $null closes the last segment.
$segments = @()
foreach ($s in $events | Group-Object Session) {
    $g = @()
    foreach ($e in @($s.Group) + $null) {
        if ($g -and (-not $e -or ($e.Time - $g[-1].Time).TotalMinutes -gt $GapMinutes)) {
            if ($g | Where-Object Event -eq "prompt") { $segments += , $g }
            $g = @()
        }
        if ($e) { $g += $e }
    }
}

# 15-minute slots on the clock grid. A segment covers its slots (1 point to the ticket its session holds there) and each event adds
# its own weight; each slot goes to the heaviest ticket, a tie to the previous slot's ticket if tied, else the lowest ticket string.
$slot = { param($t) [int][math]::Floor($t.TimeOfDay.TotalMinutes / 15) }
$weight = @{ prompt = 3; ado = 2; az = 2; commit = 2; agent = 2 }
$w = @{}
foreach ($g in $segments) {
    $j = 0
    for ($s = & $slot $g[0].Time; $s -le (& $slot $g[-1].Time); $s++) {
        if (-not $w[$s]) { $w[$s] = @{} }
        while ($j -lt $g.Count -and (& $slot $g[$j].Time) -eq $s) { $t = $g[$j].Ticket; $w[$s][$t] += [int]$weight[$g[$j].Event]; $j++ }
        $w[$s][$t] += 1
    }
}
$win = @{}
foreach ($s in $w.Keys | Sort-Object) {
    $max = ($w[$s].Values | Measure-Object -Maximum).Maximum
    $tied = @($w[$s].Keys | Where-Object { $w[$s][$_] -eq $max } | Sort-Object)
    $win[$s] = if ($win[$s - 1] -in $tied) { $win[$s - 1] } else { $tied[0] }
}

# Consecutive same-ticket slots form one entry, cut at $MaxHours (the portal caps an entry at 2 h); chunks of one run share a Block.
$day = [datetime]$Date
$blocks = @(); $bi = 0
foreach ($s in $win.Keys | Sort-Object) {
    $st = $day.AddMinutes(15 * $s)
    $b = if ($blocks) { $blocks[-1] }
    $joins = $b -and $b.Ticket -eq $win[$s] -and $b.End -eq $st
    if ($joins -and ($b.End - $b.Start).TotalHours -lt $MaxHours) { $b.End = $st.AddMinutes(15); continue }
    if (-not $joins) { $bi++ }
    $blocks += [pscustomobject]@{ Ticket = $win[$s]; Block = $bi; Start = $st; End = $st.AddMinutes(15); Facts = @() }
}

foreach ($b in $blocks) {
    $own = @($events | Where-Object { $_.Ticket -eq $b.Ticket })
    $since = $b.Start.ToString("s"); $until = $b.End.ToString("s")
    $commits = $own.Cwd | Sort-Object -Unique | ForEach-Object { git -C $_ log --no-merges --author="$(git -C $_ config user.email 2>$null)" --since=$since --until=$until --format=%s 2>$null }
    # Strongest evidence first, labelled so the summary leans on commits and ADO actions over chat prompts.
    $of = { param($evs, $kind, $label) $evs | Where-Object { $_.Event -eq $kind -and $_.Text } | ForEach-Object { "${label}: $($_.Text)" } }
    $facts = { param($evs) @(@($commits | ForEach-Object { "commit: $_" }) + @(& $of $evs az "ado") + @(& $of $evs ado "ado") + @(& $of $evs agent "agent") + @(& $of $evs prompt "asked") | Where-Object { $_ } | Select-Object -Unique) }
    $b.Facts = & $facts @($own | Where-Object { $_.Time -ge $b.Start -and $_.Time -lt $b.End })
    # An entry with nothing of its own (a slot won on coverage) describes the ticket's whole day.
    if (-not $b.Facts) { $b.Facts = & $facts $own }
}

# Ticket type and title from ADO fill the TYPE column and give the summary its theme (skipped with WORKLOG_NOSUMMARY).
if (-not $skipAdo) { $blocks.Ticket | Where-Object { $_ -match '^PET-\d{5}$' } | Sort-Object -Unique | ForEach-Object { $null = Info $_ } }

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
            "  Entry $n (start $($_.Start.ToString('HH:mm')), end $($_.End.ToString('HH:mm'))):`n" + (($f | ForEach-Object { "  - " + (& $strip $_) }) -join "`n")
        }) -join "`n")
    }) -join "`n`n"
    # Task-based billing style (the ABA/UTBMS time-entry discipline): specific verb + concrete object, no vague filler.
    $ask = @"
You write timesheet entries in task-based billing style. The work log to describe is at the end of this message, between <worklog> and </worklog>: $($blocks.Count) numbered entries grouped into blocks.
Reply with exactly $($blocks.Count) lines formatted <n>|<start>|<description>, one per entry, where <start> is that entry's start time copied from the log (HH:mm), and nothing else.

Rules:
- Format: <Category>: <verb> <specific object>; <verb> <specific object>.
- Category is one of: Development, Code review, Testing, Planning, Documentation, DevOps, Support.
- Past tense, plain ASCII, at most 150 characters, understandable on its own.
- Every clause starts with a specific action verb (Implemented, Fixed, Reviewed, Redacted, Wrote, Configured, Filed, Merged).
- Never use: worked on, continued, various, progressed, advanced, phase, ongoing, efforts, tasks, items.
- Entries inside one block are consecutive time slots of the same piece of work: each says what its own slot did, in order, and never repeats another entry.
- Use commit and ado facts first, agent facts next; asked facts are the developer's chat prompts, context only.
- Never mention ticket, work item or PR numbers.

Example reply lines (format only; not part of the log):
1|09:30|Development: Recorded the exception's own message in the log table; handled a null formatted message.
2|10:30|Code review: Reviewed the deposit refund PR; fixed two tenant-scoping findings.

<worklog>
$body
</worklog>
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
        if ($p.HasExited) { $reply = @(Get-Content $tmp[1] -Encoding UTF8) } else { Stop-Process -Id $p.Id -Force }
        $tmp | Remove-Item -ErrorAction SilentlyContinue
        # A line counts only if its echoed start time is its entry's, so a shifted reply can never label the wrong row.
        foreach ($l in $reply) {
            if ($l -match '^\s*(\d+)\|(\d\d:\d\d)\|(.+)$' -and [int]$Matches[1] -ge 1 -and [int]$Matches[1] -le $blocks.Count -and $blocks[[int]$Matches[1] - 1].Start.ToString('HH:mm') -eq $Matches[2] -and -not $desc[[int]$Matches[1]]) { $desc[[int]$Matches[1]] = $Matches[3].Trim() }
        }
        if ($desc.Count -eq $blocks.Count) { break }
        Write-Warning "Summary with $model gave $($desc.Count) of $($blocks.Count) entries with matching start times; trying the next model or raw facts."
    }
}

$lines = @("   START       END  HOURS  TICKET  TYPE        DESCRIPTION")
$total = 0
$n = 0
foreach ($b in $blocks) {
    $n++
    $hours = ($b.End - $b.Start).TotalHours
    $total += $hours
    $d = $desc[$n]
    if (-not $d) {
        $d = $b.Facts -join "; "
        if ($d.Length -gt 144) { $d = $d.Substring(0, 144) }
        $d = "$d (raw)".TrimStart()
    } elseif ($d.Length -gt 150) { $d = $d.Substring(0, $d.LastIndexOf(' ', 149)).TrimEnd(';', ',', ':') }  # whole words only
    $ticket = if ($b.Ticket -eq "UNKNOWN") { "-----" } else { $b.Ticket -replace '^PET-', '' }
    $ci = [Globalization.CultureInfo]::InvariantCulture
    $type = if ($info[$b.Ticket].Type) { $info[$b.Ticket].Type } else { "-" }
    $lines += "{0,8}  {1,8}  {2,5:0.00}  {3,-6}  {4,-10}  {5}" -f $b.Start.ToString("h:mm tt", $ci), $b.End.ToString("h:mm tt", $ci), $hours, $ticket, $type, $d
    # The ADO title under the description, to check the two match.
    if ($info[$b.Ticket].Title) { $lines += (" " * 46) + "ADO: $($info[$b.Ticket].Title)" }
}
$lines += "Total: {0:0.00} hours" -f $total

# Second view: hours per ticket (most first), its ADO title, and the periods worked as secondary detail; touching entries merge.
$lines += "", "HOURS  TICKET  TYPE        TITLE"
foreach ($g in $blocks | Group-Object Ticket | Sort-Object { ($_.Group | ForEach-Object { ($_.End - $_.Start).TotalHours } | Measure-Object -Sum).Sum } -Descending) {
    $t = $g.Name; $i = $info[$t]
    $periods = @()
    foreach ($b in $g.Group) {
        if ($periods -and $periods[-1].End -eq $b.Start) { $periods[-1].End = $b.End }
        else { $periods += [pscustomobject]@{ Start = $b.Start; End = $b.End } }
    }
    $hrs = ($g.Group | ForEach-Object { ($_.End - $_.Start).TotalHours } | Measure-Object -Sum).Sum
    $lines += "{0,5:0.00}  {1,-6}  {2,-10}  {3}" -f $hrs, $(if ($t -eq "UNKNOWN") { "-----" } else { $t -replace '^PET-', '' }), $(if ($i.Type) { $i.Type } else { "-" }), $(if ($i.Title) { $i.Title } else { "-" })
    $lines += "                           " + (($periods | ForEach-Object { "$($_.Start.ToString('h:mm', $ci))-$($_.End.ToString('h:mm tt', $ci))" }) -join ", ")
}
$lines | Set-Content (Join-Path $logDir "$Date.txt")
$lines

# Console only, not the .txt: what each session was attributed to, for writing <date>.map.
""
"Sessions:"
$bare = { param($t) if ($t -eq "UNKNOWN") { "-----" } else { $t -replace '^PET-', '' } }
foreach ($s in $events | Group-Object Session | Sort-Object Name) {
    $first = $s.Group | Where-Object { $_.Event -eq "prompt" -and $_.Text -notmatch '^\s*<' } | Select-Object -First 1
    $text = "$($first.Text)"; if ($text.Length -gt 60) { $text = $text.Substring(0, 60) }
    "{0,-8}  {1}  {2}" -f "$($s.Name)".Substring(0, [math]::Min(8, "$($s.Name)".Length)), (($s.Group.Ticket | Select-Object -Unique | ForEach-Object { & $bare $_ }) -join ","), $text
}
if (-not $skipAdo) {
    try {
        $next = ([datetime]$Date).AddDays(1).ToString("yyyy-MM-dd")
        $touched = @((Ado wiql -Query "SELECT [System.Id] FROM WorkItems WHERE [System.ChangedBy] = @Me AND [System.ChangedDate] >= '$Date' AND [System.ChangedDate] < '$next' AND [System.CreatedDate] < '$Date'") |
            ForEach-Object { "$($_.id)" } | Where-Object { "PET-$_" -notin $blocks.Ticket })
        if ($touched) { "Touched in ADO, no time logged: $($touched -join ', ')" }
    } catch { Write-Warning "ADO changed-by-me query failed: $_" }
}
