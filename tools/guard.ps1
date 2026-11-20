<#
.SYNOPSIS
A PreToolUse hook on Bash|PowerShell that enforces the rulebook's hard git rules.

.DESCRIPTION
Deny: git commit on a protected branch, git push to a protected branch, git stash (other than list/show) in a linked
worktree, and git commit, push, merge, rebase, reset, clean, stash, rm, mv, checkout, switch and restore from
read-only roles (scout, researcher, refuter, review-*). Ask: force-push and git add -A|--all|. . Protected branches:
main, develop, master, or ORC_PROTECTED_BRANCHES (comma list).

It reads the command text only, so it is a seat belt, not a sandbox. Any failure exits 0 with one stderr line: a
broken guard never blocks a session. guard.mjs is the Node port; both take the hook JSON on stdin. Targets Windows
PowerShell 5.1 and PowerShell 7.

.EXAMPLE
'{"tool_name":"Bash","cwd":"C:/repo","tool_input":{"command":"git commit -m x"}}' | powershell -File guard.ps1
#>
# No Pester suite: the repo has none; tests/guard.test.mjs runs this script through the shared node:test payload table.
[CmdletBinding()]
param()
Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

$script:Warned = $false
function Write-GuardWarning {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Message)
    if ($script:Warned) { return }
    $script:Warned = $true
    [Console]::Error.WriteLine("guard: $Message")
}

function Get-GuardProperty {
    [CmdletBinding()]
    param($Object, [Parameter(Mandatory)][string]$Name)
    if ($null -eq $Object) { return $null }
    $p = $Object.PSObject.Properties[$Name]
    if ($p) { return $p.Value }
    return $null
}

# Splits a command line into segments of words on && || ; | & ( ) and newlines outside quotes. In Bash the result also
# holds '(' and ')' markers, so a subshell's cd does not leak out of it.
# Both: a # that starts a word outside quotes is a comment to the end of the line; an escape before a newline outside
# quotes joins the lines. Bash: backslash escapes outside quotes and some characters inside double quotes
# (backslash-newline joins there too); heredoc bodies are skipped; $( inside double quotes is read unquoted up to its
# ); $(( )) is one word. PowerShell: backtick escapes; backslash is literal (Windows paths); here-strings (@' '@,
# @" "@) are one word; <# #> is a comment.
function Split-GuardCommand {
    [CmdletBinding()]
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Text, [bool]$PowerShell)
    $segments = New-Object -TypeName System.Collections.ArrayList
    $words = New-Object -TypeName System.Collections.ArrayList
    $word = New-Object -TypeName System.Text.StringBuilder
    $heredocs = New-Object -TypeName System.Collections.ArrayList
    # One entry per open $( inside double quotes: its count of nested open parentheses.
    $subst = New-Object -TypeName 'System.Collections.Generic.List[int]'
    $inWord = $false
    $quote = ''
    $esc = if ($PowerShell) { '`' } else { '\' }
    # Characters that need a decision in each state; runs of other characters are copied in one step.
    $plainStop = [char[]]@(' ', "`t", "`n", "`r", "'", '"', '&', '|', ';', '(', ')', '<', '>', '#', '@', '$', $esc)
    $doubleStop = [char[]]@('"', '$', $esc)
    $n = $Text.Length
    $i = 0
    while ($i -lt $n) {
        $c = [string]$Text[$i]
        if ($quote -eq "'" -and $c -ne "'") {
            $k = $Text.IndexOf("'", $i)
            if ($k -lt 0) { $k = $n }
            [void]$word.Append($Text, $i, $k - $i); $i = $k
            continue
        }
        if ($quote -eq '"' -and $doubleStop -notcontains $Text[$i]) {
            $k = $Text.IndexOfAny($doubleStop, $i)
            if ($k -lt 0) { $k = $n }
            [void]$word.Append($Text, $i, $k - $i); $i = $k
            continue
        }
        if (-not $quote -and $plainStop -notcontains $Text[$i]) {
            $k = $Text.IndexOfAny($plainStop, $i)
            if ($k -lt 0) { $k = $n }
            [void]$word.Append($Text, $i, $k - $i); $i = $k; $inWord = $true
            continue
        }
        $next = if ($i + 1 -lt $n) { [string]$Text[$i + 1] } else { '' }
        $prev = if ($i -gt 0) { [string]$Text[$i - 1] } else { '' }
        if (-not $quote -and $PowerShell -and $c -eq '@' -and ($next -eq "'" -or $next -eq '"') -and
            $Text.Substring($i + 2, [Math]::Min(62, $n - $i - 2)) -match '^[ \t]*\r?\n') {
            $close = $Text.IndexOf("`n$next@", $i + 2)
            $i = if ($close -lt 0) { $n } else { $close + 3 }
            $inWord = $true
            continue
        }
        if (-not $quote -and -not $inWord -and $PowerShell -and $c -eq '<' -and $next -eq '#') {
            $close = $Text.IndexOf('#>', $i + 2)
            $i = if ($close -lt 0) { $n } else { $close + 2 }
            continue
        }
        if (-not $quote -and -not $inWord -and $c -eq '#') {
            # A comment runs to the newline, which is still read (it ends the segment and starts any heredoc body).
            $e = $Text.IndexOf("`n", $i)
            $i = if ($e -lt 0) { $n } else { $e }
            continue
        }
        if ($quote -ne "'" -and -not $PowerShell -and $c -eq '$' -and $next -eq '(' -and $i + 2 -lt $n -and [string]$Text[$i + 2] -eq '(') {
            # Arithmetic $(( )): one word, so a << inside it is a shift, not a heredoc.
            $depth = 0
            $k = $i + 1
            for (; $k -lt $n; $k++) {
                $ch = [string]$Text[$k]
                if ($ch -eq '(') { $depth++ }
                elseif ($ch -eq ')') { $depth--; if ($depth -eq 0) { break } }
            }
            $end = [Math]::Min($k, $n - 1)
            [void]$word.Append($Text, $i, $end - $i + 1); $inWord = $true
            $i = $k + 1
            continue
        }
        if ($quote -eq '"' -and -not $PowerShell -and $c -eq '$' -and $next -eq '(') {
            # Command substitution inside double quotes: read it unquoted until its matching ).
            $subst.Add(0)
            $quote = ''
            if ($inWord) { [void]$words.Add($word.ToString()) }
            [void]$word.Clear(); $inWord = $false
            if ($words.Count) { [void]$segments.Add([string[]]$words.ToArray()) }
            $words.Clear()
            [void]$segments.Add('(')
            $i += 2
            continue
        }
        if (-not $quote -and -not $PowerShell -and $c -eq '<' -and $next -eq '<') {
            if ($i + 2 -lt $n -and [string]$Text[$i + 2] -eq '<') {
                [void]$word.Append('<<<'); $inWord = $true; $i += 3
                continue
            }
            # A heredoc: read its delimiter (quoted or not); the body is skipped at the next newline.
            if ($inWord) { [void]$words.Add($word.ToString()) }
            [void]$word.Clear(); $inWord = $false
            $j = $i + 2
            $strip = $j -lt $n -and [string]$Text[$j] -eq '-'
            if ($strip) { $j++ }
            while ($j -lt $n -and ([string]$Text[$j] -eq ' ' -or [string]$Text[$j] -eq "`t")) { $j++ }
            $delim = New-Object -TypeName System.Text.StringBuilder
            while ($j -lt $n -and -not " `t`n`r;&|()<>".Contains([string]$Text[$j])) {
                $q = [string]$Text[$j]
                if ($q -eq "'" -or $q -eq '"') {
                    $end = $Text.IndexOf($q, $j + 1)
                    if ($end -lt 0) { $end = $n }
                    [void]$delim.Append($Text.Substring($j + 1, $end - $j - 1))
                    $j = $end + 1
                } elseif ($q -eq '\') {
                    if ($j + 1 -lt $n) { [void]$delim.Append([string]$Text[$j + 1]) }
                    $j += 2
                } else {
                    [void]$delim.Append($q); $j++
                }
            }
            if ($delim.Length) { [void]$heredocs.Add(@{ Delim = $delim.ToString(); Strip = $strip }) }
            $i = $j
            continue
        }
        # Length of a newline right after an escape (0 when there is none).
        $nl = 0
        if ($c -eq $esc -and $next -eq "`n") { $nl = 1 }
        elseif ($c -eq $esc -and $next -eq "`r" -and $i + 2 -lt $n -and [string]$Text[$i + 2] -eq "`n") { $nl = 2 }
        if ($quote -eq "'") {
            if ($c -eq "'" -and $PowerShell -and $next -eq "'") { [void]$word.Append("'"); $i++ }
            elseif ($c -eq "'") { $quote = '' }
            else { [void]$word.Append($c) }
        } elseif ($quote -eq '"') {
            if ($nl -and -not $PowerShell) { $i += $nl }
            elseif ($c -eq $esc -and $next -ne '' -and ($PowerShell -or "`"\`$``".Contains($next) -or $next -eq "`n")) { [void]$word.Append($next); $i++ }
            elseif ($c -eq '"') { $quote = '' }
            else { [void]$word.Append($c) }
        } elseif ($nl) {
            # A line continuation.
            $i += $nl
        } elseif ($c -eq $esc -and $next -ne '') {
            [void]$word.Append($next); $i++; $inWord = $true
        } elseif ($c -eq "'" -or $c -eq '"') {
            $quote = $c; $inWord = $true
        } elseif ($c -eq '&' -and ($prev -eq '>' -or $prev -eq '<' -or $next -eq '>')) {
            # A redirection (2>&1, &>file), not a separator.
            [void]$word.Append($c); $inWord = $true
        } elseif ('&|;()'.Contains($c) -or $c -eq "`n" -or $c -eq "`r") {
            if ($inWord) { [void]$words.Add($word.ToString()) }
            [void]$word.Clear(); $inWord = $false
            if ($words.Count) { [void]$segments.Add([string[]]$words.ToArray()) }
            $words.Clear()
            if (-not $PowerShell -and $c -eq '(') {
                [void]$segments.Add($c)
                if ($subst.Count) { $t = $subst.Count - 1; $subst[$t] = $subst[$t] + 1 }
            }
            if (-not $PowerShell -and $c -eq ')') {
                [void]$segments.Add($c)
                if ($subst.Count) {
                    $t = $subst.Count - 1
                    if ($subst[$t] -eq 0) {
                        # Back inside the double-quoted word the substitution sat in.
                        $subst.RemoveAt($t); $quote = '"'; $inWord = $true
                    } else { $subst[$t] = $subst[$t] - 1 }
                }
            }
            if ($c -eq "`n" -and $heredocs.Count) {
                # Skip each pending heredoc body up to its terminator line (leading tabs dropped for <<-).
                $pos = $i + 1
                foreach ($h in $heredocs) {
                    while ($pos -lt $n) {
                        $e = $Text.IndexOf("`n", $pos)
                        $lineEnd = if ($e -lt 0) { $n } else { $e }
                        $line = $Text.Substring($pos, $lineEnd - $pos).TrimEnd([char]13)
                        if ($h.Strip) { $line = $line.TrimStart([char]9) }
                        $pos = if ($e -lt 0) { $n } else { $e + 1 }
                        if ($line -ceq $h.Delim) { break }
                    }
                }
                $heredocs.Clear()
                $i = $pos
                continue
            }
        } elseif ($c -eq ' ' -or $c -eq "`t") {
            if ($inWord) { [void]$words.Add($word.ToString()) }
            [void]$word.Clear(); $inWord = $false
        } else {
            [void]$word.Append($c); $inWord = $true
        }
        $i++
    }
    if ($inWord) { [void]$words.Add($word.ToString()) }
    if ($words.Count) { [void]$segments.Add([string[]]$words.ToArray()) }
    return , $segments
}

# Drops what can stand in front of the command: VAR=value, shell keywords, ! { }, and the wrappers time, env,
# command, exec and nohup with their options.
function Remove-GuardPrefix {
    [CmdletBinding()]
    param([Parameter(Mandatory)][AllowEmptyCollection()][AllowEmptyString()][string[]]$Words)
    $prefixWords = 'then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', '{', '}'
    $wrappers = 'time', 'env', 'command', 'exec', 'nohup'
    $k = 0
    while ($k -lt $Words.Count) {
        $h = $Words[$k].ToLowerInvariant()
        if ($Words[$k] -match '^[A-Za-z_][A-Za-z0-9_]*=' -or $prefixWords -contains $h) { $k++ }
        elseif ($wrappers -contains $h) {
            $k++
            while ($k -lt $Words.Count -and $Words[$k].StartsWith('-')) {
                if ($h -eq 'env' -and ('-u', '--unset', '-C', '--chdir' -ccontains $Words[$k])) { $k++ }
                $k++
            }
        } else { break }
    }
    if ($k -ge $Words.Count) { return , ([string[]]@()) }
    return , ([string[]]$Words[$k..($Words.Count - 1)])
}

# Git Bash writes C: as /c; ~ is the home directory.
function Resolve-GuardDirectory {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Base, [Parameter(Mandatory)][AllowEmptyString()][string]$Dir)
    $d = $Dir
    if ($d -eq '~' -or $d.StartsWith('~/') -or $d.StartsWith('~\')) { $d = $HOME + $d.Substring(1) }
    $onWindows = [System.IO.Path]::DirectorySeparatorChar -eq '\'
    if ($onWindows -and $d -match '^/([a-zA-Z])(/.*)?$') {
        $rest = if ($Matches[2]) { $Matches[2] } else { '/' }
        $d = "$($Matches[1]):$rest"
    }
    return [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($Base, $d))
}

function Invoke-GuardGit {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Cwd, [Parameter(Mandatory)][string[]]$Arguments)
    $psi = New-Object -TypeName System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'git'
    $psi.Arguments = ($Arguments | ForEach-Object { if ($_ -match '\s') { "`"$_`"" } else { $_ } }) -join ' '
    $psi.WorkingDirectory = $Cwd
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $out = $p.StandardOutput.ReadToEndAsync()
    $err = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit(3000)) {
        try { $p.Kill() } catch { Write-GuardWarning -Message "could not stop git: $($_.Exception.Message)" }
        throw "git did not answer in $Cwd"
    }
    [void]$err.Wait(1000)
    return @{ Code = $p.ExitCode; Out = $out.Result }
}

function ConvertTo-GuardPathKey {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)
    $s = $Path.Trim().Replace('\', '/').TrimEnd('/')
    if ([System.IO.Path]::DirectorySeparatorChar -eq '\') { $s = $s.ToLowerInvariant() }
    return $s
}

# Current branch ($null when detached; unborn counts as its branch) and whether the directory is a linked worktree.
$script:ProbeCache = @{}
function Get-GuardRepoState {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Cwd)
    if ($script:ProbeCache.ContainsKey($Cwd)) { return $script:ProbeCache[$Cwd] }
    $info = @{ Branch = $null; Linked = $false }
    try {
        if (-not (Test-Path -LiteralPath $Cwd -PathType Container)) { throw "no directory $Cwd" }
        $b = Invoke-GuardGit -Cwd $Cwd -Arguments @('symbolic-ref', '--short', '-q', 'HEAD')
        if ($b.Code -eq 0 -and $b.Out.Trim()) { $info.Branch = $b.Out.Trim() }
        $d = Invoke-GuardGit -Cwd $Cwd -Arguments @('rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir')
        if ($d.Code -eq 0) {
            $lines = @($d.Out -split '\r?\n')
            if ($lines.Count -ge 2 -and $lines[0] -and $lines[1]) {
                $info.Linked = (ConvertTo-GuardPathKey -Path $lines[0]) -ne (ConvertTo-GuardPathKey -Path $lines[1])
            }
        }
    } catch {
        Write-GuardWarning -Message "$($_.Exception.Message)"
    }
    $script:ProbeCache[$Cwd] = $info
    return $info
}

# Local branch names for push --all; every protected name when git cannot list them.
function Get-GuardLocalBranch {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Cwd, [Parameter(Mandatory)][string[]]$Protected)
    try {
        $r = Invoke-GuardGit -Cwd $Cwd -Arguments @('for-each-ref', '--format=%(refname:short)', 'refs/heads')
        if ($r.Code -eq 0) { return , ([string[]]@($r.Out -split '\r?\n' | Where-Object { $_ })) }
    } catch {
        Write-GuardWarning -Message "$($_.Exception.Message)"
    }
    return , $Protected
}

function Get-GuardShortFlag {
    [CmdletBinding()]
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Arg)
    if ($Arg -cmatch '^-[a-zA-Z]+$') { return $Arg.Substring(1) }
    return ''
}

# One git invocation: returns @{Decision; Reason} or $null.
function Test-GuardGit {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Sub,
        [Parameter(Mandatory)][AllowEmptyCollection()][AllowEmptyString()][string[]]$GitArgs,
        [Parameter(Mandatory)][string]$Cwd,
        [Parameter(Mandatory)][string[]]$Protected,
        [AllowEmptyString()][string]$Role
    )
    $readOnlyDenied = 'commit', 'push', 'merge', 'rebase', 'reset', 'clean', 'stash', 'rm', 'mv', 'checkout', 'switch', 'restore'
    if ($Role -and $readOnlyDenied -ccontains $Sub) {
        return @{ Decision = 'deny'; Reason = "guard: read-only-role: $Role may not run git $Sub" }
    }
    if ($Sub -ceq 'commit') {
        $branch = (Get-GuardRepoState -Cwd $Cwd).Branch
        if ($null -ne $branch -and $Protected -ccontains $branch) {
            return @{ Decision = 'deny'; Reason = "guard: protected-branch: git commit on $branch is blocked; create a branch first" }
        }
        return $null
    }
    if ($Sub -ceq 'push') {
        $force = $false
        $everything = ''
        $tags = $false
        $positional = New-Object -TypeName System.Collections.ArrayList
        for ($i = 0; $i -lt $GitArgs.Count; $i++) {
            $a = $GitArgs[$i]
            if ($a -ceq '--force' -or $a.StartsWith('--force-with-lease') -or (Get-GuardShortFlag -Arg $a).Contains('f')) { $force = $true }
            elseif ($a -ceq '--all' -or $a -ceq '--branches') { $everything = 'local' }
            elseif ($a -ceq '--mirror') { $everything = 'all' }
            elseif ($a -ceq '--tags') { $tags = $true }
            elseif ('-o', '--push-option', '--repo', '--receive-pack', '--exec' -ccontains $a) { $i++ }
            elseif (-not $a.StartsWith('-')) { [void]$positional.Add($a) }
        }
        $refspecs = @($positional | Select-Object -Skip 1)
        $dests = New-Object -TypeName System.Collections.ArrayList
        foreach ($r in $refspecs) {
            if ($r.StartsWith('+')) { $force = $true }
            $s = $r.TrimStart('+')
            $dst = if ($s.Contains(':')) { $s.Substring($s.IndexOf(':') + 1) } else { $s }
            if ($dst.StartsWith('refs/heads/')) { $dst = $dst.Substring(11) }
            if ($dst -ceq 'HEAD' -or $dst -ceq '@') { $dst = (Get-GuardRepoState -Cwd $Cwd).Branch }
            [void]$dests.Add($dst)
        }
        # No refspec: --all reaches every local branch, --mirror every branch (it also deletes remote ones it lacks),
        # --tags pushes only tags, otherwise the current branch.
        if (-not $refspecs.Count) {
            if ($everything -eq 'local') { foreach ($p in (Get-GuardLocalBranch -Cwd $Cwd -Protected $Protected)) { [void]$dests.Add($p) } }
            elseif ($everything) { foreach ($p in $Protected) { [void]$dests.Add($p) } }
            elseif (-not $tags) { [void]$dests.Add((Get-GuardRepoState -Cwd $Cwd).Branch) }
        }
        foreach ($dst in $dests) {
            if ($null -ne $dst -and $Protected -ccontains $dst) {
                return @{ Decision = 'deny'; Reason = "guard: protected-branch: git push to $dst is blocked; push a branch and open a pull request" }
            }
        }
        if ($force) { return @{ Decision = 'ask'; Reason = 'guard: force-push: this rewrites the remote branch; confirm it is yours' } }
        return $null
    }
    if ($Sub -ceq 'stash') {
        $action = @($GitArgs | Where-Object { -not $_.StartsWith('-') } | Select-Object -First 1)
        if ($action.Count -and ($action[0] -ceq 'list' -or $action[0] -ceq 'show')) { return $null }
        if ((Get-GuardRepoState -Cwd $Cwd).Linked) {
            return @{ Decision = 'deny'; Reason = 'guard: worktree-stash: git stash in a linked worktree is blocked; all worktrees share one stash stack' }
        }
        return $null
    }
    if ($Sub -ceq 'add') {
        foreach ($a in $GitArgs) {
            if ($a -ceq '--all' -or $a -ceq '.' -or $a -ceq './' -or (Get-GuardShortFlag -Arg $a).Contains('A')) {
                return @{ Decision = 'ask'; Reason = "guard: broad-add: git add $a stages every change; confirm nothing stray is included" }
            }
        }
    }
    return $null
}

# Returns @{Decision; Reason} for the strongest rule hit (deny before ask), or $null to allow.
function Get-GuardDecision {
    [CmdletBinding()]
    param($Hook)
    $command = Get-GuardProperty -Object (Get-GuardProperty -Object $Hook -Name 'tool_input') -Name 'command'
    if ($command -isnot [string]) { Write-GuardWarning -Message 'no tool_input.command in the payload; allowed'; return $null }
    if ($command -notmatch 'git') { return $null }
    $cwd = Get-GuardProperty -Object $Hook -Name 'cwd'
    if ($cwd -isnot [string] -or -not $cwd) { $cwd = (Get-Location).ProviderPath }
    $protected = @("$env:ORC_PROTECTED_BRANCHES" -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if (-not $protected.Count) { $protected = @('main', 'develop', 'master') }
    $agent = ("$(Get-GuardProperty -Object $Hook -Name 'agent_type')" -split ':')[-1].Trim().ToLowerInvariant()
    $role = if ('scout', 'researcher', 'refuter' -contains $agent -or $agent.StartsWith('review-')) { $agent } else { '' }
    $powerShellTool = "$(Get-GuardProperty -Object $Hook -Name 'tool_name')" -ceq 'PowerShell'
    $cdCommands = 'cd', 'set-location', 'sl', 'chdir', 'pushd', 'push-location'
    $subshells = New-Object -TypeName System.Collections.Stack
    $ask = $null
    foreach ($seg in (Split-GuardCommand -Text $command -PowerShell $powerShellTool)) {
        if ($seg -is [string]) {
            if ($seg -eq '(') { $subshells.Push($cwd) } elseif ($subshells.Count) { $cwd = $subshells.Pop() }
            continue
        }
        $words = Remove-GuardPrefix -Words $seg
        if (-not $words.Count) { continue }
        if ($cdCommands -contains $words[0].ToLowerInvariant()) {
            $target = @($words | Select-Object -Skip 1 | Where-Object { $_ -notmatch '^-(path|literalpath)$' } | Select-Object -First 1)
            if ($target.Count -and $target[0] -ne '-') { $cwd = Resolve-GuardDirectory -Base $cwd -Dir $target[0] }
            continue
        }
        $exe = $words[0].Replace('\', '/')
        if ($exe.Substring($exe.LastIndexOf('/') + 1) -notmatch '^git(\.exe)?$') { continue }
        $dir = $cwd
        $i = 1
        while ($i -lt $words.Count -and $words[$i].StartsWith('-')) {
            $o = $words[$i]
            if ($o -ceq '-C') {
                $i++
                $target = if ($i -lt $words.Count) { $words[$i] } else { '.' }
                $dir = Resolve-GuardDirectory -Base $dir -Dir $target
            } elseif ('-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env' -ccontains $o) { $i++ }
            $i++
        }
        if ($i -ge $words.Count) { continue }
        $sub = $words[$i]
        # Drop redirections: a bare operator also takes its target.
        $gitArgs = New-Object -TypeName System.Collections.ArrayList
        for ($j = $i + 1; $j -lt $words.Count; $j++) {
            if ($words[$j] -match '^(\d|\*|&)?>>?|^<') {
                if ($Matches[0] -ceq $words[$j]) { $j++ }
            } else { [void]$gitArgs.Add($words[$j]) }
        }
        $verdict = Test-GuardGit -Sub $sub -GitArgs ([string[]]$gitArgs.ToArray()) -Cwd $dir -Protected $protected -Role $role
        if ($verdict -and $verdict.Decision -eq 'deny') { return $verdict }
        if ($verdict -and -not $ask) { $ask = $verdict }
    }
    return $ask
}

try {
    # UTF-8 whatever the console code page, so a non-ASCII cwd survives on Windows PowerShell 5.1.
    $utf8 = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $false
    $reader = New-Object -TypeName System.IO.StreamReader -ArgumentList ([Console]::OpenStandardInput()), $utf8
    $raw = $reader.ReadToEnd()
    $hook = $raw.TrimStart([char]0xFEFF) | ConvertFrom-Json
    $verdict = Get-GuardDecision -Hook $hook
    if ($verdict) {
        @{ hookSpecificOutput = @{
            hookEventName            = 'PreToolUse'
            permissionDecision       = $verdict.Decision
            permissionDecisionReason = $verdict.Reason
        } } | ConvertTo-Json -Compress
    }
} catch {
    Write-GuardWarning -Message "$($_.Exception.Message); allowed"
}
exit 0
