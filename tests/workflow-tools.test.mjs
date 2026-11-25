// The commands the workflows run in place of shell snippets: pr-size (workflows/peer-review.md, once
// peer-review-score.sh), text-check (workflows/draft-pr.md), poll (workflows/fix-ci.md) and now (the board's clock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isolateHome } from './helpers.mjs';
import { main, isoNow } from '../tools/orc.mjs';
import { score, tierOf, riskPaths } from '../tools/lib/prsize.mjs';
import { textCheck } from '../tools/lib/textcheck.mjs';
import { pollUntil } from '../tools/lib/poll.mjs';

// No test in this file can reach the real home folder.
isolateHome();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `orc-${name}-`));

async function run(argv) {
  const out = [];
  const err = [];
  const code = await main(argv, { out: (s) => out.push(s), err: (s) => err.push(s), stdin: () => '' });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

function git(dir, ...args) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8', shell: false });
  assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';

// A repo whose `feat` branch adds product, test, doc, generated, vendored and binary files and renames a file.
function scoredRepo() {
  const dir = tempDir('prsize');
  git(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'tools'));
  fs.writeFileSync(path.join(dir, 'tools', 'a.mjs'), lines(30));
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'checkout', '-qb', 'feat');
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  put('src/Payment.cs', lines(40));
  put('src/my file.cs', lines(20));
  put('src/Auth.Tests/AuthTests.cs', lines(9));
  put('tests/a.test.mjs', lines(11));
  put('docs/guide.txt', lines(12));
  put('Notes.md', lines(4));
  put('package-lock.json', lines(500));
  put('yarn.lock', lines(40));
  put('web/app.min.js', lines(50));
  put('web/vendor/lib.js', lines(60));
  put('img.bin', Buffer.from([0, 1, 2, 3, 0]));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'feat');
  // main moves on after feat branched: the three-dot range leaves this out, a two-dot diff would count it.
  git(dir, 'checkout', '-q', 'main');
  put('src/MainOnly.cs', lines(30));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'main moves on');
  return dir;
}

// ---------- pr-size ----------

test('pr-size score: the three path classes, binary rows skipped, a quarter of tests and docs capped at 1000', () => {
  const numstat = [
    '10\t2\tsrc/app.js',
    '-\t-\tlogo.png',
    '20\t0\ttests/app.test.js',
    '6\t0\ttest/x.js',
    '4\t4\tsrc/Api.Tests/x.cs',
    '3\t1\tlib/thing_test.go',
    '8\t0\tdocs/setup.txt',
    '2\t2\tREADME.md',
    '5\t0\t{tools => tests}/moved.mjs',
    '',
  ].join('\n');
  assert.deepStrictEqual(score(numstat), { product: 17, tests: 38, docs: 12, score: 29, tier: 'S' });
  // A rename is classed by the first token of its path, the old side, as awk's $3 did.
  assert.strictEqual(score('1\t0\ttests/{a.mjs => b.mjs}\n').tests, 1);
  assert.strictEqual(score('1\t0\t{tools => tests}/x.mjs\n').product, 1);
  assert.deepStrictEqual(score(''), { product: 0, tests: 0, docs: 0, score: 0, tier: 'S' });
  assert.strictEqual(score('0\t10000\ttests/big.test.js\n').score, 1000, 'the quarter is capped at 1000');
});

test('pr-size tiers: S up to 100, M up to 400, L up to 1500, else XL', () => {
  for (const [s, tier] of [[0, 'S'], [100, 'S'], [101, 'M'], [400, 'M'], [401, 'L'], [1500, 'L'], [1501, 'XL']]) {
    assert.strictEqual(tierOf(s), tier, String(s));
    assert.strictEqual(score(`${s}\t0\tsrc/x.js\n`).tier, tier, `score ${s}`);
  }
});

test('pr-size risk paths: product paths only, matched case-insensitively', () => {
  const names = 'src/Payment.cs\ntests/payment.test.js\ndocs/payment.md\nsrc/Admin/Users.cs\nsrc/other.cs\n';
  assert.deepStrictEqual(riskPaths(names, 'payment|/admin/'), ['src/Payment.cs', 'src/Admin/Users.cs']);
});

test('pr-size on a real repo: exclusions, binary, risk lines, an empty diff, a missing ref and a bad regex', async () => {
  const dir = scoredRepo();
  const r = await run(['pr-size', '--repo-dir', dir, '--base', 'main', '--head', 'feat', '--sensitive', 'PAYMENT|my file|auth']);
  assert.strictEqual(r.code, 0, r.err);
  // product: Payment 40 + my file 20 (the lock files, app.min.js and web/vendor/ are excluded, img.bin is binary);
  // tests: Auth.Tests 9 + a.test 11 = 20; docs: guide 12 + Notes 4 = 16; score 60 + floor(36 / 4).
  assert.strictEqual(r.out, ['product=60 tests=20 docs=16 score=69 size_tier=S', 'risk: src/Payment.cs', 'risk: src/my file.cs'].join('\n'));
  const plain = await run(['pr-size', '--repo-dir', dir, '--base', 'main', '--head', 'feat']);
  assert.strictEqual(plain.out, 'product=60 tests=20 docs=16 score=69 size_tier=S', 'no --sensitive, no risk lines');
  const empty = await run(['pr-size', '--repo-dir', dir, '--base', 'feat', '--head', 'feat', '--sensitive', 'x']);
  assert.strictEqual(empty.code, 0);
  assert.strictEqual(empty.out, 'product=0 tests=0 docs=0 score=0 size_tier=S');
  const missing = await run(['pr-size', '--repo-dir', dir, '--base', 'origin/nope', '--head', 'feat']);
  assert.strictEqual(missing.code, 1);
  assert.match(missing.err, /^pr-size: git diff --numstat -M failed: /);
  assert.strictEqual(missing.out, '');
  const bad = await run(['pr-size', '--repo-dir', dir, '--base', 'main', '--head', 'feat', '--sensitive', '(']);
  assert.strictEqual(bad.code, 1);
  assert.match(bad.err, /^pr-size: --sensitive "\(" is not a valid regular expression \(.+\)$/);
  assert.strictEqual(bad.err.split('\n').length, 1, 'one line');
  // A folder that does not exist, or is not a git repository: one line, not a spawn error or git's usage text.
  for (const where of [path.join(tempDir('prsize'), 'gone'), tempDir('prsize-plain')]) {
    const r2 = await run(['pr-size', '--repo-dir', where, '--base', 'main', '--head', 'feat']);
    assert.strictEqual(r2.code, 1);
    assert.strictEqual(r2.err, `pr-size: ${where} is not a git repository`);
    assert.strictEqual(r2.out, '');
  }
  assert.strictEqual((await run(['pr-size', '--repo-dir', dir, '--base', 'main'])).code, 1, '--head is required');
  assert.match((await run(['review-tier', '--head', 'x'])).err, /--head and --sensitive apply to pr-size only/);
});

test('workflows/peer-review-score.sh is gone and peer-review.md runs pr-size', () => {
  assert.ok(!fs.existsSync(path.join(REPO, 'workflows', 'peer-review-score.sh')));
  const text = fs.readFileSync(path.join(REPO, 'workflows', 'peer-review.md'), 'utf8');
  assert.match(text, /tools\/orc\.mjs pr-size --base origin\/<target> --head origin\/<source>/);
  assert.doesNotMatch(text, /peer-review-score|Git Bash/);
});

// ---------- text-check ----------

test('text-check counts words as wc -w does and bytes as the file length', () => {
  const buf = Buffer.from('one  two\tthree\r\nfour five\n\n  six\n', 'utf8');
  // U+00A0 is not ASCII whitespace, so four five is one word, as in wc -w under the C locale.
  assert.deepStrictEqual(textCheck(buf).out, [`words=5 bytes=${buf.length}`]);
  assert.strictEqual(buf.length, 34, 'U+00A0 is two bytes');
  assert.deepStrictEqual(textCheck(Buffer.from('')).out, ['words=0 bytes=0']);
});

test('text-check --ascii names each line outside printable ASCII; a CRLF file and a tab are not offenders', async () => {
  const dir = tempDir('textcheck');
  const file = path.join(dir, 'pr.md');
  fs.writeFileSync(file, 'Title - plain\r\n\tindented with a tab\r\nA dash — here\r\n"quotes" and “curly”\r\nlast line\r\n');
  const r = await run(['text-check', file, '--ascii']);
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.out, ['words=16 bytes=' + fs.statSync(file).size, 'non-ascii: 3: A dash — here', 'non-ascii: 4: "quotes" and “curly”'].join('\n'));
  assert.strictEqual(r.err, 'text-check: 2 line(s) hold a character outside printable ASCII');
  fs.writeFileSync(file, 'Plain text,\r\n\twith a tab.\r\n');
  const clean = await run(['text-check', file, '--ascii', '--max-words', '5', '--max-bytes', '100']);
  assert.strictEqual(clean.code, 0, clean.err);
  assert.strictEqual(clean.out, 'words=5 bytes=27');
  assert.strictEqual(clean.err, '');
  // Without --ascii a non-ASCII character is not checked.
  fs.writeFileSync(file, 'café\n');
  assert.strictEqual((await run(['text-check', file])).code, 0);
});

test('text-check limits: one stderr line naming what was exceeded', async () => {
  const dir = tempDir('textcheck');
  const file = path.join(dir, 'pr.md');
  fs.writeFileSync(file, 'one two three four\n');
  const words = await run(['text-check', file, '--max-words', '3']);
  assert.strictEqual(words.code, 1);
  assert.strictEqual(words.out, 'words=4 bytes=19');
  assert.strictEqual(words.err, 'text-check: 4 words, over the limit of 3');
  const both = await run(['text-check', file, '--max-words', '3', '--max-bytes', '10']);
  assert.strictEqual(both.err, 'text-check: 4 words, over the limit of 3; 19 bytes, over the limit of 10');
  assert.strictEqual((await run(['text-check', file, '--max-words', '4', '--max-bytes', '19'])).code, 0, 'at the limit passes');
  assert.match((await run(['text-check', file, '--max-words', 'x'])).err, /--max-words needs a whole number, got x/);
  assert.match((await run(['text-check', path.join(dir, 'none.md')])).err, /text-check: no file at /);
  assert.strictEqual((await run(['text-check'])).code, 1);
  assert.match((await run(['pr-size', '--ascii'])).err, /--max-words, --max-bytes and --ascii apply to text-check only/);
});

test('text-check on a real pull request description: the newest merge commit body', async () => {
  const body = spawnSync('git', ['log', '--merges', '-1', '--format=%B'], { cwd: REPO, encoding: 'utf8' }).stdout;
  if (!body.trim()) return;
  const file = path.join(tempDir('textcheck'), 'merge.md');
  fs.writeFileSync(file, body);
  const r = await run(['text-check', file, '--ascii']);
  const words = body.split(/[ \t\n\r\v\f]+/).filter(Boolean).length;
  assert.strictEqual(r.out.split('\n')[0], `words=${words} bytes=${Buffer.byteLength(body)}`);
  assert.strictEqual(r.code, /[^\t\n\x20-\x7e]/.test(body) ? 1 : 0);
});

// ---------- poll ----------

// A fake clock and command: `results` are the successive runs; sleep advances the clock.
function fakes(results) {
  let t = 0;
  const calls = [];
  return {
    calls,
    now: () => t,
    sleep: async (ms) => {
      calls.push(['sleep', ms]);
      t += ms;
    },
    run: async (argv, limitMs) => {
      calls.push(['run', limitMs]);
      t += 10;
      return results.length > 1 ? results.shift() : results[0];
    },
  };
}

test('poll retries a run that exits non-zero, and stops on the first matching stdout', async () => {
  const f = fakes([
    { code: 1, stdout: '{"status":"completed","result":"failed"}', stderr: 'transient' },
    { code: 0, stdout: '{"status":"inProgress"}\n', stderr: '' },
    { code: 0, stdout: '  {"status":"completed","result":"succeeded"}\n', stderr: '' },
  ]);
  const r = await pollUntil({ argv: ['helper'], everyMs: 300000, until: /"status"\s*:\s*"completed"/, ...f });
  assert.deepStrictEqual(r, { code: 0, out: '{"status":"completed","result":"succeeded"}' });
  assert.deepStrictEqual(f.calls.map((c) => c[0]), ['run', 'sleep', 'run', 'sleep', 'run'], 'a non-zero exit is not final');
  assert.deepStrictEqual(f.calls.filter((c) => c[0] === 'sleep').map((c) => c[1]), [300000, 300000]);
});

test('poll gives up at the timeout with 124, the last output and the last failure', async () => {
  const f = fakes([{ code: 0, stdout: 'queued\n', stderr: '' }, { code: 2, stdout: 'half', stderr: 'HTTP 503' }]);
  const r = await pollUntil({ argv: ['helper'], everyMs: 60000, until: /completed/, timeoutMs: 90000, ...f });
  assert.strictEqual(r.code, 124);
  assert.strictEqual(r.err, 'poll: timed out after 90s; the last run exited 2; last output:\nhalf\nlast stderr: HTTP 503');
  // Runs at 0 and 60s; the second wait is cut to the deadline, and no run starts at or after it.
  assert.deepStrictEqual(f.calls.map((c) => c[0]), ['run', 'sleep', 'run', 'sleep']);
  assert.strictEqual(f.calls[0][1], 90000, 'a run is killed at the deadline');
  assert.strictEqual(f.calls[3][1], 90000 - 60020);
});

test('poll matches stdout only: the same text on stderr never ends the poll', async () => {
  const f = fakes([{ code: 0, stdout: 'queued\n', stderr: '"status": "completed"\n' }]);
  const r = await pollUntil({ argv: ['helper'], everyMs: 1000, until: /completed/, timeoutMs: 2500, ...f });
  assert.strictEqual(r.code, 124);
  assert.match(r.err, /the last run exited 0 without a match; last output:\nqueued$/);
});

test('poll --timeout kills a command still running at the deadline', async () => {
  const dir = tempDir('poll-hang');
  const pidFile = path.join(dir, 'pid');
  const script = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 30000)`;
  const t0 = Date.now();
  const r = await run(['poll', '--every', '1', '--until', 'never', '--timeout', '1', '--', process.execPath, '-e', script]);
  const took = Date.now() - t0;
  assert.strictEqual(r.code, 124, r.err);
  assert.match(r.err, /^poll: timed out after 1s; the last run was killed at the deadline; last output:\n\(no stdout\)$/);
  assert.ok(took < 15000, `returned after ${took} ms, well before the command would have ended`);
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  let alive = true;
  for (const until = Date.now() + 5000; alive && Date.now() < until;) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch {
      alive = false;
    }
  }
  assert.strictEqual(alive, false, 'the command is gone');
});

test('poll ends at once when the command cannot start', async () => {
  const f = fakes([{ cannotStart: 'nope not found' }]);
  const r = await pollUntil({ argv: ['nope'], everyMs: 1000, until: /x/, ...f });
  assert.deepStrictEqual(r, { code: 1, err: 'poll: cannot start nope: nope not found' });
  assert.deepStrictEqual(f.calls.map((c) => c[0]), ['run']);
});

test('poll CLI: a first-run match prints stdout; the command after -- is never parsed as orc options', async () => {
  const r = await run(['poll', '--every', '5', '--until', '^ready --help$', '--timeout', '30', '--', process.execPath, '-e', 'console.log(" ready " + process.argv[1])', '--', '--help']);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(r.out, 'ready --help');
  const gone = await run(['poll', '--every', '1', '--until', 'x', '--', path.join(tempDir('poll'), 'no-such-helper')]);
  assert.strictEqual(gone.code, 1);
  assert.match(gone.err, /^poll: cannot start .*no-such-helper: /);
  for (const [argv, re] of [
    [['poll', '--every', '0', '--until', 'x', '--', 'node'], /--every needs a whole number of seconds from 1 to 3600, got 0/],
    [['poll', '--every', '3601', '--until', 'x', '--', 'node'], /--every needs a whole number of seconds from 1 to 3600/],
    [['poll', '--every', '1.5', '--until', 'x', '--', 'node'], /--every needs a whole number/],
    [['poll', '--every', '1', '--until', '(', '--', 'node'], /--until is not a valid regular expression/],
    [['poll', '--every', '1', '--until', 'x'], /^usage: poll /],
    [['poll', '--every', '1', '--until', 'x', '--'], /^usage: poll /],
    [['poll', '--every', '1', '--until', 'x', '--timeout', '0', '--', 'node'], /--timeout needs a whole number of seconds from 1 to 86400/],
    [['status', '--', 'x'], /`--` applies to poll only/],
    [['review-tier', '--every', '1'], /--every applies to poll only/],
    [['review-tier', '--until', 'x'], /--until applies to queue and poll only/],
  ]) {
    const bad = await run(argv);
    assert.strictEqual(bad.code, 1, argv.join(' '));
    assert.match(bad.err, re, argv.join(' '));
  }
});

// ---------- now ----------

test('now prints local time with its UTC offset, to the second', async () => {
  const r = await run(['now']);
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  assert.ok(Math.abs(Date.parse(r.out) - Date.now()) < 5000, 'parses back to now');
  const d = new Date(2026, 10, 25, 9, 5, 7);
  const s = isoNow(d);
  assert.strictEqual(s.slice(0, 19), '2026-11-25T09:05:07');
  assert.strictEqual(Date.parse(s), d.getTime() - d.getMilliseconds(), 'the offset is the local one');
  assert.strictEqual((await run(['now', 'extra'])).code, 1);
});
