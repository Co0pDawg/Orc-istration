# Stand-in for ado-actions.ps1 in test.ps1 (via WORKLOG_ACTIONS): no actions unless WORKLOG_FAKE_ACTIONS is 1, or exit 1 when it is "fail".
param([Parameter(Position = 0)][string]$Date)
if ($env:WORKLOG_DISABLE -ne "1" -or $env:WORKLOG_FAKE_ACTIONS -eq "fail") { exit 1 }
$list = if ($env:WORKLOG_FAKE_ACTIONS -eq "1") { @(@{ time = "15:24:00"; pr = 6025; text = "Approved the pull request in Azure DevOps" }) } else { @() }
ConvertTo-Json -InputObject $list
