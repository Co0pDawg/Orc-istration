// Pre-PR review tier from the changed paths. The rule lives in AGENTS.md "Pre-PR review tiers", condition 1
// ("diff is tests/docs only"); keep this table in step with it. Conditions 2 and 3 need a refuter and cannot be computed.
import { spawnSync } from 'node:child_process';

export const LIGHT_PATTERNS = [
  { kind: 'test', re: /(^|\/)(tests|test|__tests__|spec)\// },
  { kind: 'test', re: /(^|\/)[^/]+\.(test|spec)\.[^/]+$/ },
  { kind: 'test', re: /(^|\/)[^/]+_test\.[^/]+$/ },
  { kind: 'doc', re: /\.md$/i },
  { kind: 'doc', re: /(^|\/)docs\// },
];

// Prompts are product in this repo: rulebooks, roles, agent files, tool folders, profiles, adapter notes and skills
// decide behaviour, and so do the standards archive, its setup procedure, the sprint procedure, the review panel,
// the workflows and the command wrappers, so they force Full even though most are Markdown.
export const PRODUCT_PATTERNS = [
  /(^|\/)(AGENTS|CLAUDE|GEMINI|SKILL)\.md$/i,
  /(^|\/)[^/]+\.agent\.md$/i,
  /^(roles|agents|profiles|review|workflows|commands|\.claude|\.agents|\.codex|\.cursor|\.gemini)\//,
  /^adapters\/[^/]+\.notes\.md$/,
  /^standards\//,
  /^orchestration\/(standards|sprint)\.md$/,
];

export const isLightPath = (p) => {
  const n = p.replace(/\\/g, '/');
  return !PRODUCT_PATTERNS.some((re) => re.test(n)) && LIGHT_PATTERNS.some(({ re }) => re.test(n));
};

export function classify(paths) {
  const deciding = paths.filter((p) => !isLightPath(p));
  if (!paths.length) return { tier: 'Light-eligible', reason: 'no changed paths' };
  if (!deciding.length) return { tier: 'Light-eligible', reason: `all ${paths.length} changed path(s) are tests or docs` };
  const more = deciding.length > 3 ? ` and ${deciding.length - 3} more` : '';
  return { tier: 'Full', reason: `not tests or docs: ${deciding.slice(0, 3).join(', ')}${more}` };
}

// --no-renames lists a rename as a delete plus an add, so a product file renamed into tests/ still counts.
export function changedPaths(repoDir, base) {
  const r = spawnSync('git', ['diff', '--name-only', '--no-renames', `${base}...HEAD`], { cwd: repoDir, encoding: 'utf8', shell: false });
  if (r.error) throw new Error(`git: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git diff ${base}...HEAD failed: ${r.stderr.trim()}`);
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

// Uncommitted changes are not in base...HEAD, so the tier would ignore them.
export function uncommitted(repoDir) {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: repoDir, encoding: 'utf8', shell: false });
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean).length : 0;
}

export function reviewTier(repoDir, base) {
  const n = uncommitted(repoDir);
  const warning = n ? `${n} uncommitted change(s) are not in ${base}...HEAD and are not classified; commit them first` : null;
  return { ...classify(changedPaths(repoDir, base)), warning };
}
