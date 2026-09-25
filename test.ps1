# Self-check for log-event.ps1 and worklog.ps1, no Pester. Runs under pwsh and Windows PowerShell 5.1:
#   pwsh -NoProfile -File test.ps1   /   powershell -NoProfile -File test.ps1
# Uses a temp WORKLOG_DIR and a temp git repo on feature/12351-x; never touches ~/.claude/worklog.
$ErrorActionPreference = "Stop"
$fails = 0
function Check($name, $ok) { if ($ok) { "ok   $name" } else { "FAIL $name"; $script:fails++ } }
# Row fields: 0 start, 1 end, 2 hours, 3 ticket, 4 description, 5 type.
function Rows($out) { @($out | Where-Object { $_ -match '^\s*(\d{1,2}:\d\d [AP]M)\s+(\d{1,2}:\d\d [AP]M)\s+(\S+)\s+(\S+)\s+(User Story|\S+)\s+(.*)$' } | ForEach-Object { , @($Matches[1], $Matches[2], $Matches[3], $Matches[4], $Matches[6], $Matches[5]) }) }

$dir = Join-Path ([IO.Path]::GetTempPath()) "worklog-test-$([guid]::NewGuid())"
$repo = Join-Path $dir "repo"
New-Item -ItemType Directory $repo | Out-Null
git -C $repo init -q -b feature/12351-x
$env:GIT_COMMITTER_DATE = $env:GIT_AUTHOR_DATE = "2026-01-01T09:10:00"
git -C $repo config user.name t; git -C $repo config user.email t@t
git -C $repo commit -q --allow-empty -m "Fixture commit"
git -C $repo -c user.email=other@t commit -q --allow-empty -m "Someone else's commit"
Remove-Item Env:GIT_COMMITTER_DATE, Env:GIT_AUTHOR_DATE
$env:WORKLOG_DIR = $dir
$env:WORKLOG_NOSUMMARY = "1"
$env:WORKLOG_DISABLE = $null
$exe = (Get-Process -Id $PID).Path  # hooks run under the same PowerShell as this test

# --- log-event.ps1: pipe hook JSON for each kind, then check the CSV lines ---
function Hook($kind, $obj) {
    $obj.session_id = "s1"; $obj.cwd = $repo
    ($obj | ConvertTo-Json -Compress) | & $exe -NoProfile -NonInteractive -File "$PSScriptRoot\log-event.ps1" -Kind $kind
    Check "hook $kind exits 0" ($LASTEXITCODE -eq 0)
}
$long = "Start work " + ("x" * 300)
Hook prompt @{ prompt = $long }
Hook prompt @{ prompt = "<task-notification> notify-secret" }
Hook tool @{ tool_name = "Bash"; tool_input = @{ command = "az boards work-item show --id 17400" } }
Hook prompt @{ prompt = "check the show result" }
Hook tool @{ tool_name = "PowerShell"; tool_input = @{ command = "cd x; az boards work-item update --id 17393 --state Active" } }
Hook prompt @{ prompt = "keep going" }
Hook tool @{ tool_name = "Agent"; tool_input = @{ description = "Find call sites"; subagent_type = "scout" } }
Hook tool @{ tool_name = "Bash"; tool_input = @{ command = "dotnet build" } }
Hook tool @{ tool_name = "Read"; tool_input = @{ file_path = "x" } }
Hook stop @{}
Hook prompt @{ prompt = "PET-12333, other thing" }
$env:WORKLOG_DISABLE = "1"; Hook prompt @{ prompt = "guarded" }; $env:WORKLOG_DISABLE = $null
Hook tool @{ tool_name = "Bash"; tool_input = @{ command = "sed -i 's|az/agent capture|x|' README.md; grep -n `"az \|curl`" f" } }
Hook tool @{ tool_name = "Bash"; tool_input = @{ command = "git commit -m `"Log az commands`"" } }
Hook tool @{ tool_name = "PowerShell"; tool_input = @{ command = "`$prs = az repos pr list --status active" } }
Hook tool @{ tool_name = "PowerShell"; tool_input = @{ command = "`$t = az account get-access-token --query accessToken -o tsv`nInvoke-RestMethod -Method Patch -Uri https://x/_apis/wit/workitems/17458" } }
Hook tool @{ tool_name = "Bash"; tool_input = @{ command = "az boards work-item show --id 17401; git commit -m `"update docs`"" } }

$today = (Get-Date).ToString("yyyy-MM-dd")
$csv = @(Get-Content (Join-Path $dir "$today.csv") | ForEach-Object { $p = $_ -split ',', 6; "$($p[1]),$($p[2]),$($p[5])" })
Check "12 lines logged (non-az Bash, Read, guarded prompt, az-as-a-word skipped)" ($csv.Count -eq 12)
Check "az after = is logged, read-only" ($csv[9] -eq "az,PET-12333,az repos pr list --status active")
Check "REST PATCH after az token is explicit" ($csv[10] -like "az,PET-17458*,az account get-access-token*")
Check "mutating word outside the az segment is not explicit" ($csv[11] -like "az,PET-17458,az boards work-item show --id 17401*")
Check "prompt from branch, text cut to 200" ($csv[0] -eq "prompt,PET-12351,$($long.Substring(0, 200))")
Check "notification logged as notify, no text" ($csv[1] -eq "notify,PET-12351,")
Check "read-only az keeps branch ticket" ($csv[2] -eq "az,PET-12351,az boards work-item show --id 17400")
Check "prompt after read-only az stays 12351" ($csv[3] -eq "prompt,PET-12351,check the show result")
Check "mutating az is explicit, text from az onward" ($csv[4] -eq "az,PET-17393*,az boards work-item update --id 17393 --state Active")
Check "explicit az ticket beats branch" ($csv[5] -eq "prompt,PET-17393,keep going")
Check "agent line" ($csv[6] -eq "agent,PET-17393,scout: Find call sites")
Check "stop line" ($csv[7] -eq "stop,PET-17393,")
Check "explicit prompt ticket, commas replaced" ($csv[8] -eq "prompt,PET-12333*,PET-12333  other thing")

$rows = Rows (& $exe -NoProfile -File "$PSScriptRoot\worklog.ps1")
Check "live-hook roll-up: 12351, 17393, 12333" (($rows | ForEach-Object { $_[3] }) -join "," -eq "12351,17393,12333")
Check "raw description cut to 150" ($rows[0][4] -like "ado: az boards work-item show --id 17400; asked: Start work x*x (raw)" -and $rows[0][4].Length -eq 150)
Check "17393 block holds the prompt and agent" ($rows[1][4] -like "*keep going*" -and $rows[1][4] -like "*scout: Find call sites*")

# --- worklog.ps1: fixture CSV ---
@"
09:00:00,prompt,PET-12351,s1,$repo,Fix the redaction
09:05:00,prompt,PET-12351,s1,$repo,<task-notification> old-notify-secret
09:06:00,notify,PET-12351,s1,$repo,
09:10:00,az,PET-12351*,s1,$repo,az boards work-item update --id 12351
09:20:00,stop,PET-12351,s1,$repo,
09:21:00,prompt,UNKNOWN,s2,$repo,Misc question
09:21:30,stop,UNKNOWN,s2,$repo,
10:30:00,prompt,UNKNOWN,s2,$repo,Later question
10:31:00,stop,UNKNOWN,s2,$repo,
"@ | Set-Content (Join-Path $dir "2026-01-01.csv")
$out = & $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-01-01
$rows = Rows $out
Check "3 blocks (* ignored in grouping, gap splits UNKNOWN)" ($rows.Count -eq 3)
Check "ticket column bare digits or -----" (($rows | ForEach-Object { $_[3] }) -join "," -eq "12351,-----,-----")
Check "type column is - without an ADO lookup" (($rows | ForEach-Object { $_[5] }) -join "," -eq "-,-,-")
Check "start snaps down, end up, no overlap, minimum 15 min" (($rows | ForEach-Object { "$($_[0])-$($_[1])" }) -join "," -eq "9:00 AM-9:30 AM,9:30 AM-9:45 AM,10:30 AM-10:45 AM")
Check "hours follow the snapped times" (($rows | ForEach-Object { $_[2] }) -join "," -eq "0.50,0.25,0.25")
Check "total" ($out[-1] -eq "Total: 1.00 hours")
Check "notify text never in a description" (-not ($out -like "*notify-secret*"))
Check "fallback descriptions end in (raw)" (@($rows | Where-Object { $_[4] -notlike "*(raw)" }).Count -eq 0)
Check "commits in the block window are facts" ($rows[0][4] -like "*Fixture commit*")
Check "other authors' commits are not facts" ($rows[0][4] -notlike "*Someone else*")
Check ".txt written" ((Get-Content (Join-Path $dir "2026-01-01.txt")) -join "`n" -eq ($out -join "`n"))

# --- fold and 1-hour cap: another session's az-only block folds in; a 2h05 block splits 1.00 / 1.00 / 0.25 ---
@"
03:15:00,notify,PET-17457,s3,$repo,
03:16:00,stop,PET-17457,s3,$repo,
09:00:00,prompt,PET-12351,s1,$repo,Long work
09:30:00,az,PET-17457*,s2,$repo,az boards work-item update --id 17457
09:31:00,stop,PET-12351,s1,$repo,
09:50:00,prompt,PET-12351,s1,$repo,Still going
10:15:00,prompt,PET-12351,s1,$repo,More
11:05:00,stop,PET-12351,s1,$repo,
13:00:00,notify,PET-12351,s1,$repo,
"@ | Set-Content (Join-Path $dir "2026-01-02.csv")
$out = & $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-01-02
$rows = Rows $out
Check "isolated prompt-less blocks (away-time notifications) are dropped" ($rows.Count -eq 3)
Check "prompt-less other-ticket block folds in" (($rows | ForEach-Object { $_[3] }) -join "," -eq "12351,12351,12351")
Check "entries capped at 1 hour" (($rows | ForEach-Object { $_[2] }) -join "," -eq "1.00,1.00,0.25")
Check "chunk starts are consecutive" (($rows | ForEach-Object { $_[0] }) -join "," -eq "9:00 AM,10:00 AM,11:00 AM")
Check "folded az from another ticket stays out of facts" (-not ($out -like "*17457*"))
Check "empty chunk uses the block's facts" ($rows[2][4] -like "*Long work*")

Remove-Item -Recurse -Force $dir
if ($fails) { "$fails FAILED"; exit 1 } else { "all passed" }
