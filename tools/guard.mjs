#!/usr/bin/env node
// Node port of guard.ps1: a PreToolUse hook on Claude Code (Bash|PowerShell) and Antigravity (run_command) that
// enforces the rulebook's hard git rules.
// Deny: commit on a protected branch, push to a protected branch, `git stash` (other than list/show) in a linked
// worktree, and (Claude Code only, where agent_type is present) commands that change a checkout from read-only roles
// (scout, researcher, refuter, review-*). Ask: force-push and `git add -A|--all|.`. Protected branches: main, develop,
// master, or ORC_PROTECTED_BRANCHES (comma list).
// It reads the command text only, so it is a seat belt, not a sandbox. Any failure exits 0 (fail open).
// Usage: node guard.mjs  (PreToolUse hook JSON on stdin)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PROTECTED = ['main', 'develop', 'master'];
const READ_ONLY_ROLES = ['scout', 'researcher', 'refuter'];
const READ_ONLY_DENIED = ['commit', 'push', 'merge', 'rebase', 'reset', 'clean', 'stash', 'rm', 'mv', 'checkout', 'switch', 'restore', 'pull', 'cherry-pick', 'revert', 'am'];
const CD_COMMANDS = ['cd', 'set-location', 'sl', 'chdir', 'pushd', 'push-location'];
const PREFIX_WORDS = ['then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', '{', '}'];
const WRAPPERS = ['time', 'env', 'command', 'exec', 'nohup'];

export function protectedBranches(env) {
  const list = String(env.ORC_PROTECTED_BRANCHES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_PROTECTED;
}

// Splits a command line into segments of words on && || ; | & ( ) and newlines outside quotes. In Bash the result
// also holds '(' and ')' markers, so a subshell's cd does not leak out of it.
// Both: a `#` that starts a word outside quotes is a comment to the end of the line; an escape before a newline
// outside quotes joins the lines. Bash: backslash escapes outside quotes and some characters inside double quotes
// (backslash-newline joins there too); heredoc bodies are skipped; `$(` inside double quotes is read unquoted up to
// its `)`; `$(( ))` is one word; a backtick substitution, quoted or not, is read like `$( )`. PowerShell: backtick
// escapes; backslash is literal (Windows paths); here-strings (@' '@, @" "@) are one word; `<# #>` is a comment; an
// unquoted `{` or `}` ends the command before it, so the first command inside `try {`, `ForEach-Object {`,
// `if (...) {`, `& {` or `}else{` is judged on its own, while `${name}` and `@{ }` stay words.
export function splitCommand(text, powershell) {
  const n = text.length;
  const segments = [];
  let words = [];
  let word = '';
  let inWord = false;
  let quote = '';
  let heredocs = [];
  // One entry per open `$(` inside double quotes: its count of nested open parentheses.
  const subst = [];
  // An open Bash backtick substitution: null, or whether it opened inside double quotes.
  let backtick = null;
  // PowerShell: open `${` and `@{` braces, whose `}` belongs to the word.
  let braces = 0;
  const esc = powershell ? '`' : '\\';
  const endWord = () => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length) segments.push(words);
    words = [];
  };
  const newlineAfter = (k) => (text[k] === '\n' ? 1 : text[k] === '\r' && text[k + 1] === '\n' ? 2 : 0);
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (!quote && powershell && c === '@' && (text[i + 1] === "'" || text[i + 1] === '"') && /^[ \t]*\r?\n/.test(text.slice(i + 2, i + 64))) {
      const close = text.indexOf(`\n${text[i + 1]}@`, i + 2);
      i = close < 0 ? n : close + 2;
      inWord = true;
      continue;
    }
    if (!quote && !inWord && powershell && c === '<' && text[i + 1] === '#') {
      const close = text.indexOf('#>', i + 2);
      i = close < 0 ? n : close + 1;
      continue;
    }
    if (!quote && !inWord && c === '#') {
      // A comment runs to the newline, which is still read (it ends the segment and starts any heredoc body).
      const e = text.indexOf('\n', i);
      i = (e < 0 ? n : e) - 1;
      continue;
    }
    if (quote !== "'" && !powershell && c === '$' && text[i + 1] === '(' && text[i + 2] === '(') {
      // Arithmetic $(( )): one word, so a << inside it is a shift, not a heredoc.
      let depth = 0;
      let k = i + 1;
      for (; k < n; k++) {
        if (text[k] === '(') depth++;
        else if (text[k] === ')' && --depth === 0) break;
      }
      word += text.slice(i, k + 1);
      inWord = true;
      i = k;
      continue;
    }
    if (quote === '"' && !powershell && c === '$' && text[i + 1] === '(') {
      // Command substitution inside double quotes: read it unquoted until its matching `)`.
      subst.push(0);
      quote = '';
      endSegment();
      segments.push('(');
      i++;
      continue;
    }
    if (!quote && !powershell && c === '<' && text[i + 1] === '<') {
      if (text[i + 2] === '<') {
        word += '<<<';
        inWord = true;
        i += 2;
        continue;
      }
      // A heredoc: read its delimiter (quoted or not); the body is skipped at the next newline.
      endWord();
      let j = i + 2;
      const strip = text[j] === '-';
      if (strip) j++;
      while (text[j] === ' ' || text[j] === '\t') j++;
      let delim = '';
      while (j < n && !' \t\n\r;&|()<>'.includes(text[j])) {
        const q = text[j];
        if (q === "'" || q === '"') {
          const end = text.indexOf(q, j + 1);
          delim += text.slice(j + 1, end < 0 ? n : end);
          j = end < 0 ? n : end + 1;
        } else if (q === '\\') {
          delim += text[j + 1] ?? '';
          j += 2;
        } else {
          delim += q;
          j++;
        }
      }
      if (delim) heredocs.push({ delim, strip });
      i = j - 1;
      continue;
    }
    if (quote === "'") {
      if (c === "'" && powershell && text[i + 1] === "'") {
        word += "'";
        i++;
      } else if (c === "'") quote = '';
      else word += c;
      continue;
    }
    if (quote === '"') {
      if (c === esc && !powershell && newlineAfter(i + 1)) {
        i += newlineAfter(i + 1);
      } else if (c === esc && i + 1 < n && (powershell || '"\\$`\n'.includes(text[i + 1]))) {
        word += text[++i];
      } else if (c === '`' && !powershell && !backtick) {
        // Backtick substitution inside double quotes: read it unquoted until the closing backtick.
        backtick = { quoted: true };
        quote = '';
        endSegment();
        segments.push('(');
      } else if (c === '"') quote = '';
      else word += c;
      continue;
    }
    if (c === esc && newlineAfter(i + 1)) {
      // A line continuation.
      i += newlineAfter(i + 1);
    } else if (c === esc && i + 1 < n) {
      word += text[++i];
      inWord = true;
    } else if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (c === '&' && (text[i - 1] === '>' || text[i - 1] === '<' || text[i + 1] === '>')) {
      // A redirection (2>&1, &>file), not a separator.
      word += c;
      inWord = true;
    } else if (powershell && c === '{') {
      if (word.endsWith('$') || word.endsWith('@')) {
        word += c;
        braces++;
        inWord = true;
      } else endSegment();
    } else if (powershell && c === '}') {
      if (braces) {
        word += c;
        braces--;
        inWord = true;
      } else endSegment();
    } else if (c === '`' && !powershell) {
      // A Bash backtick substitution opens or closes like `$(` and `)`.
      endSegment();
      if (backtick) {
        segments.push(')');
        if (backtick.quoted) {
          quote = '"';
          inWord = true;
        }
        backtick = null;
      } else {
        segments.push('(');
        backtick = { quoted: false };
      }
    } else if ('&|;()\n\r'.includes(c)) {
      endSegment();
      if (!powershell && c === '(') {
        segments.push(c);
        if (subst.length) subst[subst.length - 1]++;
      }
      if (!powershell && c === ')') {
        segments.push(c);
        if (subst.length && subst[subst.length - 1] === 0) {
          // Back inside the double-quoted word the substitution sat in.
          subst.pop();
          quote = '"';
          inWord = true;
        } else if (subst.length) subst[subst.length - 1]--;
      }
      if (c === '\n' && heredocs.length) {
        // Skip each pending heredoc body up to its terminator line (leading tabs dropped for <<-).
        let pos = i + 1;
        for (const { delim, strip } of heredocs) {
          while (pos < n) {
            const e = text.indexOf('\n', pos);
            let line = text.slice(pos, e < 0 ? n : e).replace(/\r$/, '');
            if (strip) line = line.replace(/^\t+/, '');
            pos = e < 0 ? n : e + 1;
            if (line === delim) break;
          }
        }
        heredocs = [];
        i = pos - 1;
      }
    } else if (c === ' ' || c === '\t') {
      endWord();
    } else {
      word += c;
      inWord = true;
    }
  }
  endSegment();
  return segments;
}

// Git Bash writes C: as /c; ~ is the home directory.
function resolveDir(base, dir, env = process.env) {
  let d = dir;
  if (d === '~' || d.startsWith('~/') || d.startsWith('~\\')) {
    const home = (process.platform === 'win32' ? (env.USERPROFILE || env.HOME) : env.HOME) || os.homedir();
    d = path.join(home, d.slice(1));
  }
  if (process.platform === 'win32') {
    const m = /^\/([a-zA-Z])(\/.*)?$/.exec(d);
    if (m) d = `${m[1]}:${m[2] ?? '/'}`;
  }
  return path.resolve(base, d);
}

function runGit(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 3000, windowsHide: true });
  if (r.error) throw new Error(`git did not answer in ${cwd} (${r.error.code ?? r.error.message})`);
  return r;
}

const firstLine = (t) => String(t ?? '').trim().split(/\r?\n/)[0];

const norm = (p) => {
  const s = p.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? s.toLowerCase() : s;
};

// Current branch (null when detached, unborn counts as its branch) and whether cwd is a linked worktree.
function makeProbe(warn) {
  const cache = new Map();
  return (cwd) => {
    if (cache.has(cwd)) return cache.get(cwd);
    let info = { branch: null, linked: false };
    try {
      if (!fs.existsSync(cwd)) throw new Error(`no directory ${cwd}`);
      const b = runGit(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']);
      // Exit 1 is a detached HEAD. Any other failure is git refusing the repo (dubious ownership, a broken .git).
      if (b.status !== 0 && b.status !== 1) throw new Error(`git could not read the branch in ${cwd} (exit ${b.status}: ${firstLine(b.stderr)}); judged as no branch`);
      const branch = b.status === 0 ? b.stdout.trim() || null : null;
      const d = runGit(cwd, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir']);
      const [gitDir, common] = d.status === 0 ? d.stdout.split(/\r?\n/) : [];
      info = { branch, linked: Boolean(gitDir && common && norm(gitDir) !== norm(common)) };
    } catch (e) {
      warn(e instanceof Error ? e.message : String(e));
    }
    cache.set(cwd, info);
    return info;
  };
}

// Local branch names for `push --all`; every protected name (so the push is denied) when git cannot list them.
function localBranches(cwd, protectedList, warn) {
  const assumed = 'push --all is judged as reaching every protected branch';
  try {
    const r = runGit(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
    if (r.status === 0) return r.stdout.split(/\r?\n/).filter(Boolean);
    warn(`git could not list the branches in ${cwd} (exit ${r.status}: ${firstLine(r.stderr)}); ${assumed}`);
  } catch (e) {
    warn(`${e instanceof Error ? e.message : String(e)}; ${assumed}`);
  }
  return [...protectedList];
}

const isGit = (w) => /^git(\.exe)?$/i.test(path.basename(w.replace(/\\/g, '/')));
const shortFlags = (a) => (/^-[a-zA-Z]+$/.test(a) ? a.slice(1) : '');

// One git invocation: returns {decision, reason} or null.
function judgeGit(sub, args, cwd, ctx) {
  const { probe, protectedList, role } = ctx;
  const isProtected = (b) => b !== null && protectedList.includes(b);
  if (role && READ_ONLY_DENIED.includes(sub)) {
    return { decision: 'deny', reason: `guard: read-only-role: ${role} may not run git ${sub}` };
  }
  if (sub === 'commit') {
    const { branch } = probe(cwd);
    if (isProtected(branch)) return { decision: 'deny', reason: `guard: protected-branch: git commit on ${branch} is blocked; create a branch first` };
    return null;
  }
  if (sub === 'push') {
    let force = false;
    let everything = false;
    let tags = false;
    const positional = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--force' || a.startsWith('--force-with-lease') || shortFlags(a).includes('f')) force = true;
      else if (a === '--all' || a === '--branches') everything = 'local';
      else if (a === '--mirror') everything = 'all';
      else if (a === '--tags') tags = true;
      else if (['-o', '--push-option', '--repo', '--receive-pack', '--exec'].includes(a)) i++;
      else if (!a.startsWith('-')) positional.push(a);
    }
    const refspecs = positional.slice(1);
    if (refspecs.some((r) => r.startsWith('+'))) force = true;
    const current = () => probe(cwd).branch;
    let dests = refspecs.map((r) => {
      const s = r.replace(/^\+/, '');
      const dst = s.includes(':') ? s.slice(s.indexOf(':') + 1) : s;
      const name = dst.replace(/^refs\/heads\//, '');
      return name === 'HEAD' || name === '@' ? current() : name;
    });
    // No refspec: --all reaches every local branch, --mirror every branch (it also deletes remote ones it lacks),
    // --tags pushes only tags, otherwise the current branch.
    if (!refspecs.length) dests = everything === 'local' ? localBranches(cwd, protectedList, ctx.warn) : everything ? [...protectedList] : tags ? [] : [current()];
    const hit = dests.find(isProtected);
    if (hit) return { decision: 'deny', reason: `guard: protected-branch: git push to ${hit} is blocked; push a branch and open a pull request` };
    if (force) return { decision: 'ask', reason: 'guard: force-push: this rewrites the remote branch; confirm it is yours' };
    return null;
  }
  if (sub === 'stash') {
    const action = args.find((a) => !a.startsWith('-'));
    if (action === 'list' || action === 'show') return null;
    if (probe(cwd).linked) return { decision: 'deny', reason: 'guard: worktree-stash: git stash in a linked worktree is blocked; all worktrees share one stash stack' };
    return null;
  }
  if (sub === 'add') {
    const broad = args.find((a) => a === '--all' || a === '.' || a === './' || shortFlags(a).includes('A'));
    if (broad) return { decision: 'ask', reason: `guard: broad-add: git add ${broad} stages every change; confirm nothing stray is included` };
  }
  return null;
}

export function readOnlyRole(agentType) {
  const name = String(agentType ?? '').split(':').pop().trim().toLowerCase();
  return READ_ONLY_ROLES.includes(name) || name.startsWith('review-') ? name : '';
}

// Drops what can stand in front of the command: VAR=value, shell keywords, ! { }, and the wrappers time, env,
// command, exec and nohup with their options.
function stripPrefixes(seg) {
  let w = seg;
  while (w.length) {
    const h = w[0].toLowerCase();
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || PREFIX_WORDS.includes(h)) w = w.slice(1);
    else if (WRAPPERS.includes(h)) {
      w = w.slice(1);
      while (w.length && w[0].startsWith('-')) w = w.slice(h === 'env' && ['-u', '--unset', '-C', '--chdir'].includes(w[0]) ? 2 : 1);
    } else break;
  }
  return w;
}

// PowerShell only: drops assignments in front of the command: `$r = git ...`, `$r += ...`, `$r=git ...`, a typed,
// braced or property target (`[string]$r`, `${r}`, `$r.x`, `$r[0]`), a comma list (`$a, $b = ...`) and a chain
// (`$a = $b = ...`).
const TARGET = String.raw`(?:\[[^\]]+\])*\$(?:\{[^}]+\}|[A-Za-z0-9_:]+)(?:\.[A-Za-z0-9_]+|\[[^\]]*\])*`;
const TARGETS = new RegExp(`^${TARGET}(?:,${TARGET})*$`);
const LISTED = new RegExp(`^(?:${TARGET})?(?:,${TARGET})*,$`);
const GLUED = new RegExp(`^${TARGET}(?:,${TARGET})*[-+*/]?=(?!=)(.+)$`);
function dropAssignment(words) {
  let w = words;
  for (;;) {
    let i = 0;
    while (i < w.length && LISTED.test(w[i])) i++;
    if (i + 1 < w.length && TARGETS.test(w[i]) && /^[-+*/]?=$/.test(w[i + 1])) {
      w = stripPrefixes(w.slice(i + 2));
      continue;
    }
    const m = i < w.length ? GLUED.exec(w[i]) : null;
    if (!m) return w;
    w = [m[1], ...w.slice(i + 1)];
  }
}

function isAntigravityPayload(hook) {
  return Boolean(
    hook && typeof hook === 'object' && !Array.isArray(hook)
      && hook.toolCall && typeof hook.toolCall === 'object' && !Array.isArray(hook.toolCall)
      && typeof hook.toolCall.name === 'string',
  );
}

// Extracts { command, role, ps } from a Claude Code or Antigravity PreToolUse payload, or null to allow.
function parsePayload(hook, warn, platform) {
  if (isAntigravityPayload(hook)) {
    if (hook.toolCall.name !== 'run_command') return null;
    const command = hook.toolCall.args?.CommandLine;
    if (typeof command !== 'string') {
      warn('no toolCall.args.CommandLine in the payload; allowed');
      return null;
    }
    return { command, role: '', ps: platform === 'win32' };
  }
  if (hook && typeof hook === 'object' && !Array.isArray(hook)) {
    const command = hook.tool_input?.command;
    if (typeof command === 'string') {
      return { command, role: readOnlyRole(hook.agent_type), ps: hook.tool_name === 'PowerShell' };
    }
    if (Object.hasOwn(hook, 'tool_input') || Object.hasOwn(hook, 'tool_name')) {
      warn('no tool_input.command in the payload; allowed');
      return null;
    }
  }
  warn('unrecognized payload (no tool_input.command or toolCall); allowed');
  return null;
}

// Returns {decision, reason} for the strongest rule hit (deny before ask), or null to allow.
export function decide(hook, env, warn = () => {}, platform = process.platform) {
  const parsed = parsePayload(hook, warn, platform);
  if (!parsed) return null;
  const { command, role, ps } = parsed;
  if (!/git/i.test(command)) return null;
  const startDir = typeof hook.cwd === 'string' && hook.cwd ? hook.cwd : process.cwd();
  const ctx = { probe: makeProbe(warn), protectedList: protectedBranches(env), role, warn };
  let cwd = startDir;
  const subshells = [];
  let ask = null;
  for (const seg of splitCommand(command, ps)) {
    if (seg === '(') {
      subshells.push(cwd);
      continue;
    }
    if (seg === ')') {
      if (subshells.length) cwd = subshells.pop();
      continue;
    }
    const words = ps ? dropAssignment(stripPrefixes(seg)) : stripPrefixes(seg);
    if (!words.length) continue;
    const head = words[0].toLowerCase();
    if (CD_COMMANDS.includes(head)) {
      const target = words.slice(1).filter((w) => !/^-(path|literalpath)$/i.test(w))[0];
      if (target && target !== '-') cwd = resolveDir(cwd, target, env);
      continue;
    }
    if (!isGit(words[0])) continue;
    let dir = cwd;
    let i = 1;
    while (i < words.length && words[i].startsWith('-')) {
      const o = words[i];
      if (o === '-C') dir = resolveDir(dir, words[++i] ?? '.', env);
      else if (['-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env'].includes(o)) i++;
      i++;
    }
    const sub = words[i];
    if (!sub) continue;
    // Drop redirections: a bare operator also takes its target.
    const args = [];
    for (let j = i + 1; j < words.length; j++) {
      const m = /^(\d|\*|&)?>>?|^</.exec(words[j]);
      if (!m) args.push(words[j]);
      else if (m[0] === words[j]) j++;
    }
    const verdict = judgeGit(sub, args, dir, ctx);
    if (verdict?.decision === 'deny') return verdict;
    if (verdict && !ask) ask = verdict;
  }
  return ask;
}

export function run(stdinText, env = process.env, warn = () => {}, platform = process.platform) {
  const hook = JSON.parse(String(stdinText).replace(/^\uFEFF/, ''));
  const verdict = decide(hook, env, warn, platform);
  if (!verdict) return '';
  if (isAntigravityPayload(hook)) {
    // A headless Antigravity run does not stop at an ask (the command runs), so under `orc dispatch`, which sets
    // ORC_HEADLESS=1, an ask is refused: nobody is there to answer it.
    if (verdict.decision === 'ask' && env.ORC_HEADLESS === '1') {
      return JSON.stringify({ decision: 'deny', reason: `${verdict.reason} (headless run: nobody can answer, so it is refused)` });
    }
    return JSON.stringify({ decision: verdict.decision, reason: verdict.reason });
  }
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: verdict.decision, permissionDecisionReason: verdict.reason },
  });
}

// Real paths on both sides, so the hook still runs when it is started through a junction or symlink.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (isMainModule()) {
  let warned = false;
  const warn = (m) => {
    if (warned) return;
    warned = true;
    process.stderr.write(`guard: ${m}\n`);
  };
  try {
    let input = null;
    try {
      input = fs.readFileSync(0, 'utf8');
    } catch (e) {
      warn(`could not read stdin (${e instanceof Error ? (e.code ?? e.message) : String(e)}); allowed`);
    }
    const out = input === null ? '' : run(input, process.env, warn);
    if (out) process.stdout.write(`${out}\n`);
  } catch (e) {
    warn(`${e instanceof Error ? e.message : String(e)}; allowed`);
  }
  process.exitCode = 0;
}
