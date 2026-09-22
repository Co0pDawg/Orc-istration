# Rolls a day's raw hook events into portal-shaped time entries.
# Usage: worklog.ps1 [yyyy-MM-dd]   (default: today)
# Rules: contiguous same-ticket activity = one block; a gap > $GapMinutes closes a block;
# block hours round up to the 15-minute grid the Cosairus portal uses.
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
    [pscustomobject]@{ Time = [datetime]"$Date $($p[0])"; Event = $p[1]; Ticket = $p[2]; Prompt = $p[5]; Seq = $i++ }
} | Sort-Object Time, Seq

$blocks = @()
$cur = $null
foreach ($e in $events) {
    $gap = $e.Event -eq "prompt" -and $cur -and ($e.Time - $cur.End).TotalMinutes -gt $GapMinutes
    $newBlock = -not $cur -or $e.Ticket -ne $cur.Ticket -or $gap
    if ($newBlock) {
        if ($cur) { $blocks += $cur }
        $cur = [pscustomobject]@{ Ticket = $e.Ticket; Start = $e.Time; End = $e.Time; Prompts = @() }
    }
    $cur.End = $e.Time
    if ($e.Event -eq "prompt" -and $e.Prompt) { $cur.Prompts += $e.Prompt }
}
if ($cur) { $blocks += $cur }

$total = 0
foreach ($b in $blocks) {
    $hours = [math]::Ceiling(($b.End - $b.Start).TotalMinutes / 15) * 0.25
    if ($hours -eq 0) { $hours = 0.25 }
    $total += $hours
    $what = ($b.Prompts | Select-Object -Unique | Select-Object -First 3) -join "; "
    "{0}  {1}  {2,-10} {3,5:0.00}  {4}" -f $b.Start.ToString("HH:mm"), $b.End.ToString("HH:mm"), $b.Ticket, $hours, $what
}
"Total: {0:0.00} hours" -f $total
