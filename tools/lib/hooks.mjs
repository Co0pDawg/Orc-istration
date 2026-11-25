// Merges only the `hooks` block of an example file into a Claude Code settings.json. It adds a hook entry only when
// no hook under the same event and matcher already runs an identical command; it never removes, reorders or rewrites
// anything. The same command under a different matcher is added, and `otherMatchers` names the existing ones.
import fs from 'node:fs';
import path from 'node:path';

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
// `settings` is the parsed target (or {}). A hook whose event and matcher already hold a stale .claude/tools/worklog
// or .claude/tools/peon entry is reported in `stale` and not duplicated.
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
        if (ek) staleByKey.set(key(g.matcher, ek), h.command);
      }
    }
    for (const group of groups) {
      const hooks = [];
      for (const h of group.hooks ?? []) {
        const entry = { ...h, command: fillHome(h.command, home, setup) };
        if (have.has(key(group.matcher, entry.command))) continue;
        const nk = extraKey(NEW_EXTRA, entry.command);
        if (nk && staleByKey.has(key(group.matcher, nk))) {
          stale.push({ event, matcher: group.matcher, oldCommand: staleByKey.get(key(group.matcher, nk)), command: entry.command });
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
