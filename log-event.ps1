# Claude Code hook: appends one CSV line per UserPromptSubmit / Stop event.
# Reads the hook JSON from stdin. Never fails the hook (exit 0 always).
param([string]$Event = "prompt")

$ErrorActionPreference = "SilentlyContinue"
try {
    $json = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $cwd = if ($json.cwd) { $json.cwd } else { (Get-Location).Path }
    $session = "$($json.session_id)"
    $prompt = "$($json.prompt)" -replace '[\r\n,]+', ' '
    if ($prompt.Length -gt 60) { $prompt = $prompt.Substring(0, 60) }

    $logDir = if ($env:WORKLOG_DIR) { $env:WORKLOG_DIR } else { Join-Path $HOME ".claude\worklog" }
    New-Item -ItemType Directory -Force $logDir | Out-Null
    $file = Join-Path $logDir ((Get-Date).ToString("yyyy-MM-dd") + ".csv")

    # Ticket: explicit in prompt -> branch name -> last ticket seen for this session -> UNKNOWN.
    # Prompt wins so a ticket named in the message overrides the branch. Five digits only: PR ids are four.
    $ticket = $null
    if ($prompt -match '(?:PET-|#)(\d{5})\b') { $ticket = "PET-$($Matches[1])" }
    if (-not $ticket) {
        $branch = git -C $cwd branch --show-current 2>$null
        if ($branch -match '(\d{5})') { $ticket = "PET-$($Matches[1])" }
    }
    if (-not $ticket -and (Test-Path $file)) {
        $last = Get-Content $file | Where-Object { $_ -like "*,$session,*" } | Select-Object -Last 1
        if ($last) { $ticket = ($last -split ',')[2] }
    }
    if (-not $ticket) { $ticket = "UNKNOWN" }

    "$((Get-Date).ToString('HH:mm:ss')),$Event,$ticket,$session,$cwd,$prompt" | Add-Content $file
} catch { }
exit 0
