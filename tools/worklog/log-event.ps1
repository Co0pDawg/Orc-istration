# Claude Code hook: appends one CSV line per UserPromptSubmit (-Kind prompt), Stop (-Kind stop)
# or PostToolUse (-Kind tool: logs `az`, `ado.ps1` and `git commit` commands and Agent dispatches, ignores every other tool).
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
        elseif ($text -match '(?:PET-|#)(\d{5})\b') { $explicit = "PET-$($Matches[1])" }
        elseif ($text -match '\b(?:pr|pull request)\s*#?(\d{4})\b') { $explicit = "PR-$($Matches[1])" }  # ponytail: PR ids are four digits until PR 10000
    } elseif ($Kind -eq "tool") {
        $cmd = "$($json.tool_input.command)"
        # az / ado.ps1 / git commit as the command itself (start, or after ; | & ( = or a newline), not the word inside a sed, grep or commit message.
        $az = [regex]::Match($cmd, '(?:^|(?<!\\)[;&|(=\r\n])\s*(?<az>az\s+[a-z])').Groups['az']
        $ado = [regex]::Match($cmd, '(?:^|(?<!\\)[;&|(=\r\n])\s*(?:(?:pwsh|powershell)(?:\.exe)?\s+(?:-\S+\s+)*)?["'']?[^\s"'';|&]*?(?<ado>ado\.ps1)["'']?\s+[a-z]').Groups['ado']
        $commit = [regex]::Match($cmd, '(?:^|(?<!\\)[;&|(=\r\n])\s*(?<git>git(?:\s+-[Cc]\s+\S+)*\s+commit\b)').Groups['git']
        if ($json.tool_name -eq "Agent") {
            $Kind = "agent"; $text = "$($json.tool_input.subagent_type): $($json.tool_input.description)"
        } elseif ($json.tool_name -in "Bash", "PowerShell" -and $ado.Success) {
            $Kind = "ado"; $text = $cmd.Substring($ado.Index); $max = 120
            # A mutating verb names the ticket (-Id, then -WorkItems) or PR (-Pr) being worked; -WhatIf only prints the request.
            $seg = ($text -split '[;|&\r\n]')[0]
            if ($seg -match '^ado\.ps1["'']?\s+(wi-update|wi-link|wi-link-branch|wi-attach|comment-add|comment-edit|pr-create|pr-update|pr-link|pr-attach)\b' -and $seg -notmatch '-WhatIf\b') {
                if ($seg -match '-Id\s+(\d{5})\b' -or $seg -match '-WorkItems\s+(\d{5})\b') { $explicit = "PET-$($Matches[1])" }
                elseif ($seg -match '-Pr\s+(\d+)\b') { $explicit = "PR-$($Matches[1])" }
            }
        } elseif ($json.tool_name -in "Bash", "PowerShell" -and $az.Success) {
            $Kind = "az"; $text = $cmd.Substring($az.Index); $max = 120
            # Only a mutating command names the ticket being worked; a read (show/list/query/GET) just looks around.
            # Verbs are checked on the az command's own segment; a REST call with an az token counts by its method.
            $seg = ($text -split '[;|&\r\n]')[0]
            $mutating = $seg -match '\b(create|update|delete|add|set-vote)\b|--http-method\s+(POST|PATCH|PUT|DELETE)' -or $text -match '-(Method|X)\s+(POST|PATCH|PUT|DELETE)\b'
            if ($mutating -and $text -match '\b(\d{5})\b') { $explicit = "PET-$($Matches[1])" }
            elseif ($mutating -and $seg -match '^az\s+repos\s+pr\b.*--id\s+(\d+)') { $explicit = "PR-$($Matches[1])" }
        } elseif ($json.tool_name -in "Bash", "PowerShell" -and $commit.Success) {
            # The session that runs the commit owns it; the message (-m, -F heredoc) can span lines, so all of it is searched.
            $Kind = "commit"; $text = $cmd.Substring($commit.Index); $max = 120
            if ($text -match '#(\d{5})\b') { $explicit = "PET-$($Matches[1])" }
        } else { exit 0 }
    }
    $text = $text -replace '[\r\n,]+', ' '
    if ($text.Length -gt $max) { $text = $text.Substring(0, $max) }

    $logDir = if ($env:WORKLOG_DIR) { $env:WORKLOG_DIR } else { Join-Path $HOME ".claude\worklog" }
    New-Item -ItemType Directory -Force $logDir | Out-Null
    $file = Join-Path $logDir ((Get-Date).ToString("yyyy-MM-dd") + ".csv")

    # Ticket: explicit in this event (written PET-NNNNN* or PR-NNNN*) -> branch name -> UNKNOWN. Five digits for tickets:
    # PR ids are four. Which ticket a session was on between explicit events is decided at roll-up from evidence (worklog.ps1).
    $ticket = "UNKNOWN"
    if ($explicit) { $ticket = "$explicit*" }
    elseif ((git -C $cwd branch --show-current 2>$null) -match '(\d{5})') { $ticket = "PET-$($Matches[1])" }

    "$((Get-Date).ToString('HH:mm:ss')),$Kind,$ticket,$session,$cwd,$text" | Add-Content $file
} catch { }
exit 0
