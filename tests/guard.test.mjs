// tools/guard.mjs and tools/guard.ps1: one table of real PreToolUse payloads, fed through stdin to each hook.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadRoles } from '../tools/orc.mjs';
import { run as runGuard } from '../tools/guard.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MJS = path.join(REPO, 'tools', 'guard.mjs');
const PS1 = path.join(REPO, 'tools', 'guard.ps1');

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

// A main checkout on `main` and a linked worktree on `feature`, both real.
function makeRepos() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orc-guard-')));
  const main = path.join(root, 'repo');
  const wt = path.join(root, 'wt');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(main, 'file.txt'), 'x\n');
  git(main, 'add', 'file.txt');
  git(main, 'commit', '-q', '-m', 'seed');
  git(main, 'worktree', 'add', '-q', '-b', 'feature', wt);
  const develop = path.join(root, 'dev');
  fs.mkdirSync(develop);
  git(develop, 'init', '-q', '-b', 'develop');
  // A non-ASCII folder name: stdin must reach the hook as UTF-8.
  const accented = path.join(root, 'naïve');
  fs.mkdirSync(accented);
  git(accented, 'init', '-q', '-b', 'main');
  // Only an unprotected branch exists locally.
  const trunk = path.join(root, 'trunk');
  fs.mkdirSync(trunk);
  git(trunk, 'init', '-q', '-b', 'trunk');
  fs.writeFileSync(path.join(trunk, 'file.txt'), 'x\n');
  git(trunk, 'add', 'file.txt');
  git(trunk, 'commit', '-q', '-m', 'seed');
  // Braces in a folder name: a PowerShell block split must keep the word whole.
  const braces = path.join(root, 'br{x}');
  fs.mkdirSync(braces);
  git(braces, 'init', '-q', '-b', 'main');
  // A .git file pointing nowhere: git answers with exit 128 instead of a branch.
  const broken = path.join(root, 'broken');
  fs.mkdirSync(broken);
  fs.writeFileSync(path.join(broken, '.git'), `gitdir: ${path.join(root, 'nowhere')}\n`);
  return { root, main, wt, develop, accented, trunk, braces, broken };
}

const R = makeRepos();
const fwd = (p) => p.replace(/\\/g, '/');

// Every case: where it runs, the tool, the command, and the expected decision (reason pattern for deny/ask).
const CASES = [
  { name: 'commit on main', cwd: 'main', cmd: 'git commit -m "x"', expect: 'deny', reason: /protected-branch: git commit on main/ },
  { name: 'commit on main with an empty message', cwd: 'main', cmd: 'git commit --allow-empty-message -m ""', expect: 'deny', reason: /commit on main/ },
  { name: 'commit on a feature branch', cwd: 'wt', cmd: 'git commit -m "x"', expect: 'allow' },
  { name: 'commit on unborn develop', cwd: 'develop', cmd: 'git commit -m x', expect: 'deny', reason: /on develop/ },
  { name: 'push origin main', cwd: 'wt', cmd: 'git push origin main', expect: 'deny', reason: /protected-branch: git push to main/ },
  { name: 'push origin feature', cwd: 'main', cmd: 'git push origin feature', expect: 'allow' },
  { name: 'push HEAD:main refspec', cwd: 'wt', cmd: 'git push -u origin HEAD:refs/heads/main', expect: 'deny', reason: /push to main/ },
  { name: 'bare push while on main', cwd: 'main', cmd: 'git push', expect: 'deny', reason: /push to main/ },
  { name: 'bare push while on feature', cwd: 'wt', cmd: 'git push', expect: 'allow' },
  { name: 'push HEAD while on feature', cwd: 'wt', cmd: 'git push origin HEAD 2>&1', expect: 'allow' },
  { name: 'force-push a feature branch', cwd: 'wt', cmd: 'git push --force origin feature', expect: 'ask', reason: /force-push/ },
  { name: 'force-with-lease', cwd: 'wt', cmd: 'git push --force-with-lease origin feature', expect: 'ask', reason: /force-push/ },
  { name: 'short -f force', cwd: 'wt', cmd: 'git push -uf origin feature', expect: 'ask', reason: /force-push/ },
  { name: '+refspec force', cwd: 'wt', cmd: 'git push origin +feature', expect: 'ask', reason: /force-push/ },
  { name: 'force-push to main is a deny', cwd: 'wt', cmd: 'git push --force origin main', expect: 'deny', reason: /push to main/ },
  { name: 'add -A', cwd: 'wt', cmd: 'git add -A', expect: 'ask', reason: /broad-add: git add -A/ },
  { name: 'add --all', cwd: 'wt', cmd: 'git add --all', expect: 'ask', reason: /broad-add/ },
  { name: 'add .', cwd: 'wt', cmd: 'git add .', expect: 'ask', reason: /broad-add: git add \./ },
  { name: 'add one file', cwd: 'wt', cmd: 'git add file.txt', expect: 'allow' },
  { name: 'stash in a linked worktree', cwd: 'wt', cmd: 'git stash', expect: 'deny', reason: /worktree-stash/ },
  { name: 'stash push -u in a linked worktree', cwd: 'wt', cmd: 'git stash push -u', expect: 'deny', reason: /worktree-stash/ },
  { name: 'stash list in a linked worktree', cwd: 'wt', cmd: 'git stash list', expect: 'allow' },
  { name: 'stash in the main checkout', cwd: 'main', cmd: 'git stash', expect: 'allow' },
  { name: 'git -C into main', cwd: 'wt', cmd: () => `git -C "${fwd(R.main)}" commit -m x`, expect: 'deny', reason: /commit on main/ },
  { name: 'git -C into the worktree', cwd: 'main', cmd: () => `git -C "${fwd(R.wt)}" commit -m x`, expect: 'allow' },
  { name: 'cd then git, chained', cwd: 'wt', cmd: () => `cd "${fwd(R.main)}" && git status && git commit -m "a; b && c"`, expect: 'deny', reason: /commit on main/ },
  { name: 'chained push after a safe command', cwd: 'wt', cmd: 'git status; git log -1 | cat && git push origin main', expect: 'deny', reason: /push to main/ },
  { name: 'git inside a quoted string', cwd: 'main', cmd: 'echo "git push origin main"', expect: 'allow' },
  { name: 'non-git command', cwd: 'main', cmd: 'npm test', expect: 'allow' },
  { name: 'PowerShell tool: Set-Location then commit', tool: 'PowerShell', cwd: 'wt', cmd: () => `Set-Location -Path '${R.main}'; git commit -m 'x'`, expect: 'deny', reason: /commit on main/ },
  { name: 'PowerShell tool: & git.exe push', tool: 'PowerShell', cwd: 'wt', cmd: '& "git.exe" push origin main', expect: 'deny', reason: /push to main/ },
  { name: 'override: main no longer protected', cwd: 'main', cmd: 'git commit -m x', env: { ORC_PROTECTED_BRANCHES: 'release, trunk' }, expect: 'allow' },
  { name: 'override: feature protected', cwd: 'wt', cmd: 'git push origin feature', env: { ORC_PROTECTED_BRANCHES: 'feature' }, expect: 'deny', reason: /push to feature/ },
  { name: 'refuter may not commit', cwd: 'wt', agent: 'refuter', cmd: 'git commit -m x', expect: 'deny', reason: /read-only-role: refuter may not run git commit/ },
  { name: 'review-* may not checkout', cwd: 'wt', agent: 'review-code-explorer', cmd: 'git checkout -- file.txt', expect: 'deny', reason: /read-only-role: review-code-explorer/ },
  { name: 'refuter may add a worktree', cwd: 'wt', agent: 'refuter', cmd: 'git worktree add ../m HEAD && git apply p.diff && git diff', expect: 'allow' },
  { name: 'scout may read the log', cwd: 'main', agent: 'scout', cmd: 'git log --oneline -5 && git show HEAD && git status', expect: 'allow' },
  { name: 'builder may commit on a feature branch', cwd: 'wt', agent: 'builder', cmd: 'git commit -m x', expect: 'allow' },
  // Heredoc bodies and here-strings are data, not commands.
  { name: 'refuter writes a scratch table by heredoc', cwd: 'wt', agent: 'refuter', cmd: "cat > 'out.md' <<'EOF'\n| git commit on main | deny |\nNo writes (git reset was not run).\nEOF", expect: 'allow' },
  { name: 'heredoc body mentions push to main', cwd: 'wt', cmd: 'cat > notes.txt <<EOF\ngit push origin main\nEOF', expect: 'allow' },
  { name: 'apostrophe in a heredoc body, then commit', cwd: 'main', cmd: "cat > msg.txt <<'EOF'\nDon't break it\nEOF\ngit commit -F msg.txt", expect: 'deny', reason: /commit on main/ },
  { name: '<<- heredoc with a tab-indented terminator, then commit', cwd: 'main', cmd: 'cat <<-"EOF" > x.txt\n\tgit push origin feature\n\tEOF\ngit commit -m x', expect: 'deny', reason: /commit on main/ },
  { name: 'PowerShell here-string message', tool: 'PowerShell', cwd: 'wt', cmd: 'git commit -m @"\nline; git push origin main\n"@', expect: 'allow' },
  { name: 'PowerShell here-string, then commit', tool: 'PowerShell', cwd: 'main', cmd: "$m = @'\nDon't git push origin feature\n'@\ngit commit -m $m", expect: 'deny', reason: /commit on main/ },
  // Line continuations.
  { name: 'backslash-newline inside git commit', cwd: 'main', cmd: 'git \\\n  commit -m x', expect: 'deny', reason: /commit on main/ },
  { name: 'backslash-newline after -C', cwd: 'wt', cmd: () => `git -C "${fwd(R.main)}" \\\n  commit -m x`, expect: 'deny', reason: /commit on main/ },
  { name: 'backslash-newline in a bare push', cwd: 'main', cmd: 'git push \\\n  origin', expect: 'deny', reason: /push to main/ },
  { name: 'PowerShell backtick-newline', tool: 'PowerShell', cwd: 'main', cmd: 'git `\n  commit -m x', expect: 'deny', reason: /commit on main/ },
  // Keywords and wrappers in front of git.
  { name: 'if ! ...; then git commit', cwd: 'main', cmd: 'if ! git diff --quiet; then git commit -am x; fi', expect: 'deny', reason: /commit on main/ },
  { name: 'for ...; do git commit', cwd: 'main', cmd: 'for f in a; do git commit -m x; done', expect: 'deny', reason: /commit on main/ },
  { name: 'brace group', cwd: 'main', cmd: '{ git commit -m x; }', expect: 'deny', reason: /commit on main/ },
  { name: 'time -p git commit', cwd: 'main', cmd: 'time -p git commit -m x', expect: 'deny', reason: /commit on main/ },
  { name: 'env -u X FOO=1 git commit', cwd: 'main', cmd: 'env -u X FOO=1 git commit -m x', expect: 'deny', reason: /commit on main/ },
  { name: 'command git commit', cwd: 'main', cmd: 'command git commit -m x', expect: 'deny', reason: /commit on main/ },
  { name: 'nohup git commit', cwd: 'main', cmd: 'nohup git commit -m x', expect: 'deny', reason: /commit on main/ },
  { name: 'exec git push', cwd: 'wt', cmd: 'exec git push origin main', expect: 'deny', reason: /push to main/ },
  // Subshells.
  { name: 'cd inside a subshell', cwd: 'wt', cmd: () => `(cd "${fwd(R.main)}" && git commit -m x)`, expect: 'deny', reason: /commit on main/ },
  { name: 'cd inside a subshell does not leak out', cwd: 'wt', cmd: () => `(cd "${fwd(R.main)}" && git log -1) && git commit -m x`, expect: 'allow' },
  // Non-ASCII paths.
  { name: 'non-ASCII cwd on main', cwd: 'accented', cmd: 'git commit -m x', expect: 'deny', reason: /commit on main/ },
  { name: 'cd into a non-ASCII folder', cwd: 'wt', cmd: () => `cd "${fwd(R.accented)}" && git commit -m x`, expect: 'deny', reason: /commit on main/ },
  // Tags, --all and --mirror.
  { name: 'push --tags on main', cwd: 'main', cmd: 'git push --tags', expect: 'allow' },
  { name: 'push origin --tags on main', cwd: 'main', cmd: 'git push origin --tags', expect: 'allow' },
  { name: 'push --tags origin main', cwd: 'wt', cmd: 'git push --tags origin main', expect: 'deny', reason: /push to main/ },
  { name: 'push --follow-tags on main', cwd: 'main', cmd: 'git push --follow-tags', expect: 'deny', reason: /push to main/ },
  { name: 'push --all from a feature branch', cwd: 'wt', cmd: 'git push --all', expect: 'deny', reason: /push to main/ },
  { name: 'push --mirror', cwd: 'wt', cmd: 'git push --mirror origin', expect: 'deny', reason: /push to main/ },
  { name: 'push --all with no protected branch locally', cwd: 'trunk', cmd: 'git push --all origin', expect: 'allow' },
  // Comments.
  { name: 'comment with an apostrophe, then commit', cwd: 'main', cmd: "# Let's commit the fix\ngit commit -m x", expect: 'deny', reason: /commit on main/ },
  { name: 'comment with an apostrophe, then push to main', cwd: 'wt', cmd: "# Don't forget\ngit push origin main", expect: 'deny', reason: /push to main/ },
  { name: 'a # inside a word is not a comment', cwd: 'main', cmd: 'echo a#b; git commit -m x', expect: 'deny', reason: /commit on main/ },
  { name: 'comment after a heredoc start: body still skipped, then commit', cwd: 'main', cmd: 'cat > n.txt <<EOF # note\ngit push origin feature\nEOF\ngit commit -m x', expect: 'deny', reason: /commit on main/ },
  { name: 'comment after a heredoc start: body mentions push to main', cwd: 'wt', cmd: 'cat > n.txt <<EOF # note\ngit push origin main\nEOF', expect: 'allow' },
  { name: 'PowerShell comment with an apostrophe, then commit', tool: 'PowerShell', cwd: 'main', cmd: "# Let's commit\ngit commit -m x", expect: 'deny', reason: /commit on main/ },
  { name: 'PowerShell block comment, then commit', tool: 'PowerShell', cwd: 'main', cmd: "<# it's\nfine #> git commit -m x", expect: 'deny', reason: /commit on main/ },
  { name: 'PowerShell block comment mentions push to main', tool: 'PowerShell', cwd: 'wt', cmd: '<# git push origin main #>\ngit status', expect: 'allow' },
  // A trailing escape inside a quoted heredoc body or a here-string is literal.
  { name: 'quoted heredoc body ending in a backslash, then commit', cwd: 'main', cmd: "cat > s.sh <<'EOF'\necho a \\\nEOF\ngit commit -m x", expect: 'deny', reason: /commit on main/ },
  { name: 'here-string ending in a backtick, then commit', tool: 'PowerShell', cwd: 'main', cmd: "$m = @'\nRun `git status`\n'@\ngit commit -m $m", expect: 'deny', reason: /commit on main/ },
  { name: 'backslash-newline inside double quotes', cwd: 'wt', cmd: 'git commit -m "a \\\nb" && git push origin main', expect: 'deny', reason: /push to main/ },
  // A heredoc inside "$( )", the form Claude Code writes commit messages in.
  { name: 'heredoc in "$( )" with a double quote in the body, then push to main', cwd: 'wt', cmd: "git commit -m \"$(cat <<'EOF'\nFix 12\" screens\nEOF\n)\" && git push origin main", expect: 'deny', reason: /push to main/ },
  { name: 'heredoc in "$( )" with a double quote in the body mentions push to main', cwd: 'wt', cmd: "git commit -m \"$(cat <<'EOF'\nFix 12\" screens\ngit push origin main is blocked\nEOF\n)\"", expect: 'allow' },
  { name: 'heredoc in "$( )" on main', cwd: 'main', cmd: "git commit -m \"$(cat <<'EOF'\nSubject\nEOF\n)\"", expect: 'deny', reason: /commit on main/ },
  { name: 'a shift inside $(( )) is not a heredoc', cwd: 'main', cmd: 'echo $((1<<2))\ngit commit -m x', expect: 'deny', reason: /commit on main/ },
  // A folder git cannot answer for does not abort the rest of the command.
  { name: 'missing -C folder, then push to main', cwd: 'main', cmd: 'git -C missing commit -m x; git push origin main', expect: 'deny', reason: /push to main/ },
  // A cd or -C target Windows PowerShell 5.1 cannot resolve as a path: both hooks keep judging, with the same answer.
  { name: 'PowerShell: Set-Location $env:X, then commit (no such folder)', tool: 'PowerShell', cwd: 'main', cmd: 'Set-Location $env:USERPROFILE\\x; git commit -m x', expect: 'allow' },
  { name: 'PowerShell: Set-Location $env:X, then push to main', tool: 'PowerShell', cwd: 'wt', cmd: 'Set-Location $env:USERPROFILE\\x; git push origin main', expect: 'deny', reason: /push to main/ },
  { name: 'PowerShell: git -C $env:X push to main', tool: 'PowerShell', cwd: 'wt', cmd: 'git -C $env:TEMP push origin main', expect: 'deny', reason: /push to main/ },
  { name: 'cd "${X:-.}", then push to main', cwd: 'wt', cmd: 'cd "${X:-.}" && git push origin main', expect: 'deny', reason: /push to main/ },
  { name: 'cd into a wildcard, then push to main', cwd: 'wt', cmd: 'cd "a*b?" && git push origin main', expect: 'deny', reason: /push to main/ },
  { name: 'cd into a name with < and |, then push to main', cwd: 'wt', cmd: 'cd "a<b|c" && git push origin main', expect: 'deny', reason: /push to main/ },
  { name: 'cd into a 300-character path, then push to main', cwd: 'wt', cmd: `cd "${'d'.repeat(300)}" && git push origin main`, expect: 'deny', reason: /push to main/ },
  { name: 'refuter: Set-Location $env:X, then reset', tool: 'PowerShell', cwd: 'wt', agent: 'refuter', cmd: 'Set-Location $env:TEMP\\x; git reset --hard', expect: 'deny', reason: /read-only-role: refuter may not run git reset/ },
  { name: 'PowerShell: add -A, then Set-Location $env:X keeps the ask', tool: 'PowerShell', cwd: 'wt', cmd: 'git add -A; Set-Location $env:TEMP\\x', expect: 'ask', reason: /broad-add/ },
  // PowerShell assignments and script blocks, and Bash backtick substitution.
  { name: 'PowerShell: $r = git push to main', tool: 'PowerShell', cwd: 'wt', cmd: '$r = git push origin main', expect: 'deny', reason: /push to main/ },
  { name: 'PowerShell: $r=git commit on main', tool: 'PowerShell', cwd: 'main', cmd: '$r=git commit -m x', expect: 'deny', reason: /commit on main/ },
  { name: 'PowerShell: $r += git push to main', tool: 'PowerShell', cwd: 'wt', cmd: '$r += git push origin main', expect: 'deny', reason: /push to main/ },
  { name: 'PowerShell: $r = git log on main', tool: 'PowerShell', cwd: 'main', cmd: '$r = git log -1', expect: 'allow' },
  { name: 'PowerShell: try { git commit } on main', tool: 'PowerShell', cwd: 'main', cmd: 'try { git commit -m x } catch { }', expect: 'deny', reason: /commit on main/ },
  { name: 'PowerShell: try { git commit } on a feature branch', tool: 'PowerShell', cwd: 'wt', cmd: 'try { git commit -m x } catch { }', expect: 'allow' },
  { name: 'PowerShell: push to main in the catch block', tool: 'PowerShell', cwd: 'wt', cmd: 'try { git status } catch { git push origin main }', expect: 'deny', reason: /push to main/ },
  { name: 'PowerShell: ForEach-Object { git push to main }', tool: 'PowerShell', cwd: 'wt', cmd: '1 | ForEach-Object { git push origin main }', expect: 'deny', reason: /push to main/ },
  { name: 'PowerShell: ForEach-Object { git push origin } on main: the } is no refspec', tool: 'PowerShell', cwd: 'main', cmd: '1 | ForEach-Object { git push origin }', expect: 'deny', reason: /push to main/ },
  { name: 'PowerShell: % {git push to main} with glued braces', tool: 'PowerShell', cwd: 'wt', cmd: '1 | % {git push origin main}', expect: 'deny', reason: /push to main/ },
  { name: 'PowerShell: if (...) { git commit } on main', tool: 'PowerShell', cwd: 'main', cmd: 'if (Test-Path x) { git commit -m x }', expect: 'deny', reason: /commit on main/ },
  { name: 'PowerShell: & { git commit } on main', tool: 'PowerShell', cwd: 'main', cmd: '& { git commit -m x }', expect: 'deny', reason: /commit on main/ },
  { name: 'PowerShell: a hash literal holding git text', tool: 'PowerShell', cwd: 'wt', cmd: "$h = @{ a = 'git push origin main' }", expect: 'allow' },
  { name: 'PowerShell: a quoted brace in a refspec list is no block: push to main', tool: 'PowerShell', cwd: 'wt', cmd: 'git push origin "{x}" main', expect: 'deny', reason: /push to main/ },
  { name: 'PowerShell: a quoted brace in an option value is no block: push to main', tool: 'PowerShell', cwd: 'wt', cmd: 'git push -o "{json}" origin main', expect: 'deny', reason: /push to main/ },
  { name: 'PowerShell: a quoted brace holding git text is text', tool: 'PowerShell', cwd: 'wt', cmd: 'Write-Output "{ git push origin main }"', expect: 'allow' },
  { name: 'PowerShell: a quoted brace does not end the command, then commit on main', tool: 'PowerShell', cwd: 'main', cmd: "Write-Output 'x }'; git commit -m x", expect: 'deny', reason: /commit on main/ },
  { name: 'PowerShell: try{git commit} glued, on main', tool: 'PowerShell', cwd: 'main', cmd: 'try{git commit -m x}catch{}', expect: 'deny', reason: /commit on main/ },
  { name: 'PowerShell: }else{ git commit } glued, on main', tool: 'PowerShell', cwd: 'main', cmd: 'if ($x) { git status }else{ git commit -m x }', expect: 'deny', reason: /commit on main/ },
  { name: 'PowerShell: [string]$r = git commit on main', tool: 'PowerShell', cwd: 'main', cmd: '[string]$r = git commit -m x', expect: 'deny', reason: /commit on main/ },
  { name: 'PowerShell: $a, $b = git commit on main', tool: 'PowerShell', cwd: 'main', cmd: '$a, $b = git commit -m x', expect: 'deny', reason: /commit on main/ },
  { name: 'PowerShell: $a,$b=git commit on main', tool: 'PowerShell', cwd: 'main', cmd: '$a,$b=git commit -m x', expect: 'deny', reason: /commit on main/ },
  { name: 'PowerShell: $a = $b = git commit on main', tool: 'PowerShell', cwd: 'main', cmd: '$a = $b = git commit -m x', expect: 'deny', reason: /commit on main/ },
  { name: 'PowerShell: ${r} = git commit on main', tool: 'PowerShell', cwd: 'main', cmd: '${r} = git commit -m x', expect: 'deny', reason: /commit on main/ },
  { name: 'PowerShell: [string]${r}=git commit on main', tool: 'PowerShell', cwd: 'main', cmd: '[string]${r}=git commit -m x', expect: 'deny', reason: /commit on main/ },
  { name: 'PowerShell: $r.x = git commit on main', tool: 'PowerShell', cwd: 'main', cmd: '$r.x = git commit -m x', expect: 'deny', reason: /commit on main/ },
  { name: "PowerShell: $h['k'] = git push to main", tool: 'PowerShell', cwd: 'wt', cmd: "$h['k'] = git push origin main", expect: 'deny', reason: /push to main/ },
  { name: 'PowerShell: [string]$r alone is no assignment', tool: 'PowerShell', cwd: 'main', cmd: '[string]$r; git log -1', expect: 'allow' },
  { name: 'PowerShell: a folder name with braces stays one word', tool: 'PowerShell', cwd: 'wt', cmd: () => `Set-Location '${R.braces}'; git commit -m x`, expect: 'deny', reason: /commit on main/ },
  { name: 'backtick substitution: push to main', cwd: 'wt', cmd: 'echo `git push origin main`', expect: 'deny', reason: /push to main/ },
  { name: 'backtick substitution after an assignment: commit on main', cwd: 'main', cmd: 'x=`git commit -m y`', expect: 'deny', reason: /commit on main/ },
  { name: 'backtick substitution inside double quotes: push to main', cwd: 'wt', cmd: 'echo "now `git push origin main` done"', expect: 'deny', reason: /push to main/ },
  { name: 'backtick substitution closes back into its quotes, then commit', cwd: 'main', cmd: 'echo "a `git log -1` b; c" && git commit -m x', expect: 'deny', reason: /commit on main/ },
  { name: 'backticks inside single quotes are text', cwd: 'wt', cmd: "echo '`git push origin main`'", expect: 'allow' },
  { name: 'escaped backticks are text', cwd: 'wt', cmd: 'echo \\`git push origin main\\`', expect: 'allow' },
  // Every subcommand read-only roles may not run, across the read-only roles; a builder may run them all.
  { name: 'scout may not push', cwd: 'wt', agent: 'scout', cmd: 'git push origin feature', expect: 'deny', reason: /read-only-role: scout may not run git push/ },
  { name: 'researcher may not merge', cwd: 'wt', agent: 'researcher', cmd: 'git merge main', expect: 'deny', reason: /read-only-role: researcher may not run git merge/ },
  { name: 'plugin:refuter may not rebase', cwd: 'wt', agent: 'orc:refuter', cmd: 'git rebase main', expect: 'deny', reason: /read-only-role: refuter may not run git rebase/ },
  { name: 'review-verifier may not reset', cwd: 'wt', agent: 'review-verifier', cmd: 'git reset --hard', expect: 'deny', reason: /read-only-role: review-verifier may not run git reset/ },
  { name: 'scout may not clean', cwd: 'wt', agent: 'scout', cmd: 'git clean -fd', expect: 'deny', reason: /read-only-role: scout may not run git clean/ },
  { name: 'researcher may not stash in the main checkout', cwd: 'main', agent: 'researcher', cmd: 'git stash', expect: 'deny', reason: /read-only-role: researcher may not run git stash/ },
  { name: 'refuter may not rm', cwd: 'wt', agent: 'refuter', cmd: 'git rm file.txt', expect: 'deny', reason: /read-only-role: refuter may not run git rm/ },
  { name: 'review-docs-explorer may not mv', cwd: 'wt', agent: 'review-docs-explorer', cmd: 'git mv file.txt f2.txt', expect: 'deny', reason: /read-only-role: review-docs-explorer may not run git mv/ },
  { name: 'scout may not switch', cwd: 'wt', agent: 'scout', cmd: 'git switch -c tmp', expect: 'deny', reason: /read-only-role: scout may not run git switch/ },
  { name: 'researcher may not restore', cwd: 'wt', agent: 'researcher', cmd: 'git restore file.txt', expect: 'deny', reason: /read-only-role: researcher may not run git restore/ },
  { name: 'refuter may not pull', cwd: 'wt', agent: 'refuter', cmd: 'git pull --rebase', expect: 'deny', reason: /read-only-role: refuter may not run git pull/ },
  { name: 'scout may not cherry-pick', cwd: 'wt', agent: 'scout', cmd: 'git cherry-pick abc123', expect: 'deny', reason: /read-only-role: scout may not run git cherry-pick/ },
  { name: 'review-failure-explorer may not revert', cwd: 'wt', agent: 'review-failure-explorer', cmd: 'git revert HEAD', expect: 'deny', reason: /read-only-role: review-failure-explorer may not run git revert/ },
  { name: 'researcher may not am', cwd: 'wt', agent: 'researcher', cmd: 'git am fix.patch', expect: 'deny', reason: /read-only-role: researcher may not run git am/ },
  { name: 'builder may run every subcommand read-only roles may not', cwd: 'wt', agent: 'builder', cmd: 'git merge x; git rebase x; git reset --hard; git clean -fd; git rm f; git mv f g; git checkout f; git switch x; git restore f; git pull; git cherry-pick a; git revert a; git am p', expect: 'allow' },
  // Push destinations named through HEAD, @, src:dst and a deleting :dst.
  { name: 'push origin HEAD while on main', cwd: 'main', cmd: 'git push origin HEAD', expect: 'deny', reason: /push to main/ },
  { name: 'push origin @ while on main', cwd: 'main', cmd: 'git push origin @', expect: 'deny', reason: /push to main/ },
  { name: 'push origin feature:main', cwd: 'wt', cmd: 'git push origin feature:main', expect: 'deny', reason: /push to main/ },
  { name: 'push origin :main deletes main', cwd: 'wt', cmd: 'git push origin :main', expect: 'deny', reason: /push to main/ },
  // Git global options with a value are skipped before the subcommand.
  { name: 'git -c name=value commit on main', cwd: 'main', cmd: 'git -c user.name=x commit -m x', expect: 'deny', reason: /commit on main/ },
  { name: 'git --git-dir .git commit on main', cwd: 'main', cmd: 'git --git-dir .git commit -m x', expect: 'deny', reason: /commit on main/ },
  { name: 'git --work-tree . push to main', cwd: 'wt', cmd: 'git --work-tree . push origin main', expect: 'deny', reason: /push to main/ },
  { name: 'git --namespace ns commit on main', cwd: 'main', cmd: 'git --namespace ns commit -m x', expect: 'deny', reason: /commit on main/ },
  { name: 'git --config-env name=ENV commit on main', cwd: 'main', cmd: 'git --config-env user.name=X commit -m x', expect: 'deny', reason: /commit on main/ },
  // Redirections are not refspecs.
  { name: 'bare push > out.txt on main', cwd: 'main', cmd: 'git push > out.txt', expect: 'deny', reason: /push to main/ },
  { name: 'bare push 2> err.txt on main', cwd: 'main', cmd: 'git push 2> err.txt', expect: 'deny', reason: /push to main/ },
  { name: 'push origin >> log.txt on main', cwd: 'main', cmd: 'git push origin >> log.txt', expect: 'deny', reason: /push to main/ },
  // Git Bash /c/... and ~ directory targets (HOME and USERPROFILE point at the temp root).
  { name: 'cd into a Git Bash /c/ path, then commit on main', cwd: 'wt', platform: 'win32', cmd: () => `cd "${fwd(R.main).replace(/^([A-Za-z]):/, (m, d) => `/${d.toLowerCase()}`)}" && git commit -m x`, expect: 'deny', reason: /commit on main/ },
  { name: 'cd ~/repo, then commit on main', cwd: 'wt', cmd: 'cd ~/repo && git commit -m x', env: () => ({ HOME: R.root, USERPROFILE: R.root }), expect: 'deny', reason: /commit on main/ },
  { name: 'git -C ~/repo commit on main', cwd: 'wt', cmd: 'git -C ~/repo commit -m x', env: () => ({ HOME: R.root, USERPROFILE: R.root }), expect: 'deny', reason: /commit on main/ },
  // A deny after an ask in one command wins.
  { name: 'add -A, then commit on main', cwd: 'main', cmd: 'git add -A && git commit -m x', expect: 'deny', reason: /commit on main/ },
];

function payload(c) {
  const p = {
    session_id: 's',
    cwd: R[c.cwd],
    hook_event_name: 'PreToolUse',
    tool_name: c.tool ?? 'Bash',
    tool_input: { command: typeof c.cmd === 'function' ? c.cmd() : c.cmd, description: 'd' },
    tool_use_id: 't',
  };
  if (c.agent) Object.assign(p, { agent_id: 'a1', agent_type: c.agent });
  return JSON.stringify(p);
}

// No ORC_PROTECTED_BRANCHES leaks in from the shell.
function envFor(c) {
  const env = { ...process.env };
  delete env.ORC_PROTECTED_BRANCHES;
  return { ...env, ...((typeof c.env === 'function' ? c.env() : c.env) ?? {}) };
}

const check = (runner, c) => judge(c, runner(payload(c), envFor(c)));

function judge(c, r) {
  assert.equal(r.status, 0, `${c.name}: exit ${r.status}; stderr ${r.stderr}`);
  // A git probe that timed out is judged as "no branch": a row whose answer matches that fallback would pass
  // without testing its path, so a timeout fails the row instead.
  assert.doesNotMatch(r.stderr ?? '', /git did not answer/, `${c.name}: the guard's git probe timed out`);
  if (c.expect === 'allow') {
    assert.equal(r.stdout.trim(), '', `${c.name}: expected no decision, got ${r.stdout}`);
    return;
  }
  assert.notEqual(r.stdout.trim(), '', `${c.name}: expected ${c.expect}, got no decision; stderr ${r.stderr}`);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, 'PreToolUse', c.name);
  assert.equal(out.permissionDecision, c.expect, `${c.name}: ${out.permissionDecisionReason}`);
  assert.match(out.permissionDecisionReason, c.reason, c.name);
  assert.ok(!out.permissionDecisionReason.includes('\n'), 'one line');
}

// The same cold-started process with the payload on stdin, as the hook runs it, without blocking: the payload
// table runs its cases side by side. A process still running after CASE_TIMEOUT_MS is killed and reported as
// timedOut, so a hung guard fails its case instead of hanging the run.
const CASE_TIMEOUT_MS = 60_000;
const spawnAsync = (cmd, args, input, env) =>
  new Promise((resolve) => {
    const p = spawn(cmd, args, { env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      p.kill();
      p.stdout.destroy();
      p.stderr.destroy();
      resolve({ status: null, stdout, stderr, timedOut: true });
    }, CASE_TIMEOUT_MS);
    p.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    p.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    p.stdin.on('error', () => {});
    p.on('error', (e) => {
      clearTimeout(timer);
      resolve({ status: null, stdout, stderr: `${stderr}${e.message}` });
    });
    p.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
    p.stdin.end(input);
  });

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1];
const viaNode = (input, env) => spawnSync(process.execPath, [MJS], { input, env, encoding: 'utf8' });
const viaNodeAsync = (input, env) => spawnAsync(process.execPath, [MJS], input, env);
const POWERSHELL = spawnSync('powershell', ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' }).status === 0;
const viaPs = (input, env) => spawnSync('powershell', PS_ARGS, { input, env, encoding: 'utf8' });
const viaPsAsync = (input, env) => spawnAsync('powershell', PS_ARGS, input, env);

const RUNNERS = [
  ['guard.mjs', viaNode, viaNodeAsync, false],
  ['guard.ps1', viaPs, viaPsAsync, POWERSHELL ? false : 'powershell is not on this machine'],
];

// Cases in flight at once: each is its own process, and PowerShell spends most of a case starting up.
const POOL = 6;

for (const [label, runner, runnerAsync, skip] of RUNNERS) {
  test(`${label}: deny, ask and allow over the payload table`, { skip }, async () => {
    // Every row runs, so one failure does not hide the next; failures are listed in table order. Each row starts
    // as "not run" and is cleared only once judged, so a row the pool never reaches fails the test.
    const cases = CASES.filter((x) => !x.platform || x.platform === process.platform);
    const failures = cases.map((c) => `${c.name}: not run`);
    let next = 0;
    const worker = async () => {
      while (next < cases.length) {
        const i = next++;
        const c = cases[i];
        try {
          const r = await runnerAsync(payload(c), envFor(c));
          if (r.timedOut) throw new Error(`${c.name}: no answer within ${CASE_TIMEOUT_MS / 1000} s; the process was killed`);
          judge(c, r);
          failures[i] = null;
        } catch (e) {
          failures[i] = e.message.split('\n')[0];
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(POOL, cases.length) }, worker));
    assert.deepEqual(failures.filter((f) => f !== null), []);
  });

  test(`${label}: denies every role marked access: read-only in core/roles/*.md, and only those`, { skip }, () => {
    const roles = loadRoles(REPO);
    assert.ok(roles.some((r) => r.access === 'read-only') && roles.some((r) => r.access !== 'read-only'), 'roles of both kinds');
    for (const r of roles) {
      const c = { name: `role ${r.name}`, cwd: 'wt', agent: r.name, cmd: 'git commit -m x' };
      if (r.access === 'read-only') check(runner, { ...c, expect: 'deny', reason: new RegExp(`read-only-role: ${r.name} may not run git commit`) });
      else check(runner, { ...c, expect: 'allow' });
    }
  });

  test(`${label}: fails open with one stderr line`, { skip }, () => {
    const env = envFor({});
    const bad = runner('{not json git', env);
    assert.equal(bad.status, 0);
    assert.equal(bad.stdout.trim(), '');
    assert.match(bad.stderr.trim(), /^guard: .*allowed$/);
    assert.equal(bad.stderr.trim().split('\n').length, 1);
    // No tool_input.command (a payload shape the guard does not know): allowed, one line.
    const noCommand = runner(JSON.stringify({ tool_name: 'Bash', cwd: R.main, tool_input: {} }), env);
    assert.equal(noCommand.status, 0);
    assert.equal(noCommand.stdout.trim(), '');
    assert.match(noCommand.stderr.trim(), /^guard: no tool_input\.command/);
    // A cwd that does not exist: git cannot answer, so the commit is allowed.
    const gone = runner(JSON.stringify({ tool_name: 'Bash', cwd: path.join(R.root, 'missing'), tool_input: { command: 'git commit -m x' } }), env);
    assert.equal(gone.status, 0);
    assert.equal(gone.stdout.trim(), '');
    assert.match(gone.stderr.trim(), /^guard: no directory /);
    // git answers with an error (exit 128) instead of a branch: allowed, and the failure is named.
    const refused = runner(JSON.stringify({ tool_name: 'Bash', cwd: R.broken, tool_input: { command: 'git commit -m x' } }), env);
    assert.equal(refused.status, 0);
    assert.equal(refused.stdout.trim(), '');
    assert.match(refused.stderr.trim(), /^guard: git could not read the branch in .*\(exit 128: .+\); judged as no branch$/);
    // git cannot list the branches for push --all: denied as reaching every protected branch, and the failure is named.
    const all = runner(JSON.stringify({ tool_name: 'Bash', cwd: R.broken, tool_input: { command: 'git push --all' } }), env);
    assert.equal(all.status, 0);
    assert.equal(JSON.parse(all.stdout).hookSpecificOutput.permissionDecision, 'deny');
    assert.match(all.stderr.trim(), /^guard: git could not list the branches in .*\(exit 128: .+\); push --all is judged as reaching every protected branch$/);
  });
}

test('both example files wire the guard on PreToolUse for Bash and PowerShell; settings denies secret reads', () => {
  for (const [file, pattern] of [
    ['adapters/claude-code/settings.example.json', /tools\\guard\.ps1"$/],
    ['adapters/claude-code/hooks.node.example.json', /tools\/guard\.mjs"$/],
  ]) {
    const groups = JSON.parse(fs.readFileSync(path.join(REPO, ...file.split('/')), 'utf8')).hooks.PreToolUse.filter((g) => g.hooks.some((h) => pattern.test(h.command)));
    assert.equal(groups.length, 1, file);
    assert.equal(groups[0].matcher, 'Bash|PowerShell', file);
  }
  // The shipped PowerShell line runs the script under any execution policy, as the tests here do.
  const ps = JSON.parse(fs.readFileSync(path.join(REPO, 'adapters', 'claude-code', 'settings.example.json'), 'utf8')).hooks.PreToolUse.flatMap((g) => g.hooks).find((h) => /guard\.ps1/.test(h.command));
  assert.match(ps.command, /^powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "/);
  const example = JSON.parse(fs.readFileSync(path.join(REPO, 'adapters', 'claude-code', 'settings.example.json'), 'utf8'));
  assert.deepEqual(example.permissions.deny, ['Read(.env)', 'Read(.env.*)', 'Read(**/.credentials.json)', 'Read(~/.claude/.credentials.json)']);
});

// ---------- Antigravity PreToolUse payloads ----------

function antigravityPayload(c) {
  return JSON.stringify({
    conversationId: 'c',
    workspacePaths: [R[c.cwd]],
    hookEventName: 'PreToolUse',
    cwd: R[c.cwd],
    toolCall: {
      id: 't1',
      name: 'run_command',
      args: { CommandLine: typeof c.cmd === 'function' ? c.cmd() : c.cmd, WaitMsBeforeAsync: 500, toolSummary: 'cmd' },
    },
    stepIdx: 3,
  });
}

function judgeAntigravity(c, stdout, stderr, status = 0) {
  assert.strictEqual(status, 0, `${c.name}: exit ${status}; stderr ${stderr}`);
  assert.doesNotMatch(stderr ?? '', /git did not answer/, `${c.name}: the guard's git probe timed out`);
  if (c.expect === 'allow') {
    assert.strictEqual(stdout.trim(), '', `${c.name}: allow must print nothing, got ${stdout}`);
    return;
  }
  assert.notStrictEqual(stdout.trim(), '', `${c.name}: expected ${c.expect}, got no decision; stderr ${stderr}`);
  const out = JSON.parse(stdout);
  assert.deepStrictEqual(Object.keys(out).sort(), ['decision', 'reason'], `${c.name}: Antigravity shape only`);
  assert.strictEqual(out.decision, c.expect, `${c.name}: ${out.reason}`);
  assert.match(out.reason, c.reason, c.name);
  assert.ok(!out.reason.includes('\n'), 'one line');
}

test('guard.mjs (Antigravity): deny, ask and allow over the payload table for POSIX and Windows splitters', async () => {
  // Every row with no agent and no tool-specific field runs with the POSIX splitter (linux).
  const posixCases = CASES.filter((c) => !c.agent && !c.tool && (!c.platform || c.platform === process.platform));
  assert.ok(posixCases.length > 50, 'covered the POSIX rows');
  for (const c of posixCases) {
    const warns = [];
    const out = runGuard(antigravityPayload(c), envFor(c), (m) => warns.push(m), 'linux');
    judgeAntigravity(c, out, warns.join('\n'));
  }
  // Every PowerShell row with no agent runs with the Windows splitter (win32).
  const psCases = CASES.filter((c) => !c.agent && c.tool === 'PowerShell');
  assert.ok(psCases.length > 20, 'covered the PowerShell rows');
  for (const c of psCases) {
    const warns = [];
    const out = runGuard(antigravityPayload(c), envFor(c), (m) => warns.push(m), 'win32');
    judgeAntigravity(c, out, warns.join('\n'));
  }
  // Platform picks the splitter: PowerShell assignment syntax only fires on win32; Bash backslash-newline only on POSIX.
  const psAssign = antigravityPayload({ cwd: 'main', cmd: '$r = git commit -m x' });
  assert.strictEqual(JSON.parse(runGuard(psAssign, envFor({}), () => {}, 'win32')).decision, 'deny');
  assert.strictEqual(runGuard(psAssign, envFor({}), () => {}, 'linux'), '');
  const bashCont = antigravityPayload({ cwd: 'main', cmd: 'git \\\n  commit -m x' });
  assert.strictEqual(JSON.parse(runGuard(bashCont, envFor({}), () => {}, 'linux')).decision, 'deny');
  assert.strictEqual(runGuard(bashCont, envFor({}), () => {}, 'win32'), '');
  // Subprocess run on the host platform, including the real-shaped Antigravity PreToolUse payload.
  const hostCases = process.platform === 'win32' ? psCases : posixCases;
  const failures = hostCases.map((c) => `${c.name}: not run`);
  let next = 0;
  const worker = async () => {
    while (next < hostCases.length) {
      const i = next++;
      const c = hostCases[i];
      try {
        const r = await viaNodeAsync(antigravityPayload(c), envFor(c));
        if (r.timedOut) throw new Error(`${c.name}: timed out`);
        judgeAntigravity(c, r.stdout, r.stderr, r.status);
        failures[i] = null;
      } catch (e) {
        failures[i] = e.message.split('\n')[0];
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, hostCases.length) }, worker));
  assert.deepStrictEqual(failures.filter((f) => f !== null), []);
  // Real-shaped payload (data precondition) through a real subprocess.
  const realPayload = JSON.stringify({
    conversationId: 'c',
    workspacePaths: [R.main],
    hookEventName: 'PreToolUse',
    cwd: R.main,
    toolCall: { id: 't1', name: 'run_command', args: { CommandLine: 'git commit -m x', WaitMsBeforeAsync: 500, toolSummary: 'commit' } },
    stepIdx: 3,
  });
  const realRes = viaNode(realPayload, envFor({}));
  assert.strictEqual(realRes.status, 0, realRes.stderr);
  assert.strictEqual(realRes.stderr, '');
  assert.deepStrictEqual(JSON.parse(realRes.stdout), {
    decision: 'deny',
    reason: 'guard: protected-branch: git commit on main is blocked; create a branch first',
  });
});

test('guard.mjs (Antigravity): non-run_command allowed, read-only-role gap, and fail-open on unknown payloads', () => {
  const env = envFor({});
  // Any Antigravity tool other than run_command is allowed silently, even if args hold a blocked command.
  for (const name of ['read_file', 'edit_file', 'write_file', 'search_web']) {
    const p = JSON.stringify({
      conversationId: 'c',
      hookEventName: 'PreToolUse',
      cwd: R.main,
      toolCall: { id: 't1', name, args: { CommandLine: 'git commit -m x', Path: 'file.txt' } },
      stepIdx: 1,
    });
    const r = viaNode(p, env);
    assert.strictEqual(r.status, 0, name);
    assert.strictEqual(r.stdout, '', `${name}: allow prints nothing`);
    assert.strictEqual(r.stderr, '', `${name}: no stderr warning`);
  }
  // Read-only-role gap: denied under Claude Code (refuter on feature branch), allowed under Antigravity (no agent identity).
  const claudeRefuter = viaNode(payload({ cwd: 'wt', agent: 'refuter', cmd: 'git commit -m x' }), env);
  assert.strictEqual(JSON.parse(claudeRefuter.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const agyRefuter = viaNode(JSON.stringify({
    conversationId: 'c',
    hookEventName: 'PreToolUse',
    cwd: R.wt,
    agent_type: 'refuter',
    toolCall: { id: 't1', name: 'run_command', args: { CommandLine: 'git commit -m x' } },
    stepIdx: 1,
  }), env);
  assert.strictEqual(agyRefuter.status, 0);
  assert.strictEqual(agyRefuter.stdout, '', 'read-only-role rule does not apply under Antigravity');
  assert.strictEqual(agyRefuter.stderr, '');
  // Missing args.CommandLine on run_command: fail open with one guard stderr line.
  const noCmdLine = viaNode(JSON.stringify({
    hookEventName: 'PreToolUse',
    cwd: R.main,
    toolCall: { id: 't1', name: 'run_command', args: {} },
  }), env);
  assert.strictEqual(noCmdLine.status, 0);
  assert.strictEqual(noCmdLine.stdout, '');
  assert.match(noCmdLine.stderr.trim(), /^guard: no toolCall\.args\.CommandLine.*allowed$/);
  assert.strictEqual(noCmdLine.stderr.trim().split('\n').length, 1);
  // Payloads of neither shape: fail open with one guard: ... allowed line on stderr.
  for (const raw of ['{}', '{"foo":"bar"}', 'null', '[]', '{"toolCall":{}}']) {
    const r = viaNode(raw, env);
    assert.strictEqual(r.status, 0, raw);
    assert.strictEqual(r.stdout, '', raw);
    assert.match(r.stderr.trim(), /^guard: .*allowed$/, raw);
    assert.strictEqual(r.stderr.trim().split('\n').length, 1, raw);
  }
});

after(() => fs.rmSync(R.root, { recursive: true, force: true }));

test('guard.mjs: under ORC_HEADLESS=1 an Antigravity ask is refused; a Claude Code ask and an interactive Antigravity ask are unchanged', () => {
  const agy = JSON.stringify({ hookEventName: 'PreToolUse', cwd: R.wt, toolCall: { id: 't1', name: 'run_command', args: { CommandLine: 'git add -A' } } });
  const claude = JSON.stringify({ hook_event_name: 'PreToolUse', cwd: R.wt, tool_name: 'Bash', tool_input: { command: 'git add -A' } });
  const interactive = JSON.parse(runGuard(agy, {}, () => {}));
  assert.strictEqual(interactive.decision, 'ask');
  const headless = JSON.parse(runGuard(agy, { ORC_HEADLESS: '1' }, () => {}));
  assert.strictEqual(headless.decision, 'deny');
  assert.match(headless.reason, /^guard: broad-add: .* \(headless run: nobody can answer, so it is refused\)$/);
  assert.strictEqual(JSON.parse(runGuard(claude, { ORC_HEADLESS: '1' }, () => {})).hookSpecificOutput.permissionDecision, 'ask', 'Claude Code already treats a headless ask as a deny');
  // An allow stays silent and a deny keeps its reason.
  const commit = JSON.stringify({ hookEventName: 'PreToolUse', cwd: R.wt, toolCall: { id: 't2', name: 'run_command', args: { CommandLine: 'git status' } } });
  assert.strictEqual(runGuard(commit, { ORC_HEADLESS: '1' }, () => {}), '');
});

test('guard.mjs: ~ is USERPROFILE on Windows and HOME elsewhere, when the two differ', () => {
  // R.root holds the repo on main; the other home holds no repo, so following it would find no branch and allow.
  const otherHome = fs.mkdtempSync(path.join(os.tmpdir(), 'orc-guard-otherhome-'));
  const env = process.platform === 'win32' ? { USERPROFILE: R.root, HOME: otherHome } : { HOME: R.root, USERPROFILE: otherHome };
  for (const cmd of ['cd ~/repo && git commit -m x', 'git -C ~/repo commit -m x']) {
    const out = runGuard(JSON.stringify({ hook_event_name: 'PreToolUse', cwd: R.wt, tool_name: 'Bash', tool_input: { command: cmd } }), env, () => {});
    assert.notStrictEqual(out, '', `${cmd}: expected a deny`);
    assert.strictEqual(JSON.parse(out).hookSpecificOutput.permissionDecision, 'deny', cmd);
    assert.match(JSON.parse(out).hookSpecificOutput.permissionDecisionReason, /commit on main/, cmd);
  }
  fs.rmSync(otherHome, { recursive: true, force: true });
});
