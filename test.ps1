# Self-check for log-event.ps1 and worklog.ps1, no Pester. Runs under pwsh and Windows PowerShell 5.1:
#   pwsh -NoProfile -File test.ps1   /   powershell -NoProfile -File test.ps1
# Uses a temp WORKLOG_DIR and a temp git repo on feature/12351-x; never touches ~/.claude/worklog.
$ErrorActionPreference = "Stop"
$fails = 0
function Check($name, $ok) { if ($ok) { "ok   $name" } else { "FAIL $name"; $script:fails++ } }
# Row fields: 0 start, 1 end, 2 hours, 3 ticket, 4 description, 5 type.
# Built by hand: @() would flatten a single row into its fields.
function Rows($out) { $r = @(); foreach ($l in $out) { if ($l -match '^\s*(\d{1,2}:\d\d [AP]M)\s+(\d{1,2}:\d\d [AP]M)\s+(\S+)\s+(\S+)\s+(User Story|\S+)\s+(.*)$') { $r += , @($Matches[1], $Matches[2], $Matches[3], $Matches[4], $Matches[6], $Matches[5]) } }; , $r }

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
    if (-not $obj.session_id) { $obj.session_id = "s1" }; $obj.cwd = $repo
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
Check "13 lines logged (non-az Bash, Read, guarded prompt, az-as-a-word skipped)" ($csv.Count -eq 13)
Check "az inside a commit message logs the commit, not az" ($csv[9] -eq "commit,PET-12351,git commit -m `"Log az commands`"")
Check "az after = is logged, read-only, branch ticket (no session inheritance)" ($csv[10] -eq "az,PET-12351,az repos pr list --status active")
Check "REST PATCH after az token is explicit" ($csv[11] -like "az,PET-17458*,az account get-access-token*")
Check "mutating word outside the az segment is not explicit" ($csv[12] -like "az,PET-12351,az boards work-item show --id 17401*")
Check "prompt from branch, text cut to 200" ($csv[0] -eq "prompt,PET-12351,$($long.Substring(0, 200))")
Check "notification logged as notify, no text" ($csv[1] -eq "notify,PET-12351,")
Check "read-only az keeps branch ticket" ($csv[2] -eq "az,PET-12351,az boards work-item show --id 17400")
Check "prompt after read-only az stays 12351" ($csv[3] -eq "prompt,PET-12351,check the show result")
Check "mutating az is explicit, text from az onward" ($csv[4] -eq "az,PET-17393*,az boards work-item update --id 17393 --state Active")
Check "capture no longer inherits the session's explicit ticket" ($csv[5] -eq "prompt,PET-12351,keep going")
Check "agent line" ($csv[6] -eq "agent,PET-12351,scout: Find call sites")
Check "stop line" ($csv[7] -eq "stop,PET-12351,")
Check "explicit prompt ticket, commas replaced" ($csv[8] -eq "prompt,PET-12333*,PET-12333  other thing")

# Roll-up re-tickets from evidence: 17393 back-fills the start, 12333 wins from its prompt, then 17458 from its REST PATCH;
# the events land in one slot (two if the run straddles a quarter hour), and 17393's three prompts outweigh the rest.
$out = & $exe -NoProfile -File "$PSScriptRoot\worklog.ps1"
$rows = Rows $out
Check "live-hook roll-up: the slot goes to 17393" ($rows[0][3] -eq "17393")
Check "Sessions list shows the evidence re-ticketing" (@($out | Where-Object { $_ -match '^s1\s+17393,12333,17458\s' }).Count -eq 1)
Check "raw description cut to 150" ($rows[0][4] -like "ado: az boards work-item show --id 17400; ado: az boards work-item update*; agent: scout: Find call sites; asked: Start*(raw)" -and $rows[0][4].Length -eq 150)

# --- log-event.ps1: ado.ps1 verbs and PR capture (own log folder, session s9) ---
$env:WORKLOG_DIR = Join-Path $dir "cap"
Hook prompt @{ session_id = "s9"; prompt = "Can you please fix the merge conflict on pr 6025" }
Hook prompt @{ session_id = "s9"; prompt = "see PR #6026 please" }
Hook prompt @{ session_id = "s9"; prompt = "pull request 6027 failed" }
Hook tool @{ session_id = "s9"; tool_name = "PowerShell"; tool_input = @{ command = "& ./.claude/scripts/ado.ps1 wi-update -Id 17500 -Set 'System.State=Active'" } }
Hook tool @{ session_id = "s9"; tool_name = "PowerShell"; tool_input = @{ command = "& ./.claude/scripts/ado.ps1 wi-get -Id 17501" } }
Hook tool @{ session_id = "s9"; tool_name = "Bash"; tool_input = @{ command = "pwsh -NoProfile -File .claude/scripts/ado.ps1 comment-add -Id 17502 -BodyFile c.md -WhatIf" } }
Hook tool @{ session_id = "s9"; tool_name = "PowerShell"; tool_input = @{ command = "`$r = & `"C:\x\ado.ps1`" pr-update -Pr 6025 -Title t" } }
Hook tool @{ session_id = "s9"; tool_name = "PowerShell"; tool_input = @{ command = "& ./.claude/scripts/ado.ps1 pr-create -Source a -Target develop -Title t -BodyFile b.md -WorkItems 17503,17504" } }
Hook tool @{ session_id = "s9"; tool_name = "Bash"; tool_input = @{ command = "grep -n `"ado.ps1 wi-get`" README.md; git commit -m `"use ado.ps1 wi-update`"" } }
Hook tool @{ session_id = "s9"; tool_name = "Bash"; tool_input = @{ command = "az repos pr update --id 6028 --status completed" } }
Hook tool @{ session_id = "s9"; tool_name = "Bash"; tool_input = @{ command = "git add -A && git commit -F - <<'EOF'`nFix the thing`n`nRefs #17610`nEOF" } }
Hook tool @{ session_id = "s9"; tool_name = "Bash"; tool_input = @{ command = "git -C x commit --amend --no-edit; echo `"git commit`"; git log --grep commit" } }
$csv = @(Get-Content (Join-Path $env:WORKLOG_DIR "$today.csv") | ForEach-Object { $p = $_ -split ',', 6; "$($p[1]),$($p[2]),$($p[5])" })
$env:WORKLOG_DIR = $dir
Check "12 capture lines (ado.ps1 as a grep word skipped; its commit logged)" ($csv.Count -eq 12)
Check "ado.ps1 inside a grep and a commit message logs only the commit" ($csv[8] -eq "commit,PET-12351,git commit -m `"use ado.ps1 wi-update`"")
Check "git commit with a heredoc message is captured with its #id" ($csv[10] -eq "commit,PET-17610*,git commit -F - <<'EOF' Fix the thing Refs #17610 EOF")
Check "git -C commit without an id keeps branch ticket" ($csv[11] -like "commit,PET-12351,git -C x commit --amend --no-edit*")
Check "prompt naming pr 6025 records PR-6025*" ($csv[0] -eq "prompt,PR-6025*,Can you please fix the merge conflict on pr 6025")
Check "PR #6026 and pull request 6027 are captured" ($csv[1] -like "prompt,PR-6026*,*" -and $csv[2] -like "prompt,PR-6027*,*")
Check "mutating ado verb is explicit, text from ado.ps1 onward" ($csv[3] -eq "ado,PET-17500*,ado.ps1 wi-update -Id 17500 -Set 'System.State=Active'")
Check "read ado verb keeps branch ticket" ($csv[4] -eq "ado,PET-12351,ado.ps1 wi-get -Id 17501")
Check "ado -WhatIf is not explicit" ($csv[5] -like "ado,PET-12351,ado.ps1 comment-add -Id 17502*")
Check "ado -Pr records PR-NNNN*" ($csv[6] -like "ado,PR-6025*,ado.ps1*pr-update -Pr 6025*")
Check "ado -WorkItems records the first id" ($csv[7] -like "ado,PET-17503*,ado.ps1 pr-create*")
Check "mutating az repos pr --id records PR-NNNN*" ($csv[9] -eq "az,PR-6028*,az repos pr update --id 6028 --status completed")

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
Check "3 entries (* ignored, s2's prompt outweighs s1's stop at 9:15, idle gap splits UNKNOWN)" ($rows.Count -eq 3)
Check "ticket column bare digits or -----" (($rows | ForEach-Object { $_[3] }) -join "," -eq "12351,-----,-----")
Check "type column is - without an ADO lookup" (($rows | ForEach-Object { $_[5] }) -join "," -eq "-,-,-")
Check "entries are whole slots" (($rows | ForEach-Object { "$($_[0])-$($_[1])" }) -join "," -eq "9:00 AM-9:15 AM,9:15 AM-9:30 AM,10:30 AM-10:45 AM")
Check "hours = slots x 0.25" (($rows | ForEach-Object { $_[2] }) -join "," -eq "0.25,0.25,0.25")
$ti = [array]::IndexOf($out, "Total: 0.75 hours")
Check "total" ($ti -gt 0)
Check "notify text never in a description" (-not ($out -like "*notify-secret*"))
Check "fallback descriptions end in (raw)" (@($rows | Where-Object { $_[4] -notlike "*(raw)" }).Count -eq 0)
Check "commits in the block window are facts" ($rows[0][4] -like "*Fixture commit*")
Check "other authors' commits are not facts" ($rows[0][4] -notlike "*Someone else*")
$si = [array]::IndexOf($out, "Sessions:")
Check ".txt written (both views, up to Sessions)" ((Get-Content (Join-Path $dir "2026-01-01.txt")) -join "`n" -eq ($out[0..($si - 2)] -join "`n"))
Check "Sessions list printed after the views, not in the .txt" ($si -gt $ti -and $out -contains "s1        12351  Fix the redaction" -and -not (Get-Content (Join-Path $dir "2026-01-01.txt") | Where-Object { $_ -like "Sessions*" }))
$bt = [array]::IndexOf($out, "HOURS  TICKET  TYPE        TITLE")
Check "by-ticket view: most hours first, periods listed under each ticket" ($bt -eq $ti + 2 -and $out[$bt + 1] -like " 0.50  -----*" -and $out[$bt + 2].Trim() -eq "9:15-9:30 AM, 10:30-10:45 AM" -and $out[$bt + 3] -like " 0.25  12351*" -and $out[$bt + 4].Trim() -eq "9:00-9:15 AM")

# --- slots: s1 (17457) prompts beat s2's (12351) coverage-only slots; the 9:15 tie keeps 17457 although 12351 sorts lower;
# a 1.50 h run splits 1.00 / 0.50; an idle hour splits entries; prompt-less segments (s3 away-time, s4 az-only) are dropped ---
@"
03:15:00,notify,PET-17999,s3,$repo,
03:16:00,stop,PET-17999,s3,$repo,
08:50:00,prompt,PET-12351,s2,$repo,Parallel question
09:00:00,prompt,PET-17457,s1,$repo,Long work
09:10:00,notify,PET-12351,s2,$repo,
09:14:00,stop,PET-17457,s1,$repo,
09:31:00,prompt,PET-17457,s1,$repo,Still going
09:35:00,notify,PET-12351,s2,$repo,
09:50:00,prompt,PET-17457,s1,$repo,More
09:52:00,stop,PET-12351,s2,$repo,
10:10:00,prompt,PET-17457,s1,$repo,Even more
10:25:00,stop,PET-17457,s1,$repo,
10:40:00,az,PET-17999*,s4,$repo,az boards work-item update --id 17999
11:30:00,prompt,PET-17457,s1,$repo,After lunch
11:40:00,stop,PET-17457,s1,$repo,
"@ | Set-Content (Join-Path $dir "2026-01-02.csv")
$out = & $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-01-02
$rows = Rows $out
Check "prompt-heavy session wins the slot; tie keeps the previous ticket" (($rows | ForEach-Object { $_[3] }) -join "," -eq "12351,17457,17457,17457")
Check "entries on slot boundaries, capped at 1 hour, idle gap splits" (($rows | ForEach-Object { "$($_[0])-$($_[1])" }) -join "," -eq "8:45 AM-9:00 AM,9:00 AM-10:00 AM,10:00 AM-10:30 AM,11:30 AM-11:45 AM")
Check "hours = slots x 0.25" (($rows | ForEach-Object { $_[2] }) -join "," -eq "0.25,1.00,0.50,0.25" -and $out -contains "Total: 2.00 hours")
Check "prompt-less segments are dropped" (-not ($rows | Where-Object { $_[3] -eq "17999" -or $_[0] -like "3:*" }))
Check "facts are the entry's own ticket and window" ($rows[1][4] -like "*Long work*" -and $rows[1][4] -notlike "*Parallel*" -and $rows[2][4] -like "*Even more*" -and $rows[2][4] -notlike "*Long work*")

# --- evidence: commit #NNNNN back-fills, a later explicit prompt wins, no-evidence session keeps its branch, .map last ---
$env:GIT_COMMITTER_DATE = $env:GIT_AUTHOR_DATE = "2026-01-03T10:10:00"
git -C $repo commit -q --allow-empty -m "#17600 Implement the thing"
# A commit made elsewhere and pulled in later is in HEAD's history but not its reflog: not evidence.
$clone = Join-Path $dir "clone"
git clone -q $repo $clone 2>$null
$env:GIT_COMMITTER_DATE = $env:GIT_AUTHOR_DATE = "2026-01-03T10:15:00"
git -C $clone -c user.name=t -c user.email=t@t commit -q --allow-empty -m "#17999 Made in another checkout"
Remove-Item Env:GIT_COMMITTER_DATE, Env:GIT_AUTHOR_DATE
git -C $repo pull -q --ff-only $clone 2>$null
@"
10:00:00,prompt,PET-12351,s1,$repo,Start
10:20:00,prompt,PET-12351,s1,$repo,Mid
10:30:00,prompt,PET-17601*,s1,$repo,Switch to PET-17601
10:40:00,prompt,PET-12351,s1,$repo,After
10:45:00,stop,PET-12351,s1,$repo,
11:00:00,prompt,PET-12351,s2,$dir,Other
11:10:00,stop,PET-12351,s2,$dir,
11:30:00,prompt,PET-12351,s3xx,$dir,Drop me
12:00:00,prompt,UNKNOWN,s4abcdef,$dir,Remap me
"@ | Set-Content (Join-Path $dir "2026-01-03.csv")
"s3 -`ns4ab 17777" | Set-Content (Join-Path $dir "2026-01-03.map")
# sessions.map applies to every date, before the date's map: s2 -> 17222 sticks, s4 -> 17111 is overridden by the date map.
"s2 17222`ns4 17111" | Set-Content (Join-Path $dir "sessions.map")
$out = & $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-01-03
Remove-Item (Join-Path $dir "sessions.map")
$rows = Rows $out
Check "commit back-fills, explicit prompt switches, sessions.map then date map remap and drop" (($rows | ForEach-Object { $_[3] }) -join "," -eq "17600,17601,17222,17777")
Check "switch lands at the explicit prompt's slot" (($rows | ForEach-Object { "$($_[0])-$($_[1])" }) -join "," -eq "10:00 AM-10:30 AM,10:30 AM-11:00 AM,11:00 AM-11:15 AM,12:00 PM-12:15 PM")
Check "Sessions list shows each session's tickets, dropped session absent" ($out -contains "s1        17600,17601  Start" -and -not ($out -like "s3xx*"))

# --- shared checkout: B's commit (its own commit event, and in the reflog) must not re-ticket A ---
$env:GIT_COMMITTER_DATE = $env:GIT_AUTHOR_DATE = "2026-01-05T10:10:00"
git -C $repo commit -q --allow-empty -m "#17650 B's work"
Remove-Item Env:GIT_COMMITTER_DATE, Env:GIT_AUTHOR_DATE
@"
10:00:00,prompt,PET-12351,sA,$repo,A starts
10:05:00,prompt,PET-12351,sB,$repo,B starts
10:10:00,commit,PET-17650*,sB,$repo,git commit -m "#17650 B's work"
10:15:00,stop,PET-12351,sB,$repo,
10:20:00,prompt,PET-12351,sA,$repo,A again
"@ | Set-Content (Join-Path $dir "2026-01-05.csv")
$out = & $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-01-05
Check "shared checkout: commit evidence stays with the session that made it" ($out -contains "sA        12351  A starts" -and $out -contains "sB        17650  B starts")

# --- -ExportJson: the re-ticketed events of test\export-day.csv, no prompt text, nothing printed, no .txt; the map drops e3 ---
Copy-Item "$PSScriptRoot\test\export-day.csv" (Join-Path $dir "2026-02-01.csv")
"e3 -" | Set-Content (Join-Path $dir "2026-02-01.map")
$json = Join-Path $dir "export.json"
$out = & $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-02-01 -ExportJson $json
$raw = Get-Content $json -Raw
$x = $raw | ConvertFrom-Json
Check "export prints nothing and writes no .txt" (-not $out -and -not (Test-Path (Join-Path $dir "2026-02-01.txt")))
Check "export keeps the 6 non-dropped events, in order, notification as notify" ($x.date -eq "2026-02-01" -and @($x.events).Count -eq 6 -and (($x.events | ForEach-Object { "$($_.time) $($_.kind)" }) -join ",") -eq "09:00:00 prompt,09:05:00 notify,09:10:00 agent,09:20:00 stop,10:00:00 prompt,10:10:00 stop")
Check "export has no text field and no prompt text" ($raw -notmatch '"text"\s*:' -and $raw -notmatch 'export-secret|Fix PET|Drop me|scout' -and (($x.events[0].PSObject.Properties.Name) -join ",") -eq "time,kind,session,ticket")
Check "/peer-review prompt marks its session review; cwd kept" ($x.sessions.e2.review -eq $true -and $x.sessions.e1.review -eq $false -and $x.sessions.e2.cwd -eq 'C:\x\Petsoft-6213' -and -not $x.sessions.e3drop)
Check "PET-17619* exports as PET-17619, UNKNOWN as null" (((@($x.events | Where-Object session -eq e1) | ForEach-Object ticket | Sort-Object -Unique) -join ",") -eq "PET-17619" -and @($x.events | Where-Object { $_.session -eq "e2" -and $null -ne $_.ticket }).Count -eq 0)

# --- sync-timeline.ps1 -DryRun (pwsh only) on test\sync-*: per-event offsets across DST end, notes from the .txt (raw rows
# skipped), the Support Item flag from fake-ado, and an unchanged second run that skips and writes nothing ---
$sd = Join-Path $dir "sync"; $dry = Join-Path $dir "dry"
New-Item -ItemType Directory $sd | Out-Null
foreach ($f in "2026-10-19.csv", "2026-10-19.txt", "2026-11-01.csv", "2026-01-06.csv") { Copy-Item "$PSScriptRoot\test\sync-$f" (Join-Path $sd $f) }
$env:WORKLOG_DIR = $sd; $env:TIMELINE_SYNC_STATE = Join-Path $dir "sync-state"; $env:WORKLOG_ADO = "$PSScriptRoot\test\fake-ado.ps1"
$sync = { param($d) pwsh -NoProfile -File "$PSScriptRoot\sync-timeline.ps1" -Date $d -DryRun $dry 2>&1 | Out-String }
$o1 = & $sync 2026-10-19; $o2 = & $sync 2026-11-01
$raw = Get-Content (Join-Path $dry "timeline-2026-10-19.json") -Raw -ErrorAction SilentlyContinue
$rawDst = Get-Content (Join-Path $dry "timeline-2026-11-01.json") -Raw -ErrorAction SilentlyContinue
$a = $raw | ConvertFrom-Json
Check "sync dry run: events carry ISO times with the day's offset (EDT, then EST after DST end)" ($raw -match '"at":"2026-10-19T10:00:00-04:00"' -and $raw -match '"tz":"-04:00"' -and $rawDst -match '"at":"2026-11-01T10:00:00-05:00"' -and $rawDst -match '"tz":"-05:00"' -and @($a.events).Count -eq 5)
Check "sync doc: events are at/kind/session/ticket, no text field or prompt text" ((($a.events[0].PSObject.Properties.Name) -join ",") -eq "at,kind,session,ticket" -and ($raw -split '"blocks":')[0] -notmatch '"text"\s*:' -and $raw -notmatch 'sync-secret|Fix PET|scout|C:\\\\x')
Check "sync doc: sessions carry project and review" ($a.sessions.a2.project -eq "Petsoft-hotfix" -and $a.sessions.a1.review -eq $false)
Check "sync notes: roll-up wins; a raw-only ticket falls back to its ADO type and title" ($a.notes.'PET-17983' -eq "Development: Built the header search typeahead." -and $a.notes.'PET-17291' -eq "Support Item: Fake 17291")
Check "sync flags: Support Item is unplanned, a Task is not" ($a.flags.'PET-17291'.unplanned -eq $true -and -not $a.flags.'PET-17983')
Check "sync titles: every ticket with an ADO title, title only" ((($a.titles.PSObject.Properties.Name | Sort-Object) -join ",") -eq "PET-17291,PET-17983" -and $a.titles.'PET-17983' -eq "Fake 17983" -and $a.titles.'PET-17291' -eq "Fake 17291")
Check "sync blocks: every roll-up row in start order with local times, (raw) rows and ADO lines left out" ($raw.Contains('"blocks":[{"start":"2026-10-19T10:00:00-04:00","end":"2026-10-19T10:30:00-04:00","ticket":"PET-17983","text":"Development: Built the header search typeahead."},{"start":"2026-10-19T10:30:00-04:00","end":"2026-10-19T10:45:00-04:00","ticket":"PET-17983","text":"Testing: A later row for the same ticket."}]') -and $raw -notmatch 'asked:|Rework the top search bar')
Check "sync blocks: a day with no .txt gets an empty list" ($rawDst -match '"blocks":\[\]')
Remove-Item (Join-Path $dry "timeline-2026-10-19.json") -ErrorAction SilentlyContinue
$o3 = & $sync 2026-10-19
Check "sync: unchanged inputs skip and write nothing" ($o1 -notmatch "unchanged" -and $o3 -match "timeline/2026-10-19 unchanged, skipped" -and -not (Test-Path (Join-Path $dry "timeline-2026-10-19.json")))
# The export keeps the worklog's ADO attribution even with WORKLOG_NOSUMMARY=1 inherited: 17010 rolls up to 17012 (fake-ado).
$null = & $sync 2026-01-06
Check "sync: a child ticket filed that day exports as its parent" (((Get-Content (Join-Path $dry "timeline-2026-01-06.json") -Raw | ConvertFrom-Json).events.ticket | Sort-Object -Unique) -join "," -eq "PET-17012")
$o4 = pwsh -NoProfile -File "$PSScriptRoot\sync-timeline.ps1" -Date 2026-11-01 2>&1 | Out-String
$pend = Join-Path $env:TIMELINE_SYNC_STATE "pending\timeline-2026-11-01.json"
Check "sync without -DryRun builds the pending file and says so" ($o4 -match "built timeline/2026-11-01 -> " -and (Get-Content $pend -Raw) -match '"date":"2026-11-01"')
# A failed ADO type lookup leaves no marker, so the next run rebuilds (and retries the Unplanned flag).
$env:TIMELINE_SYNC_STATE = Join-Path $dir "sync-state-noado"; $env:WORKLOG_ADO = Join-Path $dir "no-such-ado.ps1"
$o5 = & $sync 2026-11-01; $o6 = & $sync 2026-11-01
Check "sync: failed type lookup writes no marker; the next run retries" ($o5 -match "WARN ADO type lookup failed for PET-17983" -and $o6 -match "WARN ADO type lookup failed" -and $o6 -notmatch "unchanged" -and -not (Test-Path (Join-Path $env:TIMELINE_SYNC_STATE "2026-11-01.hash")))
$noAdo = Get-Content (Join-Path $dry "timeline-2026-11-01.json") -Raw | ConvertFrom-Json
Check "sync notes: a ticket with no commit and no ADO gets no note or title, and the build survives" (@($noAdo.notes.PSObject.Properties).Count -eq 0 -and @($noAdo.titles.PSObject.Properties).Count -eq 0)
# Fallback notes: commit subjects from the session's repo for that day only, roll-up still wins, else the ADO type and title;
# an old string cache entry is read as the type and refreshed for its title.
$repo = Join-Path $dir "notes-repo"; New-Item -ItemType Directory $repo | Out-Null
git -C $repo init -q 2>&1 | Out-Null
foreach ($c in @(@("2026-10-20T12:00:00", "#17001 Wrong day"), @("2026-10-21T12:00:00", "#17983 Remove the cold-load search hint"), @("2026-10-21T13:00:00", "#17983 Add a second subject"), @("2026-10-21T14:00:00", "#17002 Commit subject loses to the roll-up"))) {
    $env:GIT_AUTHOR_DATE = $c[0]; $env:GIT_COMMITTER_DATE = $c[0]
    git -C $repo -c user.name=t -c user.email=t@t commit -q --allow-empty -m $c[1] 2>&1 | Out-Null
}
$env:GIT_AUTHOR_DATE = $null; $env:GIT_COMMITTER_DATE = $null
@("10:00:00,prompt,PET-17983,n1,$repo,secret prompt one", "10:10:00,prompt,PET-17002,n2,$repo,secret prompt two", "10:20:00,prompt,PET-17001,n3,$repo,secret prompt three", "10:30:00,stop,PET-17001,n3,$repo,") | Set-Content (Join-Path $sd "2026-10-21.csv")
"   START       END  HOURS  TICKET  TYPE        DESCRIPTION`n10:10 AM  10:20 AM   0.17  17002   Bug         Development: Roll-up description.`n11:30 PM  12:00 AM   0.50  17002   Bug         Testing: Late block.`n 1:15 PM   1:45 PM   0.50  17002   Bug         Development: Afternoon block." | Set-Content (Join-Path $sd "2026-10-21.txt")
$env:TIMELINE_SYNC_STATE = Join-Path $dir "sync-state-notes"; New-Item -ItemType Directory $env:TIMELINE_SYNC_STATE | Out-Null
'{"PET-17001":"User Story"}' | Set-Content (Join-Path $env:TIMELINE_SYNC_STATE "types.json")
$env:WORKLOG_ADO = "$PSScriptRoot\test\fake-ado.ps1"
$null = & $sync 2026-10-21
$rawN = Get-Content (Join-Path $dry "timeline-2026-10-21.json") -Raw; $n = $rawN | ConvertFrom-Json
Check "sync notes: commit subjects fallback (that day only, deduped, joined)" ($n.notes.'PET-17983' -eq "Add a second subject; Remove the cold-load search hint" -or $n.notes.'PET-17983' -eq "Remove the cold-load search hint; Add a second subject")
Check "sync notes: roll-up beats a commit subject" ($n.notes.'PET-17002' -eq "Development: Roll-up description.")
Check "sync notes: no commit falls back to ADO; an old string cache entry gets its title" ($n.notes.'PET-17001' -eq "User Story: Fake 17001" -and (Get-Content (Join-Path $env:TIMELINE_SYNC_STATE "types.json") -Raw) -match '"title"')
Check "sync notes: no prompt text in the doc" ($rawN -notmatch 'secret prompt')
Check "sync blocks: PM times, and a 12:00 AM end after a PM start is next midnight" ($rawN.Contains('{"start":"2026-10-21T13:15:00-04:00","end":"2026-10-21T13:45:00-04:00","ticket":"PET-17002","text":"Development: Afternoon block."},{"start":"2026-10-21T23:30:00-04:00","end":"2026-10-22T00:00:00-04:00","ticket":"PET-17002","text":"Testing: Late block."}]'))
$env:WORKLOG_DIR = $dir; $env:TIMELINE_SYNC_STATE = $null; $env:WORKLOG_ADO = $null

# --- ADO path via a fake ado.ps1 (WORKLOG_ADO) and a claude stub whose entry 2 echoes the wrong start time ---
New-Item -ItemType Directory (Join-Path $dir "bin") | Out-Null
"@echo 1^|09:00^|Development: Fixed the merge conflict.`r`n@echo 2^|09:45^|Wrong row.`r`n@echo 3^|10:00^|Testing: Checked the pipeline." | Set-Content (Join-Path $dir "bin\claude.cmd")
@"
09:00:00,prompt,PET-12351,s1,$repo,Can you please fix the merge conflict on pr 6025
09:10:00,stop,PET-12351,s1,$repo,
09:30:00,prompt,PR-6026*,s2,$repo,Look at PR #6026
09:40:00,stop,PET-12351,s2,$repo,
10:00:00,prompt,PR-6666*,s3,$repo,Check pr 6666
10:10:00,stop,PET-12351,s3,$repo,
"@ | Set-Content (Join-Path $dir "2026-01-04.csv")
$oldPath = $env:PATH; $env:PATH = "$(Join-Path $dir 'bin');$env:PATH"
$env:WORKLOG_NOSUMMARY = $null; $env:WORKLOG_ADO = "$PSScriptRoot\test\fake-ado.ps1"
$out = & $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-01-04 3>$null 2>$null
$wiql = Get-Content (Join-Path $dir "wiql.txt") -Raw
# Parent roll-up: 17010 -> 17011 -> 17012 (two hops, both filed that day), 17020 -> 17021, 17030 (filed earlier) keeps its own.
@"
09:00:00,prompt,PET-17010*,s1,$repo,Fix PET-17010
10:00:00,prompt,PET-17020*,s2,$repo,Fix PET-17020
11:00:00,prompt,PET-17030*,s3,$repo,Fix PET-17030
"@ | Set-Content (Join-Path $dir "2026-01-06.csv")
$up = Rows (& $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-01-06 3>$null 2>$null)
$env:PATH = $oldPath; $env:WORKLOG_NOSUMMARY = "1"; $env:WORKLOG_ADO = $null
Check "parent roll-up: two-hop chain, one hop, filed-earlier child stays" (($up | ForEach-Object { $_[3] }) -join "," -eq "17012,17021,17030")
$rows = Rows $out
Check "PR resolves to Task, then Bug; failed PR lookup keeps branch" (($rows | ForEach-Object { $_[3] }) -join "," -eq "17003,17002,12351")
Check "type column from wi-get" (($rows | ForEach-Object { $_[5] }) -join "," -eq "Task,Bug,Task")
Check "Touched in ADO lists changed items not in the table" ($out -contains "Touched in ADO, no time logged: 17900")
Check "Touched WIQL excludes items created that day" ($wiql -like "*[[]System.CreatedDate] < '2026-01-04'*")
Check "summary lines attach only when the echoed start time matches; a mismatch stays raw" ($rows[0][4] -eq "Development: Fixed the merge conflict." -and $rows[1][4] -like "*(raw)" -and $rows[2][4] -eq "Testing: Checked the pipeline.")

Remove-Item -Recurse -Force $dir
if ($fails) { "$fails FAILED"; exit 1 } else { "all passed" }
