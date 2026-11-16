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

export const isLightPath = (p) => LIGHT_PATTERNS.some(({ re }) => re.test(p.replace(/\\/g, '/')));

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

export function reviewTier(repoDir, base) {
  return classify(changedPaths(repoDir, base));
}
