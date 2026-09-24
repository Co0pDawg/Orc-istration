# Rolls a day's raw hook events into portal-ready time entries, printed and written to <logDir>/<date>.txt.
# Usage: worklog.ps1 [yyyy-MM-dd] [-GapMinutes 30]   (default: today)
# Rules: contiguous same-ticket activity = one block; a prompt more than $GapMinutes after the block's last event starts a new one;
# block hours round up to the 15-minute grid the Cosairus portal uses. One `claude -p --model haiku` call writes the descriptions;
# WORKLOG_NOSUMMARY=1, a failure, a 60 s timeout or a wrong line count falls back to the raw facts, marked (raw).
param(
    [string]$Date = (Get-Date).ToString("yyyy-MM-dd"),
    [int]$GapMinutes = 30
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

foreach ($b in $blocks) {
    $since = $b.Start.ToString("s"); $until = $b.End.ToString("s")
    $commits = $b.Events.Cwd | Sort-Object -Unique | ForEach-Object { git -C $_ log --no-merges --author="$(git -C $_ config user.email)" --since=$since --until=$until --format=%s 2>$null }
    # Strongest evidence first, labelled so the summary leans on commits and ADO actions over chat prompts.
    $of = { param($kind, $label) $b.Events | Where-Object { $_.Event -eq $kind -and $_.Text } | ForEach-Object { "${label}: $($_.Text)" } }
    $b.Facts = @(@($commits | ForEach-Object { "commit: $_" }) + @(& $of az "ado") + @(& $of agent "agent") + @(& $of prompt "asked") | Where-Object { $_ } | Select-Object -Unique)
}

$desc = @{}
if ($env:WORKLOG_NOSUMMARY -ne "1" -and $blocks) {
    $n = 0
    $ask = "Write a timesheet description for each numbered block of work below. Reply with exactly $($blocks.Count) lines formatted <n>|<description> and nothing else. " +
        "Each description is one past-tense sentence of at most 150 characters in plain ASCII, and never mentions a ticket, work-item or PR number. " +
        "Base it on the commit and ado facts when present; asked facts are the developer's chat prompts, use them only for context. Be specific, not generic.`n`n" +
        (($blocks | ForEach-Object { $n++; $f = if ($_.Facts) { $_.Facts } else { "(no prompts: only waited on agent/task notifications)" }; "$n.`n" + (($f | ForEach-Object { "- $_" }) -join "`n") }) -join "`n`n")
    # Start-Process, not Start-Job: jobs fail under a system-wide constrained language mode.
    # WORKLOG_DISABLE (inherited by claude and its hooks) stops the summarising session from logging itself.
    $tmp = 1..3 | ForEach-Object { New-TemporaryFile }
    $ask | Set-Content $tmp[0] -Encoding UTF8
    $old = $env:WORKLOG_DISABLE; $env:WORKLOG_DISABLE = "1"
    $p = Start-Process claude "-p --model haiku" -NoNewWindow -PassThru -WorkingDirectory $logDir -RedirectStandardInput $tmp[0] -RedirectStandardOutput $tmp[1] -RedirectStandardError $tmp[2]
    $env:WORKLOG_DISABLE = $old
    Wait-Process -Id $p.Id -Timeout 60 -ErrorAction SilentlyContinue
    if ($p.HasExited) { $reply = @(Get-Content $tmp[1] -Encoding UTF8 | Where-Object { $_.Trim() }) } else { Stop-Process -Id $p.Id -Force }
    $tmp | Remove-Item -ErrorAction SilentlyContinue
    if ($reply.Count -eq $blocks.Count) { foreach ($l in $reply) { if ($l -match '^\s*(\d+)\|(.+)$') { $desc[[int]$Matches[1]] = $Matches[2].Trim() } } }
}

$lines = @("START  END    HOURS  TICKET  DESCRIPTION")
$total = 0
$n = 0
foreach ($b in $blocks) {
    $n++
    $hours = [math]::Ceiling(($b.End - $b.Start).TotalMinutes / 15) * 0.25
    if ($hours -eq 0) { $hours = 0.25 }
    $total += $hours
    $d = $desc[$n]
    if (-not $d) {
        $d = $b.Facts -join "; "
        if ($d.Length -gt 144) { $d = $d.Substring(0, 144) }
        $d = "$d (raw)".TrimStart()
    } elseif ($d.Length -gt 150) { $d = $d.Substring(0, 150) }
    $ticket = if ($b.Ticket -eq "UNKNOWN") { "-----" } else { $b.Ticket -replace '^PET-', '' }
    $lines += "{0}  {1}  {2,5:0.00}  {3,-6}  {4}" -f $b.Start.ToString("HH:mm"), $b.End.ToString("HH:mm"), $hours, $ticket, $d
}
$lines += "Total: {0:0.00} hours" -f $total
$lines | Set-Content (Join-Path $logDir "$Date.txt")
$lines
