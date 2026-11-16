# Azure DevOps REST helper: the reference implementation of docs/tracker-contract.md. One verb per call, JSON on
# stdout, exit 1 with a named error on any failure (never silent). Replaces per-workflow `az` recipes: az.cmd truncated
# multiline args, dropped --draft, and silently no-op'd from Git Bash.
# Usage: pwsh -NoProfile -File <checkout>/tools/tracker/ado.ps1 <verb> [-Param value ...] [-WhatIf]
# Organization, project and repository: -Organization/-Project/-Repository, else ORC_ADO_ORG/ORC_ADO_PROJECT/ORC_ADO_REPO.
# There are no defaults; a missing one fails before any call.
#   Work items: wi-get -Id [-Relations] | wi-create -Type -Title [-BodyFile] [-Set 'Ref=value',...] [-Parent]
#               wi-update -Id [-Set ...] [-BodyFile] [-FieldFromFile <ref>] [-Type] | wi-link-branch -Id -Branch | wi-attach -Id -File
#               wi-batch -Ids 1,2 [-Fields System.Title,System.State]   (default fields: Id, WorkItemType, Title, State, AssignedTo)
#   Comments:   comment-list -Id | comment-add -Id -BodyFile | comment-edit -Id -CommentId -BodyFile
#   PRs:        pr-get -Pr [-IncludeWorkItems (adds workItemIds: int[])] | pr-list [-Source] [-Target] [-Status active|all] | pr-create -Source -Target -Title -BodyFile [-WorkItems 1,2]
#               pr-update -Pr [-Title] [-BodyFile] | pr-link -Pr -WorkItems 1,2 | pr-attach -Pr -File   (pr-create is always a draft)
#               pr-comments -Pr   (read-only: comment threads people wrote, oldest first; system events and deleted comments dropped)
#               pr-comment-add -Pr -BodyFile [-Resolved]   (new top-level thread, Active or with -Resolved already Resolved; never a reply inside someone else's thread)
#   Queries:    wiql -Query <wiql> | -QueryFile <path> [-Top 200] | query -Name mine-active
#   Pipelines:  build-find -Pipeline <name> -Run <buildNumber> | build-get -Build | build-timeline -Build [-Failed]
#               build-list -Branch <branch | refs/... | PR id> [-Pipeline <name>] [-Top 5]   (newest first; a PR id lists its refs/pull/<id>/merge builds)
#               build-queue -Pipeline <name> -Branch <branch | refs/...>
#               build-log -Build -Log -OutFile | test-results -Build [-Name '<run name pattern>'] [-Failed]
#               (test-results lists attachments only for non-Passed results; Passed results carry attachments = [])
#   Files:      download -Url -OutFile
# Long text always goes through -BodyFile (UTF-8). -WhatIf prints each request (no auth header) instead of sending it.
param(
    [Parameter(Position = 0)][string]$Verb,
    [int]$Id, [int]$CommentId, [int]$Parent,
    [string]$Type, [string]$Title, [string]$BodyFile, [string]$FieldFromFile, [string[]]$Set,
    [string]$Branch, [string]$File, [string]$OutFile, [string]$Url,
    [int]$Pr, [Alias('WorkItems', 'Ids')][int[]]$WorkItemIds, [string[]]$Fields, [string]$Source, [string]$Target, [string]$Status = 'active', [switch]$IncludeWorkItems,
    [string]$Query, [string]$QueryFile, [string]$Name, [ValidateRange(1, 200)][int]$Top = 200,
    [int]$Build, [int]$Log, [string]$Pipeline, [string]$Run, [switch]$Failed,
    [switch]$Relations, [switch]$Resolved, [switch]$WhatIf,
    [string]$Organization = $env:ORC_ADO_ORG, [string]$Project = $env:ORC_ADO_PROJECT, [string]$Repository = $env:ORC_ADO_REPO
)

function Fail([string]$message) {
    Write-Error $message -ErrorAction Continue
    exit 1
}

# Checked before anything else, dot-sourced callers included, so a call never goes to a guessed organization.
$missing = @(@{ p = '-Organization'; e = 'ORC_ADO_ORG'; v = $Organization }, @{ p = '-Project'; e = 'ORC_ADO_PROJECT'; v = $Project }, @{ p = '-Repository'; e = 'ORC_ADO_REPO'; v = $Repository } |
    Where-Object { [string]::IsNullOrWhiteSpace($_.v) } | ForEach-Object { "$($_.p) (or $($_.e))" })
if ($missing) { Fail "ado.ps1: no Azure DevOps $($missing -join ', '). Pass them or set the environment variables; there are no defaults (docs/adopt-a-repo.md)." }

$orgUrl = "https://dev.azure.com/$Organization"
$api = "$orgUrl/$([uri]::EscapeDataString($Project))/_apis"

function Test-HtmlResponse($response) {
    $response -is [string] -and $response.TrimStart().StartsWith('<')
}

# A downloaded file is suspect when its first bytes are markup and its name does not say it is markup.
function Test-HtmlFile([string]$Path) {
    if ($Path -match '\.(html?|xml|svg|trx)$') { return $false }
    $stream = [IO.File]::OpenRead($Path)
    try { $head = [byte[]]::new(64); $count = $stream.Read($head, 0, 64) } finally { $stream.Dispose() }
    [Text.Encoding]::UTF8.GetString($head, 0, $count).TrimStart([char]0xFEFF, ' ', "`t", "`r", "`n").StartsWith('<')
}

function Get-AuthHeader {
    if ($script:authHeader) { return $script:authHeader }
    if (Get-Command az -ErrorAction SilentlyContinue) {
        # The Azure DevOps resource id (the same for every organization).
        $token = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv 2>$null
        if ($LASTEXITCODE -eq 0 -and $token) { $script:authHeader = @{ Authorization = "Bearer $token" } }
    }
    if (-not $script:authHeader -and $env:AZURE_DEVOPS_EXT_PAT) {
        $script:authHeader = @{ Authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$env:AZURE_DEVOPS_EXT_PAT")) }
    }
    if (-not $script:authHeader) { Fail "No ADO credential: run 'az login' or set AZURE_DEVOPS_EXT_PAT." }
    $script:authHeader
}

function Invoke-Ado {
    param([string]$Method = 'GET', [string]$Uri, $Body, [string]$ContentType = 'application/json', [string]$OutFile)
    if ($WhatIf) {
        # Assign, not an if-expression: that would unroll a one-item array body into a bare object.
        $shown = $Body
        if ($Body -is [byte[]]) { $shown = "<$($Body.Length) bytes>" }
        Write-Host ([ordered]@{ method = $Method; uri = $Uri; contentType = $ContentType; body = $shown } | ConvertTo-Json -Depth 20 -Compress)
        return $null
    }
    $request = @{ Method = $Method; Uri = $Uri; Headers = (Get-AuthHeader); ErrorAction = 'Stop' }
    if ($null -ne $Body) {
        $request.ContentType = $ContentType
        # Assign directly, not via an if-expression: pipeline output would unroll byte[] into object[].
        $request.Body = $Body
        if ($Body -isnot [byte[]]) { $request.Body = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Body -Depth 20)) }
    }
    if ($OutFile) { $request.OutFile = $OutFile }
    try { $response = Invoke-RestMethod @request }
    catch {
        $status = $_.Exception.Response.StatusCode.value__
        # No status means no response at all (DNS, TLS, timeout, unwritable -OutFile); the exception message is the cause.
        $detail = if ($status) { "HTTP $status $($_.ErrorDetails.Message)" } else { $_.Exception.Message }
        Fail "$Verb failed: $Method $Uri -> $detail"
    }
    if (-not $OutFile -and (Test-HtmlResponse $response)) {
        Fail "$Verb failed: $Method $Uri returned an HTML page (sign-in?), not JSON. Check 'az login' or the PAT's scope."
    }
    if ($OutFile) {
        $written = (Resolve-Path -LiteralPath $OutFile).Path
        if (Test-HtmlFile $written) {
            Remove-Item -LiteralPath $written
            Fail "$Verb failed: $Method $Uri returned an HTML page (sign-in?), not the file; '$OutFile' was removed. Check 'az login' or the PAT's scope."
        }
    }
    $response
}

function Out-Json($value) { ConvertTo-Json -InputObject $value -Depth 20 }

function Read-BodyFile {
    if (-not $BodyFile) { return $null }
    if (-not (Test-Path -LiteralPath $BodyFile)) { Fail "$Verb failed: -BodyFile '$BodyFile' not found." }
    [IO.File]::ReadAllText((Resolve-Path -LiteralPath $BodyFile), [Text.Encoding]::UTF8)
}

function New-WorkItemPatch {
    param([string]$Type, [string[]]$Set, [string]$BodyText, [string]$BodyField, [string]$Title)
    $ops = [Collections.Generic.List[object]]::new()
    if ($Title) { $ops.Add(@{ op = 'add'; path = '/fields/System.Title'; value = $Title }) }
    foreach ($pair in $Set) {
        # Without '=' the value would go out as null and clear the field; 'Ref=' clears it on purpose.
        if ($pair -notlike '*=*') { Fail "$Verb failed: -Set '$pair' has no '='; pass 'Ref=value'." }
        $ref, $value = $pair -split '=', 2
        $ops.Add(@{ op = 'add'; path = "/fields/$ref"; value = $value })
    }
    if ($null -ne $BodyText -and $BodyText -ne '') {
        $field = if ($BodyField) { $BodyField } elseif ($Type -eq 'Bug') { 'Microsoft.VSTS.TCM.ReproSteps' } else { 'System.Description' }
        $ops.Add(@{ op = 'add'; path = "/fields/$field"; value = $BodyText })
    }
    , $ops.ToArray()
}

function Get-RepoIds {
    if ($WhatIf) { return '{projectId}', '{repoId}' }
    $repo = Invoke-Ado -Uri "$api/git/repositories/$([uri]::EscapeDataString($Repository))?api-version=7.1"
    $repo.project.id, $repo.id
}

function Add-WorkItemRelation([int]$WorkItemId, [hashtable]$Relation) {
    $patch = @(@{ op = 'add'; path = '/relations/-'; value = $Relation })
    Invoke-Ado -Method PATCH -Uri "$api/wit/workitems/$WorkItemId`?api-version=7.1" -Body $patch -ContentType 'application/json-patch+json'
}

function Get-PrArtifactUrl([string]$ProjectId, [string]$RepoId, [int]$PrId) { "vstfs:///Git/PullRequestId/$ProjectId%2F$RepoId%2F$PrId" }

function Send-File([string]$Uri, [string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { Fail "$Verb failed: -File '$Path' not found." }
    Invoke-Ado -Method POST -Uri $Uri -Body ([IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $Path))) -ContentType 'application/octet-stream'
}

# Team-specific queries (a sprint, a custom field) belong in the caller's own -Query or -QueryFile, not here.
$NamedQueries = [ordered]@{
    'mine-active' = "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AssignedTo] = @Me AND [System.State] = 'Active' ORDER BY [System.ChangedDate] DESC"
}

function ConvertTo-WorkItemRows($items) {
    , @($items | Where-Object { $_ } | ForEach-Object {
        [ordered]@{
            id = $_.id; type = $_.fields.'System.WorkItemType'; state = $_.fields.'System.State'; title = $_.fields.'System.Title'
            assignedTo = $_.fields.'System.AssignedTo'.displayName; iteration = $_.fields.'System.IterationPath'
        }
    })
}

function Get-WorkItems([int[]]$Ids, [string]$Fields) {
    if (-not $Ids) { return @() }
    # One batch call caps at 200 ids, so larger lists go out in chunks.
    for ($i = 0; $i -lt $Ids.Count; $i += 200) {
        $chunk = $Ids[$i..([Math]::Min($i + 199, $Ids.Count - 1))]
        # errorPolicy=omit: a deleted or unreadable id comes back null instead of failing the whole batch.
        (Invoke-Ado -Uri "$api/wit/workitems?ids=$($chunk -join ',')&fields=$Fields&errorPolicy=omit&api-version=7.1").value
    }
}

function Get-WorkItemComments([int]$WorkItemId) {
    $comments = [Collections.Generic.List[object]]::new()
    $continuation = $null
    do {
        $page = "$api/wit/workItems/$WorkItemId/comments?`$top=200&order=asc&api-version=7.1-preview.4"
        if ($continuation) { $page += "&continuationToken=$([uri]::EscapeDataString($continuation))" }
        $response = Invoke-Ado -Uri $page
        if (-not $response) { break }
        $comments.AddRange(@($response.comments))
        $continuation = $response.continuationToken
    } while ($continuation)
    , $comments.ToArray()
}

function Invoke-Wiql([string]$Text) {
    $response = Invoke-Ado -Method POST -Uri "$api/wit/wiql?`$top=$Top&api-version=7.1" -Body @{ query = $Text }
    if (-not $response) { return , @() }
    $ids = @($response.workItems.id)
    # Stream 3, not stdout: the JSON stays parseable and the exit code stays 0.
    if ($ids.Count -eq $Top) { Write-Warning "$Verb returned exactly -Top $Top ids; results may be truncated. Raise -Top (max 200) or narrow the query." }
    # The batch GET returns items by id; restore the WIQL ORDER BY.
    ConvertTo-WorkItemRows (Get-WorkItems $ids 'System.Id,System.Title,System.State,System.WorkItemType,System.AssignedTo,System.IterationPath' | Sort-Object { [array]::IndexOf($ids, $_.id) })
}

function Select-FailedRecords($records) { , @($records | Where-Object { $_.result -eq 'failed' -and $_.type -eq 'Task' }) }

function ConvertTo-TimelineRows($records) {
    , @($records | ForEach-Object {
        [ordered]@{ id = $_.id; parentId = $_.parentId; type = $_.type; name = $_.name; result = $_.result; logId = $_.log.id; issues = $_.issues }
    })
}

# test/runs 400s unless min/max last-updated dates are both present and at most 7 days apart.
# Anchoring on the build's queue time (not "now") keeps runs from builds older than a week reachable.
function Get-TestRunWindow([datetime]$QueuedUtc) {
    $min = $QueuedUtc.ToUniversalTime().AddHours(-1)
    $min.ToString('o'), $min.AddDays(7).AddMinutes(-5).ToString('o')
}

# System comments are ADO's own event log (votes, pushes, status changes); a thread left with no human comment is dropped.
function ConvertTo-PrThreadRows($threads) {
    , @($threads | ForEach-Object {
        $comments = @($_.comments | Where-Object { $_.commentType -ne 'system' -and -not $_.isDeleted } | ForEach-Object {
            [ordered]@{ id = $_.id; parentCommentId = $_.parentCommentId; author = $_.author.displayName; published = $_.publishedDate; content = $_.content }
        })
        if ($comments) {
            [ordered]@{
                threadId = $_.id; status = $_.status; published = $_.publishedDate
                filePath = $_.threadContext.filePath; line = $_.threadContext.rightFileStart.line; comments = $comments
            }
        }
    } | Sort-Object { $_.published })
}

# Dot-sourced by ado.Tests.ps1 and the worklog for the helpers above: stop before dispatch.
if ($MyInvocation.InvocationName -eq '.') { return }

$repoApi = "$api/git/repositories/$([uri]::EscapeDataString($Repository))"

$result = switch ($Verb) {
    'wi-get' {
        $expand = if ($Relations) { '&$expand=relations' } else { '' }
        Invoke-Ado -Uri "$api/wit/workitems/$Id`?api-version=7.1$expand"
    }
    'wi-create' {
        $ops = New-WorkItemPatch -Type $Type -Title $Title -Set $Set -BodyText (Read-BodyFile)
        if ($Parent) { $ops += @{ op = 'add'; path = '/relations/-'; value = @{ rel = 'System.LinkTypes.Hierarchy-Reverse'; url = "$orgUrl/_apis/wit/workItems/$Parent" } } }
        Invoke-Ado -Method POST -Uri "$api/wit/workitems/`$$([uri]::EscapeDataString($Type))?api-version=7.1" -Body $ops -ContentType 'application/json-patch+json'
    }
    'wi-update' {
        $body = Read-BodyFile
        $itemType = $Type
        if ($body -and -not $FieldFromFile -and -not $itemType) {
            $itemType = (Invoke-Ado -Uri "$api/wit/workitems/$Id`?fields=System.WorkItemType&api-version=7.1").fields.'System.WorkItemType'
        }
        $ops = New-WorkItemPatch -Type $itemType -Set $Set -BodyText $body -BodyField $FieldFromFile
        Invoke-Ado -Method PATCH -Uri "$api/wit/workitems/$Id`?api-version=7.1" -Body $ops -ContentType 'application/json-patch+json'
    }
    'wi-link-branch' {
        $projectId, $repoId = Get-RepoIds
        Add-WorkItemRelation $Id @{ rel = 'ArtifactLink'; url = "vstfs:///Git/Ref/$projectId%2F$repoId%2FGB$Branch"; attributes = @{ name = 'Branch' } }
    }
    'wi-attach' {
        $fileName = [uri]::EscapeDataString((Split-Path -Leaf $File))
        $upload = Send-File "$api/wit/attachments?fileName=$fileName&api-version=7.1" $File
        $attachmentUrl = if ($upload) { $upload.url } else { '{attachmentUrl}' }
        Add-WorkItemRelation $Id @{ rel = 'AttachedFile'; url = $attachmentUrl }
    }
    'wi-batch' {
        if (-not $WorkItemIds) { Fail 'wi-batch failed: pass -Ids.' }
        $fieldList = if ($Fields) { $Fields -join ',' } else { 'System.Id,System.WorkItemType,System.Title,System.State,System.AssignedTo' }
        $items = @(Get-WorkItems $WorkItemIds $fieldList | Where-Object { $_ })
        $unread = @($WorkItemIds | Where-Object { $_ -notin $items.id })
        # Stream 3, not stdout: the JSON stays parseable.
        if ($unread -and -not $WhatIf) { Write-Warning "wi-batch could not read $($unread -join ', ') (deleted or no access)." }
        , @($items | ForEach-Object { [ordered]@{ id = $_.id; fields = $_.fields } })
    }
    'comment-list' { Get-WorkItemComments $Id }
    'comment-add' {
        Invoke-Ado -Method POST -Uri "$api/wit/workItems/$Id/comments?api-version=7.1-preview.4" -Body @{ text = (Read-BodyFile) }
    }
    'comment-edit' {
        Invoke-Ado -Method PATCH -Uri "$api/wit/workItems/$Id/comments/$CommentId`?api-version=7.1-preview.4" -Body @{ text = (Read-BodyFile) }
    }
    'download' {
        # Checked before any auth or network call, so the credential only ever goes to the org host.
        if (-not $Url.StartsWith("$orgUrl/", [StringComparison]::OrdinalIgnoreCase)) { Fail "download failed: -Url must start with '$orgUrl/'; the auth header is never sent to another host." }
        if (-not $OutFile) { Fail 'download failed: pass -OutFile.' }
        Invoke-Ado -Uri $Url -OutFile $OutFile | Out-Null
        if (-not $WhatIf) { @{ outFile = (Resolve-Path -LiteralPath $OutFile).Path } }
    }
    'pr-get' {
        $pull = Invoke-Ado -Uri "$api/git/pullrequests/$Pr`?api-version=7.1"
        if ($IncludeWorkItems -and $pull) {
            $refs = Invoke-Ado -Uri "$repoApi/pullRequests/$Pr/workitems?api-version=7.1"
            $pull | Add-Member -NotePropertyName workItemIds -NotePropertyValue @($refs.value | ForEach-Object { [int]$_.id })
        }
        $pull
    }
    'pr-comments' {
        $threads = Invoke-Ado -Uri "$repoApi/pullRequests/$Pr/threads?api-version=7.1"
        if (-not $threads) { , @(); break }
        ConvertTo-PrThreadRows $threads.value
    }
    'pr-comment-add' {
        $text = Read-BodyFile
        if (-not $text) { Fail 'pr-comment-add failed: pass -BodyFile.' }
        # status 1 = active, 2 = fixed (shown as Resolved); commentType 1 = text.
        $threadStatus = if ($Resolved) { 2 } else { 1 }
        Invoke-Ado -Method POST -Uri "$repoApi/pullRequests/$Pr/threads?api-version=7.1" -Body @{ comments = @(@{ parentCommentId = 0; content = $text; commentType = 1 }); status = $threadStatus }
    }
    'pr-list' {
        # Not $query: script-level locals share names with the typed params ([string]$Query) and get coerced.
        $filters = @("searchCriteria.status=$Status")
        if ($Source) { $filters += 'searchCriteria.sourceRefName=' + [uri]::EscapeDataString("refs/heads/$Source") }
        if ($Target) { $filters += 'searchCriteria.targetRefName=' + [uri]::EscapeDataString("refs/heads/$Target") }
        # ponytail: one page of 500 (the API default is 101); page with $skip if a list ever needs more.
        $response = Invoke-Ado -Uri "$repoApi/pullrequests?$($filters -join '&')&`$top=500&api-version=7.1"
        , @($response.value)
    }
    'pr-create' {
        $description = Read-BodyFile
        if ($description.Length -gt 4000) { Fail "pr-create failed: description is $($description.Length) characters; Azure DevOps caps it at 4000. Write the overflow to a file for the user to post as a PR comment." }
        $body = @{
            sourceRefName = "refs/heads/$Source"; targetRefName = "refs/heads/$Target"
            title = $Title; description = $description; isDraft = $true
            # foreach, not a pipeline: piping an unbound -WorkItems runs once with $null and sends an empty id.
            workItemRefs = @(foreach ($workItemId in $WorkItemIds) { @{ id = "$workItemId" } })
        }
        Invoke-Ado -Method POST -Uri "$repoApi/pullrequests?api-version=7.1" -Body $body
    }
    'pr-update' {
        $body = @{}
        if ($Title) { $body.title = $Title }
        $description = Read-BodyFile
        if ($description) {
            if ($description.Length -gt 4000) { Fail "pr-update failed: description is $($description.Length) characters; Azure DevOps caps it at 4000. Write the overflow to a file for the user to post as a PR comment." }
            $body.description = $description
        }
        if (-not $body.Count) { Fail 'pr-update failed: pass -Title and/or -BodyFile.' }
        Invoke-Ado -Method PATCH -Uri "$repoApi/pullrequests/$Pr`?api-version=7.1" -Body $body
    }
    'pr-link' {
        if (-not $WorkItemIds) { Fail 'pr-link failed: pass -WorkItems.' }
        $projectId, $repoId = Get-RepoIds
        , @($WorkItemIds | ForEach-Object {
            Add-WorkItemRelation $_ @{ rel = 'ArtifactLink'; url = (Get-PrArtifactUrl $projectId $repoId $Pr); attributes = @{ name = 'Pull Request' } }
        })
    }
    'pr-attach' {
        $fileName = [uri]::EscapeDataString((Split-Path -Leaf $File))
        Send-File "$repoApi/pullRequests/$Pr/attachments/$fileName`?api-version=7.1" $File
    }
    'wiql' {
        if ($QueryFile -and -not (Test-Path -LiteralPath $QueryFile)) { Fail "wiql failed: -QueryFile '$QueryFile' not found." }
        $text = if ($QueryFile) { [IO.File]::ReadAllText((Resolve-Path -LiteralPath $QueryFile), [Text.Encoding]::UTF8) } else { $Query }
        if (-not $text) { Fail 'wiql failed: pass -Query or -QueryFile.' }
        Invoke-Wiql $text
    }
    'query' {
        if (-not $NamedQueries.Contains($Name)) { Fail "query failed: unknown -Name '$Name'. Known: $($NamedQueries.Keys -join ', ')." }
        Invoke-Wiql $NamedQueries[$Name]
    }
    'build-find' {
        $definitions = Invoke-Ado -Uri "$api/build/definitions?name=$([uri]::EscapeDataString($Pipeline))&api-version=7.1"
        if (-not $definitions) { , @(); break }
        if (-not $definitions.value) { Fail "build-find failed: no pipeline named '$Pipeline'." }
        $builds = Invoke-Ado -Uri "$api/build/builds?definitions=$($definitions.value[0].id)&buildNumber=$([uri]::EscapeDataString($Run))&api-version=7.1"
        , @($builds.value)
    }
    'build-list' {
        if (-not $Branch) { Fail 'build-list failed: pass -Branch (a branch name, a refs/ ref, or a PR id).' }
        $ref = if ($Branch -match '^\d+$') { "refs/pull/$Branch/merge" } elseif ($Branch -like 'refs/*') { $Branch } else { "refs/heads/$Branch" }
        # -Top defaults to 200 for wiql; a build list wants the latest few.
        $count = if ($PSBoundParameters.ContainsKey('Top')) { $Top } else { 5 }
        $filters = "branchName=$([uri]::EscapeDataString($ref))&queryOrder=queueTimeDescending&`$top=$count"
        if ($Pipeline) {
            $definitions = Invoke-Ado -Uri "$api/build/definitions?name=$([uri]::EscapeDataString($Pipeline))&api-version=7.1"
            $definitionId = '{definitionId}'
            if (-not $WhatIf) {
                if (-not $definitions.value) { Fail "build-list failed: no pipeline named '$Pipeline'." }
                $definitionId = $definitions.value[0].id
            }
            $filters += "&definitions=$definitionId"
        }
        $builds = Invoke-Ado -Uri "$api/build/builds?$filters&api-version=7.1"
        if (-not $builds) { , @(); break }
        , @($builds.value | ForEach-Object {
            [ordered]@{
                id = $_.id; buildNumber = $_.buildNumber; pipeline = $_.definition.name; status = $_.status; result = $_.result
                sourceBranch = $_.sourceBranch; sourceVersion = $_.sourceVersion; queueTime = $_.queueTime; finishTime = $_.finishTime
            }
        })
    }
    'build-queue' {
        if (-not $Pipeline -or -not $Branch) { Fail 'build-queue failed: pass -Pipeline (its name) and -Branch.' }
        $ref = if ($Branch -like 'refs/*') { $Branch } else { "refs/heads/$Branch" }
        $definitions = Invoke-Ado -Uri "$api/build/definitions?name=$([uri]::EscapeDataString($Pipeline))&api-version=7.1"
        $definitionId = '{definitionId}'
        if (-not $WhatIf) {
            if (-not $definitions.value) { Fail "build-queue failed: no pipeline named '$Pipeline'." }
            $definitionId = $definitions.value[0].id
        }
        $b = Invoke-Ado -Method POST -Uri "$api/build/builds?api-version=7.1" -Body @{ definition = @{ id = $definitionId }; sourceBranch = $ref }
        if ($b) { [ordered]@{ id = $b.id; buildNumber = $b.buildNumber; pipeline = $b.definition.name; status = $b.status; sourceBranch = $b.sourceBranch; url = $b._links.web.href } }
    }
    'build-get' {
        $b = Invoke-Ado -Uri "$api/build/builds/$Build`?api-version=7.1"
        if ($b) {
            $definition = Invoke-Ado -Uri "$api/build/definitions/$($b.definition.id)?api-version=7.1"
            $b | Add-Member -NotePropertyName yamlFilename -NotePropertyValue $definition.process.yamlFilename
        }
        $b
    }
    'build-timeline' {
        $timeline = Invoke-Ado -Uri "$api/build/builds/$Build/timeline?api-version=7.1"
        $records = if ($Failed) { Select-FailedRecords $timeline.records } else { $timeline.records }
        ConvertTo-TimelineRows $records
    }
    'build-log' {
        if (-not $OutFile) { Fail 'build-log failed: pass -OutFile.' }
        Invoke-Ado -Uri "$api/build/builds/$Build/logs/$Log`?api-version=7.1" -OutFile $OutFile | Out-Null
        if (-not $WhatIf) { @{ outFile = (Resolve-Path -LiteralPath $OutFile).Path } }
    }
    'test-results' {
        $b = Invoke-Ado -Uri "$api/build/builds/$Build`?api-version=7.1"
        $queued = if ($b) { [datetime]$b.queueTime } else { [datetime]::UtcNow.AddDays(-1) }
        $min, $max = Get-TestRunWindow $queued
        # With a date window this route filters on buildIds; it silently ignores buildUri.
        $runs = Invoke-Ado -Uri "$api/test/runs?buildIds=$Build&minLastUpdatedDate=$([uri]::EscapeDataString($min))&maxLastUpdatedDate=$([uri]::EscapeDataString($max))&api-version=7.1"
        if (-not $runs) { , @(); break }
        $outcomeFilter = if ($Failed) { '&outcomes=Failed' } else { '' }
        , @($runs.value | Where-Object { -not $Name -or $_.name -like $Name } | ForEach-Object {
            $testRun = $_
            # The results route returns at most 1000 per call; page with $skip until a short page.
            $results = [Collections.Generic.List[object]]::new()
            do {
                $response = Invoke-Ado -Uri "$api/test/runs/$($testRun.id)/results?`$top=1000&`$skip=$($results.Count)$outcomeFilter&api-version=7.1"
                $page = @()
                if ($response) { $page = @($response.value) }
                $results.AddRange($page)
            } while ($page.Count -eq 1000)
            [ordered]@{
                runId = $testRun.id; runName = $testRun.name
                results = @($results | ForEach-Object {
                    $attachments = @()
                    if ($_.outcome -ne 'Passed') { $attachments = (Invoke-Ado -Uri "$api/test/runs/$($testRun.id)/results/$($_.id)/attachments?api-version=7.1").value }
                    [ordered]@{
                        id = $_.id; name = $_.automatedTestName; outcome = $_.outcome; errorMessage = $_.errorMessage
                        attachments = @($attachments | ForEach-Object { [ordered]@{ id = $_.id; fileName = $_.fileName; url = $_.url } })
                    }
                })
            }
        })
    }
    default {
        $lines = Get-Content -LiteralPath $PSCommandPath
        Write-Host ($lines[0..($lines.IndexOf('param(') - 1)] -join "`n")
        exit 2
    }
}

if (-not $WhatIf) { Out-Json $result }
exit 0
