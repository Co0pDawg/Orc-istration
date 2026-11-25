// The shared state home (~/.orc, or ORC_DATA_DIR): config.json and models.json, read by install, status, dispatch
// and doctor, never by build, check, sync or golden. Reading never creates anything.
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

// Throws one error naming the file and every problem in `config`. Messages name keys, never a value's content.
export function validateConfig(config, { tools, roles, file }) {
  if (!isObject(config)) throw new Error(`${file}: must be a JSON object`);
  const problems = [];
  const tool = (v, where) => {
    if (typeof v !== 'string' || !tools.includes(v)) problems.push(`${where}: not a known tool id (known: ${tools.join(', ')})`);
  };
  for (const k of Object.keys(config)) if (!KEYS.includes(k)) problems.push(`unknown key "${k}" (known: ${KEYS.join(', ')})`);
  if (!Object.hasOwn(config, 'version')) problems.push('version is required (1)');
  else if (config.version !== 1) problems.push('version must be 1');
  if (Object.hasOwn(config, 'activeTools')) {
    const a = config.activeTools;
    if (!Array.isArray(a) || !a.length) problems.push('activeTools: must be a non-empty array of tool ids');
    else {
      a.forEach((t, i) => tool(t, `activeTools[${i}]`));
      if (new Set(a).size !== a.length) problems.push('activeTools: names a tool more than once');
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
      for (const [t, p] of Object.entries(b)) {
        tool(t, 'binaries');
        if (!isText(p) || !path.isAbsolute(p)) problems.push(`binaries.${t}: must be an absolute path`);
      }
    }
  }
  if (Object.hasOwn(config, 'fallback')) tool(config.fallback, 'fallback');
  if (Object.hasOwn(config, 'routing')) {
    const r = config.routing;
    if (!isObject(r)) problems.push('routing: must be an object of role name to tool id or list of tool ids');
    else {
      for (const [role, v] of Object.entries(r)) {
        if (!roles.includes(role)) problems.push(`routing: unknown role "${role}" (known: ${roles.join(', ')})`);
        if (Array.isArray(v)) {
          if (!v.length) problems.push(`routing.${role}: must not be an empty list`);
          v.forEach((t, i) => tool(t, `routing.${role}[${i}]`));
        } else tool(v, `routing.${role}`);
      }
    }
  }
  if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
  return config;
}

// Returns {file, config}; config is null when the file is absent. An unreadable or invalid file throws.
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
  return { file, config: validateConfig(config, { tools, roles, file }) };
}

// The tools a role is routed to, in order: its routing entry, then the fallback, without repeats.
export function routeChain(config, roleName) {
  const entry = config?.routing?.[roleName];
  const chain = [...(entry === undefined ? [] : [entry].flat()), ...(config?.fallback ? [config.fallback] : [])];
  return [...new Set(chain)];
}
