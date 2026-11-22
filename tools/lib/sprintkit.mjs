// The sprint kit (install --tool claude-code --sprint-kit): the roster and rulebook as install writes them, plus the
// sprint skill, the Node git guard hook and a stack permission preset, with no board. Its settings.json additions are
// recorded entry by entry in the manifest (`kit`), so uninstall removes only those and restores what install replaced.
import fs from 'node:fs';
import path from 'node:path';
import { mergeHooks } from './hooks.mjs';
import { readText } from './text.mjs';

// The kit copies only the guard of the hook scripts: the board reminder belongs to the board the kit leaves out.
export const KIT_HOOK_SCRIPTS = ['tools/guard.mjs'];

// The skill files the kit copies, repo-relative; installed under <home>/.claude/.
export const KIT_SKILLS = ['skills/sprint/SKILL.md'];

// The rulebook lines a kit install adds where the Board line would go. The rulebook core asks for a board on every
// orchestrated task, and the tool notes describe the full setup's hooks and settings; a borrowed machine has less.
export const KIT_NOTES = [
  '- **Board:** none on this machine (sprint kit). Skip every board write, the board-reminder markers and the cost log; sprint mode waives them anyway.',
  '- **Sprint kit:** only the Node git guard (`tools/guard.mjs`) is wired; there is no board-reminder hook, so the PowerShell guard and board-reminder lines above do not apply here. No subagent model or effort is set in `settings.json`, so always name `subagent_type` (each roster agent carries its own model). Nothing is pushed unless the user says so: commits stay local.',
];

// The tool-notes line that imports the machine's board address; a kit build drops it (there is no board.local.md).
export const BOARD_IMPORT = /^.*@board\.local\.md.*\n(?:\n)?/m;

// Permission presets: build, test, run and package-restore commands per stack. A command with arguments gets the
// trailing-wildcard form; the permissions doc says "A `*` at the end, with a space before it, also matches the bare
// command." (so `Bash(npm test *)` matches `npm test`). A restore command is exact, so `npm install` never matches
// `npm install -g <pkg>`. Each rule has a PowerShell twin, because Claude Code on Windows often runs commands through
// its PowerShell tool; the doc says "PowerShell permission rules use the same shape as Bash rules". No git rules:
// Claude Code already runs read-only git without a prompt, so a `git log *` rule would only add the forms that write
// (`git log --output=<file>`). No pip rule: outside a virtual environment `pip install -r requirements.txt` installs
// into the global Python. Source for both quotes: https://code.claude.com/docs/en/permissions (Wildcard patterns;
// PowerShell rules).
const STACKS = {
  dotnet: { prefix: ['dotnet build', 'dotnet test', 'dotnet run'], exact: ['dotnet restore'] },
  node: { prefix: ['npm test', 'npm run', 'npm start'], exact: ['npm install', 'npm ci'] },
  python: { prefix: ['pytest', 'python -m pytest', 'python -m unittest'], exact: [] },
};

export const KNOWN_STACKS = Object.keys(STACKS);

export function presetRules(stacks) {
  const rules = [];
  const add = (cmd, wild) => {
    for (const tool of ['Bash', 'PowerShell']) rules.push(`${tool}(${cmd}${wild ? ' *' : ''})`);
  };
  for (const s of stacks) {
    for (const c of STACKS[s].prefix) add(c, true);
    for (const c of STACKS[s].exact) add(c, false);
  }
  return [...new Set(rules)];
}

// Stacks found in the top level of dir: *.sln, *.slnx or *.csproj = dotnet, package.json = node,
// pyproject.toml or requirements.txt = python.
export function detectStacks(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const found = [];
  if (names.some((n) => /\.(sln|slnx|csproj)$/i.test(n))) found.push('dotnet');
  if (names.includes('package.json')) found.push('node');
  if (names.includes('pyproject.toml') || names.includes('requirements.txt')) found.push('python');
  return found;
}

// The PreToolUse guard group of hooks.node.example.json only (that file also wires the board reminder).
export function kitHookExample(repo) {
  const example = JSON.parse(readText(path.join(repo, 'hooks.node.example.json')));
  const groups = (example.hooks?.PreToolUse ?? []).filter((g) => (g.hooks ?? []).some((h) => /tools\/guard\.mjs"/.test(h.command ?? '')));
  return { hooks: { PreToolUse: groups } };
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The script a hook command runs when it is a plain guard invocation, else null. The command splits into words (a
// double- or single-quoted word may hold spaces; an unquoted one may not). The first word must be the program: node,
// pwsh or powershell, bare or by path, with or without .exe. For node, the script is the first word that is not an
// option, and an option that runs code instead (-e, --eval, -p, --print, -i, --interactive, -c, --check) rejects the
// command. For pwsh and powershell, the script is the word after -File (or -f), and -Command, -c, -EncodedCommand,
// -e or -ec before it rejects the command. Any shell operator (| & ; # or a word holding one) before the script
// rejects it. The script must end in tools/guard.mjs (node) or tools/guard.ps1 (PowerShell), with no suffix.
// So `echo node .../guard.mjs`, `pwsh -c echo .../guard.ps1`, `node -e "" .../guard.mjs`, `false && node ...` and
// `node .../guard.mjs.bak` are all rejected.
export function guardScript(command) {
  if (typeof command !== 'string') return null;
  const words = [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => ({ text: m[1] ?? m[2] ?? m[3], quoted: m[3] === undefined }));
  if (!words.length) return null;
  const program = path.basename(words[0].text.replace(/\\/g, '/')).toLowerCase().replace(/\.exe$/, '');
  if (!['node', 'pwsh', 'powershell'].includes(program)) return null;
  const operator = (w) => !w.quoted && /[|&;#]/.test(w.text);
  let script = null;
  if (program === 'node') {
    for (const w of words.slice(1)) {
      if (operator(w)) return null;
      if (!w.quoted && w.text.startsWith('-')) {
        if (/^(?:-e|--eval|-p|--print|-i|--interactive|-c|--check)(?:=|$)/.test(w.text)) return null;
        continue;
      }
      script = w.text;
      break;
    }
    return script && /[\\/]tools[\\/]guard\.mjs$/.test(script) ? script : null;
  }
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (operator(w)) return null;
    if (w.quoted) continue;
    if (/^-(?:c|command|e|ec|encodedcommand)$/i.test(w.text)) return null;
    if (/^-(?:f|file)$/i.test(w.text)) {
      script = words[i + 1]?.text ?? null;
      break;
    }
  }
  return script && /[\\/]tools[\\/]guard\.ps1$/i.test(script) ? script : null;
}

// A PreToolUse matcher that fires on both Bash and PowerShell: none, empty, `*`, or a pattern naming both. A guard on
// a Bash-only matcher leaves the PowerShell tool unguarded, so it does not count.
const coversShells = (matcher) =>
  matcher === undefined || matcher === null || matcher === '' || matcher === '*' || (typeof matcher === 'string' && /\bBash\b/.test(matcher) && /\bPowerShell\b/.test(matcher));

// The PreToolUse guard hooks already in settings: {guard: true when one on a matcher covering both shells runs a guard
// script that exists, stale: [{matcher, command, script}] for guard invocations whose script is not on disk}. `exists`
// decides whether a script is there (install also counts the guard.mjs it is about to write).
export function guardStatus(settings, { exists = fs.existsSync } = {}) {
  const out = { guard: false, stale: [] };
  const groups = settings?.hooks?.PreToolUse;
  if (!Array.isArray(groups)) return out;
  for (const g of groups) {
    for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
      const script = guardScript(h?.command);
      if (!script) continue;
      if (!exists(script)) out.stale.push({ matcher: g.matcher ?? null, command: h.command, script });
      else if (coversShells(g?.matcher)) out.guard = true;
    }
  }
  return out;
}

// True when a working git guard is already wired (see guardStatus). A false yes would leave the machine with no guard,
// so anything short of that counts as no.
export const hasGuard = (settings, opts) => guardStatus(settings, opts).guard;
const getPath = (obj, dotted) => dotted.split('.').reduce((o, k) => (isObject(o) && Object.hasOwn(o, k) ? o[k] : undefined), obj);

// Plans the kit's additions to a parsed settings.json. Adds only what is missing; never removes, reorders or rewrites.
// Returns {merged, hooks: [{event, matcher, command}], allow: [rule], containers: [dotted path the kit created]}.
export function planKitSettings(settings, { example, allow, home, guardExists }) {
  if (getPath(settings, 'permissions') !== undefined && !isObject(settings.permissions)) throw new Error('permissions in settings.json is not an object');
  if (getPath(settings, 'permissions.allow') !== undefined && !Array.isArray(settings.permissions.allow)) throw new Error('permissions.allow in settings.json is not an array');
  if (getPath(settings, 'hooks') !== undefined && !isObject(settings.hooks)) throw new Error('hooks in settings.json is not an object');
  // A working git guard already wired (see guardStatus) is not doubled, and the kit records nothing for it, so
  // uninstall leaves it.
  const { merged, added } = mergeHooks(settings, hasGuard(settings, guardExists ? { exists: guardExists } : {}) ? {} : example, home);
  const addedAllow = [];
  const have = new Set(Array.isArray(settings.permissions?.allow) ? settings.permissions.allow : []);
  for (const rule of allow) {
    if (have.has(rule)) continue;
    have.add(rule);
    merged.permissions ??= {};
    merged.permissions.allow ??= [];
    merged.permissions.allow.push(rule);
    addedAllow.push(rule);
  }
  const candidates = ['permissions', 'permissions.allow', 'hooks', ...added.map((a) => `hooks.${a.event}`)];
  const containers = [...new Set(candidates)].filter((p) => getPath(settings, p) === undefined && getPath(merged, p) !== undefined);
  return { merged, hooks: added.map(({ event, matcher, command }) => ({ event, matcher: matcher ?? null, command })), allow: addedAllow, containers };
}

// Removes exactly the recorded entries (one occurrence each), then each container the kit created when it is empty.
export function removeKitSettings(settings, record) {
  const out = structuredClone(settings);
  for (const h of record.hooks ?? []) {
    const groups = out.hooks?.[h.event];
    if (!Array.isArray(groups)) continue;
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      if ((g?.matcher ?? null) !== (h.matcher ?? null) || !Array.isArray(g.hooks)) continue;
      const j = g.hooks.findIndex((x) => x?.command === h.command);
      if (j < 0) continue;
      g.hooks.splice(j, 1);
      if (!g.hooks.length) groups.splice(i, 1);
      break;
    }
  }
  const allow = out.permissions?.allow;
  if (Array.isArray(allow)) {
    for (const rule of record.allow ?? []) {
      const i = allow.lastIndexOf(rule);
      if (i >= 0) allow.splice(i, 1);
    }
  }
  const deepestFirst = [...(record.containers ?? [])].sort((a, b) => b.split('.').length - a.split('.').length);
  for (const dotted of deepestFirst) {
    const keys = dotted.split('.');
    const parent = keys.length > 1 ? getPath(out, keys.slice(0, -1).join('.')) : out;
    const last = keys.at(-1);
    if (!isObject(parent) || !Object.hasOwn(parent, last)) continue;
    const v = parent[last];
    if ((Array.isArray(v) && !v.length) || (isObject(v) && !Object.keys(v).length)) delete parent[last];
  }
  return out;
}

// Checks the shape of a manifest's `kit` record before uninstall acts on it. Returns an error string or null.
export function kitRecordProblem(kit) {
  if (kit === undefined) return null;
  if (!isObject(kit)) return 'kit is not an object';
  const s = kit.settings;
  if (s !== undefined) {
    if (!isObject(s)) return 'kit.settings is not an object';
    for (const k of ['hooks', 'allow', 'containers']) if (s[k] !== undefined && !Array.isArray(s[k])) return `kit.settings.${k} is not a list`;
    if ((s.hooks ?? []).some((h) => !isObject(h) || typeof h.event !== 'string' || typeof h.command !== 'string')) return 'kit.settings.hooks has a bad entry';
    if ((s.allow ?? []).some((r) => typeof r !== 'string')) return 'kit.settings.allow has a bad entry';
    if ((s.containers ?? []).some((c) => !['permissions', 'permissions.allow', 'hooks'].includes(c) && !/^hooks\.[A-Za-z]+$/.test(c))) return 'kit.settings.containers has a bad entry';
    if (s.backup !== undefined && s.backup !== null && typeof s.backup !== 'string') return 'kit.settings.backup is not a path';
  }
  if (kit.restore !== undefined && (!isObject(kit.restore) || Object.values(kit.restore).some((v) => typeof v !== 'string'))) return 'kit.restore is not a map of paths';
  if (kit.copies !== undefined && (!Array.isArray(kit.copies) || kit.copies.some((v) => typeof v !== 'string'))) return 'kit.copies is not a list of paths';
  return null;
}
