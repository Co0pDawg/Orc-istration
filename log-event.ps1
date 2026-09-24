# Claude Code hook: appends one CSV line per UserPromptSubmit (-Kind prompt), Stop (-Kind stop)
# or PostToolUse (-Kind tool: logs `az` commands and Agent dispatches, ignores every other tool).
# Reads the hook JSON from stdin. Never fails the hook (exit 0 always). WORKLOG_DISABLE=1 skips logging.
param([string]$Kind = "prompt")

$ErrorActionPreference = "SilentlyContinue"
if ($env:WORKLOG_DISABLE -eq "1") { exit 0 }
try {
    $json = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $cwd = if ($json.cwd) { $json.cwd } else { (Get-Location).Path }
    $session = "$($json.session_id)"
    $text = ""
    $explicit = $null
    $max = 200

    if ($Kind -eq "prompt") {
        $text = "$($json.prompt)"
        if ($text -match '^\s*<(task-notification|agent-message|system-reminder)') { $Kind = "notify"; $text = "" }
        elseif ($text -match '(?:PET-|#)(\d{5})\b') { $explicit = $Matches[1] }
    } elseif ($Kind -eq "tool") {
        $cmd = "$($json.tool_input.command)"
        $az = [regex]::Match($cmd, '\baz\b')
        if ($json.tool_name -eq "Agent") {
            $Kind = "agent"; $text = "$($json.tool_input.subagent_type): $($json.tool_input.description)"
        } elseif ($json.tool_name -in "Bash", "PowerShell" -and $az.Success) {
            $Kind = "az"; $text = $cmd.Substring($az.Index); $max = 120
            # Only a mutating command names the ticket being worked; a read (show/list/query/GET) just looks around.
            if ($text -match '\b(create|update|delete|add|set-vote)\b|--http-method\s+(POST|PATCH|PUT|DELETE)' -and $text -match '\b(\d{5})\b') { $explicit = $Matches[1] }
        } else { exit 0 }
    }
    $text = $text -replace '[\r\n,]+', ' '
    if ($text.Length -gt $max) { $text = $text.Substring(0, $max) }

    $logDir = if ($env:WORKLOG_DIR) { $env:WORKLOG_DIR } else { Join-Path $HOME ".claude\worklog" }
    New-Item -ItemType Directory -Force $logDir | Out-Null
    $file = Join-Path $logDir ((Get-Date).ToString("yyyy-MM-dd") + ".csv")

    # Ticket: explicit in this event (written PET-NNNNN*) -> session's last explicit ticket -> branch name
    # -> session's last ticket of any origin -> UNKNOWN. Five digits only: PR ids are four.
    $ticket = $null
    if ($explicit) { $ticket = "PET-$explicit*" }
    else {
        $tickets = @(if (Test-Path $file) { Get-Content $file | Where-Object { $_ -like "*,$session,*" } | ForEach-Object { ($_ -split ',')[2] } })
        $last = $tickets | Where-Object { $_.EndsWith('*') } | Select-Object -Last 1
        if ($last) { $ticket = $last.TrimEnd('*') }
        if (-not $ticket) {
            $branch = git -C $cwd branch --show-current 2>$null
            if ($branch -match '(\d{5})') { $ticket = "PET-$($Matches[1])" }
        }
        if (-not $ticket -and $tickets) { $ticket = $tickets[-1].TrimEnd('*') }
        if (-not $ticket) { $ticket = "UNKNOWN" }
    }

    "$((Get-Date).ToString('HH:mm:ss')),$Kind,$ticket,$session,$cwd,$text" | Add-Content $file
} catch { }
exit 0
