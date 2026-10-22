#Requires -Version 7
# Builds a day's re-ticketed worklog events into the Orchestration Board's timeline/<date> doc, for its Time page.
# Usage: sync-timeline.ps1 [-Date yyyy-MM-dd] [-From yyyy-MM-dd] [-Force] [-DryRun <dir>]
#   No -Date or -From (the scheduled tick): today, then yesterday; yesterday's marker makes it free once its last events are in.
#   -From: every CSV date from that day to today. -DryRun: writes <dir>\timeline-<date>.json instead of the pending file.
# Each built doc goes to ~/.claude/timeline-sync/pending/timeline-<date>.json; a Claude session uploads it (README "Uploading").
# This script never calls a model. Only at/kind/session/ticket, project, review, notes, ADO titles, roll-up blocks and flags go in the doc; prompt text never does.
# A date whose inputs (CSV, sessions.map, <date>.map, <date>.txt) are unchanged since its last build is skipped (-Force rebuilds it).
# Timing: the export runs the worklog's full attribution with ADO (PR and parent roll-up), about 95 s for a busy day, plus up to
# 60 s per uncached ADO type lookup (8.5 min seen under load). A tick builds at most today and yesterday, inside the task's 30-minute limit.
# State in ~/.claude/timeline-sync (TIMELINE_SYNC_STATE overrides): <date>.hash markers, types.json (ADO type cache), sync.log.
param([string]$Date, [string]$From, [switch]$Force, [string]$DryRun)
$ErrorActionPreference = "Stop"
# Inherited by worklog.ps1 and ado.ps1: nothing started here logs itself. WORKLOG_NOSUMMARY is cleared so the export keeps the
# worklog's ADO attribution; -ExportJson exits before worklog.ps1's model call, so no model runs either way.
$env:WORKLOG_DISABLE = "1"; $env:WORKLOG_NOSUMMARY = $null; $env:GIT_TERMINAL_PROMPT = "0"
$logDir = if ($env:WORKLOG_DIR) { $env:WORKLOG_DIR } else { Join-Path $HOME ".claude\worklog" }
$state = if ($env:TIMELINE_SYNC_STATE) { $env:TIMELINE_SYNC_STATE } else { Join-Path $HOME ".claude\timeline-sync" }
$adoScript = if ($env:WORKLOG_ADO) { $env:WORKLOG_ADO } else { "C:\Development\Petsoft\.claude\scripts\ado.ps1" }
$pending = Join-Path $state "pending"
New-Item -ItemType Directory -Force $pending | Out-Null
function Log($m) { $m; Add-Content (Join-Path $state "sync.log") "$((Get-Date).ToString('s')) $m" }

$today = (Get-Date).ToString("yyyy-MM-dd")
$dates = if ($From) { Get-ChildItem $logDir -Filter "????-??-??.csv" | ForEach-Object BaseName | Where-Object { $_ -ge $From -and $_ -le $today } | Sort-Object }
elseif ($Date) { $Date } else { $today, (Get-Date).AddDays(-1).ToString("yyyy-MM-dd") }

$typesFile = Join-Path $state "types.json"
$types = if (Test-Path $typesFile) { Get-Content $typesFile -Raw | ConvertFrom-Json -AsHashtable } else { @{} }
$ci = [Globalization.CultureInfo]::InvariantCulture
$tz = [TimeZoneInfo]::Local
$iso = { param($t) [datetimeoffset]::new($t, $tz.GetUtcOffset($t)).ToString("yyyy-MM-dd'T'HH:mm:sszzz", $ci) }
# ADO work item {type, title}, or $null when the lookup fails or runs past 60 s (its process tree is killed).
function AdoInfo($id) {
    $tmp = 1..2 | ForEach-Object { New-TemporaryFile }
    try {
        $p = Start-Process pwsh "-NoProfile -File `"$adoScript`" wi-get -Id $id" -NoNewWindow -PassThru -RedirectStandardOutput $tmp[0] -RedirectStandardError $tmp[1]
        $null = $p.Handle  # keeps ExitCode readable after exit
        Wait-Process -Id $p.Id -Timeout 60 -ErrorAction SilentlyContinue
        if (-not $p.HasExited) { taskkill /T /F /PID $p.Id 2>$null | Out-Null; return $null }
        if ($p.ExitCode) { return $null }
        $f = (Get-Content $tmp[0] -Raw | ConvertFrom-Json).fields
        if ($f.'System.WorkItemType') { @{ type = $f.'System.WorkItemType'; title = $f.'System.Title' } }
    } catch { $null } finally { $tmp | Remove-Item -ErrorAction SilentlyContinue }
}
$failed = 0

foreach ($d in $dates) {
    try {
        if (-not (Test-Path (Join-Path $logDir "$d.csv"))) { Log "timeline/$d no log, skipped"; continue }
        $inputs = "$d.csv", "sessions.map", "$d.map", "$d.txt" | ForEach-Object { Join-Path $logDir $_ } | Where-Object { Test-Path $_ }
        # The output target is part of the hash, so a dry run never stands in for a real build.
        $hash = (@($inputs | ForEach-Object { "$(Split-Path -Leaf $_)=$((Get-FileHash $_).Hash)" }) + "to=$DryRun") -join ";"
        $marker = Join-Path $state "$d.hash"
        if (-not $Force -and (Test-Path $marker) -and (Get-Content $marker -Raw).Trim() -eq $hash) { Log "timeline/$d unchanged, skipped"; continue }

        $export = Join-Path $state "export-$d.json"
        pwsh -NoProfile -File (Join-Path $PSScriptRoot "worklog.ps1") $d -ExportJson $export | Out-Null
        if ($LASTEXITCODE -or -not (Test-Path $export)) { throw "worklog.ps1 $d -ExportJson exited $LASTEXITCODE" }
        $x = Get-Content $export -Raw | ConvertFrom-Json -AsHashtable
        Remove-Item $export

        $events = @(foreach ($e in $x.events) { [ordered]@{ at = & $iso ([datetime]"$d $($e.time)"); kind = $e.kind; session = $e.session; ticket = $e.ticket } })
        $sessions = [ordered]@{}
        foreach ($k in $x.sessions.Keys) { $c = "$($x.sessions[$k].cwd)".TrimEnd('\', '/'); $sessions[$k] = [ordered]@{ project = $(if ($c) { Split-Path -Leaf $c } else { $null }); review = [bool]$x.sessions[$k].review } }

        # flags: Support Items are unplanned. {type, title} is cached per ticket (an old string entry is just the type and gets its
        # title on next use); a failed lookup leaves the marker unwritten, so the next tick retries it.
        $flags = [ordered]@{}; $typeFailed = $false
        foreach ($t in $events.ticket | Where-Object { $_ -match '^PET-\d{5}$' } | Sort-Object -Unique) {
            if ($types[$t] -is [string]) { $types[$t] = @{ type = $types[$t] } }
            if (-not $types[$t] -or -not $types[$t].title) {
                $info = AdoInfo $t.Substring(4)
                if ($info) { $types[$t] = $info; ConvertTo-Json -InputObject $types | Set-Content $typesFile -Encoding utf8NoBOM }
                else { Log "WARN ADO type lookup failed for $t (retried next run)"; $typeFailed = $true; if (-not $types[$t]) { continue } }
            }
            if ($types[$t].type -eq "Support Item") { $flags[$t] = [ordered]@{ unplanned = $true } }
        }

        # notes, per ticket: (1) the first model-written roll-up description in <date>.txt ((raw) rows are prompt text, skipped);
        # else (2) that day's "#NNNNN subject" commits in the sessions' repos; else (3) "<type>: <title>" from ADO.
        # Only those three sources: prompt text never goes in a note.
        # blocks: every such roll-up row as {start, end, ticket, text}, local times; an end at or before its start is next midnight.
        $rolled = @{}; $blocks = @()
        $txt = Join-Path $logDir "$d.txt"
        if (Test-Path $txt) {
            foreach ($l in Get-Content $txt) {
                if ($l -match '^\s*(\d{1,2}:\d\d [AP]M)\s+(\d{1,2}:\d\d [AP]M)\s+[\d.]+\s+(\d{5})\s+\S+(?: \S+)*?\s{2,}(.+)$' -and $Matches[4] -notmatch '\(raw\)\s*$') {
                    $k = "PET-$($Matches[3])"; $text = $Matches[4].Trim()
                    if (-not $rolled.ContainsKey($k)) { $rolled[$k] = $text }
                    $a = [datetime]::ParseExact("$d $($Matches[1])", "yyyy-MM-dd h:mm tt", $ci); $b = [datetime]::ParseExact("$d $($Matches[2])", "yyyy-MM-dd h:mm tt", $ci)
                    if ($b -lt $a) { $b = $b.AddDays(1) }
                    $blocks += [ordered]@{ at = $a; start = & $iso $a; end = & $iso $b; ticket = $k; text = $text }
                }
            }
        }
        $blocks = @($blocks | Sort-Object { $_.at } | ForEach-Object { $_.Remove("at"); $_ })
        $subjects = @{}; $until = ([datetime]$d).AddDays(1).ToString("yyyy-MM-dd")
        $roots = @(foreach ($k in $x.sessions.Keys) { $c = "$($x.sessions[$k].cwd)"; if ($c) { $r = git -C $c rev-parse --show-toplevel 2>$null; if ($LASTEXITCODE -eq 0 -and $r) { $r } } }) | Sort-Object -Unique
        foreach ($r in $roots) {
            foreach ($s in git -C $r log --all --since="$d 00:00" --until="$until 00:00" --format=%s 2>$null) {
                if ($s -match '^#(\d{5})\s*[-:]?\s+(.+)') {
                    $k = "PET-$($Matches[1])"; if (-not $subjects.ContainsKey($k)) { $subjects[$k] = [System.Collections.Generic.List[string]]::new() }
                    if (-not $subjects[$k].Contains($Matches[2].Trim())) { $subjects[$k].Add($Matches[2].Trim()) }
                }
            }
        }
        # titles: the ADO title of every ticket the type lookup above returned one for (the board's scrum labels).
        $notes = [ordered]@{}; $titles = [ordered]@{}; $src = @{ rollup = 0; commit = 0; ado = 0 }
        foreach ($t in $events.ticket | Where-Object { $_ -match '^PET-\d{5}$' } | Sort-Object -Unique) {
            if ($types[$t].title) { $titles[$t] = $types[$t].title }
            $n = if ($rolled[$t]) { $src.rollup++; $rolled[$t] }
            elseif ($subjects[$t]) {
                $src.commit++
                $n = ($subjects[$t] | Select-Object -First 2) -join "; "
                if ($n.Length -gt 200) { $n = $n.Substring(0, 200); if ($n -match '^(.+)\s\S*$') { $n = $Matches[1] }; $n = $n.TrimEnd() }
                $n
            }
            elseif ($types[$t].title) { $src.ado++; "$($types[$t].type): $($types[$t].title)" }
            if ($n) { $notes[$t] = $n }
        }

        $noon = [datetime]"$d 12:00"
        $doc = [ordered]@{ date = $d; synced = & $iso (Get-Date); tz = [datetimeoffset]::new($noon, $tz.GetUtcOffset($noon)).ToString("zzz", $ci); events = $events; sessions = $sessions; notes = $notes; titles = $titles; blocks = $blocks; flags = $flags }
        $json = ConvertTo-Json -InputObject $doc -Depth 5 -Compress

        if ($DryRun) {
            New-Item -ItemType Directory -Force $DryRun | Out-Null
            $json | Set-Content (Join-Path $DryRun "timeline-$d.json") -Encoding utf8NoBOM
            Log "timeline/$d dry run, $($events.Count) events; notes from roll-up $($src.rollup), commits $($src.commit), ADO $($src.ado)"
        } else {
            $file = Join-Path $pending "timeline-$d.json"
            $json | Set-Content $file -Encoding utf8NoBOM
            Log "built timeline/$d -> $file ($($events.Count) events; notes from roll-up $($src.rollup), commits $($src.commit), ADO $($src.ado))"
        }
        if (-not $typeFailed) { $hash | Set-Content $marker }
    } catch { Log "FAILED timeline/$d`: $_"; $failed++ }
}
if ($failed) { exit 1 }
