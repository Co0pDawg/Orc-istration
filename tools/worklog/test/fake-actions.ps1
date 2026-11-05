# Stand-in for ado-actions.ps1 in test.ps1 (via WORKLOG_ACTIONS): WORKLOG_FAKE_ACTIONS is 1 for a vote, "comment" for a comment, "fail" to exit 1; else no actions.
param([Parameter(Position = 0)][string]$Date)
if ($env:WORKLOG_DISABLE -ne "1" -or $env:WORKLOG_FAKE_ACTIONS -eq "fail") { exit 1 }
$list = switch ($env:WORKLOG_FAKE_ACTIONS) {
    "1" { @(@{ time = "15:24:00"; pr = 6025; text = "Approved the pull request in Azure DevOps" }) }
    "comment" { @(@{ time = "15:24:00"; pr = 6025; text = "Wrote a review comment on the pull request in Azure DevOps" }) }
    default { @() }
}
ConvertTo-Json -InputObject @($list)
