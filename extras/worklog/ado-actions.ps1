# Prints the PR actions the signed-in user took on a date as JSON: [{time, pr, text}], time local HH:mm:ss.
# Votes, written comments and completions count. Automation under the user's identity does not: a completion on a PR with
# auto-complete set, and a scheduled sweep's comment. worklog.ps1 turns each action into a one-slot event.
# Reads through ado.ps1's Invoke-Ado (it has no verb that keeps system comments), dot-sourced as ado.Tests.ps1 does.
# Usage: pwsh -NoProfile -File ado-actions.ps1 yyyy-MM-dd
param([Parameter(Position = 0)][string]$Date)

function Select-MyPrActions($MeId, $PrId, $Threads, [datetime]$From, [datetime]$To) {
    $votes = @{ "10" = "Approved"; "5" = "Approved with suggestions"; "-5" = "Waiting for the author"; "-10" = "Rejected" }
    $comments = @($Threads | ForEach-Object { $_.comments } | Where-Object { $_ -and -not $_.isDeleted })
    $auto = [bool]($comments | Where-Object { $_.commentType -eq "system" -and $_.content -match "set auto-complete" })
    foreach ($c in $comments) {
        if ($c.author.id -ne $MeId) { continue }
        $at = ([datetime]$c.publishedDate).ToLocalTime()
        if ($at -lt $From -or $at -ge $To) { continue }
        $text = $null
        if ($c.commentType -eq "system") {
            if ($c.content -match " voted (-?\d+)$" -and $votes[$Matches[1]]) { $text = "Reviewed a pull request in Azure DevOps: $($votes[$Matches[1]])" }
            elseif ($c.content -match "status to Completed" -and -not $auto) { $text = "Completed the pull request in Azure DevOps" }
        }
        elseif ($c.commentType -eq "text" -and $c.content -notmatch "^Scheduled conflict sweep") { $text = "Wrote a review comment on the pull request in Azure DevOps" }
        if ($text) { [pscustomobject]@{ time = $at.ToString("HH:mm:ss"); pr = $PrId; text = $text } }
    }
}

# Dot-sourced by test.ps1 for the pure function above: stop before any ADO call.
if ($MyInvocation.InvocationName -eq ".") { return }

$adoScript = if ($env:WORKLOG_ADO) { $env:WORKLOG_ADO } elseif ($env:ORC_ADO_SCRIPT) { $env:ORC_ADO_SCRIPT } else { "C:\src\your-repo\.claude\scripts\ado.ps1" }
. $adoScript
$dayStart = [datetime]$Date; $dayEnd = $dayStart.AddDays(1)
$meId = (Invoke-Ado -Uri "$orgUrl/_apis/connectionData").authenticatedUser.id
$repoApi = "$api/git/repositories/$([uri]::EscapeDataString($Repository))"
# ponytail: newest 500 PRs, one threads call per PR open that day (about 35); page with $skip to backfill past 500, cache if ticks get slow.
$open = @((Invoke-Ado -Uri "$repoApi/pullrequests?searchCriteria.status=all&`$top=500&api-version=7.1").value | Where-Object {
    ([datetime]$_.creationDate).ToLocalTime() -lt $dayEnd -and ($_.status -eq "active" -or ([datetime]$_.closedDate).ToLocalTime() -ge $dayStart)
})
$actions = @(foreach ($p in $open) {
    Select-MyPrActions $meId $p.pullRequestId (Invoke-Ado -Uri "$repoApi/pullRequests/$($p.pullRequestId)/threads?api-version=7.1").value $dayStart $dayEnd
})
ConvertTo-Json -InputObject $actions
