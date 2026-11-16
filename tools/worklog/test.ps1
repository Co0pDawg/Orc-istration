# Self-check for log-event.ps1 and worklog.ps1, no Pester. Runs under pwsh and Windows PowerShell 5.1:
#   pwsh -NoProfile -File test.ps1   /   powershell -NoProfile -File test.ps1
# Uses a temp WORKLOG_DIR and a temp git repo on feature/10002-x; never touches ~/.claude/worklog.
$ErrorActionPreference = "Stop"
$fails = 0
function Check($name, $ok) { if ($ok) { "ok   $name" } else { "FAIL $name"; $script:fails++ } }
# Row fields: 0 start, 1 end, 2 hours, 3 ticket, 4 description, 5 type.
# Built by hand: @() would flatten a single row into its fields.
function Rows($out) { $r = @(); foreach ($l in $out) { if ($l -match '^\s*(\d{1,2}:\d\d [AP]M)\s+(\d{1,2}:\d\d [AP]M)\s+(\S+)\s+(\S+)\s+(User Story|\S+)\s+(.*)$') { $r += , @($Matches[1], $Matches[2], $Matches[3], $Matches[4], $Matches[6], $Matches[5]) } }; , $r }

$dir = Join-Path ([IO.Path]::GetTempPath()) "worklog-test-$([guid]::NewGuid())"
$repo = Join-Path $dir "repo"
New-Item -ItemType Directory $repo | Out-Null
git -C $repo init -q -b feature/10002-x
$env:GIT_COMMITTER_DATE = $env:GIT_AUTHOR_DATE = "2026-01-01T09:10:00"
git -C $repo config user.name t; git -C $repo config user.email t@t
git -C $repo commit -q --allow-empty -m "Fixture commit"
git -C $repo -c user.email=other@t commit -q --allow-empty -m "Someone else's commit"
Remove-Item Env:GIT_COMMITTER_DATE, Env:GIT_AUTHOR_DATE
$env:WORKLOG_DIR = $dir
$env:WORKLOG_NOSUMMARY = "1"
$env:WORKLOG_ACTIONS = "$PSScriptRoot\test\fake-actions.ps1"
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
Hook tool @{ tool_name = "Bash"; tool_input = @{ command = "az boards work-item show --id 10017" } }
Hook prompt @{ prompt = "check the show result" }
Hook tool @{ tool_name = "PowerShell"; tool_input = @{ command = "cd x; az boards work-item update --id 10016 --state Active" } }
Hook prompt @{ prompt = "keep going" }
Hook tool @{ tool_name = "Agent"; tool_input = @{ description = "Find call sites"; subagent_type = "scout" } }
Hook tool @{ tool_name = "Bash"; tool_input = @{ command = "dotnet build" } }
Hook tool @{ tool_name = "Read"; tool_input = @{ file_path = "x" } }
Hook stop @{}
Hook prompt @{ prompt = "APP-10001, other thing" }
$env:WORKLOG_DISABLE = "1"; Hook prompt @{ prompt = "guarded" }; $env:WORKLOG_DISABLE = $null
Hook tool @{ tool_name = "Bash"; tool_input = @{ command = "sed -i 's|az/agent capture|x|' README.md; grep -n `"az \|curl`" f" } }
Hook tool @{ tool_name = "Bash"; tool_input = @{ command = "git commit -m `"Log az commands`"" } }
Hook tool @{ tool_name = "PowerShell"; tool_input = @{ command = "`$prs = az repos pr list --status active" } }
Hook tool @{ tool_name = "PowerShell"; tool_input = @{ command = "`$t = az account get-access-token --query accessToken -o tsv`nInvoke-RestMethod -Method Patch -Uri https://x/_apis/wit/workitems/10021" } }
Hook tool @{ tool_name = "Bash"; tool_input = @{ command = "az boards work-item show --id 10018; git commit -m `"update docs`"" } }

$today = (Get-Date).ToString("yyyy-MM-dd")
$csv = @(Get-Content (Join-Path $dir "$today.csv") | ForEach-Object { $p = $_ -split ',', 6; "$($p[1]),$($p[2]),$($p[5])" })
Check "13 lines logged (non-az Bash, Read, guarded prompt, az-as-a-word skipped)" ($csv.Count -eq 13)
Check "az inside a commit message logs the commit, not az" ($csv[9] -eq "commit,APP-10002,git commit -m `"Log az commands`"")
Check "az after = is logged, read-only, branch ticket (no session inheritance)" ($csv[10] -eq "az,APP-10002,az repos pr list --status active")
Check "REST PATCH after az token is explicit" ($csv[11] -like "az,APP-10021*,az account get-access-token*")
Check "mutating word outside the az segment is not explicit" ($csv[12] -like "az,APP-10002,az boards work-item show --id 10018*")
Check "prompt from branch, text cut to 200" ($csv[0] -eq "prompt,APP-10002,$($long.Substring(0, 200))")
Check "notification logged as notify, no text" ($csv[1] -eq "notify,APP-10002,")
Check "read-only az keeps branch ticket" ($csv[2] -eq "az,APP-10002,az boards work-item show --id 10017")
Check "prompt after read-only az stays 10002" ($csv[3] -eq "prompt,APP-10002,check the show result")
Check "mutating az is explicit, text from az onward" ($csv[4] -eq "az,APP-10016*,az boards work-item update --id 10016 --state Active")
Check "capture no longer inherits the session's explicit ticket" ($csv[5] -eq "prompt,APP-10002,keep going")
Check "agent line" ($csv[6] -eq "agent,APP-10002,scout: Find call sites")
Check "stop line" ($csv[7] -eq "stop,APP-10002,")
Check "explicit prompt ticket, commas replaced" ($csv[8] -eq "prompt,APP-10001*,APP-10001  other thing")

# Roll-up re-tickets from evidence: 10016 back-fills the start, 10001 wins from its prompt, then 10021 from its REST PATCH;
# the events land in one slot (two if the run straddles a quarter hour), and 10016's three prompts outweigh the rest.
$out = & $exe -NoProfile -File "$PSScriptRoot\worklog.ps1"
$rows = Rows $out
Check "live-hook roll-up: the slot goes to 10016" ($rows[0][3] -eq "10016")
Check "Sessions list shows the evidence re-ticketing" (@($out | Where-Object { $_ -match '^s1\s+10016,10001,10021\s' }).Count -eq 1)
Check "raw description cut to 150" ($rows[0][4] -like "ado: az boards work-item show --id 10017; ado: az boards work-item update*; agent: scout: Find call sites; asked: Start*(raw)" -and $rows[0][4].Length -eq 150)

# --- log-event.ps1: ado.ps1 verbs and PR capture (own log folder, session s9) ---
$env:WORKLOG_DIR = Join-Path $dir "cap"
Hook prompt @{ session_id = "s9"; prompt = "Can you please fix the merge conflict on pr 1001" }
Hook prompt @{ session_id = "s9"; prompt = "see PR #1002 please" }
Hook prompt @{ session_id = "s9"; prompt = "pull request 1003 failed" }
Hook tool @{ session_id = "s9"; tool_name = "PowerShell"; tool_input = @{ command = "& ./.claude/scripts/ado.ps1 wi-update -Id 10022 -Set 'System.State=Active'" } }
Hook tool @{ session_id = "s9"; tool_name = "PowerShell"; tool_input = @{ command = "& ./.claude/scripts/ado.ps1 wi-get -Id 10023" } }
Hook tool @{ session_id = "s9"; tool_name = "Bash"; tool_input = @{ command = "pwsh -NoProfile -File .claude/scripts/ado.ps1 comment-add -Id 10024 -BodyFile c.md -WhatIf" } }
Hook tool @{ session_id = "s9"; tool_name = "PowerShell"; tool_input = @{ command = "`$r = & `"C:\x\ado.ps1`" pr-update -Pr 1001 -Title t" } }
Hook tool @{ session_id = "s9"; tool_name = "PowerShell"; tool_input = @{ command = "& ./.claude/scripts/ado.ps1 pr-create -Source a -Target develop -Title t -BodyFile b.md -WorkItems 10025,10026" } }
Hook tool @{ session_id = "s9"; tool_name = "Bash"; tool_input = @{ command = "grep -n `"ado.ps1 wi-get`" README.md; git commit -m `"use ado.ps1 wi-update`"" } }
Hook tool @{ session_id = "s9"; tool_name = "Bash"; tool_input = @{ command = "az repos pr update --id 1004 --status completed" } }
Hook tool @{ session_id = "s9"; tool_name = "Bash"; tool_input = @{ command = "git add -A && git commit -F - <<'EOF'`nFix the thing`n`nRefs #10029`nEOF" } }
Hook tool @{ session_id = "s9"; tool_name = "Bash"; tool_input = @{ command = "git -C x commit --amend --no-edit; echo `"git commit`"; git log --grep commit" } }
$csv = @(Get-Content (Join-Path $env:WORKLOG_DIR "$today.csv") | ForEach-Object { $p = $_ -split ',', 6; "$($p[1]),$($p[2]),$($p[5])" })
$env:WORKLOG_DIR = $dir
Check "12 capture lines (ado.ps1 as a grep word skipped; its commit logged)" ($csv.Count -eq 12)
Check "ado.ps1 inside a grep and a commit message logs only the commit" ($csv[8] -eq "commit,APP-10002,git commit -m `"use ado.ps1 wi-update`"")
Check "git commit with a heredoc message is captured with its #id" ($csv[10] -eq "commit,APP-10029*,git commit -F - <<'EOF' Fix the thing Refs #10029 EOF")
Check "git -C commit without an id keeps branch ticket" ($csv[11] -like "commit,APP-10002,git -C x commit --amend --no-edit*")
Check "prompt naming pr 1001 records PR-1001*" ($csv[0] -eq "prompt,PR-1001*,Can you please fix the merge conflict on pr 1001")
Check "PR #1002 and pull request 1003 are captured" ($csv[1] -like "prompt,PR-1002*,*" -and $csv[2] -like "prompt,PR-1003*,*")
Check "mutating ado verb is explicit, text from ado.ps1 onward" ($csv[3] -eq "ado,APP-10022*,ado.ps1 wi-update -Id 10022 -Set 'System.State=Active'")
Check "read ado verb keeps branch ticket" ($csv[4] -eq "ado,APP-10002,ado.ps1 wi-get -Id 10023")
Check "ado -WhatIf is not explicit" ($csv[5] -like "ado,APP-10002,ado.ps1 comment-add -Id 10024*")
Check "ado -Pr records PR-NNNN*" ($csv[6] -like "ado,PR-1001*,ado.ps1*pr-update -Pr 1001*")
Check "ado -WorkItems records the first id" ($csv[7] -like "ado,APP-10025*,ado.ps1 pr-create*")
Check "mutating az repos pr --id records PR-NNNN*" ($csv[9] -eq "az,PR-1004*,az repos pr update --id 1004 --status completed")

# --- worklog.ps1: fixture CSV ---
@"
09:00:00,prompt,APP-10002,s1,$repo,Fix the redaction
09:05:00,prompt,APP-10002,s1,$repo,<task-notification> old-notify-secret
09:06:00,notify,APP-10002,s1,$repo,
09:10:00,az,APP-10002*,s1,$repo,az boards work-item update --id 10002
09:20:00,stop,APP-10002,s1,$repo,
09:21:00,prompt,UNKNOWN,s2,$repo,Misc question
09:21:30,stop,UNKNOWN,s2,$repo,
10:30:00,prompt,UNKNOWN,s2,$repo,Later question
10:31:00,stop,UNKNOWN,s2,$repo,
"@ | Set-Content (Join-Path $dir "2026-01-01.csv")
$out = & $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-01-01
$rows = Rows $out
Check "3 entries (* ignored, s2's prompt outweighs s1's stop at 9:15, idle gap splits UNKNOWN)" ($rows.Count -eq 3)
Check "ticket column bare digits or -----" (($rows | ForEach-Object { $_[3] }) -join "," -eq "10002,-----,-----")
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
Check "Sessions list printed after the views, not in the .txt" ($si -gt $ti -and $out -contains "s1        10002  Fix the redaction" -and -not (Get-Content (Join-Path $dir "2026-01-01.txt") | Where-Object { $_ -like "Sessions*" }))
$bt = [array]::IndexOf($out, "HOURS  TICKET  TYPE        TITLE")
Check "by-ticket view: most hours first, periods listed under each ticket" ($bt -eq $ti + 2 -and $out[$bt + 1] -like " 0.50  -----*" -and $out[$bt + 2].Trim() -eq "9:15-9:30 AM, 10:30-10:45 AM" -and $out[$bt + 3] -like " 0.25  10002*" -and $out[$bt + 4].Trim() -eq "9:00-9:15 AM")

# --- slots: s1 (10020) prompts beat s2's (10002) coverage-only slots; the 9:15 tie keeps 10020 although 10002 sorts lower;
# a 1.50 h run splits 1.00 / 0.50; an idle hour splits entries; prompt-less segments (s3 away-time, s4 az-only) are dropped ---
@"
03:15:00,notify,APP-10035,s3,$repo,
03:16:00,stop,APP-10035,s3,$repo,
08:50:00,prompt,APP-10002,s2,$repo,Parallel question
09:00:00,prompt,APP-10020,s1,$repo,Long work
09:10:00,notify,APP-10002,s2,$repo,
09:14:00,stop,APP-10020,s1,$repo,
09:31:00,prompt,APP-10020,s1,$repo,Still going
09:35:00,notify,APP-10002,s2,$repo,
09:50:00,prompt,APP-10020,s1,$repo,More
09:52:00,stop,APP-10002,s2,$repo,
10:10:00,prompt,APP-10020,s1,$repo,Even more
10:25:00,stop,APP-10020,s1,$repo,
10:40:00,az,APP-10035*,s4,$repo,az boards work-item update --id 10035
11:30:00,prompt,APP-10020,s1,$repo,After lunch
11:40:00,stop,APP-10020,s1,$repo,
"@ | Set-Content (Join-Path $dir "2026-01-02.csv")
$out = & $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-01-02
$rows = Rows $out
Check "prompt-heavy session wins the slot; tie keeps the previous ticket" (($rows | ForEach-Object { $_[3] }) -join "," -eq "10002,10020,10020,10020")
Check "entries on slot boundaries, capped at 1 hour, idle gap splits" (($rows | ForEach-Object { "$($_[0])-$($_[1])" }) -join "," -eq "8:45 AM-9:00 AM,9:00 AM-10:00 AM,10:00 AM-10:30 AM,11:30 AM-11:45 AM")
Check "hours = slots x 0.25" (($rows | ForEach-Object { $_[2] }) -join "," -eq "0.25,1.00,0.50,0.25" -and $out -contains "Total: 2.00 hours")
Check "prompt-less segments are dropped" (-not ($rows | Where-Object { $_[3] -eq "10035" -or $_[0] -like "3:*" }))
Check "facts are the entry's own ticket and window" ($rows[1][4] -like "*Long work*" -and $rows[1][4] -notlike "*Parallel*" -and $rows[2][4] -like "*Even more*" -and $rows[2][4] -notlike "*Long work*")

# --- evidence: commit #NNNNN back-fills, a later explicit prompt wins, no-evidence session keeps its branch, .map last ---
$env:GIT_COMMITTER_DATE = $env:GIT_AUTHOR_DATE = "2026-01-03T10:10:00"
git -C $repo commit -q --allow-empty -m "#10027 Implement the thing"
# A commit made elsewhere and pulled in later is in HEAD's history but not its reflog: not evidence.
$clone = Join-Path $dir "clone"
git clone -q $repo $clone 2>$null
$env:GIT_COMMITTER_DATE = $env:GIT_AUTHOR_DATE = "2026-01-03T10:15:00"
git -C $clone -c user.name=t -c user.email=t@t commit -q --allow-empty -m "#10035 Made in another checkout"
Remove-Item Env:GIT_COMMITTER_DATE, Env:GIT_AUTHOR_DATE
git -C $repo pull -q --ff-only $clone 2>$null
@"
10:00:00,prompt,APP-10002,s1,$repo,Start
10:20:00,prompt,APP-10002,s1,$repo,Mid
10:30:00,prompt,APP-10028*,s1,$repo,Switch to APP-10028
10:40:00,prompt,APP-10002,s1,$repo,After
10:45:00,stop,APP-10002,s1,$repo,
11:00:00,prompt,APP-10002,s2,$dir,Other
11:10:00,stop,APP-10002,s2,$dir,
11:30:00,prompt,APP-10002,s3xx,$dir,Drop me
12:00:00,prompt,UNKNOWN,s4abcdef,$dir,Remap me
"@ | Set-Content (Join-Path $dir "2026-01-03.csv")
"s3 -`ns4ab 10032" | Set-Content (Join-Path $dir "2026-01-03.map")
# sessions.map applies to every date, before the date's map: s2 -> 10014 sticks, s4 -> 10013 is overridden by the date map.
"s2 10014`ns4 10013" | Set-Content (Join-Path $dir "sessions.map")
$out = & $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-01-03
Remove-Item (Join-Path $dir "sessions.map")
$rows = Rows $out
Check "commit back-fills, explicit prompt switches, sessions.map then date map remap and drop" (($rows | ForEach-Object { $_[3] }) -join "," -eq "10027,10028,10014,10032")
Check "switch lands at the explicit prompt's slot" (($rows | ForEach-Object { "$($_[0])-$($_[1])" }) -join "," -eq "10:00 AM-10:30 AM,10:30 AM-11:00 AM,11:00 AM-11:15 AM,12:00 PM-12:15 PM")
Check "Sessions list shows each session's tickets, dropped session absent" ($out -contains "s1        10027,10028  Start" -and -not ($out -like "s3xx*"))

# --- shared checkout: B's commit (its own commit event, and in the reflog) must not re-ticket A ---
$env:GIT_COMMITTER_DATE = $env:GIT_AUTHOR_DATE = "2026-01-05T10:10:00"
git -C $repo commit -q --allow-empty -m "#10031 B's work"
Remove-Item Env:GIT_COMMITTER_DATE, Env:GIT_AUTHOR_DATE
@"
10:00:00,prompt,APP-10002,sA,$repo,A starts
10:05:00,prompt,APP-10002,sB,$repo,B starts
10:10:00,commit,APP-10031*,sB,$repo,git commit -m "#10031 B's work"
10:15:00,stop,APP-10002,sB,$repo,
10:20:00,prompt,APP-10002,sA,$repo,A again
"@ | Set-Content (Join-Path $dir "2026-01-05.csv")
$out = & $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-01-05
Check "shared checkout: commit evidence stays with the session that made it" ($out -contains "sA        10002  A starts" -and $out -contains "sB        10031  B starts")

# --- -ExportJson: the re-ticketed events of test\export-day.csv, no prompt text, nothing printed, no .txt; the map drops e3 ---
Copy-Item "$PSScriptRoot\test\export-day.csv" (Join-Path $dir "2026-02-01.csv")
"e3 -" | Set-Content (Join-Path $dir "2026-02-01.map")
$json = Join-Path $dir "export.json"
$out = & $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-02-01 -ExportJson $json
$raw = Get-Content $json -Raw
$x = $raw | ConvertFrom-Json
Check "export prints nothing and writes no .txt" (-not $out -and -not (Test-Path (Join-Path $dir "2026-02-01.txt")))
Check "export keeps the 6 non-dropped events, in order, notification as notify" ($x.date -eq "2026-02-01" -and @($x.events).Count -eq 6 -and (($x.events | ForEach-Object { "$($_.time) $($_.kind)" }) -join ",") -eq "09:00:00 prompt,09:05:00 notify,09:10:00 agent,09:20:00 stop,10:00:00 prompt,10:10:00 stop")
Check "export has no text field and no prompt text" ($raw -notmatch '"text"\s*:' -and $raw -notmatch 'export-secret|Fix APP|Drop me|scout' -and (($x.events[0].PSObject.Properties.Name) -join ",") -eq "time,kind,session,ticket")
Check "/peer-review prompt marks its session review; cwd kept" ($x.sessions.e2.review -eq $true -and $x.sessions.e1.review -eq $false -and $x.sessions.e2.cwd -eq 'C:\x\AcmeApp-1006' -and -not $x.sessions.e3drop)
Check "APP-10030* exports as APP-10030, UNKNOWN as null" (((@($x.events | Where-Object session -eq e1) | ForEach-Object ticket | Sort-Object -Unique) -join ",") -eq "APP-10030" -and @($x.events | Where-Object { $_.session -eq "e2" -and $null -ne $_.ticket }).Count -eq 0)

# --- sync-timeline.ps1 -DryRun (pwsh only) on test\sync-*: per-event offsets across DST end, notes from the .txt (raw rows
# skipped), the Support Item flag from fake-ado, and an unchanged second run that skips and writes nothing ---
$sd = Join-Path $dir "sync"; $dry = Join-Path $dir "dry"
New-Item -ItemType Directory $sd | Out-Null
foreach ($f in "2026-10-19.csv", "2026-10-19.txt", "2026-11-01.csv", "2026-01-06.csv") { Copy-Item "$PSScriptRoot\test\sync-$f" (Join-Path $sd $f) }
$env:WORKLOG_DIR = $sd; $env:TIMELINE_SYNC_STATE = Join-Path $dir "sync-state"; $env:WORKLOG_ADO = "$PSScriptRoot\test\fake-ado.ps1"
$env:ORC_BOARD_URL = "https://claude.ai/artifact/test-board"  # never reads the real board.local.md
$sync ={ param($d) pwsh -NoProfile -File "$PSScriptRoot\sync-timeline.ps1" -Date $d -DryRun $dry 2>&1 | Out-String }
$o1 = & $sync 2026-10-19; $o2 = & $sync 2026-11-01
$raw = Get-Content (Join-Path $dry "timeline-2026-10-19.json") -Raw -ErrorAction SilentlyContinue
$rawDst = Get-Content (Join-Path $dry "timeline-2026-11-01.json") -Raw -ErrorAction SilentlyContinue
$a = $raw | ConvertFrom-Json
Check "sync dry run: events carry ISO times with the day's offset (EDT, then EST after DST end)" ($raw -match '"at":"2026-10-19T10:00:00-04:00"' -and $raw -match '"tz":"-04:00"' -and $rawDst -match '"at":"2026-11-01T10:00:00-05:00"' -and $rawDst -match '"tz":"-05:00"' -and @($a.events).Count -eq 5)
Check "sync doc: events are at/kind/session/ticket, no text field or prompt text" ((($a.events[0].PSObject.Properties.Name) -join ",") -eq "at,kind,session,ticket" -and ($raw -split '"blocks":')[0] -notmatch '"text"\s*:' -and $raw -notmatch 'sync-secret|Fix APP|scout|C:\\\\x')
Check "sync doc: sessions carry project and review" ($a.sessions.a2.project -eq "AcmeApp-hotfix" -and $a.sessions.a1.review -eq $false)
Check "sync notes: roll-up wins; a raw-only ticket falls back to its ADO type and title" ($a.notes.'APP-10034' -eq "Development: Built the order export dialog." -and $a.notes.'APP-10015' -eq "Support Item: Fake 10015")
Check "sync flags: Support Item is unplanned, a Task is not" ($a.flags.'APP-10015'.unplanned -eq $true -and -not $a.flags.'APP-10034')
Check "sync titles: every ticket with an ADO title, title only" ((($a.titles.PSObject.Properties.Name | Sort-Object) -join ",") -eq "APP-10015,APP-10034" -and $a.titles.'APP-10034' -eq "Fake 10034" -and $a.titles.'APP-10015' -eq "Fake 10015")
Check "sync blocks: every roll-up row in start order with local times, (raw) rows and ADO lines left out" ($raw.Contains('"blocks":[{"start":"2026-10-19T10:00:00-04:00","end":"2026-10-19T10:30:00-04:00","ticket":"APP-10034","text":"Development: Built the order export dialog."},{"start":"2026-10-19T10:30:00-04:00","end":"2026-10-19T10:45:00-04:00","ticket":"APP-10034","text":"Testing: A later row for the same ticket."}]') -and $raw -notmatch 'asked:|Rework the order export')
Check "sync blocks: a day with no .txt gets an empty list" ($rawDst -match '"blocks":\[\]')
Remove-Item (Join-Path $dry "timeline-2026-10-19.json") -ErrorAction SilentlyContinue
$o3 = & $sync 2026-10-19
Check "sync: unchanged inputs skip and write nothing" ($o1 -notmatch "unchanged" -and $o3 -match "timeline/2026-10-19 unchanged, skipped" -and -not (Test-Path (Join-Path $dry "timeline-2026-10-19.json")))
# The export keeps the worklog's ADO attribution even with WORKLOG_NOSUMMARY=1 inherited: 10006 rolls up to 10008 (fake-ado).
$null = & $sync 2026-01-06
Check "sync: a child ticket filed that day exports as its parent" (((Get-Content (Join-Path $dry "timeline-2026-01-06.json") -Raw | ConvertFrom-Json).events.ticket | Sort-Object -Unique) -join "," -eq "APP-10008")
$o4 = pwsh -NoProfile -File "$PSScriptRoot\sync-timeline.ps1" -Date 2026-11-01 2>&1 | Out-String
$pend = Join-Path $env:TIMELINE_SYNC_STATE "pending\timeline-2026-11-01.json"
Check "sync without -DryRun builds the pending file and says so" ($o4 -match "built timeline/2026-11-01 -> " -and (Get-Content $pend -Raw) -match '"date":"2026-11-01"')
# Local board: the fake CLI (ORC_BOARD_REPO) gets set timeline/<date> --file <pending> with the address's port; a failure keeps the file.
$env:ORC_BOARD_URL = "http://localhost:8499/"; $env:ORC_BOARD_REPO = "$PSScriptRoot\test\fake-board"
$env:FAKE_BOARD_LOG = Join-Path $dir "fake-board.log"; $env:FAKE_BOARD_EXIT = "1"
$o7 = pwsh -NoProfile -File "$PSScriptRoot\sync-timeline.ps1" -Date 2026-11-01 -Force 2>&1 | Out-String
Check "local board: a failed upload leaves the file pending" ($o7 -match "WARN upload of timeline/2026-11-01 exited 1; left pending" -and (Test-Path $pend))
$env:FAKE_BOARD_EXIT = "0"
$o8 = pwsh -NoProfile -File "$PSScriptRoot\sync-timeline.ps1" -Date 2026-11-01 -Force 2>&1 | Out-String
$calls = @(Get-Content $env:FAKE_BOARD_LOG)
Check "local board: set timeline/<date> --file <pending> on the address's port, then the file is deleted" ($o8 -match "uploaded timeline/2026-11-01" -and -not (Test-Path $pend) -and $calls.Count -eq 2 -and $calls[1] -eq "set timeline/2026-11-01 --file $pend port=8499")
$env:ORC_BOARD_URL = "https://claude.ai/artifact/test-board"
$o9 = pwsh -NoProfile -File "$PSScriptRoot\sync-timeline.ps1" -Date 2026-11-01 -Force 2>&1 | Out-String
Check "artifact board: the pending file stays for a Claude session and the CLI is not called" ((Test-Path $pend) -and @(Get-Content $env:FAKE_BOARD_LOG).Count -eq 2)
# Only an exact localhost / 127.0.0.1 host is local. A date with no log builds nothing, so only the upload step runs.
$upload = { param($url) $env:ORC_BOARD_URL = $url; $n = @(Get-Content $env:FAKE_BOARD_LOG).Count
    if (-not (Test-Path $pend)) { '{"date":"2026-11-01"}' | Set-Content $pend }
    $o = pwsh -NoProfile -File "$PSScriptRoot\sync-timeline.ps1" -Date 2026-12-31 2>&1 | Out-String
    @{ out = $o; called = (@(Get-Content $env:FAKE_BOARD_LOG).Count -gt $n); pending = (Test-Path $pend) } }
$e1 = & $upload "http://localhost.evil.example"; $e2 = & $upload "http://127.0.0.1.evil.example:80"
Check "lookalike hosts are not local: CLI not called, file stays pending" (-not $e1.called -and $e1.pending -and -not $e2.called -and $e2.pending)
$l1 = & $upload "http://localhost:8377/"; $l2 = & $upload "http://127.0.0.1"
Check "http://localhost:8377/ and http://127.0.0.1 are local" ($l1.called -and -not $l1.pending -and $l2.called -and -not $l2.pending -and (Get-Content $env:FAKE_BOARD_LOG)[-2] -match 'port=8377$')
# Missing node or CLI: one WARN, files left pending, no throw.
$env:ORC_BOARD_REPO = Join-Path $dir "no-such-board"
$m1 = & $upload "http://localhost:8499/"
Check "missing board CLI: one WARN, file left pending" ($m1.out -match "WARN cannot upload to http://localhost:8499/: the board CLI .* does not exist" -and $m1.pending -and $m1.out -notmatch "FAILED|Exception")
$env:ORC_BOARD_REPO = "$PSScriptRoot\test\fake-board"
$keepPath = $env:PATH; $env:PATH = ($env:PATH -split ';' | Where-Object { $_ -and -not (Test-Path (Join-Path $_ "node.exe")) }) -join ';'
$m2 = & $upload "http://localhost:8499/"
$env:PATH = $keepPath
Check "missing node: one WARN, file left pending" ($m2.out -match "WARN cannot upload to http://localhost:8499/: node is not on PATH" -and $m2.pending -and -not $m2.called)
$env:ORC_BOARD_URL = "https://claude.ai/artifact/test-board"
$env:ORC_BOARD_REPO = $null; $env:FAKE_BOARD_LOG = $null; $env:FAKE_BOARD_EXIT = $null
# A failed ADO type lookup leaves no marker, so the next run rebuilds (and retries the Unplanned flag).
$env:TIMELINE_SYNC_STATE = Join-Path $dir "sync-state-noado"; $env:WORKLOG_ADO = Join-Path $dir "no-such-ado.ps1"
$o5 = & $sync 2026-11-01; $o6 = & $sync 2026-11-01
Check "sync: failed type lookup writes no marker; the next run retries" ($o5 -match "WARN ADO type lookup failed for APP-10034" -and $o6 -match "WARN ADO type lookup failed" -and $o6 -notmatch "unchanged" -and -not (Test-Path (Join-Path $env:TIMELINE_SYNC_STATE "2026-11-01.hash")))
$noAdo = Get-Content (Join-Path $dry "timeline-2026-11-01.json") -Raw | ConvertFrom-Json
Check "sync notes: a ticket with no commit and no ADO gets no note or title, and the build survives" (@($noAdo.notes.PSObject.Properties).Count -eq 0 -and @($noAdo.titles.PSObject.Properties).Count -eq 0)
# Fallback notes: commit subjects from the session's repo for that day only, roll-up still wins, else the ADO type and title;
# an old string cache entry is read as the type and refreshed for its title.
$repo = Join-Path $dir "notes-repo"; New-Item -ItemType Directory $repo | Out-Null
git -C $repo init -q 2>&1 | Out-Null
foreach ($c in @(@("2026-10-20T12:00:00", "#10003 Wrong day"), @("2026-10-21T12:00:00", "#10034 Remove the unused export hint"), @("2026-10-21T13:00:00", "#10034 Add a second subject"), @("2026-10-21T14:00:00", "#10004 Commit subject loses to the roll-up"))) {
    $env:GIT_AUTHOR_DATE = $c[0]; $env:GIT_COMMITTER_DATE = $c[0]
    git -C $repo -c user.name=t -c user.email=t@t commit -q --allow-empty -m $c[1] 2>&1 | Out-Null
}
$env:GIT_AUTHOR_DATE = $null; $env:GIT_COMMITTER_DATE = $null
@("10:00:00,prompt,APP-10034,n1,$repo,secret prompt one", "10:10:00,prompt,APP-10004,n2,$repo,secret prompt two", "10:20:00,prompt,APP-10003,n3,$repo,secret prompt three", "10:30:00,stop,APP-10003,n3,$repo,") | Set-Content (Join-Path $sd "2026-10-21.csv")
"   START       END  HOURS  TICKET  TYPE        DESCRIPTION`n10:10 AM  10:20 AM   0.17  10004   Bug         Development: Roll-up description.`n11:30 PM  12:00 AM   0.50  10004   Bug         Testing: Late block.`n 1:15 PM   1:45 PM   0.50  10004   Bug         Development: Afternoon block." | Set-Content (Join-Path $sd "2026-10-21.txt")
$env:TIMELINE_SYNC_STATE = Join-Path $dir "sync-state-notes"; New-Item -ItemType Directory $env:TIMELINE_SYNC_STATE | Out-Null
'{"APP-10003":"User Story"}' | Set-Content (Join-Path $env:TIMELINE_SYNC_STATE "types.json")
$env:WORKLOG_ADO = "$PSScriptRoot\test\fake-ado.ps1"
$null = & $sync 2026-10-21
$rawN = Get-Content (Join-Path $dry "timeline-2026-10-21.json") -Raw; $n = $rawN | ConvertFrom-Json
Check "sync notes: commit subjects fallback (that day only, deduped, joined)" ($n.notes.'APP-10034' -eq "Add a second subject; Remove the unused export hint" -or $n.notes.'APP-10034' -eq "Remove the unused export hint; Add a second subject")
Check "sync notes: roll-up beats a commit subject" ($n.notes.'APP-10004' -eq "Development: Roll-up description.")
Check "sync notes: no commit falls back to ADO; an old string cache entry gets its title" ($n.notes.'APP-10003' -eq "User Story: Fake 10003" -and (Get-Content (Join-Path $env:TIMELINE_SYNC_STATE "types.json") -Raw) -match '"title"')
Check "sync notes: no prompt text in the doc" ($rawN -notmatch 'secret prompt')
Check "sync blocks: PM times, and a 12:00 AM end after a PM start is next midnight" ($rawN.Contains('{"start":"2026-10-21T13:15:00-04:00","end":"2026-10-21T13:45:00-04:00","ticket":"APP-10004","text":"Development: Afternoon block."},{"start":"2026-10-21T23:30:00-04:00","end":"2026-10-22T00:00:00-04:00","ticket":"APP-10004","text":"Testing: Late block."}]'))
$env:WORKLOG_DIR = $dir; $env:TIMELINE_SYNC_STATE = $null; $env:WORKLOG_ADO = $null; $env:ORC_BOARD_URL = $null

# --- ADO path via a fake ado.ps1 (WORKLOG_ADO) and a claude stub whose entry 2 echoes the wrong start time ---
New-Item -ItemType Directory (Join-Path $dir "bin") | Out-Null
"@echo 1^|09:00^|Development: Fixed the merge conflict.`r`n@echo 2^|09:45^|Wrong row.`r`n@echo 3^|10:00^|Testing: Checked the pipeline." | Set-Content (Join-Path $dir "bin\claude.cmd")
@"
09:00:00,prompt,APP-10002,s1,$repo,Can you please fix the merge conflict on pr 1001
09:10:00,stop,APP-10002,s1,$repo,
09:30:00,prompt,PR-1002*,s2,$repo,Look at PR #1002
09:40:00,stop,APP-10002,s2,$repo,
10:00:00,prompt,PR-1007*,s3,$repo,Check pr 1007
10:10:00,stop,APP-10002,s3,$repo,
"@ | Set-Content (Join-Path $dir "2026-01-04.csv")
$oldPath = $env:PATH; $env:PATH = "$(Join-Path $dir 'bin');$env:PATH"
$env:WORKLOG_NOSUMMARY = $null; $env:WORKLOG_ADO = "$PSScriptRoot\test\fake-ado.ps1"
$out = & $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-01-04 3>$null 2>$null
$wiql = Get-Content (Join-Path $dir "wiql.txt") -Raw
# Parent roll-up: 10006 -> 10007 -> 10008 (two hops, both filed that day), 10009 -> 10010, 10011 (filed earlier) keeps its own.
@"
09:00:00,prompt,APP-10006*,s1,$repo,Fix APP-10006
10:00:00,prompt,APP-10009*,s2,$repo,Fix APP-10009
11:00:00,prompt,APP-10011*,s3,$repo,Fix APP-10011
"@ | Set-Content (Join-Path $dir "2026-01-06.csv")
$up = Rows (& $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-01-06 3>$null 2>$null)
# WORKLOG_SUMMARY_CMD replaces the claude stub still first on PATH: the prompt arrives on stdin, the reply labels the entry.
"@more > `"%~dp0summary-in.txt`"`r`n@echo 1^|09:00^|Development: Ran the custom summary command." | Set-Content (Join-Path $dir "bin\summary.cmd")
"09:00:00,prompt,APP-10002,s1,$repo,Fix the thing`n09:10:00,stop,APP-10002,s1,$repo," | Set-Content (Join-Path $dir "2026-01-12.csv")
$env:WORKLOG_SUMMARY_CMD = Join-Path $dir "bin\summary.cmd"
$custom = Rows (& $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-01-12 3>$null 2>$null)
$env:WORKLOG_SUMMARY_CMD = $null
$stub = Rows (& $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-01-12 3>$null 2>$null)
Check "WORKLOG_SUMMARY_CMD: its reply is used and it got the prompt on stdin" ($custom[0][4] -eq "Development: Ran the custom summary command." -and (Get-Content (Join-Path $dir "bin\summary-in.txt") -Raw) -match '<worklog>')
Check "WORKLOG_SUMMARY_CMD unset: the claude call runs as before" ($stub[0][4] -eq "Development: Fixed the merge conflict.")
# A summary command past WORKLOG_SUMMARY_TIMEOUT has its whole tree killed: the grandchild never writes its late file.
$late = Join-Path $dir "bin\late.txt"
"@powershell -NoProfile -Command `"Start-Sleep 6; Set-Content -Path '$late' -Value late`"`r`n@echo 1^|09:00^|Development: Too late." | Set-Content (Join-Path $dir "bin\slow.cmd")
$env:WORKLOG_SUMMARY_CMD = Join-Path $dir "bin\slow.cmd"; $env:WORKLOG_SUMMARY_TIMEOUT = "2"
$slow = Rows (& $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-01-12 3>$null 2>$null)
$env:WORKLOG_SUMMARY_CMD = $null; $env:WORKLOG_SUMMARY_TIMEOUT = $null
Start-Sleep -Seconds 8
Check "WORKLOG_SUMMARY_CMD timeout: raw fallback and the process tree is killed" ($slow[0][4] -like "*(raw)" -and -not (Test-Path $late))
$env:PATH = $oldPath; $env:WORKLOG_NOSUMMARY = "1"; $env:WORKLOG_ADO = $null
Check "parent roll-up: two-hop chain, one hop, filed-earlier child stays" (($up | ForEach-Object { $_[3] }) -join "," -eq "10008,10010,10011")
$rows = Rows $out
Check "PR resolves to Task, then Bug; failed PR lookup keeps branch" (($rows | ForEach-Object { $_[3] }) -join "," -eq "10005,10004,10002")
Check "type column from wi-get" (($rows | ForEach-Object { $_[5] }) -join "," -eq "Task,Bug,Task")
Check "Touched in ADO lists changed items not in the table" ($out -contains "Touched in ADO, no time logged: 10033")
Check "Touched WIQL excludes items created that day" ($wiql -like "*[[]System.CreatedDate] < '2026-01-04'*")
Check "summary lines attach only when the echoed start time matches; a mismatch stays raw" ($rows[0][4] -eq "Development: Fixed the merge conflict." -and $rows[1][4] -like "*(raw)" -and $rows[2][4] -eq "Testing: Checked the pipeline.")

# --- ado-actions.ps1: only the user's own hand actions inside the day ---
. "$PSScriptRoot\ado-actions.ps1"
$me = @{ id = "me" }; $them = @{ id = "them" }
function Note($author, $type, $at, $content) { [pscustomobject]@{ author = $author; commentType = $type; publishedDate = ([datetime]"2026-01-08 $at").ToUniversalTime().ToString("o"); content = $content; isDeleted = $false } }
function Thread { [pscustomobject]@{ comments = @($args) } }
$from = [datetime]"2026-01-08"; $to = $from.AddDays(1)
$manual = Select-MyPrActions "me" 1 @(
    (Thread (Note $me system "09:00:00" "Me voted 10")), (Thread (Note $them system "09:15:00" "Them voted 10")), (Thread (Note $me system "09:30:00" "Me voted 0")),
    (Thread (Note $me text "10:00:00" "Looks good")), (Thread (Note $them text "10:15:00" "Reply")), (Thread (Note $me text "11:00:00" "Scheduled conflict sweep could not merge")),
    (Thread (Note $me system "12:00:00" "Me updated the pull request status to Completed")), (Thread (Note $me system "13:00:00" "Policy status has been updated"))) $from $to
Check "own votes, comments and a manual completion count; others, a vote reset, the sweep and policy events do not" (@($manual).time -join "," -eq "09:00:00,10:00:00,12:00:00")
Check "a vote says what it was" (@($manual)[0].text -eq "Reviewed a pull request in Azure DevOps: Approved")
$autoDone = Select-MyPrActions "me" 2 @((Thread (Note $them system "08:00:00" "Them set auto-complete")), (Thread (Note $me system "12:00:00" "Me updated the pull request status to Completed"))) $from $to
Check "a completion on an auto-complete PR is automation" (-not $autoDone)
$elsewhen = Select-MyPrActions "me" 3 @(Thread (Note $me text "12:00:00" "x")) $from.AddDays(1) $to.AddDays(1)
Check "an action on another day is left out" (-not $elsewhen)

# --- PR actions in the roll-up: one slot, on the PR's ticket, away from any session; a failed read warns and changes nothing ---
"09:00:00,prompt,APP-10002,s1,$repo,Morning work" | Set-Content (Join-Path $dir "2026-01-07.csv")
$env:PATH = "$(Join-Path $dir 'bin');$env:PATH"; $env:WORKLOG_NOSUMMARY = $null; $env:WORKLOG_ADO = "$PSScriptRoot\test\fake-ado.ps1"
$env:WORKLOG_FAKE_ACTIONS = "1"
$acted = Rows (& $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-01-07 3>$null 2>$null)
@"
15:20:00,prompt,APP-10002,s1,$repo,Afternoon work
"@ | Set-Content (Join-Path $dir "2026-01-09.csv")
$held = Rows (& $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-01-09 3>$null 2>$null)
Check "a PR action never takes a slot a session holds" ($held.Count -eq 1 -and $held[0][3] -eq "10002")
$env:WORKLOG_FAKE_ACTIONS = "comment"
"09:00:00,prompt,APP-10002,s1,$repo,Morning work", "15:24:10,ado,APP-10002,s2,$repo,ado.ps1 pr-comment-add -Pr 1001 -BodyFile x" | Set-Content (Join-Path $dir "2026-01-10.csv")
$byHand = Rows (& $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-01-07 3>$null 2>$null)
$bySession = Rows (& $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-01-10 3>$null 2>$null)
Check "a hand comment fills its slot; a session's logged comment does not" ($byHand.Count -eq 2 -and $bySession.Count -eq 1)
$env:WORKLOG_FAKE_ACTIONS = "fail"
$failed =Rows (& $exe -NoProfile -File "$PSScriptRoot\worklog.ps1" 2026-01-07 3>$null 2>$null)
$env:WORKLOG_FAKE_ACTIONS = $null; $env:PATH = $oldPath; $env:WORKLOG_NOSUMMARY = "1"; $env:WORKLOG_ADO = $null
Check "a PR action adds its own 15-minute slot on the PR's ticket" ($acted.Count -eq 2 -and $acted[1][0] -eq "3:15 PM" -and $acted[1][1] -eq "3:30 PM" -and $acted[1][3] -eq "10005")
Check "a failed actions read leaves the day as it was" ($failed.Count -eq 1 -and $failed[0][3] -eq "10002")

Remove-Item -Recurse -Force $dir
if ($fails) { "$fails FAILED"; exit 1 } else { "all passed" }
