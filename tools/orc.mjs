#!/usr/bin/env node
// Orchestration generator and installer. Node 22+, standard library only.
// build | check | sync | install | uninstall | status | models | brief | review-tier | costlog | dispatch | hooks
// (see README "Other tools")
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, normalizeEol, isGenerated } from './lib/frontmatter.mjs';
import { parseRole } from './lib/roles.mjs';
import { sha256, diskHash, loadManifest, writeManifest, safeRel, escapes } from './lib/manifest.mjs';
import { knownTools, validateModels } from './lib/models.mjs';
import { briefTemplate, lintBrief, parseMarchingOrders } from './lib/brief.mjs';
import { reviewTier } from './lib/reviewtier.mjs';
import { costlog, readBoardExport } from './lib/costlog.mjs';
import { dispatchPlan, runDispatch, formatCommand, argvProblem, binEnv } from './lib/dispatch.mjs';
import { mergeHooks, formatLike } from './lib/hooks.mjs';
import { decodeText, readText } from './lib/text.mjs';

const DEFAULT_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Text from a file or stdin goes through the one shared reader (tools/lib/text.mjs).
export { decodeText };
const read = readText;

export function loadRoles(repo) {
  const dir = path.join(repo, 'roles');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseRole(read(path.join(dir, f)), `roles/${f}`));
}

export function loadModels(repo, { local = true } = {}) {
  const tools = knownTools(repo);
  const models = JSON.parse(read(path.join(repo, 'models.json')));
  validateModels(models, tools, 'models.json');
  const localFile = path.join(repo, 'models.local.json');
  if (local && fs.existsSync(localFile)) {
    const over = JSON.parse(read(localFile));
    validateModels(over, tools, 'models.local.json');
    for (const [tool, tiers] of Object.entries(over)) {
      models[tool] ??= {};
      for (const [tier, value] of Object.entries(tiers)) {
        const base = models[tool][tier];
        models[tool][tier] =
          base && typeof base === 'object' && typeof value === 'object' ? { ...base, ...value } : value;
      }
    }
  }
  return models;
}

export async function loadAdapters(repo) {
  const dir = path.join(repo, 'adapters');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();
  const adapters = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(dir, f)).href);
    const adapter = mod.default;
    const notesFile = path.join(dir, `${adapter.id}.notes.md`);
    adapter.notes = fs.existsSync(notesFile) ? read(notesFile) : '';
    adapters.push(adapter);
  }
  return adapters;
}

export function renderNotes(adapter, extra = [], profiles = []) {
  let notes = adapter.notes;
  for (const line of extra) notes += `${line}\n`;
  if (adapter.gaps.length) {
    notes += `\nWhat ${adapter.title} cannot do (generated from the adapter's gaps):\n`;
    for (const g of adapter.gaps) notes += `- ${g}\n`;
  }
  for (const p of profiles) notes += `\n# Profile: ${p.name}\n\n${p.text}`;
  return notes;
}

// Optional rulebook additions from profiles/<name>.md, appended after the tool notes in the order given.
export function loadProfiles(repo, names = []) {
  const dir = path.join(repo, 'profiles');
  const known = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort() : [];
  return names.map((name) => {
    if (!known.includes(name)) throw new Error(`unknown profile ${name}; known: ${known.join(', ') || 'none'}`);
    return { name, text: read(path.join(dir, `${name}.md`)) };
  });
}

// The Board line that install adds, so status compares against the same text.
function boardNotes({ board, boardRepo }) {
  if (!board) return [];
  const cli = `${boardRepo.replace(/\\/g, '/')}/local/board.js`;
  const port = /^https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/.exec(board)?.[1];
  const portNote = port ? ` (set \`ORC_BOARD_PORT=${port}\`)` : '';
  return [`- **Board:** this machine's board address is \`${board}\`; write it with \`node "${cli}"\`${portNote}.`];
}

// Install options (profiles, board) come from the flags; with none of them given, from the manifest's `options`.
// Each option given replaces the recorded one; --no-profile and --no-board clear them.
function installOptions(opt, manifest, io) {
  const rec = manifest?.options ?? {};
  const reused = [];
  let profiles = opt.profile ?? [];
  if (opt['no-profile']) profiles = [];
  else if (!opt.profile && Array.isArray(rec.profiles) && rec.profiles.length) {
    profiles = rec.profiles;
    reused.push(`profile ${profiles.join(',')}`);
  }
  let board = opt.board ?? null;
  let boardRepo = opt['board-repo'] ?? null;
  if (opt['no-board']) board = boardRepo = null;
  else if (!opt.board && typeof rec.board === 'string' && typeof rec.boardRepo === 'string') {
    board = rec.board;
    boardRepo = rec.boardRepo;
    reused.push(`board ${board}`);
  }
  if (reused.length) io.out(`using the options recorded at install: ${reused.join('; ')} (pass --no-profile or --no-board to clear)`);
  return { profiles, board, boardRepo };
}

export function allowedTools(adapter) {
  return new Set(Object.values(adapter.capabilityTools ?? {}).flat().filter(Boolean));
}

function emittedTools(file) {
  if (!file.path.endsWith('.md')) return [];
  const { data } = parse(file.content);
  if (data.tools === undefined) return [];
  return Array.isArray(data.tools) ? data.tools : String(data.tools).split(',').map((s) => s.trim());
}

// Returns {files, errors, warnings, rulebook}. Paths are home-relative with forward slashes; agent files carry `role`.
export function buildTool(adapter, roles, models, agentsMd, { extraNotes = [], profiles = [] } = {}) {
  const errors = [];
  const warnings = [];
  let rulebook = null;
  const tiers = models[adapter.id];
  if (!tiers) return { files: [], errors: [`${adapter.id}: no entry in models.json`], warnings, rulebook };
  const files = [...adapter.renderRulebook(agentsMd, renderNotes(adapter, extraNotes, profiles))];
  for (const role of roles) {
    const tierModel = tiers[role.tier];
    if (!tierModel) errors.push(`${adapter.id}: no model for tier ${role.tier}`);
    else files.push({ ...adapter.renderAgent(role, tierModel), role: role.name });
  }
  const allowed = allowedTools(adapter);
  const editTools = new Set(adapter.capabilityTools?.edit ?? []);
  for (const f of files) {
    f.path = f.path.replace(/\\/g, '/');
    const limit = adapter.limits?.ruleBytes;
    if (limit && f.path === adapter.home.rulebook) {
      const size = Buffer.byteLength(f.content, 'utf8');
      rulebook = { path: f.path, size, limit, headroom: limit - size };
      if (size >= limit) errors.push(`${adapter.id}: ${f.path} is ${size} bytes; the limit is under ${limit}`);
      else if (limit - size < 1000) warnings.push(`${adapter.id}: ${f.path} has only ${limit - size} bytes of headroom (under 1000)`);
    }
    if (!f.role) continue;
    const bodyCap = adapter.limits?.agentBodyChars;
    if (bodyCap) {
      const chars = [...parse(f.content).body].length;
      if (chars > bodyCap) errors.push(`${adapter.id}: ${f.path} body is ${chars} characters; the limit is ${bodyCap}`);
    }
    let tools;
    try {
      tools = emittedTools(f);
    } catch (e) {
      errors.push(`${adapter.id}: ${f.path}: ${e.message}`);
      continue;
    }
    for (const t of tools) if (!allowed.has(t)) errors.push(`${adapter.id}: ${f.path} emits unknown tool ${t}`);
    const role = roles.find((r) => r.name === f.role);
    if (role.access === 'read-only') {
      for (const t of tools) if (editTools.has(t)) errors.push(`${adapter.id}: read-only ${role.name} gets ${t}`);
    }
  }
  return { files, errors, warnings, rulebook };
}

async function buildAll(repo, toolId, { local = true, extraNotes = [], profiles = [] } = {}) {
  const roles = loadRoles(repo);
  const loaded = loadProfiles(repo, profiles);
  const models = loadModels(repo, { local });
  const agentsMd = read(path.join(repo, 'AGENTS.md'));
  const adapters = await loadAdapters(repo);
  const picked = !toolId || toolId === 'all' ? adapters : adapters.filter((a) => a.id === toolId);
  if (!picked.length) throw new Error(`unknown tool ${toolId}; known: ${adapters.map((a) => a.id).join(', ')}`);
  return picked.map((adapter) => ({ adapter, ...buildTool(adapter, roles, models, agentsMd, { extraNotes, profiles: loaded }) }));
}

function checkedInTargets(results) {
  const claude = results.find((r) => r.adapter.id === 'claude-code');
  const prefix = `${claude.adapter.home.root}/`;
  return claude.files
    .filter((f) => f.path !== `${prefix}AGENTS.md`)
    .map((f) => ({ rel: f.path.slice(prefix.length), content: f.content }));
}

// Checked-in agents/*.md with no role. `deletable` when it holds only generated-shaped frontmatter and a body.
function staleAgents(repo, roles) {
  const dir = path.join(repo, 'agents');
  if (!fs.existsSync(dir)) return [];
  const names = new Set(roles.map((r) => r.name));
  const shape = ['name', 'description', 'model', 'effort', 'tools'];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !names.has(f.slice(0, -3)))
    .map((f) => {
      let deletable = false;
      try {
        const { data } = parse(read(path.join(dir, f)));
        const keys = Object.keys(data);
        deletable = data.name === f.slice(0, -3) && keys.every((k) => shape.includes(k)) && typeof data.model === 'string';
      } catch {
        deletable = false;
      }
      return { rel: `agents/${f}`, deletable };
    });
}

// 1-based number of the first line that differs, also when one text is a line-wise prefix of the other.
export function firstDiffLine(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return i + 1;
  return 0;
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const VALUE_OPTIONS = ['home', 'tool', 'out', 'board', 'board-repo', 'repo', 'profile', 'role', 'base', 'repo-dir', 'session', 'board-export', 'brief', 'timeout'];

// Value options that may repeat; each value may also be comma-separated.
const LIST_OPTIONS = ['profile'];

const FLAG_OPTIONS = ['apply', 'force', 'from-stdin', 'dry-run', 'no-lint', 'node', 'no-profile', 'no-board'];

// Accepts `--key value` and `--key=value`. An unknown option is an error, never a silent boolean: a mistyped
// `--home=<dir>` once fell through to the real home directory.
export function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const key = eq < 0 ? a.slice(2) : a.slice(2, eq);
    if (VALUE_OPTIONS.includes(key)) {
      const value = eq < 0 ? argv[++i] : a.slice(eq + 1);
      if (value === undefined || value.trim() === '' || value.startsWith('--')) throw new Error(`--${key} needs a value`);
      if (LIST_OPTIONS.includes(key)) {
        const items = value.split(',').map((s) => s.trim());
        if (items.some((s) => s === '')) throw new Error(`--${key} needs a value`);
        out[key] = [...(out[key] ?? []), ...items];
      } else out[key] = value;
    } else if (FLAG_OPTIONS.includes(key) && eq < 0) out[key] = true;
    else throw new Error(`unknown option ${a}`);
  }
  return out;
}

export function parseAgyModels(text) {
  const found = {};
  for (const line of normalizeEol(text).split('\n')) {
    const m = /^\s*(\S*flash\S*-(low|medium|high))\s/.exec(`${line} `);
    if (m) found[{ low: 'low', medium: 'mid', high: 'high' }[m[2]]] ??= m[1];
  }
  const missing = ['low', 'mid', 'high'].filter((t) => !found[t]);
  if (missing.length) return { error: `cannot tell the ${missing.join(', ')} flash slug(s) from this list` };
  return { fragment: { antigravity: { headless: { low: found.low, mid: found.mid, high: found.high } } } };
}

export async function main(argv, io = { out: console.log, err: console.error, stdin: () => fs.readFileSync(0) }) {
  const fail = (msg) => {
    io.err(msg);
    return 1;
  };
  let opt;
  try {
    opt = args(argv);
  } catch (e) {
    return fail(e.message);
  }
  const cmd = opt._[0];
  const repo = path.resolve(opt.repo ?? DEFAULT_REPO);
  const profiles = opt.profile ?? [];
  if (profiles.length && !['build', 'install', 'status'].includes(cmd)) return fail('--profile applies to build, install and status only');
  if ((opt['no-profile'] || opt['no-board']) && !['install', 'status'].includes(cmd)) return fail('--no-profile and --no-board apply to install and status only');
  if (opt['no-profile'] && opt.profile) return fail('pass --profile or --no-profile, not both');
  if (opt['no-board'] && (opt.board || opt['board-repo'])) return fail('pass --board or --no-board, not both');
  try {
    loadProfiles(repo, profiles);
  } catch (e) {
    return fail(e.message);
  }

  if (cmd === 'build') {
    const outDir = path.resolve(repo, opt.out ?? 'dist');
    const results = await buildAll(repo, opt.tool ?? 'all', { profiles });
    let code = 0;
    for (const { adapter, files, errors, warnings, rulebook } of results) {
      warnings.forEach((w) => io.err(`WARN ${w}`));
      if (errors.length) {
        errors.forEach((e) => io.err(e));
        code = 1;
        continue;
      }
      for (const f of files) {
        const target = path.join(outDir, adapter.id, ...f.path.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, f.content);
        const room = rulebook?.path === f.path ? ` (headroom ${rulebook.headroom} of ${rulebook.limit})` : '';
        io.out(`${adapter.id}/${f.path} ${Buffer.byteLength(f.content)} bytes${room}`);
      }
      for (const g of adapter.gaps) io.out(`  gap: ${g}`);
    }
    return code;
  }

  if (cmd === 'check') {
    try {
      loadModels(repo);
    } catch (e) {
      return fail(`FAIL ${e.message}`);
    }
    const results = await buildAll(repo, 'all', { local: false });
    const problems = results.flatMap((r) => r.errors);
    for (const r of results) {
      r.warnings.forEach((w) => io.err(`WARN ${w}`));
      if (r.rulebook) io.out(`${r.adapter.id}: ${r.rulebook.path} ${r.rulebook.size} bytes, headroom ${r.rulebook.headroom}`);
    }
    if (results.some((r) => r.adapter.id === 'claude-code' && !r.errors.length)) {
      for (const { rel, content } of checkedInTargets(results)) {
        const file = path.join(repo, ...rel.split('/'));
        if (!fs.existsSync(file)) problems.push(`${rel}: missing (run node tools/orc.mjs sync)`);
        else if (read(file) !== content) {
          problems.push(`${rel}: differs from generated at line ${firstDiffLine(read(file), content)} (run node tools/orc.mjs sync)`);
        }
      }
      for (const s of staleAgents(repo, loadRoles(repo))) problems.push(`${s.rel}: no matching role in roles/ (stale)`);
    }
    if (problems.length) {
      problems.forEach((p) => io.err(`FAIL ${p}`));
      return 1;
    }
    io.out(`check ok: ${results.length} adapters, ${results.reduce((n, r) => n + r.files.length, 0)} files`);
    return 0;
  }

  if (cmd === 'sync') {
    const results = await buildAll(repo, 'claude-code', { local: false });
    if (results[0].errors.length) return fail(results[0].errors.join('\n'));
    for (const { rel, content } of checkedInTargets(results)) {
      fs.writeFileSync(path.join(repo, ...rel.split('/')), content);
      io.out(`wrote ${rel}`);
    }
    let code = 0;
    for (const s of staleAgents(repo, loadRoles(repo))) {
      if (s.deletable) {
        fs.rmSync(path.join(repo, ...s.rel.split('/')));
        io.out(`deleted ${s.rel} (generated, no matching role)`);
      } else {
        io.err(`WARN ${s.rel} has no matching role and is not in the generated shape; left in place`);
        code = 1;
      }
    }
    return code;
  }

  if (cmd === 'install') {
    const toolId = opt.tool;
    if (!toolId || toolId === 'all') return fail('install needs --tool <id>');
    if (toolId === 'claude-code' && !opt.home) {
      return fail('refusing --tool claude-code without --home: the live ~/.claude is synced by hand');
    }
    if (!opt.board !== !opt['board-repo']) return fail('pass --board and --board-repo together, or neither');
    const home = path.resolve(opt.home ?? (await import('node:os')).homedir());
    const known = (await loadAdapters(repo)).find((a) => a.id === toolId);
    const early = known ? loadManifest(home, known) : {};
    if (early.error) return fail(`${early.error}; remove or fix the manifest by hand`);
    const chosen = installOptions(opt, early.manifest, io);
    const extraNotes = boardNotes(chosen);
    if (!chosen.board) io.err('WARN the board address is not set: pass --board <address> --board-repo <path> so the rulebook names it');
    let built;
    try {
      [built] = await buildAll(repo, toolId, { extraNotes, profiles: chosen.profiles });
    } catch (e) {
      return fail(e.message);
    }
    const { adapter, files, errors } = built;
    if (errors.length) return fail(errors.join('\n'));
    for (const c of adapter.conflicts ?? []) {
      const other = path.join(home, ...c.path.split('/'));
      if (fs.existsSync(other) && isGenerated(read(other))) {
        io.err(`WARN ${other} is an orc-generated ${c.tool} rulebook in the same folder: ${c.warning}. Remove ${other} unless you also use ${c.tool}.`);
      }
    }
    const when = stamp(io.now ? io.now() : new Date());
    const loaded = loadManifest(home, adapter);
    if (loaded.error) return fail(`${loaded.error}; remove or fix the manifest by hand`);
    const manifest = loaded.manifest;
    const recorded = manifest?.files ?? {};
    const root = adapter.home.root;
    // Every install target and every manifest path is checked on the real file system before anything is read or
    // written: a symlink or junction below the tool root refuses the whole install.
    const unsafe = [];
    for (const f of files.filter((x) => x.install !== false)) {
      const why = escapes(home, root, path.join(home, ...f.path.split('/')));
      if (why) unsafe.push(why);
    }
    for (const rel of Object.keys(recorded)) {
      const t = safeRel(home, rel, root);
      const why = escapes(home, root, t);
      if (why) unsafe.push(why);
      else if (fs.existsSync(t) && !fs.lstatSync(t).isFile()) unsafe.push(`${t} (in the manifest) is not a regular file`);
    }
    if (unsafe.length) {
      unsafe.forEach((u) => io.err(`refused: ${u}`));
      return fail('nothing written: unsafe target path(s)');
    }
    // Plan every target first: one refused file refuses the whole install, so it is never half applied.
    const plan = files
      .filter((f) => f.install !== false)
      .map((f) => {
        const target = path.join(home, ...f.path.split('/'));
        const exists = fs.existsSync(target);
        const current = exists ? read(target) : null;
        let state = !exists ? 'create' : current === normalizeEol(f.content) ? 'unchanged' : 'replace';
        if (state === 'replace') {
          const m = recorded[f.path];
          // In the manifest the hash decides: untouched since install replaces, edited by hand is refused. With no
          // manifest entry only rulebooks and TOML agents carry a marker; any other differing file is hand-written.
          if (m && diskHash(target) !== m.sha256) state = 'REPLACE EDITED';
          else if (!m && !isGenerated(current)) state = 'REPLACE HAND-WRITTEN';
        }
        return { f, target, exists, state };
      });
    const generated = new Set(plan.map((p) => p.f.path));
    const stale = Object.entries(recorded)
      .filter(([rel]) => !generated.has(rel))
      .map(([rel, m]) => {
        const target = safeRel(home, rel, adapter.home.root);
        if (!fs.existsSync(target)) return { rel, target, state: 'gone' };
        return { rel, target, m, state: diskHash(target) === m.sha256 ? 'delete' : 'keep' };
      });
    const refusedStates = ['REPLACE HAND-WRITTEN', 'REPLACE EDITED'];
    const blocked = opt.force ? [] : plan.filter((p) => refusedStates.includes(p.state));
    const kind = blocked.some((p) => p.state === 'REPLACE EDITED') ? 'hand-written or edited' : 'hand-written';
    if (opt.apply && blocked.length) {
      for (const p of blocked) {
        const why = p.state === 'REPLACE EDITED' ? 'edited since install' : 'hand-written';
        io.err(`refused (${why}; pass --force to replace it, with a backup): ${p.target}`);
      }
      return fail(`nothing written: ${blocked.length} ${kind} file(s) in the way`);
    }
    const next = {
      tool: adapter.id,
      version: 1,
      installedAt: new Date().toISOString(),
      options: { profiles: chosen.profiles, board: chosen.board, boardRepo: chosen.boardRepo },
      files: {},
      dirs: [...(manifest?.dirs ?? [])],
    };
    for (const { f, target, exists, state } of plan) {
      if (opt.apply && state !== 'unchanged') {
        for (let d = path.dirname(target), rel = path.posix.dirname(f.path); !fs.existsSync(d); d = path.dirname(d), rel = path.posix.dirname(rel)) {
          if (safeRel(home, rel, adapter.home.root) && !next.dirs.includes(rel)) next.dirs.push(rel);
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (exists) {
          let backup = `${target}.orc-backup-${when}`;
          for (let n = 2; fs.existsSync(backup); n++) backup = `${target}.orc-backup-${when}-${n}`;
          fs.copyFileSync(target, backup);
        }
        const bytes = Buffer.from(f.content, 'utf8');
        fs.writeFileSync(target, bytes);
        next.files[f.path] = { sha256: sha256(bytes) };
      } else if (opt.apply) next.files[f.path] = { sha256: diskHash(target) };
      const sep = refusedStates.includes(state) ? '' : ':';
      io.out(`${opt.apply ? 'applied' : 'would'} ${state}${sep} ${target}`);
    }
    for (const s of stale) {
      if (s.state === 'gone') continue;
      if (s.state === 'delete') {
        if (opt.apply) fs.rmSync(s.target);
        io.out(`${opt.apply ? 'deleted' : 'would delete'} (role removed): ${s.target}`);
      } else {
        if (opt.apply) next.files[s.rel] = { sha256: s.m.sha256 };
        io.out(`${opt.apply ? 'kept' : 'would keep'} (role removed, edited since install): ${s.target}`);
      }
    }
    if (opt.apply) writeManifest(loaded.file, next);
    if (adapter.installNote) io.out(adapter.installNote);
    if (!opt.apply) {
      io.out(`dry run for ${adapter.id}; add --apply to write`);
      if (blocked.length) io.out(`--apply would refuse: ${blocked.length} ${kind} file(s) in the way (use --force to replace them, with backups)`);
    }
    return 0;
  }

  if (cmd === 'uninstall') {
    const toolId = opt.tool;
    if (!toolId || toolId === 'all') return fail('uninstall needs --tool <id>');
    if (toolId === 'claude-code' && !opt.home) return fail('refusing --tool claude-code without --home: the live ~/.claude is synced by hand');
    const home = path.resolve(opt.home ?? (await import('node:os')).homedir());
    const adapter = (await loadAdapters(repo)).find((a) => a.id === toolId);
    if (!adapter) return fail(`unknown tool ${toolId}`);
    const { manifest, file, error } = loadManifest(home, adapter);
    if (error) return fail(error);
    if (!manifest) return fail(`no install manifest at ${file}: remove ${adapter.id}'s files by hand`);
    const when = stamp(io.now ? io.now() : new Date());
    // Validate every entry and build the whole plan before deleting anything.
    const root = adapter.home.root;
    const steps = [];
    const bad = [];
    for (const [rel, m] of Object.entries(manifest.files)) {
      const target = safeRel(home, rel, root);
      const why = escapes(home, root, target);
      if (why) {
        bad.push(why);
        continue;
      }
      if (!fs.existsSync(target)) continue;
      if (!fs.lstatSync(target).isFile()) {
        bad.push(`${target} (in the manifest) is not a regular file`);
        continue;
      }
      try {
        steps.push({ rel, sha: m.sha256, target, edited: diskHash(target) !== m.sha256 });
      } catch (e) {
        bad.push(`${target}: cannot read (${e.message})`);
      }
    }
    for (const rel of manifest.dirs) {
      const why = escapes(home, root, safeRel(home, rel, root));
      if (why) bad.push(why);
    }
    if (bad.length) {
      bad.forEach((b) => io.err(`refused: ${b}`));
      return fail('nothing deleted: the manifest names unsafe or invalid paths');
    }
    const kept = {};
    for (const { rel, sha, target, edited } of steps) {
      if (edited && !opt.force) {
        kept[rel] = { sha256: sha };
        io.out(`${opt.apply ? 'kept' : 'would keep'} (edited since install; --force deletes it after a backup): ${target}`);
        continue;
      }
      if (opt.apply) {
        if (edited) fs.copyFileSync(target, `${target}.orc-backup-${when}`);
        fs.rmSync(target);
      }
      io.out(`${opt.apply ? 'deleted' : 'would delete'}${edited ? ' (edited, backed up)' : ''}: ${target}`);
    }
    if (opt.apply) {
      const keep = Object.keys(kept).length > 0;
      if (!keep) fs.rmSync(file);
      // Only directories install created, deepest first, and only when empty.
      for (const rel of [...manifest.dirs].sort((x, y) => y.length - x.length)) {
        const d = safeRel(home, rel, adapter.home.root);
        if (fs.existsSync(d) && !fs.readdirSync(d).length) {
          fs.rmdirSync(d);
          io.out(`removed empty directory: ${d}`);
        }
      }
      if (keep) {
        // The kept files stay listed, so `uninstall --apply --force` can still remove them.
        const dirs = manifest.dirs.filter((rel) => fs.existsSync(safeRel(home, rel, adapter.home.root)));
        writeManifest(file, { ...manifest, files: kept, dirs });
        io.out(`kept manifest listing ${Object.keys(kept).length} kept file(s): ${file}`);
      } else io.out(`removed manifest: ${file}`);
    } else io.out(`dry run for ${adapter.id}; add --apply to delete`);
    return 0;
  }

  if (cmd === 'status') {
    const toolId = opt.tool;
    if (!toolId || toolId === 'all') return fail('status needs --tool <id>');
    if (!opt.board !== !opt['board-repo']) return fail('pass --board and --board-repo together, or neither');
    const home = path.resolve(opt.home ?? (await import('node:os')).homedir());
    const known = (await loadAdapters(repo)).find((a) => a.id === toolId);
    const loaded = known ? loadManifest(home, known) : {};
    if (loaded.error) io.err(`WARN ${loaded.error}; ignoring it`);
    const chosen = installOptions(opt, loaded.manifest, io);
    let built;
    try {
      [built] = await buildAll(repo, toolId, { extraNotes: boardNotes(chosen), profiles: chosen.profiles });
    } catch (e) {
      return fail(e.message);
    }
    const { adapter, files, errors } = built;
    if (errors.length) return fail(errors.join('\n'));
    const installed = files.filter((f) => f.install !== false);
    const recorded = loaded.manifest?.files ?? null;
    const ours = new Set();
    let clean = true;
    for (const f of installed) {
      const target = path.join(home, ...f.path.split('/'));
      ours.add(target);
      let state = 'same';
      if (!fs.existsSync(target)) state = 'missing';
      else {
        const line = firstDiffLine(read(target), normalizeEol(f.content));
        if (line && recorded?.[f.path] && diskHash(target) !== recorded[f.path].sha256) state = `edited since install, differs (first difference at line ${line})`;
        else if (line) state = `differs (first difference at line ${line})`;
      }
      if (state !== 'same') clean = false;
      io.out(`${state}: ${target}`);
    }
    for (const rel of Object.keys(recorded ?? {})) {
      const target = safeRel(home, rel, adapter.home.root);
      if (ours.has(target) || !fs.existsSync(target)) continue;
      ours.add(target);
      clean = false;
      io.out(`stale (role removed): ${target}`);
    }
    // Files in the agents folder that no role generates; install backups (*.orc-backup-*) are not counted.
    const agentsDir = path.join(home, ...adapter.home.agentsDir.split('/'));
    if (fs.existsSync(agentsDir)) {
      for (const e of fs.readdirSync(agentsDir, { withFileTypes: true })) {
        const p = path.join(agentsDir, e.name);
        if (!e.isFile() || ours.has(p) || e.name.includes('.orc-backup-')) continue;
        clean = false;
        io.out(`extra: ${p}${recorded ? ' (not installed by orc)' : ''}`);
      }
    }
    io.out(clean ? `status ${adapter.id}: all same` : `status ${adapter.id}: out of date (install --apply updates it)`);
    return clean ? 0 : 1;
  }

  if (cmd === 'models') {
    if (opt.tool !== 'antigravity' || !opt['from-stdin']) return fail('usage: models --tool antigravity --from-stdin');
    const { fragment, error } = parseAgyModels(decodeText(io.stdin()));
    if (error) return fail(`${error}; paste the output of "agy models"`);
    io.out(JSON.stringify(fragment, null, 2));
    return 0;
  }

  // Writes `text` to --out, or prints it.
  const emit = (text) => {
    if (opt.out) {
      if (fs.existsSync(path.resolve(opt.out)) && !opt.force) throw new Error(`refusing to overwrite ${path.resolve(opt.out)}; pass --force to replace it`);
      fs.writeFileSync(path.resolve(opt.out), text);
      io.out(`wrote ${path.resolve(opt.out)}`);
    } else io.out(text.replace(/\n$/, ''));
  };
  const marchingOrders = () => parseMarchingOrders(read(path.join(repo, 'AGENTS.md')));
  const knownRole = (name) => {
    const roles = loadRoles(repo);
    const role = roles.find((r) => r.name === name);
    if (!role) throw new Error(`unknown role ${name}; known: ${roles.map((r) => r.name).join(', ')}`);
    return role;
  };

  if (cmd === 'brief') {
    const sub = opt._[1];
    try {
      if (opt.role) knownRole(opt.role);
      if (sub === 'new' && opt._.length === 2) {
        emit(briefTemplate(marchingOrders(), opt.role));
        return 0;
      }
      if (sub === 'lint' && opt._.length === 3) {
        const problems = lintBrief(read(path.resolve(opt._[2])), marchingOrders(), opt.role);
        problems.forEach((p) => io.err(p));
        if (!problems.length) io.out(`brief ok: ${opt._[2]}`);
        return problems.length ? 1 : 0;
      }
    } catch (e) {
      return fail(e.message);
    }
    return fail('usage: brief new [--role <name>] [--out <file>] | brief lint <file> [--role <name>]');
  }

  if (cmd === 'review-tier') {
    const base = opt.base ?? 'origin/main';
    try {
      const { tier, reason, warning } = reviewTier(path.resolve(opt['repo-dir'] ?? process.cwd()), base);
      if (warning) io.err(`WARN ${warning}`);
      io.out(`${tier}: ${reason}`);
      if (tier === 'Light-eligible') {
        io.out("Light also needs a refuter ACCEPT after mutation checks, with the repo's test conventions as its checklist (rulebook conditions 2 and 3; not computable here).");
      }
      return 0;
    } catch (e) {
      return fail(e.message);
    }
  }

  if (cmd === 'costlog') {
    if (!opt.session) return fail('costlog needs --session <id>');
    const viaCli = Boolean(opt.board || opt['board-repo']);
    if (Boolean(opt['board-export']) === viaCli) return fail('pass --board-export <file>, or --board <http://localhost:port> --board-repo <dir>');
    if (viaCli && (!opt.board || !opt['board-repo'])) return fail('pass --board and --board-repo together');
    try {
      const data = readBoardExport({
        file: opt['board-export'] && path.resolve(opt['board-export']),
        board: opt.board,
        boardRepo: opt['board-repo'] && path.resolve(opt['board-repo']),
      });
      emit(costlog(data, opt.session));
      return 0;
    } catch (e) {
      return fail(e.message);
    }
  }

  if (cmd === 'dispatch') {
    if (!opt.tool || !opt.role || !opt.brief) return fail('usage: dispatch --tool <id> --role <name> --brief <file> [--dry-run] [--timeout <seconds>] [--no-lint]');
    let timeoutSec = 0;
    if (opt.timeout !== undefined) {
      timeoutSec = /^\d+$/.test(opt.timeout) ? Number(opt.timeout) : NaN;
      if (!(timeoutSec >= 1 && timeoutSec <= 86400)) return fail(`--timeout needs a whole number of seconds from 1 to 86400, got ${opt.timeout}`);
    }
    let plan;
    try {
      const role = knownRole(opt.role);
      const adapter = (await loadAdapters(repo)).find((a) => a.id === opt.tool);
      if (!adapter) return fail(`unknown tool ${opt.tool}`);
      if (typeof adapter.headless !== 'function') return fail(`no headless recipe for ${adapter.id}`);
      const briefPath = path.resolve(opt.brief);
      if (!fs.existsSync(briefPath)) return fail(`no brief at ${briefPath}`);
      const briefText = read(briefPath);
      if (!opt['no-lint']) {
        const problems = lintBrief(briefText, marchingOrders(), role.name);
        if (problems.length) {
          problems.forEach((p) => io.err(p));
          return fail(`dispatch refused: the brief fails lint (${problems.length} problem(s)); fix it or pass --no-lint`);
        }
      }
      plan = dispatchPlan(adapter, role, loadModels(repo), briefText);
    } catch (e) {
      return fail(e.message);
    }
    if (plan.error) return fail(plan.error);
    const tooBig = argvProblem(plan);
    if (tooBig) return fail(`dispatch refused: ${tooBig}; nothing started`);
    io.out(formatCommand(plan));
    if (opt['dry-run']) return 0;
    if (plan.exe.missing) return fail(`cannot run ${plan.command}: not found${plan.exe.shim ? ' (only a .cmd/.bat shim)' : ''}; set ${binEnv(plan.toolId)} to its full path`);
    return runDispatch(plan, { timeoutSec, err: io.err });
  }

  if (cmd === 'hooks') {
    if (!opt.home) return fail('hooks needs --home <dir> (no default)');
    const home = path.resolve(opt.home);
    const source = path.join(repo, opt.node ? 'hooks.node.example.json' : 'settings.example.json');
    const target = path.join(home, '.claude', 'settings.json');
    const unsafe = escapes(home, '.claude', target);
    if (unsafe) return fail(`hooks: ${unsafe}; nothing written`);
    let original = null;
    let bom = '';
    let settings = {};
    try {
      if (fs.existsSync(target)) {
        const raw = fs.readFileSync(target, 'utf8');
        bom = raw.charCodeAt(0) === 0xfeff ? raw[0] : '';
        original = raw.slice(bom.length);
        settings = JSON.parse(original);
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return fail(`hooks: ${target} is not a JSON object at the top level; nothing written`);
      }
      const { merged, added } = mergeHooks(settings, JSON.parse(read(source)), home);
      if (!added.length) {
        io.out(`nothing to add: every hook in ${path.basename(source)} is already in ${target}`);
        return 0;
      }
      for (const a of added) {
        io.out(`${opt.apply ? 'added' : 'would add'} ${a.event}${a.matcher ? ` [${a.matcher}]` : ''}: ${a.command}`);
        if (a.otherMatchers?.length) io.out(`  note: the same command already runs under matcher ${a.otherMatchers.map((m) => JSON.stringify(m)).join(', ')}; that entry is left as it is`);
      }
      if (original !== null && formatLike(original, settings) !== original) {
        io.err(`WARN ${target} is not in plain indented JSON layout; writing it re-indents the existing content (values and order unchanged)`);
      }
      if (!opt.apply) {
        io.out(`dry run: ${original === null ? 'would create' : 'would update'} ${target}; add --apply to write`);
        return 0;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // Write the new content beside the target first: when that fails, no backup is left behind.
      const tmp = `${target}.orc-tmp-${process.pid}`;
      fs.writeFileSync(tmp, bom + formatLike(original, merged));
      let backup = null;
      if (original !== null) {
        backup = `${target}.orc-backup-${stamp(io.now ? io.now() : new Date())}`;
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
        // The target could not be replaced (read-only, locked): leave no temp file and no stray backup.
        fs.rmSync(tmp, { force: true });
        if (backup) fs.rmSync(backup, { force: true });
        throw e;
      }
      if (backup) io.out(`backed up: ${backup}`);
      io.out(`${original === null ? 'created' : 'updated'} ${target}`);
      return 0;
    } catch (e) {
      return fail(`hooks: ${e.message}`);
    }
  }

  return fail('usage: node tools/orc.mjs build|check|sync|install|uninstall|status|models|brief|review-tier|costlog|dispatch|hooks [options]');
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e.message);
      process.exit(1);
    },
  );
}
