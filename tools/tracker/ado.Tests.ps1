# Self-check for ado.ps1. Run: pwsh -NoProfile -File tools/tracker/ado.Tests.ps1
# Request shapes are checked through -WhatIf (no network, no credentials); pure helpers by dot-sourcing.
$ErrorActionPreference = 'Stop'
$ado = Join-Path $PSScriptRoot 'ado.ps1'
$tmp = Join-Path ([IO.Path]::GetTempPath()) "ado-tests-$PID"
New-Item -ItemType Directory -Force $tmp | Out-Null
$script:fails = 0
# Invented names; the helper has no defaults, so every call below reads these.
$env:ORC_ADO_ORG = 'contoso'; $env:ORC_ADO_PROJECT = 'AcmeApp'; $env:ORC_ADO_REPO = 'AcmeApp'
$orgPrefix = "https://dev.azure.com/$($env:ORC_ADO_ORG)/"

# Hashtable splatting only: an array's '-Id' strings bind positionally, not as parameter names.
function Invoke-Helper([hashtable]$params) {
    $global:LASTEXITCODE = 0
    $out = & $ado @params 6>&1 2>&1
    [pscustomobject]@{ Code = $LASTEXITCODE; Lines = @($out | ForEach-Object { "$_" }) }
}
function Get-Requests([hashtable]$params) {
    $r = Invoke-Helper ($params + @{ WhatIf = $true })
    if ($r.Code) { throw "exit $($r.Code): $($r.Lines -join ' | ')" }
    , @($r.Lines | Where-Object { $_ -like '{*' } | ForEach-Object { $_ | ConvertFrom-Json -Depth 20 })
}
function Check([string]$name, [scriptblock]$test) {
    try { if (& $test) { "PASS $name" } else { "FAIL $name"; $script:fails++ } }
    catch { "FAIL $name -- $_"; $script:fails++ }
}
function New-BodyFile([string]$text) {
    $p = Join-Path $tmp ([guid]::NewGuid().ToString() + '.txt')
    [IO.File]::WriteAllText($p, $text, [Text.UTF8Encoding]::new($false))
    $p
}

$tricky = "Line one $([char]0x2014) em dash`n$([char]0x201C)quoted$([char]0x201D) line two"

# --- configuration (no defaults)
Check 'no organization, project or repository: exit 1 naming each, before any request' {
    $saved = $env:ORC_ADO_ORG, $env:ORC_ADO_PROJECT, $env:ORC_ADO_REPO
    try { $env:ORC_ADO_ORG = $null; $env:ORC_ADO_PROJECT = $null; $env:ORC_ADO_REPO = $null; $r = Invoke-Helper @{ Verb = 'wi-get'; Id = 1; WhatIf = $true } }
    finally { $env:ORC_ADO_ORG, $env:ORC_ADO_PROJECT, $env:ORC_ADO_REPO = $saved }
    $text = $r.Lines -join ' '
    $r.Code -eq 1 -and $text -like '*-Organization (or ORC_ADO_ORG), -Project (or ORC_ADO_PROJECT), -Repository (or ORC_ADO_REPO)*no defaults*' -and -not ($r.Lines | Where-Object { $_ -like '{*' })
}
Check 'parameters win over the environment' {
    $r = Get-Requests @{ Verb = 'pr-list'; Organization = 'fabrikam'; Project = 'Other'; Repository = 'Repo2' }
    $r[0].uri -like '*.com/fabrikam/Other/_apis/git/repositories/Repo2/pullrequests?*'
}
Check 'a missing repository alone is named alone' {
    $saved = $env:ORC_ADO_REPO
    try { $env:ORC_ADO_REPO = ''; $r = Invoke-Helper @{ Verb = 'wi-get'; Id = 1; WhatIf = $true } }
    finally { $env:ORC_ADO_REPO = $saved }
    $text = $r.Lines -join ' '
    $r.Code -eq 1 -and $text -like '*no Azure DevOps -Repository (or ORC_ADO_REPO).*' -and $text -notlike '*ORC_ADO_ORG*'
}

# --- pure helpers
. $ado
Check 'Test-HtmlResponse flags a sign-in page' { (Test-HtmlResponse '<!DOCTYPE html><html>sign in</html>') -and -not (Test-HtmlResponse ([pscustomobject]@{ id = 1 })) }
Check 'New-WorkItemPatch splits Set on the first =' {
    $ops = New-WorkItemPatch -Type 'Task' -Set 'System.State=Active', 'Custom.X=a=b'
    ($ops | Where-Object path -eq '/fields/Custom.X').value -eq 'a=b'
}
Check 'Test-HtmlFile flags a sign-in page saved under a non-markup name only' {
    $report = Join-Path $tmp 'report.html'; Set-Content -LiteralPath $report '<html/>'
    (Test-HtmlFile (New-BodyFile "`r`n <!DOCTYPE html><html>sign in</html>")) -and -not (Test-HtmlFile (New-BodyFile '2026-09-24T20:11:01Z ##[section]Starting')) -and
        -not (Test-HtmlFile (New-BodyFile '')) -and -not (Test-HtmlFile $report)
}
Check 'Invoke-Wiql warns on stream 3 only when the id count hits -Top' {
    function Invoke-Ado { param($Method, $Uri, $Body)
        if ($Uri -like '*/wiql?*') { [pscustomobject]@{ workItems = @(1..3 | ForEach-Object { [pscustomobject]@{ id = $_ } }) } } else { [pscustomobject]@{ value = @() } } }
    $Top = 3; $hit = @(Invoke-Wiql 'q' 3>&1 | Where-Object { $_ -is [Management.Automation.WarningRecord] })
    $Top = 4; $miss = @(Invoke-Wiql 'q' 3>&1 | Where-Object { $_ -is [Management.Automation.WarningRecord] })
    $hit.Count -eq 1 -and "$($hit[0])" -like '*-Top 3*truncated*' -and $miss.Count -eq 0
}

# --- work items
Check 'wi-get -Relations expands relations' {
    $r = Get-Requests @{ Verb = 'wi-get'; Id = 5; Relations = $true }
    $r.Count -eq 1 -and $r[0].method -eq 'GET' -and $r[0].uri -like '*/_apis/wit/workitems/5?*$expand=relations*'
}
Check 'wi-create Bug routes body to ReproSteps byte-identical' {
    $r = Get-Requests @{ Verb = 'wi-create'; Type = 'Bug'; Title = 'T'; BodyFile = (New-BodyFile $tricky) }
    $op = $r[0].body | Where-Object path -eq '/fields/Microsoft.VSTS.TCM.ReproSteps'
    $r[0].method -eq 'POST' -and $r[0].uri -like '*/wit/workitems/$Bug?*' -and $r[0].contentType -eq 'application/json-patch+json' -and $op.value -ceq $tricky
}
Check 'wi-create User Story encodes the type and uses Description' {
    $r = Get-Requests @{ Verb = 'wi-create'; Type = 'User Story'; Title = 'T'; BodyFile = (New-BodyFile 'x') }
    $r[0].uri -like '*/wit/workitems/$User%20Story?*' -and ($r[0].body.path -contains '/fields/System.Description')
}
Check 'wi-create -Parent adds a Hierarchy-Reverse relation' {
    $r = Get-Requests @{ Verb = 'wi-create'; Type = 'Task'; Title = 'T'; Parent = 9 }
    $rel = ($r[0].body | Where-Object path -eq '/relations/-').value
    $rel.rel -eq 'System.LinkTypes.Hierarchy-Reverse' -and $rel.url -like '*/_apis/wit/workItems/9'
}
Check 'wi-update -FieldFromFile targets the named field' {
    $r = Get-Requests @{ Verb = 'wi-update'; Id = 5; FieldFromFile = 'Microsoft.VSTS.Common.AcceptanceCriteria'; BodyFile = (New-BodyFile 'ac') }
    $r[-1].method -eq 'PATCH' -and ($r[-1].body | Where-Object path -eq '/fields/Microsoft.VSTS.Common.AcceptanceCriteria').value -eq 'ac'
}
Check 'wi-update -Type Bug -BodyFile goes to ReproSteps without a lookup' {
    $r = Get-Requests @{ Verb = 'wi-update'; Id = 5; Type = 'Bug'; BodyFile = (New-BodyFile 'x') }
    $r.Count -eq 1 -and ($r[0].body.path -contains '/fields/Microsoft.VSTS.TCM.ReproSteps')
}
Check 'wi-update -Set without = exits 1 before sending' {
    $r = Invoke-Helper @{ Verb = 'wi-update'; Id = 5; Set = 'System.State'; WhatIf = $true }
    $r.Code -eq 1 -and ($r.Lines -join ' ') -like "*-Set 'System.State' has no '='*" -and -not ($r.Lines | Where-Object { $_ -like '{*' })
}
Check 'wi-update -Set Ref= sends an empty string' {
    $r = Get-Requests @{ Verb = 'wi-update'; Id = 5; Set = 'System.Tags=' }
    ($r[0].body | Where-Object path -eq '/fields/System.Tags').value -ceq ''
}
Check 'wi-link-branch builds the vstfs Git ref' {
    $r = Get-Requests @{ Verb = 'wi-link-branch'; Id = 5; Branch = 'feature/1-x' }
    $v = ($r[-1].body | Where-Object path -eq '/relations/-').value
    $v.rel -eq 'ArtifactLink' -and $v.url -eq 'vstfs:///Git/Ref/{projectId}%2F{repoId}%2FGBfeature/1-x' -and $v.attributes.name -eq 'Branch'
}
Check 'wi-attach uploads bytes then links AttachedFile' {
    $r = Get-Requests @{ Verb = 'wi-attach'; Id = 5; File = (New-BodyFile 'abc') }
    $r[0].method -eq 'POST' -and $r[0].uri -like '*/wit/attachments?fileName=*' -and $r[0].body -eq '<3 bytes>' -and $r[0].contentType -eq 'application/octet-stream'
}
Check 'wi-batch reads the default fields in one batch call' {
    $r = Get-Requests @{ Verb = 'wi-batch'; Ids = 1, 2 }
    $r.Count -eq 1 -and $r[0].method -eq 'GET' -and $r[0].uri -like '*/wit/workitems?ids=1,2&fields=System.Id,System.WorkItemType,System.Title,System.State,System.AssignedTo&errorPolicy=omit&*'
}
Check 'wi-batch -Fields replaces the default fields' {
    $r = Get-Requests @{ Verb = 'wi-batch'; Ids = 1; Fields = 'System.Title', 'System.Tags' }
    $r[0].uri -like '*&fields=System.Title,System.Tags&*'
}
Check 'Get-WorkItems reads more than 200 ids in chunks of 200' {
    $r = Get-Requests @{ Verb = 'wi-batch'; Ids = 1..401 }
    $r.Count -eq 3 -and $r[0].uri -like '*ids=1,*,200&*' -and $r[2].uri -like '*ids=401&*'
}

# --- comments
Check 'comment-add posts text byte-identical on 7.1-preview.4' {
    $r = Get-Requests @{ Verb = 'comment-add'; Id = 5; BodyFile = (New-BodyFile $tricky) }
    $r[0].method -eq 'POST' -and $r[0].uri -like '*/wit/workItems/5/comments?api-version=7.1-preview.4' -and $r[0].body.text -ceq $tricky
}
Check 'comment-edit patches the comment id' {
    $r = Get-Requests @{ Verb = 'comment-edit'; Id = 5; CommentId = 77; BodyFile = (New-BodyFile 'x') }
    $r[0].method -eq 'PATCH' -and $r[0].uri -like '*/wit/workItems/5/comments/77?*'
}

# --- pull requests
Check 'pr-create is always a draft, links work items, keeps a / in the title' {
    $r = Get-Requests @{ Verb = 'pr-create'; Source = 'feature/1-x'; Target = 'main'; Title = '#1 - Fix a/b handling'; BodyFile = (New-BodyFile $tricky); WorkItems = 1, 2 }
    $b = $r[0].body
    $r[0].method -eq 'POST' -and $r[0].uri -like '*/git/repositories/AcmeApp/pullrequests?api-version=7.1' -and
        $b.isDraft -eq $true -and $b.sourceRefName -eq 'refs/heads/feature/1-x' -and $b.targetRefName -eq 'refs/heads/main' -and
        $b.title -ceq '#1 - Fix a/b handling' -and $b.description -ceq $tricky -and (@($b.workItemRefs.id) -join ',') -eq '1,2'
}
Check 'pr-create rejects a description over 4000 characters before sending' {
    $r = Invoke-Helper @{ Verb = 'pr-create'; Source = 'a'; Target = 'b'; Title = 't'; BodyFile = (New-BodyFile ('x' * 4001)); WhatIf = $true }
    $r.Code -eq 1 -and ($r.Lines -join ' ') -like '*4000*' -and -not ($r.Lines | Where-Object { $_ -like '{*' })
}
Check 'pr-create without -WorkItems sends no work item refs' {
    $r = Get-Requests @{ Verb = 'pr-create'; Source = 'a'; Target = 'b'; Title = 't'; BodyFile = (New-BodyFile 'x') }
    @($r[0].body.workItemRefs).Count -eq 0
}
Check 'pr-link without -WorkItems exits 1 before sending' {
    $r = Invoke-Helper @{ Verb = 'pr-link'; Pr = 3; WhatIf = $true }
    $r.Code -eq 1 -and ($r.Lines -join ' ') -like '*pass -WorkItems*' -and -not ($r.Lines | Where-Object { $_ -like '{*' })
}
Check 'pr-update patches only what was given' {
    $r = Get-Requests @{ Verb = 'pr-update'; Pr = 3; Title = 'New' }
    $r[0].method -eq 'PATCH' -and $r[0].uri -like '*/pullrequests/3?*' -and $r[0].body.title -eq 'New' -and -not ($r[0].body.PSObject.Properties.Name -contains 'description')
}
Check 'pr-link adds one PullRequestId artifact per work item' {
    $r = Get-Requests @{ Verb = 'pr-link'; Pr = 3; WorkItems = 1, 2 }
    $urls = @($r | Where-Object method -eq 'PATCH' | ForEach-Object { ($_.body | Where-Object path -eq '/relations/-').value.url })
    $urls.Count -eq 2 -and $urls[0] -eq 'vstfs:///Git/PullRequestId/{projectId}%2F{repoId}%2F3'
}
Check 'pr-attach posts bytes to the PR attachments route' {
    $r = Get-Requests @{ Verb = 'pr-attach'; Pr = 3; File = (New-BodyFile 'abcd') }
    $r[0].method -eq 'POST' -and $r[0].uri -like '*/pullRequests/3/attachments/*.txt?api-version=7.1' -and $r[0].body -eq '<4 bytes>'
}
Check 'pr-comments is a single GET of the PR threads' {
    $r = Get-Requests @{ Verb = 'pr-comments'; Pr = 3 }
    $r.Count -eq 1 -and $r[0].method -eq 'GET' -and $r[0].uri -like '*/git/repositories/AcmeApp/pullRequests/3/threads?api-version=7.1'
}
Check 'pr-comment-add posts one active top-level thread with the body file text' {
    $r = Get-Requests @{ Verb = 'pr-comment-add'; Pr = 3; BodyFile = (New-BodyFile $tricky) }
    $r.Count -eq 1 -and $r[0].method -eq 'POST' -and $r[0].uri -like '*/pullRequests/3/threads?api-version=7.1' -and
        $r[0].body.status -eq 1 -and $r[0].body.comments[0].parentCommentId -eq 0 -and $r[0].body.comments[0].content -eq $tricky
}
Check 'pr-comment-add -Resolved posts the thread already Resolved (status fixed)' {
    $r = Get-Requests @{ Verb = 'pr-comment-add'; Pr = 3; BodyFile = (New-BodyFile 'done'); Resolved = $true }
    $r.Count -eq 1 -and $r[0].body.status -eq 2 -and $r[0].body.comments[0].content -eq 'done'
}
Check 'pr-comment-add without -BodyFile fails before any request' {
    $r = Invoke-Helper @{ Verb = 'pr-comment-add'; Pr = 3; WhatIf = $true }
    $r.Code -eq 1 -and -not ($r.Lines | Where-Object { $_ -like '{*' })
}
$comment = { param($id, $type, $deleted) [pscustomobject]@{ id = $id; parentCommentId = 0; commentType = $type; isDeleted = $deleted; author = [pscustomobject]@{ displayName = 'A' }; publishedDate = '2026-09-01'; content = "c$id" } }
$thread = { param($id, $published, $comments, $context) [pscustomobject]@{ id = $id; status = 'active'; publishedDate = $published; threadContext = $context; comments = $comments } }
Check 'ConvertTo-PrThreadRows drops system and deleted comments, empty threads, and sorts oldest first' {
    $context = [pscustomobject]@{ filePath = '/a.cs'; rightFileStart = [pscustomobject]@{ line = 12 } }
    $rows = ConvertTo-PrThreadRows @(
        (& $thread 1 '2026-09-03' @((& $comment 1 'text' $false), (& $comment 2 'system' $false), (& $comment 3 'text' $true)) $context),
        (& $thread 2 '2026-09-02' @((& $comment 4 'system' $false)) $null),
        (& $thread 3 '2026-09-01' @((& $comment 5 'text' $false)) $null))
    (@($rows.threadId) -join ',') -eq '3,1' -and (@($rows[1].comments.id) -join ',') -eq '1' -and
        $rows[1].filePath -eq '/a.cs' -and $rows[1].line -eq 12 -and $rows[1].comments[0].author -eq 'A' -and $null -eq $rows[0].filePath
}
Check 'ConvertTo-PrThreadRows of nothing or one thread is a JSON array' {
    $none = ConvertTo-PrThreadRows @(); $one = ConvertTo-PrThreadRows @(& $thread 1 '2026-09-01' @((& $comment 1 'text' $false)) $null)
    (Out-Json $none) -eq '[]' -and (Out-Json $one).TrimStart().StartsWith('[')
}
Check 'pr-list filters by refs and status' {
    $r = Get-Requests @{ Verb = 'pr-list'; Source = 'feature/1-x'; Target = 'main' }
    $r[0].uri -like '*&searchCriteria.sourceRefName=refs%2Fheads%2Ffeature%2F1-x&*' -and $r[0].uri -like '*&searchCriteria.targetRefName=refs%2Fheads%2Fmain&*' -and $r[0].uri -like '*?searchCriteria.status=active&*' -and $r[0].uri -like '*&$top=500&*'
}

# --- queries
Check 'Invoke-Ado names the cause when no HTTP response came back' {
    function Fail([string]$message) { throw $message }
    function Get-AuthHeader { @{ Authorization = 'Bearer test' } }
    $message = try { Invoke-Ado -Uri 'http://127.0.0.1:1/'; '' } catch { "$_" }
    $message -like '*http://127.0.0.1:1/ -> ?*' -and $message -notlike '*-> HTTP *'
}
Check 'ConvertTo-WorkItemRows of nothing is an empty array' { $rows = ConvertTo-WorkItemRows @(); (Out-Json @($rows)) -eq '[]' }
Check 'query mine-active posts its WIQL' {
    $r = Get-Requests @{ Verb = 'query'; Name = 'mine-active' }
    $r[0].method -eq 'POST' -and $r[0].uri -like '*/wit/wiql?$top=200&api-version=7.1' -and $r[0].body.query -like '*@Me*Active*'
}
Check 'query with an unknown name exits 1 and lists the names' {
    $r = Invoke-Helper @{ Verb = 'query'; Name = 'sprint'; WhatIf = $true }
    $r.Code -eq 1 -and ($r.Lines -join ' ') -like "*unknown -Name 'sprint'. Known: mine-active.*"
}
Check 'wiql with a missing -QueryFile names the file' {
    $r = Invoke-Helper @{ Verb = 'wiql'; QueryFile = (Join-Path $tmp 'nope.wiql'); WhatIf = $true }
    $r.Code -eq 1 -and ($r.Lines -join ' ') -like "*-QueryFile '*nope.wiql' not found*"
}

# --- pipelines and tests
$rec = { param($id, $type, $result) [pscustomobject]@{ id = $id; parentId = 'p'; type = $type; name = "n$id"; result = $result; log = [pscustomobject]@{ id = 7 }; issues = @() } }
Check 'Select-FailedRecords keeps failed Tasks only' {
    $rows = Select-FailedRecords @((& $rec 'a' 'Task' 'failed'), (& $rec 'b' 'Job' 'failed'), (& $rec 'c' 'Task' 'succeeded'))
    (@($rows.id) -join ',') -eq 'a'
}
Check 'ConvertTo-TimelineRows flattens log.id' { (ConvertTo-TimelineRows @(& $rec 'a' 'Task' 'failed'))[0].logId -eq 7 }
Check 'Get-TestRunWindow stays under 7 days and starts before the queue time' {
    $queued = [datetime]::new(2026, 9, 1, 12, 0, 0, [DateTimeKind]::Utc)
    $min, $max = Get-TestRunWindow $queued
    $span = [datetime]::Parse($max).ToUniversalTime() - [datetime]::Parse($min).ToUniversalTime()
    $span -lt [timespan]::FromDays(7) -and [datetime]::Parse($min).ToUniversalTime() -lt $queued
}
Check 'build-find looks the pipeline up by name' {
    $r = Get-Requests @{ Verb = 'build-find'; Pipeline = 'AcmeApp CI'; Run = '20260924.3' }
    $r[0].uri -like '*/build/definitions?name=AcmeApp%20CI*'
}
Check 'build-list expands a PR id to its merge ref and defaults to the latest 5' {
    $r = Get-Requests @{ Verb = 'build-list'; Branch = '42' }
    $r.Count -eq 1 -and $r[0].uri -like '*/build/builds?branchName=refs%2Fpull%2F42%2Fmerge&queryOrder=queueTimeDescending&$top=5&api-version=7.1'
}
Check 'build-list expands a bare branch, keeps a refs/ ref, and honors -Top' {
    $bare = Get-Requests @{ Verb = 'build-list'; Branch = 'feature/1-x'; Top = 2 }
    $full = Get-Requests @{ Verb = 'build-list'; Branch = 'refs/heads/main' }
    $bare[0].uri -like '*branchName=refs%2Fheads%2Ffeature%2F1-x&*&$top=2&*' -and $full[0].uri -like '*branchName=refs%2Fheads%2Fmain&*'
}
Check 'build-list -Pipeline resolves the definition by name and filters on it' {
    $r = Get-Requests @{ Verb = 'build-list'; Branch = 'main'; Pipeline = 'AcmeApp - main' }
    $r.Count -eq 2 -and $r[0].uri -like '*/build/definitions?name=AcmeApp%20-%20main&*' -and $r[1].uri -like '*&definitions={definitionId}&*'
}
Check 'build-queue resolves the definition by name and posts a run on the branch ref' {
    $r = Get-Requests @{ Verb = 'build-queue'; Pipeline = 'AcmeApp CI'; Branch = 'main' }
    $r.Count -eq 2 -and $r[0].uri -like '*/build/definitions?name=AcmeApp%20CI&*' -and $r[1].method -eq 'POST' -and $r[1].uri -like '*/build/builds?api-version=7.1' `
        -and $r[1].body.sourceBranch -eq 'refs/heads/main' -and $r[1].body.definition.id -eq '{definitionId}'
}
Check 'build-log writes to the out file' {
    $r = Get-Requests @{ Verb = 'build-log'; Build = 9; Log = 4; OutFile = (Join-Path $tmp 'l.txt') }
    $r[0].uri -like '*/build/builds/9/logs/4?api-version=7.1'
}
Check 'build-log and download without -OutFile exit 1 before sending' {
    $log = Invoke-Helper @{ Verb = 'build-log'; Build = 9; Log = 4; WhatIf = $true }
    $dl = Invoke-Helper @{ Verb = 'download'; Url = "$($orgPrefix)x"; WhatIf = $true }
    $log.Code -eq 1 -and ($log.Lines -join ' ') -like '*build-log failed: pass -OutFile*' -and -not ($log.Lines | Where-Object { $_ -like '{*' }) -and
        $dl.Code -eq 1 -and ($dl.Lines -join ' ') -like '*download failed: pass -OutFile*' -and -not ($dl.Lines | Where-Object { $_ -like '{*' })
}
Check 'test-results sends a bounded date window' {
    $r = Get-Requests @{ Verb = 'test-results'; Build = 9 }
    $runs = $r | Where-Object uri -like '*/test/runs?*'
    $runs.uri -like '*?buildIds=9&*' -and $runs.uri -like '*minLastUpdatedDate=*' -and $runs.uri -like '*maxLastUpdatedDate=*'
}

# --- exit codes
Check 'missing credential exits 1 with the named message' {
    $savedPath = $env:PATH; $savedPat = $env:AZURE_DEVOPS_EXT_PAT
    try { $env:PATH = $PSHOME; $env:AZURE_DEVOPS_EXT_PAT = $null; $r = Invoke-Helper @{ Verb = 'wi-get'; Id = 1 } }
    finally { $env:PATH = $savedPath; $env:AZURE_DEVOPS_EXT_PAT = $savedPat }
    $r.Code -eq 1 -and ($r.Lines -join ' ') -like "*No ADO credential: run 'az login' or set AZURE_DEVOPS_EXT_PAT.*"
}
Check 'download refuses a non-org host before any auth or network call' {
    $savedPath = $env:PATH; $savedPat = $env:AZURE_DEVOPS_EXT_PAT
    try { $env:PATH = $PSHOME; $env:AZURE_DEVOPS_EXT_PAT = $null; $r = Invoke-Helper @{ Verb = 'download'; Url = 'https://evil.example/x'; OutFile = (Join-Path $tmp 'evil.bin') } }
    finally { $env:PATH = $savedPath; $env:AZURE_DEVOPS_EXT_PAT = $savedPat }
    $text = $r.Lines -join ' '
    $r.Code -eq 1 -and $text -like "*-Url must start with '$orgPrefix'*" -and $text -notlike '*No ADO credential*' -and -not (Test-Path (Join-Path $tmp 'evil.bin'))
}
Check 'unknown verb exits 2 with usage' { $r = Invoke-Helper @{ Verb = 'nope' }; $r.Code -eq 2 -and ($r.Lines -join ' ') -like '*Usage*' }
Check 'removed verbs are unknown (exit 2), not silently accepted' {
    @('release-note-check', 'pr-unlink', 'testpoint-list', 'wiki-get') | ForEach-Object { (Invoke-Helper @{ Verb = $_; WhatIf = $true }).Code } | Where-Object { $_ -ne 2 } | Measure-Object | ForEach-Object { $_.Count -eq 0 }
}
Check '-WhatIf output never carries a credential' {
    $r = Invoke-Helper @{ Verb = 'wi-get'; Id = 5; WhatIf = $true }
    -not (($r.Lines -join ' ') -match 'Authorization|Bearer|Basic ')
}

Remove-Item -Recurse -Force $tmp
if ($script:fails) { "$script:fails FAILED"; exit 1 } else { 'ALL PASS'; exit 0 }
