# Replays a peon-ping "input required" line until a pending question or approval is answered.
# Hook modes (hook JSON on stdin): -Mode start on PermissionRequest / PreToolUse AskUserQuestion,
# -Mode stop on UserPromptSubmit / Stop. -Mode loop is the hidden background replayer.
# The loop also ends by itself once the session transcript grows (the answer or the tool result
# was written), after $MaxMinutes, or when peon-ping is paused.
param([string]$Mode = "start", [string]$Session = "", [string]$Transcript = "", [string]$Id = "", [switch]$PlayNow)

$IntervalSeconds = if ($env:PEON_NAG_SECONDS) { [int]$env:PEON_NAG_SECONDS } else { 120 }
$MaxMinutes = 15
$AngryAfter = 3   # replays before the peon gets annoyed (user.spam sounds)

$peonDir = Join-Path $HOME '.claude\hooks\peon-ping'
$nagDir = Join-Path $env:TEMP 'peon-nag'

function Read-Json([string]$path){ try { Get-Content -Raw -Encoding UTF8 $path | ConvertFrom-Json } catch { $null } }
function Marker([string]$sid){ Join-Path $nagDir (($sid -replace '[^\w-]', '_') + '.id') }
function Size([string]$p){ if ($p -and (Test-Path $p)) { (Get-Item $p).Length } else { -1 } }

function Play([string]$category){
  $cfg = Read-Json (Join-Path $peonDir 'config.json')
  if (-not $cfg -or $cfg.enabled -eq $false) { return $false }
  $pack = if ($cfg.default_pack) { $cfg.default_pack } else { 'peon' }
  $m = Read-Json (Join-Path $peonDir "packs\$pack\openpeon.json")
  $sounds = @($m.categories.$category.sounds)
  if (-not $sounds.Count) { $sounds = @($m.categories.'input.required'.sounds) }
  if (-not $sounds.Count) { return $true }
  $file = Join-Path $peonDir ("packs\$pack\" + ($sounds | Get-Random).file)
  $vol = if ($cfg.volume) { $cfg.volume } else { 0.5 }
  & powershell -NoProfile -NonInteractive -File (Join-Path $peonDir 'scripts\win-play.ps1') -path $file -vol $vol | Out-Null
  return $true
}

if ($Mode -eq 'loop'){
  $marker = Marker $Session
  # Baseline after a moment, so lines written as the prompt opens do not count as an answer.
  Start-Sleep -Seconds 3
  $base = Size $Transcript
  $deadline = (Get-Date).AddMinutes($MaxMinutes)
  if ($PlayNow -and -not (Play 'input.required')) { exit 0 }
  $n = 0
  while ((Get-Date) -lt $deadline){
    Start-Sleep -Seconds $IntervalSeconds
    if (-not (Test-Path $marker) -or (Get-Content -Raw $marker).Trim() -ne $Id) { exit 0 }   # stopped, or a newer loop took over
    if ((Size $Transcript) -ne $base) { break }
    $n++
    if (-not (Play ($(if ($n -gt $AngryAfter) { 'user.spam' } else { 'input.required' })))) { break }
  }
  if ((Test-Path $marker) -and (Get-Content -Raw $marker).Trim() -eq $Id) { Remove-Item $marker -ErrorAction SilentlyContinue }
  exit 0
}

# Hook modes. Headless runs (claude -p, the SDK) have nobody to nag.
if ($env:CLAUDE_CODE_ENTRYPOINT -like 'sdk*') { exit 0 }
try { $ev = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch { exit 0 }
$sid = [string]$ev.session_id
if (-not $sid) { exit 0 }
$marker = Marker $sid

if ($Mode -eq 'stop'){ Remove-Item $marker -ErrorAction SilentlyContinue; exit 0 }

New-Item -ItemType Directory -Force $nagDir | Out-Null
$newId = [guid]::NewGuid().ToString('N')
[IO.File]::WriteAllText($marker, $newId)
# peon.ps1 already plays a sound for PermissionRequest; AskUserQuestion gets its first one here.
# One quoted string: Start-Process drops empty array items, which would shift the named values.
$loopArgs = "-NoProfile -NonInteractive -WindowStyle Hidden -File `"$PSCommandPath`" -Mode loop -Session `"$sid`" -Transcript `"$($ev.transcript_path)`" -Id $newId"
if ($ev.hook_event_name -eq 'PreToolUse') { $loopArgs += ' -PlayNow' }
Start-Process powershell -ArgumentList $loopArgs -WindowStyle Hidden
exit 0
