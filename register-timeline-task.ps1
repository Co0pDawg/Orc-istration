#Requires -Version 7
# Registers (or replaces) the "Worklog timeline sync" scheduled task: sync-timeline.ps1 every 15 minutes while the user is
# logged on (interactive only, no stored password), stopped after 30 minutes, not started on batteries (like the build watcher).
# Usage: pwsh -NoProfile -File register-timeline-task.ps1      Check: schtasks /query /tn "Worklog timeline sync" /v /fo LIST
$ErrorActionPreference = "Stop"
$action = New-ScheduledTaskAction -Execute "pwsh.exe" -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -File `"$PSScriptRoot\sync-timeline.ps1`"" -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 15)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "Worklog timeline sync" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
"registered Worklog timeline sync"
