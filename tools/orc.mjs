#!/usr/bin/env node
// Orchestration generator and installer. Node 22+, standard library only.
// Commands: the HELP table in tools/lib/help.mjs (node tools/orc.mjs help); reference: docs/cli.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parse, normalizeEol, isGenerated } from './lib/frontmatter.mjs';
import { parseRole } from './lib/roles.mjs';
import { sha256, diskHash, loadManifest, writeManifest, safeRel, escapes } from './lib/manifest.mjs';
import { knownTools, validateModels } from './lib/models.mjs';
import { briefTemplate, lintBrief, parseMarchingOrders } from './lib/brief.mjs';
import { reviewTier } from './lib/reviewtier.mjs';
import { costlog, readBoardExport } from './lib/costlog.mjs';
import { calibrationReport, DEFAULT_MIN_PRECISION } from './lib/calibration.mjs';
import { listCases, scoreReport } from './lib/corpus.mjs';
import { listBenchCases, runBench, loadBenchResults, benchReport, BENCH_USAGE } from './lib/bench.mjs';
import { runQueue, QUEUE_USAGE } from './lib/queue.mjs';
import { capture, loadRuns, metricsReport, repoTop, DEFAULT_PRICES } from './lib/metrics.mjs';
import { dispatchPlan, runDispatch, formatCommand, argvProblem, binEnv, unavailable } from './lib/dispatch.mjs';
import { mergeHooks, formatLike, readSettings, writeSettings } from './lib/hooks.mjs';
import { KIT_HOOK_SCRIPTS, KIT_SKILLS, KIT_NOTES, KNOWN_STACKS, presetRules, detectStacks, kitHookExample, planKitSettings, removeKitSettings, kitRecordProblem, guardStatus } from './lib/sprintkit.mjs';
import { decodeText, readText } from './lib/text.mjs';
import { USAGE, globalHelp, commandHelp } from './lib/help.mjs';
import { validateArchive, runStandards, backupPath } from './lib/standards.mjs';
import { orcHome, configFile, loadConfig, routeChain, jsonProblem, boardDefault } from './lib/config.mjs';
import { runDoctor } from './lib/doctor.mjs';

const DEFAULT_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The checkout running orc.mjs, with forward slashes. The last line of every install points at the standards setup.
// The real (on-disk) case, so every shell that starts node writes and compares the same line.
const SETUP = fs.realpathSync.native(DEFAULT_REPO).replace(/\\/g, '/');
const STANDARDS_NEXT = `set up each project's coding standards: see ${SETUP}/orchestration/standards.md (Claude Code: the repo-standards skill, where ~/.claude/skills has it).`;

// The Setup checkout line install adds (status adds it too): the checkout running orc.mjs, never recorded in the manifest.
const setupNotes = () => [`- Setup checkout (this machine): ${SETUP}. Standards setup: node "${SETUP}/tools/orc.mjs" standards ...; procedure: ${SETUP}/orchestration/standards.md.`];

// Real path normalised for setupCheckout comparison: forward slashes, case-insensitive on Windows.
function normCheckout(p) {
  let resolved;
  try {
    resolved = fs.realpathSync.native(p);
  } catch {
    resolved = path.resolve(p);
  }
  const fwd = resolved.replace(/\\/g, '/');
  return process.platform === 'win32' ? fwd.toLowerCase() : fwd;
}

// Reads setupCheckout from config.json without failing on unrelated config errors (used by uninstall and hooks).
function readSetupCheckout(env = process.env) {
  const file = configFile(env);
  if (!fs.existsSync(file)) return { file, setupCheckout: null };
  try {
    const cfg = JSON.parse(read(file));
    const sc = cfg && typeof cfg === 'object' && !Array.isArray(cfg) && typeof cfg.setupCheckout === 'string' && cfg.setupCheckout.trim() ? cfg.setupCheckout : null;
    return { file, setupCheckout: sc };
  } catch {
    return { file, setupCheckout: null };
  }
}

// Non-null reason when config.json names a setupCheckout other than the checkout running orc.mjs.
function setupCheckoutMismatch({ file, setupCheckout }) {
  if (!setupCheckout || normCheckout(SETUP) === normCheckout(setupCheckout)) return null;
  return `this checkout (${SETUP}) is not the setupCheckout in ${file} (${setupCheckout}); the installed rulebook and hooks will point here. Run it from that checkout, or set setupCheckout to this one`;
}

// Text from a file or stdin goes through the one shared reader (tools/lib/text.mjs).
export { decodeText };
const read = readText;

export function loadRoles(repo) {
  const dir = path.join(repo, 'core', 'roles');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseRole(read(path.join(dir, f)), `core/roles/${f}`));
}

// models.json, then (with `shared`) <orc home>/models.json, then models.local.json; the two over-layers only with
// `local`. Only install (and sync, which is install --all), status, dispatch and doctor pass `shared`: build, check
// and golden never read ~/.orc.
// <orc home> is shared by every checkout, so a tool id there that this checkout does not know is skipped, with one
// line through `warn`; models.json and models.local.json stay strict. `extra` is one more override file in the
// models.local.json shape (bench --models), layered last whatever `local` says.
export function loadModels(repo, { local = true, shared = false, env = process.env, warn = () => {}, extra = null } = {}) {
  const tools = knownTools(repo);
  const models = JSON.parse(read(path.join(repo, 'models.json')));
  validateModels(models, tools, 'models.json');
  const layer = (over) => {
    for (const [tool, tiers] of Object.entries(over)) {
      models[tool] ??= {};
      for (const [tier, value] of Object.entries(tiers)) {
        const base = models[tool][tier];
        models[tool][tier] =
          base && typeof base === 'object' && typeof value === 'object' ? { ...base, ...value } : value;
      }
    }
  };
  const sharedFile = path.join(orcHome(env), 'models.json');
  if (local && shared && fs.existsSync(sharedFile)) {
    let over;
    try {
      over = JSON.parse(read(sharedFile));
    } catch (e) {
      throw new Error(`${sharedFile}: ${jsonProblem(e)}`);
    }
    if (over && typeof over === 'object' && !Array.isArray(over)) {
      over = { ...over };
      for (const tool of Object.keys(over).filter((t) => !tools.includes(t))) {
        warn(`${sharedFile}: unknown tool id "${tool}" (ignored; this checkout does not know it)`);
        delete over[tool];
      }
    }
    validateModels(over, tools, sharedFile);
    layer(over);
  }
  const localFile = path.join(repo, 'models.local.json');
  if (local && fs.existsSync(localFile)) {
    const over = JSON.parse(read(localFile));
    validateModels(over, tools, 'models.local.json');
    layer(over);
  }
  if (extra) {
    const over = JSON.parse(read(extra));
    validateModels(over, tools, extra);
    layer(over);
  }
  return models;
}

export async function loadAdapters(repo) {
  const dir = path.join(repo, 'adapters');
  const files = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.mjs')).map((e) => e.name).sort();
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

// An artifact board is written only with ArtifactData from Claude Code, so it needs no --board-repo.
const isArtifactBoard = (board) => /^(?:https:\/\/)?claude\.ai\/(?:code\/)?artifact\//.test(board ?? '');
const boardPairError = (opt, toolId) => (opt['board-repo'] ? !opt.board : Boolean(opt.board) && !(toolId === 'claude-code' && isArtifactBoard(opt.board)));
const ARTIFACT_ONLY_CLAUDE = 'the artifact board can be written only from Claude Code; use a local board address';
const artifactRefused = (board, toolId) => toolId !== 'claude-code' && isArtifactBoard(board);

// The Board line that install adds, so status compares against the same text.
function boardNotes({ board, boardRepo }, toolId) {
  if (!board) return [];
  if (toolId === 'claude-code' && isArtifactBoard(board)) return [`- **Board:** this machine's board address is \`${board}\` (artifact backend: write it with ArtifactData, as the tool notes say).`];
  const cli = `${boardRepo.replace(/\\/g, '/')}/local/board.js`;
  const port = /^https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/.exec(board)?.[1];
  const portNote = port ? ` (set \`ORC_BOARD_PORT=${port}\`)` : '';
  return [`- **Board:** this machine's board address is \`${board}\`; write it with \`node "${cli}"\`${portNote}.`];
}

// Install options (profiles, board) come from the flags; with none of them given, from the manifest's `options`.
// Each option given replaces the recorded one; --no-profile and --no-board clear them. A --no-board clear is recorded
// (`noBoard`), so the config.json board does not come back; a later --board drops the mark.
// `configBoard` ({board, boardRepo, file}) is the last default: flag, then manifest, then recorded --no-board, then
// config.json. An artifact address in config.json applies to claude-code only: other tools get no Board line and one
// notice saying so.
function installOptions(opt, manifest, io, configBoard = null, toolId = null) {
  const rec = manifest?.options ?? {};
  const reused = [];
  let profiles = opt.profile ?? [];
  if (opt['no-profile']) profiles = [];
  else if (!opt.profile && Array.isArray(rec.profiles) && rec.profiles.length) {
    profiles = rec.profiles;
    reused.push(`profile ${profiles.join(',')}`);
  }
  // A sprint kit stays a kit on every later install and status; only uninstall removes it.
  let sprintKit = Boolean(opt['sprint-kit']);
  if (!sprintKit && rec.sprintKit === true) {
    sprintKit = true;
    reused.push('sprint kit');
  }
  let stacks = opt.stack ?? null;
  if (sprintKit && !stacks && Array.isArray(rec.stacks) && rec.stacks.length && rec.stacks.every((s) => KNOWN_STACKS.includes(s))) {
    stacks = rec.stacks;
    reused.push(`stack ${stacks.join(',')}`);
  }
  let board = opt.board ?? null;
  let boardRepo = opt['board-repo'] ?? null;
  let noBoard = false;
  let artifactSkipped = false;
  if (opt['no-board'] || sprintKit) {
    board = boardRepo = null;
    noBoard = !sprintKit && Boolean(opt['no-board']);
  } else if (!opt.board && typeof rec.board === 'string' && (typeof rec.boardRepo === 'string' || isArtifactBoard(rec.board))) {
    board = rec.board;
    boardRepo = rec.boardRepo;
    reused.push(`board ${board}`);
  } else if (!opt.board && !opt['board-repo'] && rec.noBoard === true) {
    noBoard = true;
    reused.push('no board (cleared with --no-board; --board sets one)');
  } else if (!opt.board && !opt['board-repo'] && configBoard?.board) {
    if (toolId && artifactRefused(configBoard.board, toolId)) {
      artifactSkipped = true;
      io.out(`note: skipping the artifact board in ${configBoard.file} for ${toolId} (the artifact board can be written only from Claude Code; no Board line added)`);
    } else {
      board = configBoard.board;
      boardRepo = configBoard.boardRepo ?? null;
      io.out(`using the board from ${configBoard.file}: ${board}`);
    }
  }
  const clear = rec.sprintKit === true ? (reused.some((r) => r.startsWith('profile')) ? 'pass --no-profile to clear; uninstall removes the sprint kit' : 'uninstall removes the sprint kit') : 'pass --no-profile or --no-board to clear';
  if (reused.length) io.out(`using the options recorded at install: ${reused.join('; ')} (${clear})`);
  return { profiles, board, boardRepo, noBoard, sprintKit, stacks, artifactSkipped };
}

// Reads ~/.orc/config.json for the board default when a single-tool install or status did not come through --all.
// Returns {configBoard} or {error}. An invalid config or a local board with no repo fails only when this tool would
// actually use the config board; otherwise an invalid config prints one WARN and the run proceeds without it.
function resolveConfigBoard(repo, opt, manifest, io, env = process.env) {
  let cfg;
  try {
    cfg = loadConfig({ tools: knownTools(repo), roles: loadRoles(repo).map((r) => r.name), env });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (usesConfigBoard(opt, manifest)) return { error: msg };
    io.err(`WARN ${msg}`);
    return { configBoard: null, config: null, file: configFile(env) };
  }
  (cfg.warnings ?? []).forEach((w) => io.err(`WARN ${w}`));
  const boardRule = boardDefault(cfg.config, cfg.file, isArtifactBoard);
  if (boardRule?.error && usesConfigBoard(opt, manifest)) return { error: boardRule.error };
  return { configBoard: boardRule?.error ? null : boardRule, config: cfg.config, file: cfg.file };
}

// True when installOptions will fall through to config.json's board default (no flag, no sprint kit, no recorded
// board or noBoard mark).
function usesConfigBoard(opt, manifest) {
  const rec = manifest?.options ?? {};
  const sprintKit = Boolean(opt['sprint-kit']) || rec.sprintKit === true;
  if (opt['no-board'] || sprintKit || opt.board || opt['board-repo']) return false;
  if (typeof rec.board === 'string' && (typeof rec.boardRepo === 'string' || isArtifactBoard(rec.board))) return false;
  if (rec.noBoard === true) return false;
  return true;
}

// Checks that every planned target can be written on the file system: each existing ancestor is a directory, and the
// target itself is not a directory. Symlinks are left to `escapes`, which reports them separately.
function targetPathProblems(home, files) {
  const out = [];
  const seen = new Set();
  const add = (msg) => {
    if (!seen.has(msg)) {
      seen.add(msg);
      out.push(msg);
    }
  };
  try {
    if (!fs.statSync(home).isDirectory()) add(`${home} is not a directory`);
  } catch (e) {
    if (e?.code !== 'ENOENT') add(`${home}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (out.length) return out;
  for (const f of files) {
    const parts = f.path.split('/');
    let cur = home;
    let blocked = false;
    for (let i = 0; i < parts.length - 1; i++) {
      cur = path.join(cur, parts[i]);
      let st;
      try {
        st = fs.lstatSync(cur);
      } catch (e) {
        if (e?.code === 'ENOENT') break;
        add(`${cur}: ${e instanceof Error ? e.message : String(e)}`);
        blocked = true;
        break;
      }
      if (st.isSymbolicLink()) {
        blocked = true;
        break;
      }
      if (!st.isDirectory()) {
        add(`${cur} is not a directory`);
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    const target = path.join(home, ...parts);
    let st;
    try {
      st = fs.lstatSync(target);
    } catch (e) {
      if (e?.code === 'ENOENT') continue;
      add(`${target}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (!st.isSymbolicLink() && st.isDirectory()) add(`${target} is a directory`);
  }
  return out;
}

// The rulebook lines install and status add after the tool notes: the Board line (or the kit's no-board line), then
// the Setup checkout line.
const installNotes = (chosen, toolId) => [...(chosen.sprintKit ? KIT_NOTES : boardNotes(chosen, toolId)), ...setupNotes()];

// The files a kit adds beside the build: the sprint skill under <root>/skills/.
function kitFiles(repo, adapter) {
  return KIT_SKILLS.map((rel) => ({ path: `${adapter.home.root}/${rel}`, content: read(path.join(repo, ...rel.split('/'))) }));
}

const SETTINGS_REL = '.claude/settings.json';
// Two absolute paths name the same file (case-insensitive on Windows and macOS).
const samePath = (a, b) => {
  const fold = ['win32', 'darwin'].includes(process.platform) ? (p) => path.resolve(p).toLowerCase() : (p) => path.resolve(p);
  return fold(a) === fold(b);
};
const KIT_NEXT = `start a fresh Claude Code session and check that /sprint and the roster agents are listed; then ask for a sprint (${SETUP}/docs/interview-machine.md).`;
const KIT_RESTORABLE = 'replace (hand-written; backed up, uninstall restores it)';

// How uninstall undoes a kit's settings.json changes, decided before anything is touched. Throws when settings.json
// cannot be read (uninstall then refuses). Returns {action, rec, backup, warn?, reason?, original, bom, cleaned}:
// 'delete' (the kit created the file and it is empty again), 'restore' (nothing else changed: the backup goes back),
// 'restore-missing' (settings.json is gone: the owner's original goes back), 'write' (only the kit's entries are
// removed; `reason` says why the backup cannot simply go back) or 'none'.
function planSettingsUndo(rec, target, backup) {
  let before = null;
  let backupWhy = null;
  if (backup && !fs.existsSync(backup)) backupWhy = `the kit's backup ${backup} is gone`;
  else if (backup) {
    try {
      before = readSettings(backup).settings;
    } catch (e) {
      backupWhy = `the kit's backup ${backup} cannot be read (${e instanceof Error ? e.message : String(e)})`;
    }
  }
  const base = { rec, backup };
  if (!fs.existsSync(target)) {
    if (before) return { ...base, action: 'restore-missing' };
    return { ...base, action: 'none', warn: `${target} is gone, so there are no kit entries to remove${backupWhy ? `; ${backupWhy}` : ''}` };
  }
  const { original, bom, settings } = readSettings(target);
  const cleaned = removeKitSettings(settings, rec);
  const plan = { ...base, original, bom, cleaned };
  if (rec.fileCreated && !Object.keys(cleaned).length) return { ...plan, action: 'delete' };
  if (before && isDeepStrictEqual(cleaned, before)) return { ...plan, action: 'restore' };
  const reason = backupWhy ?? (backup ? 'settings.json changed since install' : 'settings.json holds more than the kit created');
  return { ...plan, action: 'write', reason, warn: backupWhy ? `${backupWhy}; only the kit's entries are removed from ${target}` : undefined };
}

// Every path the kit touches or a manifest's kit record names (settings.json, its backup, each restore target and
// backup, each recorded copy) must be a plain path under the tool root that stays inside it on the real file system.
function kitPathProblems(home, root, kitRec) {
  const rels = [SETTINGS_REL, ...Object.entries(kitRec?.restore ?? {}).flat(), ...(kitRec?.settings?.backup ? [kitRec.settings.backup] : []), ...(kitRec?.copies ?? [])];
  const out = [];
  for (const rel of rels) {
    const t = safeRel(home, rel, root);
    if (!t || rel.split('/').pop().startsWith('.orc-manifest.')) {
      out.push(`${rel} (in the manifest) is not a plain path under ${root}`);
      continue;
    }
    const why = escapes(home, root, t);
    if (why) out.push(why);
    else if (fs.existsSync(t) && !fs.lstatSync(t).isFile()) out.push(`${t} is not a regular file`);
  }
  return out;
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
    if (adapter.limits?.nonEmptyTools && tools.length === 0) errors.push(`${adapter.id}: ${f.path} has an empty tools list; give the role a capability that maps to a tool`);
    const role = roles.find((r) => r.name === f.role);
    if (role.access === 'read-only') {
      for (const t of tools) if (editTools.has(t)) errors.push(`${adapter.id}: read-only ${role.name} gets ${t}`);
    }
  }
  return { files, errors, warnings, rulebook };
}

// `env` and `warn` reach loadModels (the shared state home and its warnings).
async function buildAll(repo, toolId, { local = true, shared = false, extraNotes = [], profiles = [], env = process.env, warn = undefined } = {}) {
  const roles = loadRoles(repo);
  const loaded = loadProfiles(repo, profiles);
  const models = loadModels(repo, { local, shared, env, warn });
  const agentsMd = read(path.join(repo, 'core', 'AGENTS.md'));
  const adapters = await loadAdapters(repo);
  const picked = !toolId || toolId === 'all' ? adapters : adapters.filter((a) => a.id === toolId);
  if (!picked.length) throw new Error(`unknown tool ${toolId}; known: ${adapters.map((a) => a.id).join(', ')}`);
  return picked.map((adapter) => ({ adapter, ...buildTool(adapter, roles, models, agentsMd, { extraNotes, profiles: loaded }) }));
}

// The scripts the tool's example hooks run (adapter.hookScripts), as files under its root: install copies them beside
// the generated files and status compares them, but build, golden and check never emit them.
function hookScriptFiles(repo, adapter, { sprintKit = false } = {}) {
  return (adapter.hookScripts ?? [])
    .filter((rel) => !sprintKit || KIT_HOOK_SCRIPTS.includes(rel))
    .map((rel) => ({ path: `${adapter.home.root}/${rel}`, content: read(path.join(repo, ...rel.split('/'))), handCopyLabel: 'hook script' }));
}

// Static per-tool files (adapter.staticFiles: workflow commands, orc-permissions skill) copied beside the generated
// files on a full install, with the same safeguards as hook scripts; never part of build, golden, check or sprint-kit.
function adapterStaticFiles(repo, adapter, { sprintKit = false } = {}) {
  if (sprintKit) return [];
  return (adapter.staticFiles ?? []).map(({ from, to, kind }) => ({
    path: `${adapter.home.root}/${to}`,
    content: read(path.join(repo, ...from.split('/'))),
    handCopyLabel: kind,
  }));
}

// Every file install writes and status compares for an adapter, excluding build-only files (`install: false`).
function installFileList(repo, adapter, builtFiles, { sprintKit = false } = {}) {
  return [
    ...builtFiles,
    ...hookScriptFiles(repo, adapter, { sprintKit }),
    ...adapterStaticFiles(repo, adapter, { sprintKit }),
    ...(sprintKit ? kitFiles(repo, adapter) : []),
  ].filter((f) => f.install !== false);
}

// The build the golden test compares against and the golden command writes: models.json only, no profiles, no extra notes.
export function buildGolden(repo, toolId = 'all') {
  return buildAll(repo, toolId, { local: false });
}

// Every file below dir, absolute paths.
function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

// What to edit for a built file: an agent file comes from its role, a command from the adapter, and the other
// rulebook files from the core rulebook, the tool notes and the adapter.
function sourceOf(adapter, file) {
  if (file.role) return { src: `core/roles/${file.role}.md`, those: false };
  if (/(^|\/)commands\/[^/]+\.md$/.test(file.path)) return { src: `adapters/${adapter.id}.mjs`, those: false };
  return { src: `core/AGENTS.md / adapters/${adapter.id}.notes.md / adapters/${adapter.id}.mjs`, those: true };
}

// A case-insensitive file system (win32, darwin) folds names; `golden` and `check` compare names the same way.
const fileKey = (p) => (['win32', 'darwin'].includes(process.platform) ? p.toLowerCase() : p);

// The build compared with tests/golden/<tool>/ as `golden` writes it (the same reader, the same folded names): one
// problem per missing, differing or stale golden file of every adapter that built without errors, plus any
// tests/golden/<id>/ folder that no adapter owns.
function goldenProblems(repo, results) {
  const problems = [];
  const goldenRoot = path.join(repo, 'tests', 'golden');
  const knownIds = new Set(results.map((r) => fileKey(r.adapter.id)));
  if (fs.existsSync(goldenRoot)) {
    for (const e of fs.readdirSync(goldenRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory() && !knownIds.has(fileKey(e.name))) {
        problems.push(`tests/golden/${e.name}/: stale (no adapter owns it; remove it by hand)`);
      }
    }
  }
  for (const { adapter, files, errors } of results) {
    if (errors.length) continue;
    const dir = path.join(repo, 'tests', 'golden', adapter.id);
    const onDisk = new Map(walkFiles(dir).map((p) => [fileKey(p), p]));
    const wanted = new Set();
    for (const f of files) {
      const target = path.join(dir, ...f.path.split('/'));
      wanted.add(fileKey(target));
      const rel = `tests/golden/${adapter.id}/${f.path}`;
      const { src, those } = sourceOf(adapter, f);
      const disk = onDisk.get(fileKey(target));
      if (!disk) problems.push(`${rel}: missing (generated from ${src}; run node tools/orc.mjs golden)`);
      else if (read(disk) !== f.content) {
        problems.push(`${rel}: differs from the build at line ${firstDiffLine(read(disk), f.content)} (generated from ${src}; edit ${those ? 'those' : 'that'}, then run node tools/orc.mjs golden)`);
      }
    }
    for (const [k, file] of onDisk) {
      if (!wanted.has(k)) problems.push(`tests/golden/${adapter.id}/${path.relative(dir, file).replace(/\\/g, '/')}: stale (no source generates it; run node tools/orc.mjs golden)`);
    }
  }
  return problems;
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

const VALUE_OPTIONS = ['home', 'tool', 'out', 'board', 'board-repo', 'repo', 'profile', 'role', 'base', 'repo-dir', 'session', 'board-export', 'brief', 'timeout', 'logs', 'min-precision', 'workflow', 'transcript', 'log', 'mode', 'version', 'dir', 'prices', 'stack', 'from', 'case', 'report', 'variant', 'models', 'budget-usd', 'runs', 'label', 'author', 'max', 'until', 'model', 'allow', 'state', 'issue', 'family', 'prefer'];

// Value options that may repeat; each value may also be comma-separated.
const LIST_OPTIONS = ['profile', 'stack'];

// Value options that may repeat but are never comma-split (paths, case ids, logins, tool rules).
const REPEAT_OPTIONS = ['from', 'case', 'author', 'allow'];

const FLAG_OPTIONS = ['help', 'apply', 'force', 'from-stdin', 'dry-run', 'no-lint', 'node', 'no-profile', 'no-board', 'print', 'json', 'sprint-kit', 'keep', 'keep-output', 'all'];

// The argv index of the command word (the first argument that is neither an option nor an option's value).
function commandIndex(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) return i;
    if (!a.includes('=') && VALUE_OPTIONS.includes(a.slice(2))) i++;
  }
  return -1;
}

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
      } else if (REPEAT_OPTIONS.includes(key)) out[key] = [...(out[key] ?? []), value];
      else out[key] = value;
    } else if (FLAG_OPTIONS.includes(key) && eq < 0) out[key] = true;
    else throw new Error(`unknown option ${a}`);
  }
  return out;
}

export function parseAgyModels(text, family) {
  let re;
  let label;
  if (family === undefined) {
    re = /^\s*(\S*flash\S*-(low|medium|high))\s/;
    label = 'flash';
  } else {
    const name = typeof family === 'string' ? family.trim() : '';
    if (!name) return { error: 'family name must not be empty' };
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`^\\s*((?:\\S*-)?${esc}-(low|medium|high))\\s`);
    label = name;
  }
  const found = {};
  for (const line of normalizeEol(text).split('\n')) {
    const m = re.exec(`${line} `);
    if (m) found[{ low: 'low', medium: 'mid', high: 'high' }[m[2]]] ??= m[1];
  }
  const missing = ['low', 'mid', 'high'].filter((t) => !found[t]);
  if (missing.length) return { error: `cannot tell the ${missing.join(', ')} ${label} slug(s) from this list` };
  if (family !== undefined) {
    const stems = new Set([found.low.slice(0, -'-low'.length), found.mid.slice(0, -'-medium'.length), found.high.slice(0, -'-high'.length)]);
    if (stems.size > 1) {
      // The list was readable, so the caller must not add its "paste the output" hint to this one.
      const example = found.high.slice(0, -'-high'.length).replace(/^gemini-/, '');
      return { error: `--family ${label} picks slugs from more than one model (${found.low}, ${found.mid}, ${found.high}); name one model, for example --family ${example}`, readable: true };
    }
  }
  return { fragment: { antigravity: { headless: { low: found.low, mid: found.mid, high: found.high } } } };
}

// The comparison status prints and doctor summarises: every file install would write, against what is in `home`.
// Prints one line per file through io.out; returns {error} or {adapter, clean, files, missing}, either with
// `manifestError` when the manifest is corrupt (compared as absent; install refuses it).
export async function compareInstall(repo, home, toolId, opt, io, configBoard = undefined, env = process.env) {
  const known = (await loadAdapters(repo)).find((a) => a.id === toolId);
  const loaded = known ? loadManifest(home, known) : {};
  if (loaded.error) io.err(`WARN ${loaded.error}; ignoring it`);
  const flagged = (r) => (loaded.error ? { ...r, manifestError: loaded.error } : r);
  if (configBoard === undefined) {
    const resolved = resolveConfigBoard(repo, opt, loaded.manifest, io, env);
    if (resolved.error) return flagged({ error: resolved.error });
    configBoard = resolved.configBoard;
  }
  const chosen = installOptions(opt, loaded.manifest, io, configBoard, toolId);
  if (artifactRefused(chosen.board, toolId)) return flagged({ error: ARTIFACT_ONLY_CLAUDE });
  let built;
  try {
    [built] = await buildAll(repo, toolId, { shared: true, extraNotes: installNotes(chosen, toolId), profiles: chosen.profiles, env, warn: (w) => io.err(`WARN ${w}`) });
  } catch (e) {
    return flagged({ error: e instanceof Error ? e.message : String(e) });
  }
  const { adapter, errors } = built;
  if (errors.length) return flagged({ error: errors.join('\n') });
  const kit = chosen.sprintKit;
  const installed = installFileList(repo, adapter, built.files, { sprintKit: kit });
  const recorded = loaded.manifest?.files ?? null;
  const ours = new Set();
  let clean = true;
  let missingCount = 0;
  for (const f of installed) {
    const target = path.join(home, ...f.path.split('/'));
    ours.add(target);
    let state = 'same';
    if (!fs.existsSync(target)) state = 'missing';
    else {
      const line = firstDiffLine(read(target), normalizeEol(f.content));
      if (line && recorded?.[f.path] && diskHash(target) !== recorded[f.path].sha256) state = `edited since install, differs (first difference at line ${line})`;
      // A hand-copied hook script, command or skill with no manifest entry is one install keeps: only --force replaces it.
      else if (line && f.handCopyLabel && !recorded?.[f.path] && !isGenerated(read(target))) {
        state = `differs (first difference at line ${line}; a hand-copied ${f.handCopyLabel}, which install --apply keeps: install --apply --force replaces it, with a backup)`;
      } else if (line) state = `differs (first difference at line ${line})`;
    }
    if (state !== 'same') clean = false;
    if (state === 'missing') missingCount++;
    io.out(`${state}: ${target}`);
  }
  // A kit's settings.json must still hold a working guard, every allow rule the kit ever added (all stacks) and the
  // preset for the recorded stacks.
  if (kit) {
    const target = path.join(home, ...SETTINGS_REL.split('/'));
    let missing;
    let example;
    try {
      example = kitHookExample(repo);
    } catch (e) {
      return flagged({ error: `cannot read ${path.join(repo, 'adapters', 'claude-code', 'hooks.node.example.json')} (${e instanceof Error ? e.message : String(e)})` });
    }
    const recordedAllow = Array.isArray(loaded.manifest?.kit?.settings?.allow) ? loaded.manifest.kit.settings.allow.filter((r) => typeof r === 'string') : [];
    try {
      const { settings } = readSettings(target);
      const allow = [...new Set([...presetRules(chosen.stacks ?? []), ...recordedAllow])];
      const p = planKitSettings(settings, { example, allow, home });
      missing = [...p.hooks.map((h) => `${h.event}${h.matcher ? ` [${h.matcher}]` : ''}: ${h.command}`), ...p.allow.map((r) => `permissions.allow: ${r}`)];
    } catch (e) {
      missing = [`unreadable (${e instanceof Error ? e.message : String(e)})`];
    }
    for (const m of missing) io.out(`missing in settings.json: ${m}`);
    if (missing.length) clean = false;
    else io.out(`same: ${target} (sprint kit entries present)`);
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
  return flagged({ adapter, clean, files: installed.length, missing: missingCount });
}

// `ctx` is internal to --all: {configBoard} (the board default from config.json) and {preflight} (a dry run that
// counts files in the way as a refusal).
export async function main(argv, io = { out: console.log, err: console.error, stdin: () => fs.readFileSync(0) }, ctx = {}) {
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
  if (opt.help || opt._.includes('-h') || cmd === 'help') {
    const topic = cmd === 'help' || cmd === '-h' ? opt._.find((a, i) => i > 0 && a !== '-h') : cmd;
    if (!topic) {
      io.out(globalHelp());
      return 0;
    }
    const text = commandHelp(topic);
    if (!text) return fail(`unknown command ${topic}\n${USAGE}`);
    io.out(text);
    return 0;
  }
  const repo = path.resolve(opt.repo ?? DEFAULT_REPO);
  // sync is install --all under another name: the same code installs every tool in activeTools (a dry run without
  // --apply). It writes nothing into the checkout.
  if (cmd === 'sync') {
    if (opt.tool) return fail('sync installs every tool in activeTools; --tool does not apply (install --tool <id> installs one tool)');
    if (opt.all || opt['sprint-kit']) return fail('--all and --sprint-kit do not apply to sync (it installs every tool in activeTools)');
    let cfg;
    try {
      cfg = loadConfig({ tools: knownTools(repo), roles: loadRoles(repo).map((r) => r.name) });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
    (cfg.warnings ?? []).forEach((w) => io.err(`WARN ${w}`));
    if (!cfg.config?.activeTools?.length) {
      const dropped = (cfg.warnings ?? []).some((w) => w.includes('so activeTools is dropped'));
      const why = dropped
        ? `no tool in activeTools of ${cfg.file} is known to this checkout`
        : `sync needs activeTools in ${cfg.file}${cfg.config ? '' : ' (the file does not exist)'}`;
      return fail(`${why}; to install one tool instead, run install --tool <id> [--home <dir>] --apply`);
    }
    const at = commandIndex(argv);
    return main([...argv.slice(0, at), 'install', ...argv.slice(at + 1), '--all'], io, { ...ctx, cfg });
  }
  const profiles = opt.profile ?? [];
  if (profiles.length && !['build', 'install', 'status'].includes(cmd)) return fail('--profile applies to build, install and status only');
  if ((opt['no-profile'] || opt['no-board']) && !['install', 'status'].includes(cmd)) return fail('--no-profile and --no-board apply to install and status only');
  const kitStack = opt.stack && cmd === 'install' && opt['sprint-kit'];
  if (((opt.stack && !kitStack) || opt.from || (opt.json && cmd !== 'doctor')) && cmd !== 'standards') return fail('--stack, --from and --json apply to standards only (and --stack to install --sprint-kit, --json to doctor)');
  if (opt.family !== undefined && cmd !== 'models') return fail('--family applies to models only');
  if (opt.model !== undefined && !['dispatch', 'queue'].includes(cmd)) return fail('--model applies to dispatch and queue only');
  if (opt.prefer !== undefined && cmd !== 'dispatch') return fail('--prefer applies to dispatch only');
  if (opt.all && !['install', 'status'].includes(cmd)) return fail('--all applies to install and status only');
  if (opt.all && opt.tool) return fail('pass --all or --tool, not both');
  if (opt['sprint-kit'] && !['install', 'status'].includes(cmd)) return fail('--sprint-kit applies to install and status only (uninstall reads the kit from the manifest)');
  if (opt['sprint-kit'] && opt.tool !== 'claude-code') return fail('--sprint-kit is for --tool claude-code only');
  if (opt['sprint-kit'] && (opt.board || opt['board-repo'])) return fail('the sprint kit installs no board: drop --board and --board-repo');
  if (kitStack) {
    const unknown = opt.stack.filter((s) => !KNOWN_STACKS.includes(s));
    if (unknown.length) return fail(`unknown stack(s) ${unknown.join(', ')} for the sprint kit; known: ${KNOWN_STACKS.join(', ')}`);
  }
  const queueOnly = ['label', 'author', 'max', 'until', 'allow', 'state', 'issue'].filter((k) => opt[k] !== undefined);
  if (queueOnly.length && cmd !== 'queue') return fail(`${queueOnly.map((k) => `--${k}`).join(', ')} apply to queue only`);
  const benchOnly = ['variant', 'models', 'runs', 'keep', 'keep-output'].filter((k) => opt[k] !== undefined);
  if (benchOnly.length && cmd !== 'bench') return fail(`${benchOnly.map((k) => `--${k}`).join(', ')} apply to bench only`);
  if (opt['budget-usd'] !== undefined && !['bench', 'queue'].includes(cmd)) return fail('--budget-usd applies to bench and queue only');
  if (opt['dry-run'] && cmd === 'queue') return fail('queue takes no --dry-run: queue run without --apply is the dry run');
  if (opt['no-profile'] && opt.profile) return fail('pass --profile or --no-profile, not both');
  if (opt['no-board'] && (opt.board || opt['board-repo'])) return fail('pass --board or --no-board, not both');
  try {
    loadProfiles(repo, profiles);
  } catch (e) {
    return fail(e.message);
  }

  // --all: the command once per config.activeTools entry, in order. Every refusal is checked for every tool first.
  if (opt.all) {
    let cfg = ctx.cfg;
    if (!cfg) {
      try {
        cfg = loadConfig({ tools: knownTools(repo), roles: loadRoles(repo).map((r) => r.name) });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
      (cfg.warnings ?? []).forEach((w) => io.err(`WARN ${w}`));
    }
    const tools = cfg.config?.activeTools ?? [];
    if (!tools.length) return fail(`--all needs activeTools in ${cfg.file}`);
    if (cmd === 'install' && !opt.home && !ctx.setupChecked) {
      const mismatch = setupCheckoutMismatch({ file: cfg.file, setupCheckout: cfg.config?.setupCheckout ?? null });
      if (mismatch) {
        if (opt.apply && !opt.force) return fail(`refused: ${mismatch}; pass --force to write from this checkout`);
        io.err(`WARN ${mismatch}`);
      }
    }
    const boardRule = boardDefault(cfg.config, cfg.file, isArtifactBoard);
    const configBoard = boardRule?.error ? null : boardRule;
    const refused = [];
    for (const t of tools) {
      if (artifactRefused(opt.board, t)) refused.push(`${t}: ${ARTIFACT_ONLY_CLAUDE}`);
      if (boardPairError(opt, t)) refused.push(`${t}: pass --board and --board-repo together, or neither (an artifact --board needs no --board-repo)`);
    }
    if (!refused.length && boardRule?.error) {
      const home = path.resolve(opt.home ?? os.homedir());
      const adapters = await loadAdapters(repo);
      const needed = tools.some((t) => {
        const adapter = adapters.find((a) => a.id === t);
        let manifest = null;
        try {
          manifest = loadManifest(home, adapter).manifest ?? null;
        } catch {
          manifest = null;
        }
        return usesConfigBoard(opt, manifest);
      });
      if (needed) return fail(boardRule.error);
    }
    const rest = argv.filter((a) => a !== '--all');
    // install --apply: a dry run of every tool first, so a refusal anywhere (an unsafe path, a file in the way, a bad
    // manifest, the config board on a tool that cannot use it) stops the run before any tool is written.
    if (!refused.length && cmd === 'install' && opt.apply) {
      for (const t of tools) {
        const errs = [];
        const quiet = { ...io, out: () => {}, err: (s) => errs.push(s) };
        let code;
        try {
          code = await main([...rest.filter((a) => a !== '--apply'), '--tool', t], quiet, { configBoard, preflight: true, setupChecked: true });
        } catch (e) {
          refused.push(`${t}: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        // A non-zero dry run is a refusal even when it printed only WARN lines.
        const said = errs.filter((s) => !s.startsWith('WARN '));
        if (code) refused.push(...(said.length ? said : [`dry run exited ${code}`]).map((s) => `${t}: ${s}`));
      }
    } else if (!refused.length) {
      const home = path.resolve(opt.home ?? os.homedir());
      const adapters = await loadAdapters(repo);
      for (const t of tools) {
        const adapter = adapters.find((a) => a.id === t);
        let manifest = null;
        try {
          manifest = loadManifest(home, adapter).manifest ?? null;
        } catch {
          manifest = null;
        }
        const chosen = installOptions(opt, manifest, { ...io, out: () => {} }, configBoard, t);
        if (artifactRefused(chosen.board, t)) refused.push(`${t}: ${ARTIFACT_ONLY_CLAUDE}`);
      }
    }
    if (refused.length) {
      refused.forEach((r) => io.err(`refused: ${r}`));
      return fail(`nothing ${cmd === 'install' ? 'written' : 'compared'}: ${cmd} --all refused for ${[...new Set(refused.map((r) => r.split(':')[0]))].join(', ')}`);
    }
    // One tool's failure does not stop the rest; the last line names every tool that failed.
    let worst = 0;
    const failed = [];
    for (const t of tools) {
      io.out(`== ${t} ==`);
      let code;
      try {
        code = await main([...rest, '--tool', t], io, { configBoard, setupChecked: true });
      } catch (e) {
        io.err(`${t}: ${e instanceof Error ? e.message : String(e)}`);
        code = 1;
      }
      if (code) failed.push(`${t} (exit ${code})`);
      worst = Math.max(worst, code);
    }
    if (failed.length) io.err(`${cmd} --all: failed for ${failed.join(', ')}`);
    return worst;
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
    problems.push(...goldenProblems(repo, results));
    problems.push(...validateArchive(path.join(repo, 'standards')));
    if (problems.length) {
      problems.forEach((p) => io.err(`FAIL ${p}`));
      return 1;
    }
    io.out(`check ok: ${results.length} adapters, ${results.reduce((n, r) => n + r.files.length, 0)} files`);
    return 0;
  }

  if (cmd === 'golden') {
    let results;
    try {
      results = await buildGolden(repo, opt.tool ?? 'all');
    } catch (e) {
      return fail(e.message);
    }
    const errors = results.flatMap((r) => r.errors);
    if (errors.length) return fail(errors.join('\n'));
    const root = path.join(repo, 'tests', 'golden');
    // The install containment check: tests, tests/golden and every folder below must be real folders inside the repo.
    const outside = results.flatMap(({ adapter, files }) =>
      [path.join(root, adapter.id), ...files.map((f) => path.join(root, adapter.id, ...f.path.split('/')))].map((t) => escapes(repo, 'tests/golden', t)).filter(Boolean),
    );
    if (outside.length) {
      [...new Set(outside)].forEach((u) => io.err(`refused: ${u}`));
      return fail('nothing written: unsafe tests/golden path(s)');
    }
    // On a case-insensitive file system (win32, darwin) a golden that differs from the built name only by case is
    // the same file: it is renamed, never deleted. A folder that differs only by case is refused before any write.
    const onDiskOf = new Map(results.map(({ adapter }) => [adapter.id, new Map(walkFiles(path.join(root, adapter.id)).map((p) => [fileKey(p), p]))]));
    const badDirs = new Map();
    for (const { adapter, files } of results) {
      const dir = path.join(root, adapter.id);
      for (const f of files) {
        const target = path.join(dir, ...f.path.split('/'));
        const disk = onDiskOf.get(adapter.id).get(fileKey(target));
        if (!disk || path.dirname(disk) === path.dirname(target)) continue;
        const [have, want] = [disk, target].map((p) => path.relative(repo, path.dirname(p)).replace(/\\/g, '/'));
        badDirs.set(have, want);
      }
    }
    if (badDirs.size) {
      for (const [have, want] of badDirs) io.err(`refused: folder ${have} differs only by case from ${want}; rename it by hand`);
      return fail('nothing written: golden folder name(s) differ only by case');
    }
    for (const { adapter, files } of results) {
      const dir = path.join(root, adapter.id);
      const wanted = new Set();
      const onDisk = onDiskOf.get(adapter.id);
      for (const f of files) {
        const target = path.join(dir, ...f.path.split('/'));
        wanted.add(fileKey(target));
        const rel = `tests/golden/${adapter.id}/${f.path}`;
        const disk = onDisk.get(fileKey(target));
        if (disk && disk !== target) {
          const tmp = `${disk}.orc-rename-${process.pid}`;
          fs.renameSync(disk, tmp);
          fs.renameSync(tmp, target);
          io.out(`renamed tests/golden/${adapter.id}/${path.relative(dir, disk).replace(/\\/g, '/')} -> tests/golden/${adapter.id}/${f.path}`);
        }
        if (fs.existsSync(target) && read(target) === f.content) {
          io.out(`unchanged ${rel}`);
          continue;
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, f.content);
        io.out(`wrote ${rel}`);
      }
      for (const file of walkFiles(dir)) {
        if (wanted.has(fileKey(file))) continue;
        fs.rmSync(file);
        io.out(`deleted tests/golden/${adapter.id}/${path.relative(dir, file).replace(/\\/g, '/')}`);
      }
    }
    return 0;
  }

  if (cmd === 'install') {
    const toolId = opt.tool;
    if (!toolId || toolId === 'all') return fail('install needs --tool <id>');
    if (artifactRefused(opt.board, toolId)) return fail(ARTIFACT_ONLY_CLAUDE);
    if (boardPairError(opt, toolId)) return fail('pass --board and --board-repo together, or neither (an artifact --board needs no --board-repo)');
    const home = path.resolve(opt.home ?? os.homedir());
    const known = (await loadAdapters(repo)).find((a) => a.id === toolId);
    const early = known ? loadManifest(home, known) : {};
    if (early.error) return fail(`${early.error}; remove or fix the manifest by hand`);
    let configBoard = ctx.configBoard;
    let setupInfo = null;
    if (!Object.hasOwn(ctx, 'configBoard')) {
      const resolved = resolveConfigBoard(repo, opt, early.manifest, io);
      if (resolved.error) return fail(resolved.error);
      configBoard = resolved.configBoard;
      setupInfo = resolved.config ? { file: resolved.file, setupCheckout: resolved.config.setupCheckout ?? null } : readSetupCheckout();
    }
    if (!opt.home && !ctx.setupChecked) {
      const mismatch = setupCheckoutMismatch(setupInfo ?? readSetupCheckout());
      if (mismatch) {
        if (opt.apply && !opt.force) return fail(`refused: ${mismatch}; pass --force to write from this checkout`);
        io.err(`WARN ${mismatch}`);
      }
    }
    const chosen = installOptions(opt, early.manifest, io, configBoard, toolId);
    if (artifactRefused(chosen.board, toolId)) return fail(ARTIFACT_ONLY_CLAUDE);
    const kit = chosen.sprintKit;
    if (kit && (opt.board || opt['board-repo'])) return fail('the sprint kit installs no board: drop --board and --board-repo');
    // A kit over a full install would delete that install's hook scripts while its settings.json still runs them, and
    // its uninstall would remove the whole earlier install. (The reverse cannot happen: a recorded kit stays a kit.)
    if (kit && early.manifest && early.manifest.options?.sprintKit !== true) {
      return fail(
        `refused: ${early.file} records a full orc install, not a sprint kit; nothing written. The full install already has the roster agents and the hook scripts (hooks --node --apply wires the guard). ` +
          `For /sprint, copy ${SETUP}/skills/sprint to ${path.join(home, '.claude', 'skills', 'sprint')} by hand; to switch to a sprint kit, run uninstall --tool claude-code --home <dir> --apply first.`,
      );
    }
    const extraNotes = installNotes(chosen, toolId);
    if (!chosen.board && !kit && !chosen.artifactSkipped) io.err('WARN the board address is not set: pass --board <address> (with --board-repo <path> for a local board) so the rulebook names it');
    let stacks = chosen.stacks ?? [];
    if (kit && !chosen.stacks) {
      // Detection reads the current folder; the checkout itself (which has a package.json) is never the project.
      const cwd = path.resolve(io.cwd ? io.cwd() : process.cwd());
      const isCheckout = fs.existsSync(cwd) && fs.realpathSync.native(cwd) === fs.realpathSync.native(repo);
      stacks = isCheckout ? [] : detectStacks(cwd);
      if (isCheckout) io.out(`sprint kit: no stack detected (the current folder is the Orc-istration checkout); pass --stack ${KNOWN_STACKS.join('|')} for a permission preset`);
      else if (!stacks.length) io.out(`sprint kit: no stack detected in ${cwd}; no permission preset (pass --stack ${KNOWN_STACKS.join('|')})`);
      else io.out(`sprint kit: stack ${stacks.join(',')} (detected in ${cwd})`);
    } else if (kit) io.out(`sprint kit: stack ${stacks.join(',')}`);
    let built;
    try {
      [built] = await buildAll(repo, toolId, { shared: true, extraNotes, profiles: chosen.profiles, warn: (w) => io.err(`WARN ${w}`) });
    } catch (e) {
      return fail(e.message);
    }
    const { adapter, errors } = built;
    if (errors.length) return fail(errors.join('\n'));
    const installTargets = installFileList(repo, adapter, built.files, { sprintKit: kit });
    for (const c of adapter.conflicts ?? []) {
      const other = path.join(home, ...c.path.split('/'));
      if (!fs.existsSync(other) || !fs.statSync(other).isFile()) continue;
      if (isGenerated(read(other))) {
        io.err(`WARN ${other} is an orc-generated ${c.tool} rulebook in the same folder: ${c.warning}. Remove ${other} unless you also use ${c.tool}.`);
      } else {
        io.err(`WARN ${other} exists in the same folder (${c.tool} rulebook): ${c.handWrittenWarning ?? c.warning}. Review both files so their rules do not conflict.`);
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
    for (const f of installTargets) {
      const why = escapes(home, root, path.join(home, ...f.path.split('/')));
      if (why) unsafe.push(why);
    }
    // Only the --all preflight checks the paths first: one tool's failure there would leave the others installed. A
    // single-tool install stops at the failure and records what it wrote, so uninstall undoes it.
    if (ctx.preflight) unsafe.push(...targetPathProblems(home, installTargets));
    for (const rel of Object.keys(recorded)) {
      const t = safeRel(home, rel, root);
      const why = escapes(home, root, t);
      if (why) unsafe.push(why);
      else if (fs.existsSync(t) && !fs.lstatSync(t).isFile()) unsafe.push(`${t} (in the manifest) is not a regular file`);
    }
    const priorKit = manifest?.kit;
    const settingsTarget = path.join(home, ...SETTINGS_REL.split('/'));
    if (kit) {
      const problem = kitRecordProblem(priorKit);
      if (problem) return fail(`${loaded.file}: ${problem}; remove or fix the manifest by hand`);
      unsafe.push(...kitPathProblems(home, root, priorKit));
    }
    if (unsafe.length) {
      unsafe.forEach((u) => io.err(`refused: ${u}`));
      return fail('nothing written: unsafe target path(s)');
    }
    // The kit's settings.json additions are planned before any write: an unreadable file refuses the whole install.
    let settingsPlan = null;
    if (kit) {
      let example;
      try {
        example = kitHookExample(repo);
      } catch (e) {
        return fail(`cannot read ${path.join(repo, 'adapters', 'claude-code', 'hooks.node.example.json')} (${e instanceof Error ? e.message : String(e)}); nothing written`);
      }
      // The guard.mjs the kit is about to write counts as on disk.
      const kitGuard = path.join(home, ...root.split('/'), ...KIT_HOOK_SCRIPTS[0].split('/'));
      const guardExists = (p) => fs.existsSync(p) || samePath(p, kitGuard);
      try {
        const current = readSettings(settingsTarget);
        // Every rule the kit added before (an earlier --stack) is put back when missing, as status asks for it.
        const kitAllow = [...new Set([...presetRules(stacks), ...(priorKit?.settings?.allow ?? []).filter((r) => typeof r === 'string')])];
        settingsPlan = { ...current, ...planKitSettings(current.settings, { example, allow: kitAllow, home, guardExists }) };
        for (const s of guardStatus(current.settings, { exists: guardExists }).stale) {
          io.err(`WARN ${settingsTarget}: the PreToolUse hook${s.matcher ? ` [${s.matcher}]` : ''} "${s.command}" runs ${s.script}, which is not on disk, so it guards nothing; left as it is (remove it by hand)`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const why = e instanceof SyntaxError ? `${settingsTarget} is not valid JSON (${msg})` : (msg.startsWith(settingsTarget) ? msg : `${settingsTarget}: ${msg}`).replace(/; nothing written$/, '');
        return fail(`refused: ${why}; nothing written (fix or move that file, then run again)`);
      }
    }
    // Plan every target first: one refused file refuses the whole install, so it is never half applied.
    const plan = installTargets.map((f) => {
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
          // A hook script, command or skill copied by hand before install shipped them is kept, so it never refuses the whole install.
          if (state === 'REPLACE HAND-WRITTEN' && f.handCopyLabel && !opt.force) state = 'KEEP';
          // On a borrowed machine the kit replaces the owner's own file after a backup, and uninstall puts it back.
          if (state === 'REPLACE HAND-WRITTEN' && kit) state = KIT_RESTORABLE;
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
    if ((opt.apply || ctx.preflight) && blocked.length) {
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
      options: { profiles: chosen.profiles, board: chosen.board, boardRepo: chosen.boardRepo, ...(chosen.noBoard ? { noBoard: true } : {}) },
      files: {},
      dirs: [...(manifest?.dirs ?? [])],
    };
    // The first backup of each file the kit replaced is the one uninstall restores; a re-install keeps it.
    const restore = { ...(priorKit?.restore ?? {}) };
    const copies = [...(priorKit?.copies ?? [])];
    const prior = priorKit?.settings ?? {};
    // The kit's settings record: the prior one until this run's settings.json write succeeds.
    let settingsRecord = priorKit?.settings;
    const withKit = (m) => ({ ...m, options: { ...m.options, sprintKit: true, stacks }, kit: { ...(settingsRecord ? { settings: settingsRecord } : {}), restore, copies } });
    try {
      for (const { f, target, exists, state } of plan) {
        if (state === 'KEEP') {
          io.out(`${opt.apply ? 'kept' : 'would keep'} (hand-copied ${f.handCopyLabel}, differs; --force replaces it, with a backup): ${target}`);
          continue;
        }
        // A file any install finds already in place, identical and in no manifest, is the owner's: not recorded, so
        // uninstall leaves it (#30).
        const ownerCopy = state === 'unchanged' && !recorded[f.path];
        if (opt.apply && state !== 'unchanged') {
          for (let d = path.dirname(target), rel = path.posix.dirname(f.path); !fs.existsSync(d); d = path.dirname(d), rel = path.posix.dirname(rel)) {
            if (safeRel(home, rel, adapter.home.root) && !next.dirs.includes(rel)) next.dirs.push(rel);
          }
          fs.mkdirSync(path.dirname(target), { recursive: true });
          if (exists) {
            const backup = backupPath(target, when);
            fs.copyFileSync(target, backup);
            const backupRel = f.path + backup.slice(target.length);
            // The owner's file gets a restore entry; a backup of the kit's own earlier copy is recorded as a copy.
            if (kit && !recorded[f.path] && !restore[f.path]) restore[f.path] = backupRel;
            else if (kit) copies.push(backupRel);
          }
          const bytes = Buffer.from(f.content, 'utf8');
          fs.writeFileSync(target, bytes);
          next.files[f.path] = { sha256: sha256(bytes) };
        } else if (opt.apply && !ownerCopy) next.files[f.path] = { sha256: diskHash(target) };
        const sep = refusedStates.includes(state) ? '' : ':';
        io.out(`${opt.apply ? 'applied' : 'would'} ${state}${sep} ${target}${ownerCopy ? ' (already there and in no orc manifest: not recorded, uninstall leaves it)' : ''}`);
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
      if (kit) {
        const s = settingsPlan;
        for (const h of s.hooks) io.out(`${opt.apply ? 'added' : 'would add'} to settings.json ${h.event}${h.matcher ? ` [${h.matcher}]` : ''}: ${h.command}`);
        for (const r of s.allow) io.out(`${opt.apply ? 'added' : 'would add'} to settings.json permissions.allow: ${r}`);
        const changed = s.hooks.length + s.allow.length > 0;
        // One backup, before the kit's first change to the file; a file the kit created needs none.
        const firstChange = changed && s.original !== null && !prior.backup && !prior.fileCreated;
        let backupRel = prior.backup ?? null;
        if (!changed) io.out(`settings.json: nothing to add (${settingsTarget})`);
        else if (s.original !== null && formatLike(s.original, s.settings) !== s.original) {
          io.err(`WARN ${settingsTarget} is not in plain indented JSON layout; writing it re-indents the existing content (values and order unchanged)`);
        }
        if (changed && opt.apply) {
          let backup = null;
          if (firstChange) {
            backup = backupPath(settingsTarget, when);
            backupRel = SETTINGS_REL + backup.slice(settingsTarget.length);
          }
          writeSettings(settingsTarget, s.bom + formatLike(s.original, s.merged), backup);
          io.out(`${s.original === null ? 'created' : 'updated'} ${settingsTarget}${backup ? ` (backed up: ${backup})` : ''}`);
        } else if (changed) io.out(`would ${s.original === null ? 'create' : 'update'} ${settingsTarget}${firstChange ? ', after a backup' : ''}`);
        const uniq = (list, key) => [...new Map(list.map((x) => [key(x), x])).values()];
        settingsRecord = {
          fileCreated: Boolean(prior.fileCreated) || (changed && s.original === null),
          backup: backupRel,
          containers: uniq([...(prior.containers ?? []), ...s.containers], (c) => c),
          hooks: uniq([...(prior.hooks ?? []), ...s.hooks], (h) => JSON.stringify([h.event, h.matcher ?? null, h.command])),
          allow: uniq([...(prior.allow ?? []), ...s.allow], (r) => r),
        };
      }
    } catch (e) {
      if (!opt.apply) throw e;
      // An install stopped part way still leaves a manifest naming every file written so far (and, for a kit, each
      // owner file's backup), so uninstall can undo it; a kit's settings record is the new one only if settings.json
      // was written.
      const partial = { ...next, files: { ...recorded, ...next.files } };
      writeManifest(loaded.file, kit ? withKit(partial) : partial);
      return fail(`install stopped: ${e instanceof Error ? e.message : String(e)}; ${loaded.file} records what was written, so uninstall --apply undoes it`);
    }
    if (opt.apply) {
      try {
        writeManifest(loaded.file, kit ? withKit(next) : next);
      } catch (e) {
        return fail(`the files were written but not recorded: cannot write ${loaded.file} (${e instanceof Error ? e.message : String(e)}), so uninstall cannot undo this install`);
      }
    }
    if (adapter.installNote) io.out(adapter.installNote);
    if (!opt.apply) {
      io.out(`dry run for ${adapter.id}; add --apply to write`);
      if (blocked.length) io.out(`--apply would refuse: ${blocked.length} ${kind} file(s) in the way (use --force to replace them, with backups)`);
    }
    io.out(`${opt.apply ? 'Next' : 'After --apply, next'}: ${kit ? KIT_NEXT : STANDARDS_NEXT}`);
    return 0;
  }

  if (cmd === 'uninstall') {
    const toolId = opt.tool;
    if (!toolId || toolId === 'all') return fail('uninstall needs --tool <id>');
    const home = path.resolve(opt.home ?? os.homedir());
    const adapter = (await loadAdapters(repo)).find((a) => a.id === toolId);
    if (!adapter) return fail(`unknown tool ${toolId}`);
    if (!opt.home) {
      const mismatch = setupCheckoutMismatch(readSetupCheckout());
      if (mismatch) {
        if (opt.apply && !opt.force) return fail(`refused: ${mismatch}; pass --force to proceed from this checkout`);
        io.err(`WARN ${mismatch}`);
      }
    }
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
    // A sprint kit: its settings.json entries are removed first (a failed write then leaves the home and the manifest
    // as they were), then the kit's files are deleted and the files it replaced are restored.
    const kitRec = manifest.kit;
    const settingsTarget = path.join(home, ...SETTINGS_REL.split('/'));
    let settingsStep = null;
    if (kitRec !== undefined) {
      const problem = kitRecordProblem(kitRec);
      if (problem) bad.push(`${file}: ${problem}`);
      else bad.push(...kitPathProblems(home, root, kitRec));
      const rec = kitRec?.settings;
      if (!problem && rec && ((rec.hooks ?? []).length || (rec.allow ?? []).length)) {
        try {
          settingsStep = planSettingsUndo(rec, settingsTarget, rec.backup ? safeRel(home, rec.backup, root) : null);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          bad.push(`${settingsTarget}: cannot remove the sprint kit's entries (${e instanceof SyntaxError ? `not valid JSON: ${msg}` : msg})`);
        }
      }
    }
    if (bad.length) {
      bad.forEach((b) => io.err(`refused: ${b}`));
      return fail('nothing deleted: the manifest names unsafe or invalid paths');
    }
    // Backups this run leaves behind, with why: listed at the end, so none is left unexplained.
    const left = new Map();
    if (settingsStep) {
      const s = settingsStep;
      const removing = !['restore-missing', 'none'].includes(s.action);
      for (const h of removing ? (s.rec.hooks ?? []) : []) io.out(`${opt.apply ? 'removed' : 'would remove'} from settings.json ${h.event}${h.matcher ? ` [${h.matcher}]` : ''}: ${h.command}`);
      for (const r of removing ? (s.rec.allow ?? []) : []) io.out(`${opt.apply ? 'removed' : 'would remove'} from settings.json permissions.allow: ${r}`);
      if (s.warn) io.err(`WARN ${s.warn}`);
      try {
        if (s.action === 'delete') {
          if (opt.apply) fs.rmSync(settingsTarget);
          io.out(`${opt.apply ? 'deleted' : 'would delete'} (created by the sprint kit, now empty): ${settingsTarget}`);
        } else if (s.action === 'restore' || s.action === 'restore-missing') {
          // The backup's bytes go back, layout and BOM included.
          if (opt.apply) fs.renameSync(s.backup, settingsTarget);
          io.out(`${opt.apply ? 'restored' : 'would restore'} ${settingsTarget} from ${s.backup}${s.action === 'restore-missing' ? ' (settings.json was gone)' : ''}`);
        } else if (s.action === 'write') {
          if (opt.apply) writeSettings(settingsTarget, s.bom + formatLike(s.original, s.cleaned));
          io.out(`${opt.apply ? 'updated' : 'would update'} ${settingsTarget} (${s.reason}, so only the kit's entries are removed)`);
          if (s.backup && fs.existsSync(s.backup)) left.set(s.backup, `the settings.json from before the kit, kept because ${s.reason}; compare, then delete it`);
        }
        // The settings step is done: drop it from the manifest, so a rerun after a later failure does not redo it.
        if (opt.apply) writeManifest(file, { ...manifest, kit: { ...kitRec, settings: undefined } });
      } catch (e) {
        return fail(`nothing deleted: ${settingsTarget}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const kept = {};
    const gone = new Set();
    for (const { rel, sha, target, edited } of steps) {
      if (edited && !opt.force) {
        kept[rel] = { sha256: sha };
        io.out(`${opt.apply ? 'kept' : 'would keep'} (edited since install; --force deletes it after a backup): ${target}`);
        continue;
      }
      if (opt.apply) {
        if (edited) {
          // Never over an existing backup: it may be the original a sprint kit restores next.
          const backup = backupPath(target, when);
          fs.copyFileSync(target, backup);
          left.set(backup, `a copy of the kit file ${target}, edited since install, made by this uninstall; safe to delete`);
        }
        fs.rmSync(target);
      }
      gone.add(rel);
      io.out(`${opt.apply ? 'deleted' : 'would delete'}${edited ? ' (edited, backed up)' : ''}: ${target}`);
    }
    const keptRestore = {};
    for (const [rel, backupRel] of Object.entries(kitRec?.restore ?? {})) {
      const target = safeRel(home, rel, root);
      const backup = safeRel(home, backupRel, root);
      if (kept[rel]) {
        keptRestore[rel] = backupRel;
        left.set(backup, `the original of ${target}, not restored because the installed file is kept; uninstall --apply --force restores it`);
        io.out(`${opt.apply ? 'not restored' : 'would not restore'} (the installed file is kept): ${target}; the original is ${backup}`);
      } else if (!fs.existsSync(backup)) io.err(`WARN cannot restore ${target}: its backup ${backup} is gone`);
      else if (fs.existsSync(target) && !gone.has(rel)) {
        left.set(backup, `the original of ${target}, not restored because ${target} exists`);
        io.err(`WARN not restored: ${target} exists; the original is ${backup}`);
      } else {
        if (opt.apply) fs.renameSync(backup, target);
        io.out(`${opt.apply ? 'restored' : 'would restore'} ${target} from ${backup}`);
      }
    }
    if (opt.apply && kitRec !== undefined) {
      // Every other .orc-backup- file beside a file the kit touched: a copy of a kit file a re-install made (recorded
      // in kit.copies) or not the kit's at all.
      const touched = [...Object.keys(manifest.files), ...Object.keys(kitRec?.restore ?? {}), SETTINGS_REL];
      const dirsSeen = new Set(touched.map((rel) => path.dirname(safeRel(home, rel, root))));
      for (const d of dirsSeen) {
        if (!fs.existsSync(d)) continue;
        for (const name of fs.readdirSync(d).filter((n) => n.includes('.orc-backup-')).sort()) {
          const p = path.join(d, name);
          if (left.has(p)) continue;
          const copy = (kitRec?.copies ?? []).some((rel) => samePath(safeRel(home, rel, root), p));
          left.set(p, copy ? 'a copy of a kit file, made when a re-install replaced it; safe to delete' : 'not made by this kit (it may be the owner\'s); left alone');
        }
      }
      for (const [p, why] of left) io.out(`left: ${p} (${why})`);
    }
    // Only when this uninstall undoes nothing at all: a kit's settings.json step or restores are work it does.
    if (!Object.keys(manifest.files).length && !settingsStep && !Object.keys(kitRec?.restore ?? {}).length) {
      io.out('nothing recorded to delete: files that were already in place at install are not in the manifest; delete them by hand if they are orc\'s');
    }
    if (opt.apply) {
      const keep = Object.keys(kept).length > 0;
      if (!keep) fs.rmSync(file);
      // Only directories install created, deepest first, and only when empty.
      for (const rel of [...manifest.dirs].sort((x, y) => y.length - x.length)) {
        const d = safeRel(home, rel, adapter.home.root);
        // A recorded directory something else has since replaced (a file) is left alone, not read.
        if (fs.existsSync(d) && fs.lstatSync(d).isDirectory() && !fs.readdirSync(d).length) {
          fs.rmdirSync(d);
          io.out(`removed empty directory: ${d}`);
        }
      }
      if (keep) {
        // The kept files stay listed, so `uninstall --apply --force` can still remove them.
        const dirs = manifest.dirs.filter((rel) => fs.existsSync(safeRel(home, rel, adapter.home.root)));
        const rest = { ...manifest, files: kept, dirs };
        if (kitRec !== undefined) rest.kit = { restore: keptRestore };
        writeManifest(file, rest);
        io.out(`kept manifest listing ${Object.keys(kept).length} kept file(s): ${file}`);
      } else io.out(`removed manifest: ${file}`);
    } else io.out(`dry run for ${adapter.id}; add --apply to delete`);
    return 0;
  }

  if (cmd === 'status') {
    const toolId = opt.tool;
    if (!toolId || toolId === 'all') return fail('status needs --tool <id>');
    if (artifactRefused(opt.board, toolId)) return fail(ARTIFACT_ONLY_CLAUDE);
    if (boardPairError(opt, toolId)) return fail('pass --board and --board-repo together, or neither (an artifact --board needs no --board-repo)');
    const home = path.resolve(opt.home ?? os.homedir());
    const r = await compareInstall(repo, home, toolId, opt, io, Object.hasOwn(ctx, 'configBoard') ? ctx.configBoard : undefined);
    if (r.error) return fail(r.error);
    const { adapter, clean } = r;
    io.out(clean ? `status ${adapter.id}: all same` : `status ${adapter.id}: out of date (install --apply updates it)`);
    return clean ? 0 : 1;
  }

  if (cmd === 'models') {
    if (opt.tool !== 'antigravity' || !opt['from-stdin']) return fail('usage: models --tool antigravity --from-stdin [--family <name>]');
    const { fragment, error, readable } = parseAgyModels(decodeText(io.stdin()), opt.family);
    if (error) return fail(readable ? error : `${error}; paste the output of "agy models"`);
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
  const marchingOrders = () => parseMarchingOrders(read(path.join(repo, 'core', 'AGENTS.md')));
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

  if (cmd === 'calibration') {
    const min = opt['min-precision'] === undefined ? DEFAULT_MIN_PRECISION : Number(opt['min-precision']);
    if (!(min >= 0 && min <= 1)) return fail(`calibration: --min-precision must be a number from 0 to 1, got ${opt['min-precision']}`);
    try {
      const logs = path.resolve(opt.logs ?? path.join(repoTop(process.cwd()) ?? process.cwd(), '.orc', 'reviews'));
      emit(calibrationReport(logs, min));
      return 0;
    } catch (e) {
      return fail(e.message);
    }
  }

  if (cmd === 'corpus') {
    const sub = opt._[1];
    const root = path.join(repo, 'tests', 'fixtures', 'corpus');
    try {
      if (sub === 'list' && opt._.length === 2 && !opt.case && !opt.report) {
        const warnings = [];
        const cases = listCases(root, warnings);
        for (const w of warnings) io.err(`WARN ${w}`);
        io.out(cases.map((c) => `${c.id}  [${c.lanes.join(', ')}]  ${c.title}`).join('\n'));
        return 0;
      }
      if (sub === 'score' && opt._.length === 2) {
        if (!opt.case || !opt.report) return fail('corpus: score needs --case <id> and --report <file>');
        // --case may repeat (bench takes several); corpus score keeps the last one, as before.
        const { text, missed } = scoreReport(root, opt.case.at(-1), path.resolve(opt.report));
        io.out(text.replace(/\n$/, ''));
        return missed ? 1 : 0;
      }
    } catch (e) {
      return fail(e.message);
    }
    return fail('usage: corpus list | corpus score --case <id> --report <file>');
  }

  if (cmd === 'bench') {
    const sub = opt._[1];
    const root = path.join(repo, 'tests', 'fixtures', 'bench');
    try {
      if (sub === 'list' && opt._.length === 2) {
        const warnings = [];
        const cases = listBenchCases(root, warnings);
        for (const w of warnings) io.err(`WARN ${w}`);
        io.out(cases.map((c) => `${c.id}  ${c.kind || '?'}  ${c.title}`).join('\n'));
        return 0;
      }
      if (sub === 'run' && opt._.length === 2) {
        const toolId = opt.tool ?? 'claude-code';
        const adapter = (await loadAdapters(repo)).find((a) => a.id === toolId);
        if (toolId !== 'claude-code' || !adapter) return fail(`bench: no bench recipe for ${toolId} (bench runs Claude Code only)`);
        const models = loadModels(repo, { local: false, extra: opt.models ? path.resolve(opt.models) : null });
        return await runBench({ repo, root, adapter, roles: loadRoles(repo), models, opt, cwd: io.cwd ? io.cwd() : process.cwd() }, io);
      }
      if (sub === 'report' && opt._.length === 2) {
        const dir = path.resolve(opt.dir ?? path.join(repoTop(process.cwd()) ?? process.cwd(), '.orc', 'bench'));
        const { results, skipped } = loadBenchResults(dir);
        emit(benchReport(results, skipped));
        return 0;
      }
    } catch (e) {
      return fail(e.message.startsWith('bench:') ? e.message : `bench: ${e.message}`);
    }
    return fail(BENCH_USAGE);
  }

  if (cmd === 'queue') {
    const sub = opt._[1];
    if (!['list', 'run'].includes(sub) || opt._.length !== 2) return fail(QUEUE_USAGE);
    try {
      return await runQueue({ sub, models: loadModels(repo), opt, cwd: io.cwd ? io.cwd() : process.cwd() }, io);
    } catch (e) {
      return fail(e.message.startsWith('queue:') ? e.message : `queue: ${e.message}`);
    }
  }

  if (cmd === 'metrics') {
    const sub = opt._[1];
    try {
      if (sub === 'capture' && opt._.length === 2) {
        if (opt.mode && !['lite', 'full'].includes(opt.mode)) return fail(`metrics: --mode must be lite or full, got ${opt.mode}`);
        const { report, file, warnings } = capture({
          cwd: process.cwd(),
          workflow: opt.workflow,
          session: opt.session ?? process.env.CLAUDE_CODE_SESSION_ID,
          transcript: opt.transcript,
          log: opt.log,
          mode: opt.mode,
          version: opt.version,
          out: opt.out,
        });
        warnings.forEach((w) => io.err(`WARN ${w}`));
        const json = JSON.stringify(report, null, 2);
        if (opt.print) {
          io.out(json);
          return 0;
        }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${json}\n`);
        io.out(file);
        return 0;
      }
      if (sub === 'report' && opt._.length === 2) {
        const prices = opt.prices ? JSON.parse(read(path.resolve(opt.prices))) : DEFAULT_PRICES;
        const dir = path.resolve(opt.dir ?? path.join(repoTop(process.cwd()) ?? process.cwd(), '.orc', 'metrics'));
        emit(metricsReport(loadRuns(dir), prices));
        return 0;
      }
    } catch (e) {
      return fail(e.message.startsWith('metrics:') ? e.message : `metrics: ${e.message}`);
    }
    return fail('usage: metrics capture --workflow <name> [--session <id> | --transcript <path>] [--log <run log>] [--mode lite|full] [--version <v>] [--out <dir>] [--print] | metrics report [--dir <dir>] [--prices <file>] [--out <file>] [--force]');
  }

  if (cmd === 'dispatch') {
    if (!opt.role || !opt.brief) return fail('usage: dispatch [--tool <id> | --prefer <id>] --role <name> --brief <file> [--model <slug>] [--dry-run] [--timeout <seconds>] [--no-lint]');
    let timeoutSec = 0;
    if (opt.timeout !== undefined) {
      timeoutSec = /^\d+$/.test(opt.timeout) ? Number(opt.timeout) : NaN;
      if (!(timeoutSec >= 1 && timeoutSec <= 86400)) return fail(`--timeout needs a whole number of seconds from 1 to 86400, got ${opt.timeout}`);
    }
    let plan;
    try {
      const role = knownRole(opt.role);
      const adapters = await loadAdapters(repo);
      if (opt.tool && opt.prefer) return fail('pass --tool or --prefer, not both (--tool has no fallback)');
      if (opt.tool) {
        const adapter = adapters.find((a) => a.id === opt.tool);
        if (!adapter) return fail(`unknown tool ${opt.tool}`);
        if (typeof adapter.headless !== 'function') return fail(`no headless recipe for ${adapter.id}`);
      }
      if (opt.prefer && !adapters.some((a) => a.id === opt.prefer)) return fail(`unknown tool ${opt.prefer}`);
      // With --tool only `binaries` is used, so a config.json still invalid after its unknown entries are skipped is
      // one WARN and the run goes on without it; routing and --prefer need it and fail.
      let cfg;
      try {
        cfg = loadConfig({ tools: adapters.map((a) => a.id), roles: loadRoles(repo).map((r) => r.name) });
      } catch (e) {
        if (!opt.tool) throw e;
        io.err(`WARN ${e instanceof Error ? e.message : String(e)} (dispatch --tool goes on without its binaries)`);
        cfg = { file: configFile(), config: null };
      }
      (cfg.warnings ?? []).forEach((w) => io.err(`WARN ${w}`));
      // An explicit --tool is the whole chain (no fallback); otherwise the role's routing entry, then the fallback,
      // with --prefer moved to the front.
      const chain = opt.tool ? [opt.tool] : [...new Set([...(opt.prefer ? [opt.prefer] : []), ...routeChain(cfg.config, role.name)])];
      if (!chain.length) return fail(`dispatch needs --tool, or a routing entry for ${role.name} (or a fallback) in ${cfg.file}`);
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
      const models = loadModels(repo, { shared: true, warn: (w) => io.err(`WARN ${w}`) });
      const bins = { binaries: cfg.config?.binaries ?? null, configFile: cfg.file };
      // --model belongs to the first tool in the chain: dropped when another tool runs.
      const plans = chain.map((id, i) => dispatchPlan(adapters.find((a) => a.id === id), role, models, briefText, process.env, { ...bins, model: i === 0 ? opt.model : undefined }));
      if (opt.tool) plan = plans[0];
      else {
        // Decided before anything starts: a tool that starts and fails is never retried on another.
        const pick = plans.findIndex((p) => !unavailable(p));
        if (pick < 0) {
          chain.forEach((id, i) => io.err(`dispatch: ${id} unavailable (${unavailable(plans[i])})`));
          return fail(`dispatch: no tool available for ${role.name} (${chain.join(', ')}); nothing started`);
        }
        for (let i = 0; i < pick; i++) io.err(`dispatch: ${chain[i]} unavailable (${unavailable(plans[i])}); falling back to ${chain[i + 1]}`);
        if (pick > 0 && opt.model) io.err(`dispatch: --model ${opt.model} dropped (it was for ${chain[0]}); ${chain[pick]} runs its ${role.tier} model`);
        plan = plans[pick];
      }
    } catch (e) {
      return fail(e.message);
    }
    if (plan.error) return fail(plan.error);
    const tooBig = argvProblem(plan);
    if (tooBig) return fail(`dispatch refused: ${tooBig}; nothing started`);
    io.out(formatCommand(plan));
    if (opt['dry-run']) return 0;
    if (plan.exe.reason) return fail(`cannot run ${plan.toolId}: ${plan.exe.reason}`);
    if (plan.exe.missing) return fail(`cannot run ${plan.command}: not found${plan.exe.shim ? ' (only a .cmd/.bat shim)' : ''}; set ${binEnv(plan.toolId)} to its full path`);
    return runDispatch(plan, { timeoutSec, err: io.err });
  }

  if (cmd === 'hooks') {
    if (!opt.home) return fail('hooks needs --home <dir> (no default)');
    const home = path.resolve(opt.home);
    const source = path.join(repo, 'adapters', 'claude-code', opt.node ? 'hooks.node.example.json' : 'settings.example.json');
    const target = path.join(home, '.claude', 'settings.json');
    const unsafe = escapes(home, '.claude', target);
    if (unsafe) return fail(`hooks: ${unsafe}; nothing written`);
    const hooksMismatch = setupCheckoutMismatch(readSetupCheckout());
    if (hooksMismatch) io.err(`WARN ${hooksMismatch}`);
    try {
      const { original, bom, settings } = readSettings(target);
      const { merged, added, stale } = mergeHooks(settings, JSON.parse(read(source)), home, SETUP);
      for (const s of stale) {
        io.out(`stale ${s.event}${s.matcher ? ` [${s.matcher}]` : ''} (replace by hand; not duplicated): ${s.oldCommand}`);
        io.out(`  -> ${s.command}`);
      }
      if (!added.length) {
        io.out(
          stale.length
            ? `nothing added: ${stale.length} stale hook(s) still point at .claude/tools/worklog or .claude/tools/peon in ${target}; replace them with the paths above`
            : `nothing to add: every hook in ${path.basename(source)} is already in ${target}`,
        );
        return 0;
      }
      for (const a of added) {
        io.out(`${opt.apply ? 'added' : 'would add'} ${a.event}${a.matcher ? ` [${a.matcher}]` : ''}: ${a.command}`);
        if (a.otherMatchers?.length) io.out(`  note: the same command already runs under matcher ${a.otherMatchers.map((m) => JSON.stringify(m)).join(', ')}; that entry is left as it is`);
      }
      // A hook whose script is not at the path it names fails on every call; say so before it is wired.
      const scripts = [...new Set(added.map((a) => /"([^"]+\.(?:ps1|mjs))"/.exec(a.command)?.[1]).filter(Boolean))];
      for (const s of scripts.filter((p) => !fs.existsSync(p))) {
        io.err(`WARN hook script not found: ${s} (install --tool claude-code --apply copies the guard and board-reminder scripts; copy any other by hand)`);
      }
      if (original !== null && formatLike(original, settings) !== original) {
        io.err(`WARN ${target} is not in plain indented JSON layout; writing it re-indents the existing content (values and order unchanged)`);
      }
      if (!opt.apply) {
        io.out(`dry run: ${original === null ? 'would create' : 'would update'} ${target}; add --apply to write`);
        return 0;
      }
      const backup = original === null ? null : `${target}.orc-backup-${stamp(io.now ? io.now() : new Date())}`;
      writeSettings(target, bom + formatLike(original, merged), backup);
      if (backup) io.out(`backed up: ${backup}`);
      io.out(`${original === null ? 'created' : 'updated'} ${target}`);
      return 0;
    } catch (e) {
      return fail(`hooks: ${e.message}`);
    }
  }

  if (cmd === 'doctor') {
    const home = path.resolve(opt.home ?? os.homedir());
    return runDoctor({ repo, home, json: Boolean(opt.json), io }, { loadAdapters, loadRoles, loadModels, compareInstall, isArtifactBoard });
  }

  if (cmd === 'standards') {
    return runStandards(opt, io, { archiveDir: path.join(DEFAULT_REPO, 'standards'), when: stamp(io.now ? io.now() : new Date()), cap: io.standardsCap, readdir: io.standardsReaddir });
  }

  return fail(USAGE);
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
