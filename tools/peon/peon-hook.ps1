# The one hook entry for peon-ping (Windows). Skips headless runs (claude -p, the SDK), so scheduled
# jobs stay silent, then runs peon.ps1 in this same process, which reads the hook JSON from stdin.
if ($env:CLAUDE_CODE_ENTRYPOINT -like 'sdk*') { exit 0 }
$peon = Join-Path $HOME '.claude\hooks\peon-ping\peon.ps1'
if (Test-Path $peon) { & $peon }
exit 0
