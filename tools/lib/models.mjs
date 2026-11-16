// models.json / models.local.json validation: tool ids are the adapters, tiers are low|mid|high plus `headless`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OWN_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const TIERS = ['low', 'mid', 'high'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const TIER_KEYS = ['model', 'effort'];

// The repo's adapters; a models-only copy (no adapters/ folder) falls back to this checkout's adapters.
export function knownTools(repo) {
  let dir = path.join(repo, 'adapters');
  if (!fs.existsSync(dir)) dir = path.join(OWN_REPO, 'adapters');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4)).sort();
}

// Throws one error naming every problem in `models` (parsed from `file`).
export function validateModels(models, tools, file) {
  const problems = [];
  if (!models || typeof models !== 'object' || Array.isArray(models)) throw new Error(`${file}: must be a JSON object`);
  for (const [tool, tiers] of Object.entries(models)) {
    if (!tools.includes(tool)) {
      problems.push(`unknown tool id "${tool}" (known: ${tools.join(', ')})`);
      continue;
    }
    if (!tiers || typeof tiers !== 'object' || Array.isArray(tiers)) {
      problems.push(`${tool}: must be an object of tiers`);
      continue;
    }
    for (const [tier, value] of Object.entries(tiers)) {
      if (tier === 'headless') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) problems.push(`${tool}.headless: must be an object of tier slugs`);
        else for (const [t, slug] of Object.entries(value)) {
          if (!TIERS.includes(t)) problems.push(`${tool}.headless: unknown tier key "${t}" (known: ${TIERS.join(', ')})`);
          else if (typeof slug !== 'string') problems.push(`${tool}.headless.${t}: model must be a string`);
        }
        continue;
      }
      if (!TIERS.includes(tier)) {
        problems.push(`${tool}: unknown tier key "${tier}" (known: ${TIERS.join(', ')}, headless)`);
        continue;
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        problems.push(`${tool}.${tier}: must be an object`);
        continue;
      }
      for (const [k, v] of Object.entries(value)) {
        if (!TIER_KEYS.includes(k)) problems.push(`${tool}.${tier}: unknown key "${k}"`);
        else if (typeof v !== 'string') problems.push(`${tool}.${tier}.${k}: must be a string`);
        else if (k === 'effort' && !EFFORTS.includes(v)) problems.push(`${tool}.${tier}.effort: "${v}" is not one of ${EFFORTS.join(', ')}`);
      }
    }
  }
  if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
}
