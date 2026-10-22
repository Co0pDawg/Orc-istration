# Stand-in for Petsoft's ado.ps1 in test.ps1 (via WORKLOG_ADO): same verbs and JSON shapes, canned data.
# Fails like the real one (exit 1) for an unknown PR, and when the roll-up forgets to set WORKLOG_DISABLE.
# wiql writes its query to <WORKLOG_DIR>\wiql.txt so the test can check the filter.
param([Parameter(Position = 0)][string]$Verb, [int]$Id, [int]$Pr, [switch]$IncludeWorkItems, [switch]$Relations, [string]$Query)
if ($env:WORKLOG_DISABLE -ne "1") { Write-Error "WORKLOG_DISABLE not set" -ErrorAction Continue; exit 1 }
$types = @{ 17001 = "User Story"; 17002 = "Bug"; 17003 = "Task"; 17291 = "Support Item" }
$links = @{ 6025 = @(17001, 17002, 17003); 6026 = @(17001, 17002) }
# Parent roll-up chain for 2026-01-06: 17010 -> 17011 -> 17012 (filed earlier), 17020 -> 17021, 17030 (filed earlier) stays.
$today = @(17010, 17011, 17020)
$parents = @{ 17010 = 17011; 17011 = 17012; 17020 = 17021; 17030 = 17031 }
switch ($Verb) {
    "wi-get" {
        $t = if ($types[$Id]) { $types[$Id] } else { "Task" }
        $f = @{ "System.WorkItemType" = $t; "System.Title" = "Fake $Id"; "System.CreatedDate" = $(if ($Id -in $today) { "2026-01-06T15:00:00Z" } else { "2025-12-01T15:00:00Z" }) }
        if ($Relations -and $parents[$Id]) { $f["System.Parent"] = $parents[$Id] }
        @{ id = $Id; fields = $f } | ConvertTo-Json -Depth 5
    }
    "pr-get" { if (-not $links[$Pr]) { Write-Error "pr-get failed: 404" -ErrorAction Continue; exit 1 }; @{ pullRequestId = $Pr; workItemIds = $links[$Pr] } | ConvertTo-Json }
    "wiql" { $Query | Set-Content (Join-Path $env:WORKLOG_DIR "wiql.txt"); ConvertTo-Json -InputObject @(@{ id = 17003; type = "Task" }, @{ id = 17900; type = "Bug" }) }
    default { exit 1 }
}
