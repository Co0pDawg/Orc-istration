// The shared state home (~/.orc, or ORC_DATA_DIR): config.json and models.json, read by install (and sync,
// which is install --all), status, dispatch and doctor, never by build, check or golden. Reading never creates anything.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readText } from './text.mjs';

// ORC_DATA_DIR when it names a folder; unset, empty or whitespace-only all mean unset, so ~/.orc.
export const orcHome = (env = process.env) => (env.ORC_DATA_DIR?.trim() ? env.ORC_DATA_DIR : path.join(os.homedir(), '.orc'));
export const configFile = (env = process.env) => path.join(orcHome(env), 'config.json');

const KEYS = ['version', 'activeTools', 'setupCheckout', 'board', 'binaries', 'fallback', 'routing'];
const BOARD_KEYS = ['url', 'repo'];
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';

// A JSON.parse message can quote the file's text; only its position is kept.
export const jsonProblem = (e) => {
  const where = /at position \d+(?: \(line \d+ column \d+\))?/.exec(e instanceof Error ? e.message : '')?.[0];
  return where ? `not valid JSON (${where})` : 'not valid JSON';
};

const IGNORED = '(ignored; this checkout does not know it)';

// ~/.orc is shared by every checkout on the machine, so an entry this checkout does not know (a top-level key, a tool
// id, a role name) is dropped from the returned copy with one warning each; any other problem (a wrong type or shape,
// a wrong version, a duplicate, an empty list) throws one error naming the file and every problem. Returns
// {config, warnings}. Messages name keys and role names, never a value's content.
export function validateConfig(config, { tools, roles, file }) {
  if (!isObject(config)) throw new Error(`${file}: must be a JSON object`);
  const problems = [];
  const warnings = [];
  const out = { ...config };
  const warn = (what) => warnings.push(`${file}: ${what} ${IGNORED}`);
  // 'ok', 'unknown' (a string this checkout does not know) or 'bad' (not a string: a problem).
  const tool = (v, where) => {
    if (typeof v !== 'string' || !v.trim()) {
      problems.push(`${where}: must be a tool id (known: ${tools.join(', ')})`);
      return 'bad';
    }
    return tools.includes(v) ? 'ok' : 'unknown';
  };
  // A list of tool ids without the unknown ones, one warning each. When none is left, the last warning says that
  // `entry` is dropped, and the caller drops it.
  const known = (list, where, entry) => {
    const states = list.map((t, i) => tool(t, `${where}[${i}]`));
    const kept = list.filter((_, i) => states[i] === 'ok');
    const unknown = states.flatMap((s, i) => (s === 'unknown' ? [i] : []));
    unknown.forEach((i, n) => {
      const last = n === unknown.length - 1 && !kept.length;
      warn(`${where}[${i}]: not a known tool id${last ? `, and no known tool is left, so ${entry} is dropped` : ''}`);
    });
    return kept;
  };
  for (const k of Object.keys(config)) {
    if (!KEYS.includes(k)) {
      warn(`unknown key "${k}"`);
      delete out[k];
    }
  }
  if (!Object.hasOwn(config, 'version')) problems.push('version is required (1)');
  else if (config.version !== 1) problems.push('version must be 1');
  if (Object.hasOwn(config, 'activeTools')) {
    const a = config.activeTools;
    if (!Array.isArray(a) || !a.length) problems.push('activeTools: must be a non-empty array of tool ids');
    else {
      if (new Set(a).size !== a.length) problems.push('activeTools: names a tool more than once');
      const kept = known(a, 'activeTools', 'activeTools');
      if (!kept.length) delete out.activeTools;
      else if (kept.length !== a.length) out.activeTools = kept;
    }
  }
  if (Object.hasOwn(config, 'setupCheckout') && !isText(config.setupCheckout)) problems.push('setupCheckout: must be a path');
  if (Object.hasOwn(config, 'board')) {
    const b = config.board;
    if (!isObject(b)) problems.push('board: must be an object with url and repo');
    else {
      for (const k of Object.keys(b)) if (!BOARD_KEYS.includes(k)) problems.push(`board: unknown key "${k}" (known: ${BOARD_KEYS.join(', ')})`);
      if (!isText(b.url)) problems.push('board.url: must be the board address');
      if (Object.hasOwn(b, 'repo') && !isText(b.repo)) problems.push('board.repo: must be a path');
    }
  }
  if (Object.hasOwn(config, 'binaries')) {
    const b = config.binaries;
    if (!isObject(b)) problems.push('binaries: must be an object of tool id to executable path');
    else {
      const kept = {};
      for (const [t, p] of Object.entries(b)) {
        if (!tools.includes(t)) {
          warn(`binaries: "${t}" is not a known tool id`);
          continue;
        }
        if (!isText(p) || !path.isAbsolute(p)) problems.push(`binaries.${t}: must be an absolute path`);
        kept[t] = p;
      }
      out.binaries = Object.keys(kept).length === Object.keys(b).length ? b : kept;
    }
  }
  if (Object.hasOwn(config, 'fallback') && tool(config.fallback, 'fallback') === 'unknown') {
    warn('fallback: not a known tool id');
    delete out.fallback;
  }
  if (Object.hasOwn(config, 'routing')) {
    const r = config.routing;
    if (!isObject(r)) problems.push('routing: must be an object of role name to tool id or list of tool ids');
    else {
      const kept = {};
      for (const [role, v] of Object.entries(r)) {
        if (!roles.includes(role)) {
          warn(`routing: unknown role "${role}"`);
          continue;
        }
        if (Array.isArray(v)) {
          if (!v.length) {
            problems.push(`routing.${role}: must not be an empty list`);
            continue;
          }
          if (new Set(v).size !== v.length) problems.push(`routing.${role}: names a tool more than once`);
          const list = known(v, `routing.${role}`, `the routing.${role} entry`);
          if (list.length) kept[role] = list.length === v.length ? v : list;
        } else {
          const s = tool(v, `routing.${role}`);
          if (s === 'ok') kept[role] = v;
          else if (s === 'unknown') warn(`routing.${role}: not a known tool id, so the routing.${role} entry is dropped`);
        }
      }
      out.routing = kept;
    }
  }
  if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
  return { config: out, warnings };
}

// Returns {file, config, warnings}, or exactly {file, config: null} when the file is absent. `warnings` lists the
// entries this checkout does not know, already dropped from `config`; the caller prints each once. An unreadable or
// invalid file throws.
export function loadConfig({ tools, roles, env = process.env }) {
  const file = configFile(env);
  if (!fs.existsSync(file)) return { file, config: null };
  let text;
  try {
    text = readText(file);
  } catch (e) {
    throw new Error(`${file}: cannot read (${e instanceof Error && 'code' in e ? e.code : 'error'})`);
  }
  let config;
  try {
    config = JSON.parse(text);
  } catch (e) {
    throw new Error(`${file}: ${jsonProblem(e)}`);
  }
  return { file, ...validateConfig(config, { tools, roles, file }) };
}

// The board default config.json gives `--all` and doctor: null with no board, {error} for a local address with no
// repo, else {board, boardRepo, file}. `isArtifactBoard` is install's own test for an artifact address.
export function boardDefault(config, file, isArtifactBoard) {
  const b = config?.board;
  if (!b) return null;
  if (!b.repo && !isArtifactBoard(b.url)) return { error: `${file}: board.repo is needed with the local board address in board.url` };
  return { board: b.url, boardRepo: b.repo ?? null, file };
}

// The tools a role is routed to, in order: its routing entry, then the fallback, without repeats.
export function routeChain(config, roleName) {
  const entry = config?.routing?.[roleName];
  const chain = [...(entry === undefined ? [] : [entry].flat()), ...(config?.fallback ? [config.fallback] : [])];
  return [...new Set(chain)];
}
