<#
.SYNOPSIS
Reminds the orchestrator to update the board's session doc after a builder, refuter or debugger finishes.

.DESCRIPTION
A SubagentStop hook cannot reach the main session: its output goes to the finishing agent and keeps it running. So
-Mode mark (SubagentStop) only leaves a marker, and -Mode relay (PostToolUse, UserPromptSubmit) turns the session's
markers into context on the main session's next dispatch, board write or prompt. It writes nothing to the board.

Silent without a board.url in ~/.orc/config.json (or $ORC_DATA_DIR/config.json), so a developer with no board sees
nothing. Any failure exits 0: a reminder never blocks work. BOARD_REMINDER_ROOT overrides ~/.claude for markers.
#>
param([ValidateSet('mark', 'relay')][string]$Mode = 'relay')

$ErrorActionPreference = 'Stop'
try {
    $orcHome = if ($env:ORC_DATA_DIR -and $env:ORC_DATA_DIR.Trim()) { $env:ORC_DATA_DIR } else { Join-Path -Path $HOME -ChildPath '.orc' }
    $cfgFile = Join-Path -Path $orcHome -ChildPath 'config.json'
    $hasBoard = $false
    if (Test-Path -LiteralPath $cfgFile -PathType Leaf) {
        try {
            $cfg = Get-Content -LiteralPath $cfgFile -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
            if ($null -ne $cfg -and ($cfg.PSObject.Properties.Name -contains 'board') -and $null -ne $cfg.board -and ($cfg.board.PSObject.Properties.Name -contains 'url')) {
                $url = $cfg.board.url
                if ($url -is [string] -and $url.Trim()) { $hasBoard = $true }
            }
        } catch {
            $hasBoard = $false
        }
    }
    if (-not $hasBoard) { exit 0 }
    $root = if ($env:BOARD_REMINDER_ROOT) { $env:BOARD_REMINDER_ROOT } else { Join-Path -Path $HOME -ChildPath '.claude' }
    $dir = Join-Path $root 'board-reminders'
    # The relay runs on every prompt, so the common case of no markers stops here.
    if ($Mode -eq 'relay' -and -not (Test-Path (Join-Path $dir '*'))) { exit 0 }

    $hook = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $session = "$($hook.session_id)" -replace '[^\w-]', ''
    if (-not $session) { exit 0 }

    if ($Mode -eq 'mark') {
        if ("$($hook.agent_type)" -notin 'builder', 'refuter', 'debugger') { exit 0 }
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        Set-Content -Path (Join-Path $dir "$session.$("$($hook.agent_id)" -replace '[^\w-]', '')") -Value $hook.agent_type
        # A session that ended before its relay ran leaves its marker behind.
        Get-ChildItem $dir | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Force
        exit 0
    }

    # A hook call inside a subagent carries agent_id; the reminder is for the main session.
    if ($hook.agent_id) { exit 0 }
    $markers = @(Get-ChildItem $dir -Filter "$session.*")
    if (-not $markers.Count) { exit 0 }
    $agents = @($markers | ForEach-Object { "$(Get-Content $_.FullName -Raw)".Trim() } | Where-Object { $_ } | Sort-Object -Unique) -join ', '
    $markers | Remove-Item -Force
    # A marker killed mid-write is empty: it is cleared without naming an agent.
    if (-not $agents) { $agents = 'An agent' }
    @{ hookSpecificOutput = @{
        hookEventName     = "$($hook.hook_event_name)"
        additionalContext = "Board: $agents finished. Update this session's now and events, set the card's tokens from the completion notice, and confirm the agent's stage moved."
    } } | ConvertTo-Json -Compress
} catch { [Console]::Error.WriteLine("board-reminder: $($_.Exception.Message)") }
exit 0
