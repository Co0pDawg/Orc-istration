#!/usr/bin/env node
// Orchestration generator and installer. Node 22+, standard library only.
// build | check | sync | install | models   (see README "Other tools")
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, normalizeEol, isGenerated } from './lib/frontmatter.mjs';
import { parseRole } from './lib/roles.mjs';

const DEFAULT_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Text from a file or stdin: strips a UTF-8 BOM, decodes UTF-16 LE/BE with a BOM (Windows PowerShell 5.1 pipes UTF-16).
export function decodeText(buf) {
  if (typeof buf === 'string') return normalizeEol(buf.replace(/^﻿/, ''));
  let text;
  if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.subarray(2).toString('utf16le');
  else if (buf[0] === 0xfe && buf[1] === 0xff) text = Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  else text = buf.toString('utf8').replace(/^﻿/, '');
  return normalizeEol(text);
}

function read(file) {
  return decodeText(fs.readFileSync(file));
}

export function loadRoles(repo) {
  const dir = path.join(repo, 'roles');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseRole(read(path.join(dir, f)), `roles/${f}`));
}

export function loadModels(repo, { local = true } = {}) {
  const models = JSON.parse(read(path.join(repo, 'models.json')));
  const localFile = path.join(repo, 'models.local.json');
  if (local && fs.existsSync(localFile)) {
    const over = JSON.parse(read(localFile));
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

export function renderNotes(adapter, extra = []) {
  let notes = adapter.notes;
  for (const line of extra) notes += `${line}\n`;
  if (adapter.gaps.length) {
    notes += `\nWhat ${adapter.title} cannot do (generated from the adapter's gaps):\n`;
    for (const g of adapter.gaps) notes += `- ${g}\n`;
  }
  return notes;
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
export function buildTool(adapter, roles, models, agentsMd, { extraNotes = [] } = {}) {
  const errors = [];
  const warnings = [];
  let rulebook = null;
  const tiers = models[adapter.id];
  if (!tiers) return { files: [], errors: [`${adapter.id}: no entry in models.json`], warnings, rulebook };
  const files = [...adapter.renderRulebook(agentsMd, renderNotes(adapter, extraNotes))];
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

async function buildAll(repo, toolId, { local = true, extraNotes = [] } = {}) {
  const roles = loadRoles(repo);
  const models = loadModels(repo, { local });
  const agentsMd = read(path.join(repo, 'AGENTS.md'));
  const adapters = await loadAdapters(repo);
  const picked = !toolId || toolId === 'all' ? adapters : adapters.filter((a) => a.id === toolId);
  if (!picked.length) throw new Error(`unknown tool ${toolId}; known: ${adapters.map((a) => a.id).join(', ')}`);
  return picked.map((adapter) => ({ adapter, ...buildTool(adapter, roles, models, agentsMd, { extraNotes }) }));
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

const VALUE_OPTIONS = ['home', 'tool', 'out', 'board', 'board-repo', 'repo'];

export function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (VALUE_OPTIONS.includes(key)) {
        if (next === undefined || next.trim() === '' || next.startsWith('--')) throw new Error(`--${key} needs a value`);
        out[key] = argv[++i];
      } else out[key] = true;
    } else out._.push(a);
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

  if (cmd === 'build') {
    const outDir = path.resolve(repo, opt.out ?? 'dist');
    const results = await buildAll(repo, opt.tool ?? 'all');
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
    const extraNotes = [];
    if (opt.board) {
      const cli = `${opt['board-repo'].replace(/\\/g, '/')}/local/board.js`;
      const port = /^https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/.exec(opt.board)?.[1];
      const portNote = port ? ` (set \`ORC_BOARD_PORT=${port}\`)` : '';
      extraNotes.push(`- **Board:** this machine's board address is \`${opt.board}\`; write it with \`node "${cli}"\`${portNote}.`);
    } else {
      io.err('WARN the board address is not set: pass --board <address> --board-repo <path> so the rulebook names it');
    }
    const [{ adapter, files, errors }] = await buildAll(repo, toolId, { extraNotes });
    if (errors.length) return fail(errors.join('\n'));
    for (const c of adapter.conflicts ?? []) {
      const other = path.join(home, ...c.path.split('/'));
      if (fs.existsSync(other) && isGenerated(read(other))) {
        io.err(`WARN ${other} is an orc-generated ${c.tool} rulebook in the same folder: ${c.warning}. Remove ${other} unless you also use ${c.tool}.`);
      }
    }
    const when = stamp(io.now ? io.now() : new Date());
    let refused = 0;
    for (const f of files) {
      if (f.install === false) continue;
      const target = path.join(home, ...f.path.split('/'));
      const exists = fs.existsSync(target);
      const current = exists ? read(target) : null;
      let state = !exists ? 'create' : current === normalizeEol(f.content) ? 'unchanged' : 'replace';
      // Only rulebooks and TOML agents carry a marker; any other differing file is treated as hand-written.
      if (state === 'replace' && !isGenerated(current)) state = 'REPLACE HAND-WRITTEN';
      if (opt.apply && state === 'REPLACE HAND-WRITTEN' && !opt.force) {
        io.err(`refused (hand-written; pass --force to replace it, with a backup): ${target}`);
        refused++;
        continue;
      }
      if (opt.apply && state !== 'unchanged') {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (exists) {
          let backup = `${target}.orc-backup-${when}`;
          for (let n = 2; fs.existsSync(backup); n++) backup = `${target}.orc-backup-${when}-${n}`;
          fs.copyFileSync(target, backup);
        }
        fs.writeFileSync(target, f.content);
      }
      const sep = state === 'REPLACE HAND-WRITTEN' ? '' : ':';
      io.out(`${opt.apply ? 'applied' : 'would'} ${state}${sep} ${target}`);
    }
    if (adapter.installNote) io.out(adapter.installNote);
    if (!opt.apply) io.out(`dry run for ${adapter.id}; add --apply to write`);
    return refused ? 1 : 0;
  }

  if (cmd === 'models') {
    if (opt.tool !== 'antigravity' || !opt['from-stdin']) return fail('usage: models --tool antigravity --from-stdin');
    const { fragment, error } = parseAgyModels(decodeText(io.stdin()));
    if (error) return fail(`${error}; paste the output of "agy models"`);
    io.out(JSON.stringify(fragment, null, 2));
    return 0;
  }

  return fail('usage: node tools/orc.mjs build|check|sync|install|models [options]');
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
