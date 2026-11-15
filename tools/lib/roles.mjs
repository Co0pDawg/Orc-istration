import { parse } from './frontmatter.mjs';

export const ALL_CAPABILITIES = ['list', 'search', 'read', 'shell', 'edit', 'web-fetch', 'web-search'];
const TIERS = ['low', 'mid', 'high'];
const EFFORTS = ['low', 'medium', 'high'];
const ACCESS = ['read-only', 'write'];

export function parseRole(text, source = 'role') {
  const { data, body } = parse(text);
  const fail = (msg) => {
    throw new Error(`${source}: ${msg}`);
  };
  for (const key of ['name', 'description', 'tier', 'access']) {
    if (typeof data[key] !== 'string' || data[key] === '') fail(`missing ${key}`);
  }
  if (!/^[a-z0-9_-]+$/.test(data.name)) fail(`bad name ${data.name}`);
  if (!TIERS.includes(data.tier)) fail(`unknown tier ${data.tier}`);
  if (!ACCESS.includes(data.access)) fail(`unknown access ${data.access}`);
  if (data.effort !== undefined && !EFFORTS.includes(data.effort)) fail(`unknown effort ${data.effort}`);
  if (!Array.isArray(data.capabilities) || data.capabilities.length === 0) fail('capabilities must be a list');
  for (const c of data.capabilities) if (!ALL_CAPABILITIES.includes(c)) fail(`unknown capability ${c}`);
  const known = ['name', 'description', 'tier', 'effort', 'access', 'capabilities'];
  for (const k of Object.keys(data)) if (!known.includes(k)) fail(`unknown key ${k}`);
  return { ...data, body };
}
