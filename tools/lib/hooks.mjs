// Merges hooks into Claude Code's settings.json (under `hooks`) and Antigravity's named-hook hooks.json (top-level keys).
// Claude Code (`mergeHooks`): adds a hook entry only when no hook under the same event and matcher already runs an
// identical command; never removes, reorders or rewrites anything. The same command under a different matcher is added,
// and `otherMatchers` names the existing ones.
// Antigravity (`setAntigravityGuard` / `removeAntigravityGuard`): adds, replaces or removes only the `orc-guard`
// top-level key and leaves every other named hook untouched in value and order.
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

// Reads a settings.json: {original (text without a BOM, or null when absent), bom, settings}. Throws on invalid JSON
// and on a top level that is not an object.
export function readSettings(target) {
  if (!fs.existsSync(target)) return { original: null, bom: '', settings: {} };
  const raw = fs.readFileSync(target, 'utf8');
  const bom = raw.charCodeAt(0) === 0xfeff ? raw[0] : '';
  const original = raw.slice(bom.length);
  const settings = JSON.parse(original);
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error(`${target} is not a JSON object at the top level; nothing written`);
  return { original, bom, settings };
}

// Writes the new content beside the target first, so a failed write leaves no backup behind; then copies the target
// to `backup` (when given) and renames the new content over it. A failed rename removes the temp file and the backup.
export function writeSettings(target, content, backup = null) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.orc-tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  if (backup) {
    try {
      fs.copyFileSync(target, backup);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
  }
  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    if (backup) fs.rmSync(backup, { force: true });
    throw e;
  }
}

// The example files write the home as `C:\Users\<you>` (adapters/claude-code/settings.example.json) or `<home>`
// (adapters/claude-code/hooks.node.example.json), and the setup checkout as `<setup>`.
export function fillHome(command, home, setup = '') {
  let out = command.replaceAll('C:\\Users\\<you>', home).replaceAll('<home>', home.replace(/\\/g, '/'));
  if (setup) out = out.replaceAll('<setup>', setup.replace(/\\/g, '/'));
  return out;
}

// Old worklog/peon paths (under .claude/tools/) vs the moved paths (under <setup>/extras/), keyed by area, script
// name and trailing arguments so a stale entry matches only its replacement hook.
const OLD_EXTRA = /[\\/]\.claude[\\/]tools[\\/](worklog|peon)[\\/]([^"'\\/\s]+\.ps1)(?:["']|\s|$)(.*)$/i;
const NEW_EXTRA = /[\\/]extras[\\/](worklog|peon)[\\/]([^"\\/]+\.ps1)"(.*)$/i;
const extraKey = (re, cmd) => {
  const m = re.exec(cmd);
  return m ? `${m[1].toLowerCase()}/${m[2].toLowerCase()}|${m[3].trim()}` : null;
};

// Returns {merged, added: [{event, matcher, command, otherMatchers}], stale: [{event, matcher, oldCommand, command}]}.
// `settings` is the parsed target (or {}). A hook whose event already holds a stale .claude/tools/worklog or
// .claude/tools/peon entry for the same script and arguments (under any matcher) is reported in `stale` with the
// matcher it was found under and not duplicated.
export function mergeHooks(settings, example, home, setup = '') {
  const merged = structuredClone(settings);
  const added = [];
  const stale = [];
  const source = example.hooks ?? {};
  for (const [event, groups] of Object.entries(source)) {
    const key = (matcher, command) => JSON.stringify([matcher ?? '', command]);
    const have = new Set();
    const matchersOf = new Map();
    const staleByKey = new Map();
    for (const g of Array.isArray(merged.hooks?.[event]) ? merged.hooks[event] : []) {
      for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
        if (typeof h?.command !== 'string') continue;
        have.add(key(g.matcher, h.command));
        if (!matchersOf.has(h.command)) matchersOf.set(h.command, []);
        matchersOf.get(h.command).push(g.matcher ?? '');
        const ek = extraKey(OLD_EXTRA, h.command);
        if (ek) {
          if (!staleByKey.has(ek)) staleByKey.set(ek, []);
          staleByKey.get(ek).push({ matcher: g.matcher, command: h.command });
        }
      }
    }
    for (const group of groups) {
      const hooks = [];
      for (const h of group.hooks ?? []) {
        const entry = { ...h, command: fillHome(h.command, home, setup) };
        if (have.has(key(group.matcher, entry.command))) continue;
        const nk = extraKey(NEW_EXTRA, entry.command);
        if (nk && staleByKey.has(nk)) {
          for (const found of staleByKey.get(nk)) {
            stale.push({ event, matcher: found.matcher, oldCommand: found.command, command: entry.command });
          }
          continue;
        }
        have.add(key(group.matcher, entry.command));
        hooks.push(entry);
        const others = (matchersOf.get(entry.command) ?? []).filter((m) => m !== (group.matcher ?? ''));
        added.push({ event, matcher: group.matcher, command: entry.command, otherMatchers: others });
      }
      if (!hooks.length) continue;
      merged.hooks ??= {};
      if (merged.hooks[event] !== undefined && !Array.isArray(merged.hooks[event])) throw new Error(`hooks.${event} in settings.json is not an array`);
      merged.hooks[event] ??= [];
      merged.hooks[event].push({ ...group, hooks });
    }
  }
  return { merged, added, stale };
}

// Serializes like the input file: its indent, its line ending, its trailing newline.
export function formatLike(original, value) {
  const indent = /\n([ \t]+)"/.exec(original ?? '')?.[1] ?? '  ';
  const eol = (original ?? '').includes('\r\n') ? '\r\n' : '\n';
  const trailing = original === null || original === undefined || /\n$/.test(original) ? eol : '';
  return JSON.stringify(value, null, indent).replace(/\n/g, eol) + trailing;
}

// ---------- Antigravity hooks.json (top-level named hooks, no `hooks` wrapper) ----------

export const ANTIGRAVITY_GUARD_KEY = 'orc-guard';

export function antigravityGuardPath(home) {
  return path.join(home, '.gemini', 'tools', 'guard.mjs').replace(/\\/g, '/');
}

export function antigravityGuardEntry(home) {
  return {
    PreToolUse: [
      {
        matcher: 'run_command',
        hooks: [{ type: 'command', command: `node "${antigravityGuardPath(home)}"`, timeout: 10 }],
      },
    ],
  };
}

function describeGuardDiff(prev, next) {
  if (!prev || typeof prev !== 'object' || Array.isArray(prev)) return `was ${JSON.stringify(prev)}`;
  const parts = [];
  if (prev.enabled === false) parts.push('enabled was false');
  else if (Object.hasOwn(prev, 'enabled')) parts.push(`enabled was ${JSON.stringify(prev.enabled)}`);
  const extraKeys = Object.keys(prev).filter((k) => k !== 'PreToolUse' && k !== 'enabled');
  if (extraKeys.length) parts.push(`extra key(s): ${extraKeys.join(', ')}`);
  const prevGroup = Array.isArray(prev.PreToolUse) && prev.PreToolUse.length === 1 ? prev.PreToolUse[0] : null;
  const nextGroup = next.PreToolUse[0];
  if (!prevGroup || typeof prevGroup !== 'object' || Array.isArray(prevGroup)) {
    parts.push(`PreToolUse was ${JSON.stringify(prev.PreToolUse)}`);
  } else {
    if (prevGroup.matcher !== nextGroup.matcher) parts.push(`matcher ${JSON.stringify(prevGroup.matcher)} -> ${JSON.stringify(nextGroup.matcher)}`);
    const prevHook = Array.isArray(prevGroup.hooks) && prevGroup.hooks.length === 1 ? prevGroup.hooks[0] : null;
    const nextHook = nextGroup.hooks[0];
    if (!prevHook || typeof prevHook !== 'object' || Array.isArray(prevHook)) {
      parts.push(`PreToolUse hooks was ${JSON.stringify(prevGroup.hooks)}`);
    } else {
      if (prevHook.type !== nextHook.type) parts.push(`type ${JSON.stringify(prevHook.type)} -> ${JSON.stringify(nextHook.type)}`);
      if (prevHook.command !== nextHook.command) parts.push(`command ${JSON.stringify(prevHook.command)} -> ${JSON.stringify(nextHook.command)}`);
      if (prevHook.timeout !== nextHook.timeout) parts.push(`timeout ${JSON.stringify(prevHook.timeout)} -> ${JSON.stringify(nextHook.timeout)}`);
    }
  }
  return parts.length ? parts.join('; ') : `was ${JSON.stringify(prev)}`;
}

// Adds or replaces only `orc-guard` in a parsed Antigravity hooks.json object; every other top-level key is untouched
// in value and order.
export function setAntigravityGuard(hooksObj, home) {
  const entry = antigravityGuardEntry(home);
  const had = Object.hasOwn(hooksObj, ANTIGRAVITY_GUARD_KEY);
  if (had && isDeepStrictEqual(hooksObj[ANTIGRAVITY_GUARD_KEY], entry)) {
    return { status: 'unchanged', merged: hooksObj, entry };
  }
  // Rebuilt key by key so `orc-guard` is replaced where it stands (or appended) and nothing else moves.
  const merged = {};
  for (const [k, v] of Object.entries(hooksObj)) merged[k] = k === ANTIGRAVITY_GUARD_KEY ? entry : v;
  if (!had) merged[ANTIGRAVITY_GUARD_KEY] = entry;
  return had
    ? { status: 'replaced', merged, entry, diff: describeGuardDiff(hooksObj[ANTIGRAVITY_GUARD_KEY], entry) }
    : { status: 'added', merged, entry };
}

// Removes only `orc-guard` from a parsed Antigravity hooks.json object; every other top-level key is untouched.
export function removeAntigravityGuard(hooksObj) {
  if (!Object.hasOwn(hooksObj, ANTIGRAVITY_GUARD_KEY)) return { status: 'absent', merged: hooksObj };
  const merged = structuredClone(hooksObj);
  delete merged[ANTIGRAVITY_GUARD_KEY];
  return { status: 'removed', merged };
}

// Extracts the PreToolUse command and script path from an `orc-guard` entry (used by `orc doctor`).
export function antigravityGuardScript(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { command: null, script: null, disabled: false };
  const disabled = entry.enabled === false;
  const groups = Array.isArray(entry.PreToolUse) ? entry.PreToolUse : [];
  let command = null;
  for (const g of groups) {
    for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
      if (typeof h?.command === 'string' && h.command.trim()) {
        command = h.command;
        break;
      }
    }
    if (command) break;
  }
  if (!command) return { command: null, script: null, disabled };
  const quoted = /"([^"]+\.(?:mjs|cjs|js|ps1|cmd|sh))"/i.exec(command) ?? /'([^']+\.(?:mjs|cjs|js|ps1|cmd|sh))'/i.exec(command);
  if (quoted) return { command, script: quoted[1], disabled };
  const tokens = command.trim().split(/\s+/);
  const script = tokens.length >= 2 && /^node(?:\.exe)?$/i.test(tokens[0]) ? tokens[1].replace(/^["']|["']$/g, '') : null;
  return { command, script, disabled };
}
