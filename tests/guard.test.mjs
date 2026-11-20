// tools/guard.mjs and tools/guard.ps1: one table of real PreToolUse payloads, fed through stdin to each hook.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
  return { root, main, wt, develop, accented, trunk };
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
  return { ...env, ...(c.env ?? {}) };
}

function check(runner, c) {
  const r = runner(payload(c), envFor(c));
  assert.equal(r.status, 0, `${c.name}: exit ${r.status}; stderr ${r.stderr}`);
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

const viaNode = (input, env) => spawnSync(process.execPath, [MJS], { input, env, encoding: 'utf8' });
const POWERSHELL = spawnSync('powershell', ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' }).status === 0;
const viaPs = (input, env) =>
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1], { input, env, encoding: 'utf8' });

const RUNNERS = [
  ['guard.mjs', viaNode, false],
  ['guard.ps1', viaPs, POWERSHELL ? false : 'powershell is not on this machine'],
];

for (const [label, runner, skip] of RUNNERS) {
  test(`${label}: deny, ask and allow over the payload table`, { skip }, () => {
    for (const c of CASES) check(runner, c);
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
  });
}

test('both example files wire the guard on PreToolUse for Bash and PowerShell; settings denies secret reads', () => {
  for (const [file, pattern] of [
    ['settings.example.json', /tools\\guard\.ps1"$/],
    ['hooks.node.example.json', /tools\/guard\.mjs"$/],
  ]) {
    const groups = JSON.parse(fs.readFileSync(path.join(REPO, file), 'utf8')).hooks.PreToolUse.filter((g) => g.hooks.some((h) => pattern.test(h.command)));
    assert.equal(groups.length, 1, file);
    assert.equal(groups[0].matcher, 'Bash|PowerShell', file);
  }
  const example = JSON.parse(fs.readFileSync(path.join(REPO, 'settings.example.json'), 'utf8'));
  assert.deepEqual(example.permissions.deny, ['Read(.env)', 'Read(.env.*)', 'Read(**/.credentials.json)', 'Read(~/.claude/.credentials.json)']);
});

after(() => fs.rmSync(R.root, { recursive: true, force: true }));
