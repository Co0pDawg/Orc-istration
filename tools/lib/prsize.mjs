// PR size and review tier for workflows/peer-review.md (`orc pr-size`), once workflows/peer-review-score.sh. Same path
// classes, exclusions, score and tiers. A numstat path is the line's first whitespace token after the counts, as awk's
// $3 was: a rename (`a => b`, `dir/{a => b}/f`) is classed by its old side.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

export const TESTS_RE = /(^|\/)(tests?|__tests__|spec)\/|\.Tests?\/|[._-](test|spec)\.[^/]+$|_test\.[^/]+$/;
export const DOCS_RE = /(^|\/)docs\/|\.md$/;

// Generated and vendored files never count.
const EXCLUDE = [':!*package-lock.json', ':!*.lock', ':!*.min.*', ':!*.Designer.cs', ':!**/vendor/**', ':!**/node_modules/**'];

export const tierOf = (score) => (score <= 100 ? 'S' : score <= 400 ? 'M' : score <= 1500 ? 'L' : 'XL');

// `numstat` is `git diff --numstat -M` output. Binary files (`-` counts) are skipped.
export function score(numstat) {
  let product = 0;
  let tests = 0;
  let docs = 0;
  for (const line of numstat.split('\n')) {
    const f = line.trim().split(/[ \t]+/);
    if (f[0] === '' || f[0] === '-') continue;
    const n = (Number(f[0]) || 0) + (Number(f[1]) || 0);
    const file = f[2] ?? '';
    if (TESTS_RE.test(file)) tests += n;
    else if (DOCS_RE.test(file)) docs += n;
    else product += n;
  }
  // Tests and docs weigh a quarter, capped at 1000; retune from cost-log scores.
  const s = product + Math.min(1000, Math.floor((tests + docs) / 4));
  return { product, tests, docs, score: s, tier: tierOf(s) };
}

export const formatScore = (r) => `product=${r.product} tests=${r.tests} docs=${r.docs} score=${r.score} size_tier=${r.tier}`;

// Non-test, non-doc changed paths matching the sensitive regex (case-insensitive); the caller bumps the tier.
export function riskPaths(names, sensitive) {
  const re = new RegExp(sensitive, 'i');
  return names.split('\n').filter((p) => p !== '' && !TESTS_RE.test(p) && !DOCS_RE.test(p) && re.test(p));
}

function git(repoDir, args) {
  const r = spawnSync('git', args, { cwd: repoDir, encoding: 'utf8', shell: false, maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new Error(`pr-size: git: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`pr-size: git ${args.slice(0, 3).join(' ')} failed: ${(r.stderr || '').trim() || `exit ${r.status}`}`);
  return r.stdout;
}

// Returns the output lines: the score line, then one `risk: <path>` per sensitive hit.
// --sensitive is a JavaScript regular expression (the script used grep -E: POSIX classes such as [[:upper:]] are not
// supported).
export function prSize(repoDir, base, head, sensitive) {
  if (sensitive) {
    try {
      new RegExp(sensitive, 'i');
    } catch (e) {
      const why = (e instanceof Error ? e.message : String(e)).split('\n')[0];
      throw new Error(`pr-size: --sensitive ${JSON.stringify(sensitive)} is not a valid regular expression (${why})`);
    }
  }
  const isDir = fs.existsSync(repoDir) && fs.statSync(repoDir).isDirectory();
  const inside = isDir && spawnSync('git', ['rev-parse', '--git-dir'], { cwd: repoDir, encoding: 'utf8', shell: false }).status === 0;
  if (!inside) throw new Error(`pr-size: ${repoDir} is not a git repository`);
  const range = `${base}...${head}`;
  const lines = [formatScore(score(git(repoDir, ['diff', '--numstat', '-M', range, '--', '.', ...EXCLUDE])))];
  if (sensitive) lines.push(...riskPaths(git(repoDir, ['diff', '--name-only', range]), sensitive).map((p) => `risk: ${p}`));
  return lines;
}
