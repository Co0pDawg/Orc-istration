# Stand-in for AcmeApp's ado.ps1 in test.ps1 (via WORKLOG_ADO): same verbs and JSON shapes, canned data.
# Fails like the real one (exit 1) for an unknown PR, and when the roll-up forgets to set WORKLOG_DISABLE.
# wiql writes its query to <WORKLOG_DIR>\wiql.txt so the test can check the filter.
param([Parameter(Position = 0)][string]$Verb, [int]$Id, [int]$Pr, [switch]$IncludeWorkItems, [switch]$Relations, [string]$Query)
if ($env:WORKLOG_DISABLE -ne "1") { Write-Error "WORKLOG_DISABLE not set" -ErrorAction Continue; exit 1 }
$types = @{ 10003 = "User Story"; 10004 = "Bug"; 10005 = "Task"; 10015 = "Support Item" }
$links = @{ 1001 = @(10003, 10004, 10005); 1002 = @(10003, 10004) }
# Parent roll-up chain for 2026-01-06: 10006 -> 10007 -> 10008 (filed earlier), 10009 -> 10010, 10011 (filed earlier) stays.
$today = @(10006, 10007, 10009)
$parents = @{ 10006 = 10007; 10007 = 10008; 10009 = 10010; 10011 = 10012 }
switch ($Verb) {
    "wi-get" {
        $t = if ($types[$Id]) { $types[$Id] } else { "Task" }
        $f = @{ "System.WorkItemType" = $t; "System.Title" = "Fake $Id"; "System.CreatedDate" = $(if ($Id -in $today) { "2026-01-06T15:00:00Z" } else { "2025-12-01T15:00:00Z" }) }
        if ($Relations -and $parents[$Id]) { $f["System.Parent"] = $parents[$Id] }
        @{ id = $Id; fields = $f } | ConvertTo-Json -Depth 5
    }
    "pr-get" { if (-not $links[$Pr]) { Write-Error "pr-get failed: 404" -ErrorAction Continue; exit 1 }; @{ pullRequestId = $Pr; workItemIds = $links[$Pr] } | ConvertTo-Json }
    "wiql" { $Query | Set-Content (Join-Path $env:WORKLOG_DIR "wiql.txt"); ConvertTo-Json -InputObject @(@{ id = 10005; type = "Task" }, @{ id = 10033; type = "Bug" }) }
    default { exit 1 }
}
