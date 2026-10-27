# PostToolUse hook on ArtifactData: when the orchestrator writes a board session doc with a title, names this
# Claude Code session the same, by appending the custom-title line /rename writes to the session transcript.
try { $ev = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch { exit 0 }
$t = $ev.tool_input
$path = [string]$ev.transcript_path
if (-not $t -or -not $path -or -not (Test-Path $path)) { exit 0 }

function TitleOf($w){
  if ($w.collection -ne 'sessions' -or $w.op -eq 'delete' -or $w.action -eq 'delete') { return $null }
  $d = $w.data
  if (-not $d -and $w.file_path -and (Test-Path $w.file_path)) { try { $d = Get-Content -Raw -Encoding UTF8 $w.file_path | ConvertFrom-Json } catch { } }
  if ($d -and $d.title) { [string]$d.title } else { $null }
}
$writes = if ($t.action -eq 'batch') { @($t.writes) } elseif ($t.action -in 'set', 'update') { @($t) } else { @() }
$title = $writes | ForEach-Object { TitleOf $_ } | Where-Object { $_ } | Select-Object -Last 1
if (-not $title) { exit 0 }

# Skip when the transcript already carries this title last.
$last = Select-String -Path $path -Pattern '"type":"custom-title"' -SimpleMatch | Select-Object -Last 1
if ($last -and ($last.Line | ConvertFrom-Json).customTitle -eq $title) { exit 0 }

$line = [ordered]@{ type = 'custom-title'; customTitle = $title; sessionId = [string]$ev.session_id } | ConvertTo-Json -Compress
[IO.File]::AppendAllText($path, $line + "`n", [Text.UTF8Encoding]::new($false))
exit 0