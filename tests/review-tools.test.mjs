// calibration, corpus and metrics: synthetic run logs (tests/fixtures/reviews), the regression corpus
// (tests/fixtures/corpus) and a synthetic Claude Code session (tests/fixtures/transcripts/proj/sess-1: a main thread,
// a builder, a refuter and a review-verifier).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../tools/orc.mjs';
import { parseRunLog, verdictOf, sourceOf, calibrationReport, aggregate, precision } from '../tools/lib/calibration.mjs';
import { parseExpected } from '../tools/lib/corpus.mjs';
import { readTranscript, measureAgent, redactPath, agentResult, loopOutcomes, findingsFromLog, runReport, findTranscript, cost, metricsReport, loadRuns, isoWeek } from '../tools/lib/metrics.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(REPO, 'tests', 'fixtures');
const REVIEWS = path.join(FIX, 'reviews');
const PROJ = path.join(FIX, 'transcripts', 'proj');
const MAIN = path.join(PROJ, 'sess-1.jsonl');
const ROOTS = ['/work/acmeapp'];
const t0 = Date.UTC(2026, 0, 9, 12, 0, 0);
const at = (min) => t0 + min * 60000;
const tempDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `orc-${name}-`));

async function run(argv) {
  const out = [];
  const err = [];
  const code = await main(argv, { out: (s) => out.push(s), err: (s) => err.push(s), stdin: () => '' });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

// ---------- calibration ----------

test('parseRunLog reads finding tables only, splits merged lanes and escaped pipes', () => {
  const log = parseRunLog(fs.readFileSync(path.join(REVIEWS, '2026-01-05-feature-101-login.md'), 'utf8').replace(/\r\n/g, '\n'));
  assert.equal(log.rows.length, 6, 'the "vs Run 1" table is not a finding table');
  assert.deepEqual(log.leads, { raised: 3, confirmed: 1, plausible: 1, refuted: 1 });
  assert.deepEqual(log.rows[0].lanes, ['code-reviewer', 'silent-failure-hunter']);
  assert.equal(log.rows[2].kind, 'wontFix', 'a `\\|` inside the Verdict cell does not split it');
  assert.equal(log.rows[2].verdict, 'wont-fix — local-only profile, `dev \\|\\| test` builds');
  assert.deepEqual(log.rows.map((r) => r.kind), ['confirmed', 'falsePositive', 'wontFix', 'notActioned', 'pending', 'nonCanonical']);
});

test('verdictOf takes the canonical prefixes and nothing else', () => {
  assert.equal(verdictOf('CONFIRMED (code read)'), 'confirmed');
  assert.equal(verdictOf('**false-positive** — x'), 'falsePositive');
  assert.equal(verdictOf("won't-fix — x"), 'wontFix');
  assert.equal(verdictOf('_pending_'), 'pending');
  assert.equal(verdictOf(''), 'pending');
  assert.equal(verdictOf('fixed'), 'nonCanonical');
});

test('calibration aggregates per lane, flags low precision and false-positive targets, skips non-logs', async () => {
  const r = await run(['calibration', '--logs', REVIEWS]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /4 run log\(s\) parsed, 1 skipped, 20 finding\(s\)\. Triaged verdicts \(confirmed, false-positive, wont-fix\): 17\./);
  // The precision gate: 4 confirmed + false-positive verdicts show n/a, 5 show a percentage.
  assert.match(r.out, /\| type-design-analyzer \| 4 \| 3 \| 1 \| 0 \| 0 \| 0 \| n\/a \| {2}\|/);
  assert.match(r.out, /\| pr-test-analyzer \| 5 \| 4 \| 1 \| 0 \| 0 \| 0 \| 80% \| {2}\|/);
  // code-reviewer: 5 + 1 rows; confirmed 3 (1, 4, 5 of export + login 1), fp 4, wont-fix 1, pending 1.
  assert.match(r.out, /\| code-reviewer \| 9 \| 3 \| 4 \| 1 \| 0 \| 1 \| 43% \| below threshold; 4 false positives \|/);
  assert.match(r.out, /\| silent-failure-hunter \| 1 \| 1 \| 0 \| 0 \| 0 \| 0 \| n\/a \| {2}\|/, 'under 5 verdicts: no precision');
  assert.match(r.out, /\| comment-analyzer \| 2 \| 0 \| 0 \| 0 \| 1 \| 1 \| n\/a \| {2}\|/);
  assert.match(r.out, /- 1 x `fixed`/);
  assert.match(r.out, /- notes\.md: not a run log/);
  const strict = await run(['calibration', '--logs', REVIEWS, '--min-precision', '0.4']);
  assert.match(strict.out, /\| code-reviewer \| 9 \| 3 \| 4 \| 1 \| 0 \| 1 \| 43% \| 4 false positives \|/);
});

test('sourceOf: (agent) anywhere in the cell is the agent, otherwise the developer; verdictOf ignores the suffix', () => {
  assert.equal(sourceOf('confirmed — fixed in session (agent)'), 'agent');
  assert.equal(sourceOf('false-positive — x (Developer)'), 'developer');
  assert.equal(sourceOf('confirmed'), 'developer');
  assert.equal(sourceOf('CONFIRMED (code read)'), 'developer', 'only the two source words are a suffix');
  assert.equal(sourceOf('confirmed (agent) — later note'), 'agent', '(agent) anywhere in the cell marks the agent');
  assert.equal(sourceOf('false-positive (AGENT): refuted by verifier'), 'agent');
  assert.equal(sourceOf('confirmed (developer) — later note'), 'developer');
  assert.equal(verdictOf('confirmed (agent) — later note'), 'confirmed');
  assert.equal(verdictOf('false-positive — refuted by verifier: guard at a.js:3 (agent)'), 'falsePositive');
  assert.equal(verdictOf('_pending_ (agent)'), 'pending');
  assert.equal(verdictOf('(developer)'), 'pending');
});

const RECALL = path.join(REVIEWS, 'recall');
const RECALL_LOG = path.join(RECALL, '2026-02-02-feature-201-sync.md');

test('parseRunLog reads the escaped-defects table, keeps an escaped pipe in its cell, and ignores Runtime checks', () => {
  const log = parseRunLog(fs.readFileSync(RECALL_LOG, 'utf8').replace(/\r\n/g, '\n'));
  assert.equal(log.rows.length, 8, 'the Runtime checks rows are not findings');
  assert.deepEqual(log.rows.map((r) => r.source), ['developer', 'developer', 'agent', 'agent', 'developer', 'developer', 'developer', 'developer']);
  assert.equal(log.escapes.length, 3, 'the Runtime checks rows are not escapes');
  assert.deepEqual(log.escapes.map((e) => e.lanes), [['code-reviewer'], ['code-reviewer'], ['silent-failure-hunter']]);
  assert.equal(log.escapes[0].defect, 'Merge reads `a \\|\\| b` with the wrong precedence');
  assert.deepEqual([log.escapes[0].where, log.escapes[0].foundBy, log.escapes[0].why], ['src/AcmeApp/Merge.cs:22', 'teammate', 'outside the changed hunk']);
  assert.deepEqual(log.leads, { raised: 2, confirmed: 1, plausible: 0, refuted: 1 }, 'the Verification: line is not the Leads: line');
  assert.deepEqual(log.verification, { checked: 5, confirmed: 4, plausible: 0, refuted: 1 });
  assert.deepEqual(log.warnings, []);
  assert.equal(parseRunLog('# Review Log: a → main\n').verification, null, 'no Verification: line');
  assert.match(parseRunLog('Verification: 3 checked, 2 confirmed\n').warnings.join('\n'), /the Verification: line has no count for: plausible, refuted/);
});

// Escaped-defects rows the parser cannot read: each table shape drops its rows with a warning naming why.
test('parseRunLog drops unreadable escaped-defect rows with a warning, never silently; calibration prints it', async () => {
  const head = '# Review Log: a → main\n\n| # | Severity | Agent | Finding (one line) | Where | Verdict |\n|---|---|---|---|---|---|\n| 1 | issue | code-reviewer | f | a.js:1 | confirmed |\n\n## Escaped defects\n\n';
  const good = '| # | Lane | Defect (one line) | Where | Found by | Why missed |\n|---|---|---|---|---|---|\n';
  const shapes = [
    [`${good}| E1 | code-reviewer | d | a.js:9 | teammate | w |\n| 2 | code-reviewer | d | a.js:9 | teammate | w |\n`, 1, /escaped defects: 1 row\(s\) dropped: its # is not a number \("E1"\)/],
    [`${good}| 1 | code-reviewer | d | a.js:9 |\n`, 0, /escaped defects: 1 row\(s\) dropped: it has 4 cells, fewer than the header's 6/],
    ['| # | Lanes | Defect | Where | Who | Why |\n|---|---|---|---|---|---|\n| 1 | code-reviewer | d | a.js:9 | teammate | w |\n| 2 | code-reviewer | d | a.js:9 | teammate | w |\n', 0, /escaped defects: 2 row\(s\) dropped: its table header is not/],
    ['| Id | Lane | Defect | Where | Found by | Why missed |\n|---|---|---|---|---|---|\n| 1 | code-reviewer | d | a.js:9 | teammate | w |\n', 0, /escaped defects: 1 row\(s\) dropped: its table header does not start with `#`/],
    ['No table yet.\n', 0, /the Escaped defects section has no rows/],
  ];
  for (const [table, read, warning] of shapes) {
    const log = parseRunLog(head + table);
    assert.equal(log.escapes.length, read, table);
    assert.match(log.warnings.join('\n'), warning, table);
    assert.equal(log.rows.length, 1, 'the finding table is unaffected');
  }
  const dir = tempDir('esc-warn');
  fs.writeFileSync(path.join(dir, '2026-04-01-x.md'), head + shapes[0][0]);
  const r = await run(['calibration', '--logs', dir]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Escaped defects: 1\./);
  assert.match(r.out, /## Parser warnings\n\nLines the counts above could not use:\n\n- 2026-04-01-x\.md: escaped defects: 1 row\(s\) dropped: its # is not a number \("E1"\)/);
  assert.doesNotMatch((await run(['calibration', '--logs', RECALL])).out, /Parser warnings/, 'a clean log prints no warnings');
});

test('a log whose only table is Runtime checks has no findings and no escapes', () => {
  const text = '# Review Log: a → main\n\n## Runtime checks\n\n| # | Check | Steps | Result |\n|---|---|---|---|\n| 1 | Export opens | Click Export; a defect shows a blank page | _not run_ |\n';
  const log = parseRunLog(text);
  assert.deepEqual([log.tables, log.rows.length, log.escapes.length], [0, 0, 0]);
});

test('calibration: agent verdicts stay out of precision and the triaged count; escapes give Escaped and recall', async () => {
  const r = await run(['calibration', '--logs', RECALL]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /1 run log\(s\) parsed, 0 skipped, 8 finding\(s\)\. Triaged verdicts \(confirmed, false-positive, wont-fix\): 5\. Agent verdicts: 2\. Escaped defects: 3\./);
  // code-reviewer: developer confirmed 3 (rows 1, 2, 8), false positive 1 (row 6): 4 verdicts, no precision.
  // Counting the two agent verdicts would give 4 confirmed + 2 false positives = 67%.
  assert.match(r.out, /\| code-reviewer \| 7 \| 3 \| 1 \| 0 \| 1 \| 0 \| n\/a \| 2 escaped \| 2 \| 2 \| 60% \|/);
  assert.match(r.out, /\| silent-failure-hunter \| 1 \| 1 \| 0 \| 0 \| 0 \| 0 \| n\/a \| {2}\| 0 \| 1 \| n\/a \|/, 'under 5 confirmed + escaped: no recall');
  assert.match(r.out, /\| warning \| 3 \| 1 \| 0 \| 0 \| 0 \| 0 \| 2 \|/);
  // The four older fixtures carry none of the new parts: zero agent verdicts and escapes, numbers unchanged.
  const old = await run(['calibration', '--logs', REVIEWS]);
  assert.match(old.out, /Triaged verdicts \(confirmed, false-positive, wont-fix\): 17\. Agent verdicts: 0\. Escaped defects: 0\./);
  assert.match(old.out, /\| code-reviewer \| 9 \| 3 \| 4 \| 1 \| 0 \| 1 \| 43% \| below threshold; 4 false positives \| 0 \| 0 \| n\/a \|/);
});

// Source suffixes in any case, an agent wont-fix, a two-lane escape, a lane with no escape, and a non-escape table
// that has a Lane column.
const EDGE_LOG = [
  '# Review Log: feature/x → main',
  '',
  '| # | Severity | Agent | Finding (one line) | Where | Verdict |',
  '|---|---|---|---|---|---|',
  '| 1 | warning | lane-a | f1 | a.js:1 | wont-fix — the workflow judged it harmless (agent) |',
  '| 2 | warning | lane-a | f2 | a.js:2 | confirmed — fixed in session (Agent) |',
  '| 3 | warning | lane-a | f3 | a.js:3 | false-positive — refuted by verifier: the guard at a.js:9 (AGENT) |',
  ...[4, 5, 6, 7, 8].map((n) => `| ${n} | issue | lane-a | f${n} | a.js:${n} | confirmed |`),
  '| 9 | nit | lane-b | f9 | b.js:1 | false-positive — named in config (developer) |',
  ...[10, 11, 12, 13, 14].map((n) => `| ${n} | suggestion | lane-c | f${n} | c.js:${n} | confirmed |`),
  ...[15, 16, 17].map((n) => `| ${n} | warning | lane-d | f${n} | d.js:${n} | confirmed |`),
  '| 18 | warning | lane-d | f18 | d.js:18 | false-positive — covered upstream |',
  '',
  '## Lane notes',
  '',
  '| # | Lane | Note |',
  '|---|---|---|',
  '| 1 | lane-a | not an escape |',
  '',
  '## Escaped defects',
  '',
  '| # | Lane | Defect (one line) | Where | Found by | Why missed |',
  '|---|---|---|---|---|---|',
  '| 1 | lane-a, lane-b | Retry repeats the charge | a.js:40 | teammate | no caller trace |',
  '',
].join('\n');

test('calibration edges: an agent wont-fix, (Agent) in any case, a two-lane escape, recall n/a with no escape, a Lane-column table', async () => {
  const dir = tempDir('edge');
  fs.writeFileSync(path.join(dir, '2026-03-01-feature-x.md'), EDGE_LOG);
  const r = await run(['calibration', '--logs', dir]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /18 finding\(s\)\. Triaged verdicts \(confirmed, false-positive, wont-fix\): 15\. Agent verdicts: 3\. Escaped defects: 1\./);
  assert.match(r.out, /\| lane-d \| 4 \| 3 \| 1 \| 0 \| 0 \| 0 \| n\/a \| {2}\| 0 \| 0 \| n\/a \|/, '4 developer verdicts: no precision');
  assert.match(r.out, /\| lane-a \| 8 \| 5 \| 0 \| 0 \| 0 \| 0 \| 100% \| {2}\| 3 \| 1 \| 83% \|/, 'the Lane notes row is not a second escape');
  assert.match(r.out, /\| lane-b \| 1 \| 0 \| 1 \| 0 \| 0 \| 0 \| n\/a \| {2}\| 0 \| 1 \| n\/a \|/, 'a two-lane escape counts for both');
  assert.match(r.out, /\| lane-c \| 5 \| 5 \| 0 \| 0 \| 0 \| 0 \| 100% \| {2}\| 0 \| 0 \| n\/a \|/, 'no escape recorded: recall n/a, not 100%');
});

// The Precision cell (8th) of every lane row in the table under `heading`.
const precisionCells = (out, heading) => {
  const sec = out.slice(out.indexOf(heading)).split('\n## ')[0];
  return Object.fromEntries([...sec.matchAll(/^\| ([a-z-]+) \|(.*)$/gm)].map((m) => [m[1], m[2].split('|')[6].trim()]));
};

test('metrics counts agent verdicts apart exactly as calibration does, so both give the same precision', () => {
  const prices = { cacheWrite5mMultiplier: 1.25, cacheWrite1hMultiplier: 2, models: {} };
  for (const text of [EDGE_LOG, fs.readFileSync(RECALL_LOG, 'utf8')]) {
    const m = findingsFromLog(text, 'x.md');
    const { byLane } = aggregate([parseRunLog(text.replace(/\r\n/g, '\n'))]);
    assert.deepEqual(Object.keys(m.byLane).sort(), Object.keys(byLane).filter((l) => byLane[l].total).sort());
    for (const [lane, c] of Object.entries(m.byLane)) {
      const k = byLane[lane];
      assert.deepEqual([c.confirmed, c.falsePositive, c.wontFix, c.agent], [k.confirmed, k.falsePositive, k.wontFix, k.agent], lane);
    }
    // The rendered Precision cells agree lane by lane, n/a included.
    const dir = tempDir('parity');
    fs.writeFileSync(path.join(dir, 'log.md'), text);
    const cal = calibrationReport(dir);
    const runRep = runReport(MAIN, 'pre-pr-review', { until: at(60), roots: ROOTS }).report;
    Object.assign(runRep, { runId: 'r', developer: 'd', branch: 'feature/x', schemaVersion: 1 });
    runRep.outcomes.findings = m;
    const met = metricsReport([runRep], prices);
    const calCells = precisionCells(cal, '## Lanes');
    assert.deepEqual(precisionCells(met, '## Review lanes'), calCells);
    for (const lane of Object.keys(calCells)) assert.equal(calCells[lane], precision(byLane[lane]) === null ? 'n/a' : `${Math.round(precision(byLane[lane]) * 100)}%`, lane);
  }
  assert.deepEqual(findingsFromLog(EDGE_LOG, 'x.md').byVerdict, { confirmed: 13, falsePositive: 2, wontFix: 0, notActioned: 0, pending: 0, agent: 3 });
});

test('metrics report prints the Agent verdicts column and a lane-d with 4 developer verdicts as n/a', () => {
  const runRep = runReport(MAIN, 'pre-pr-review', { until: at(60), roots: ROOTS }).report;
  Object.assign(runRep, { runId: 'r', developer: 'd', branch: 'feature/x', schemaVersion: 1 });
  runRep.outcomes.findings = findingsFromLog(EDGE_LOG, 'x.md');
  const out = metricsReport([runRep], { cacheWrite5mMultiplier: 1.25, cacheWrite1hMultiplier: 2, models: {} });
  assert.match(out, /^\| Lane \| Findings \| Confirmed \| False positive \| Wont fix \| Not actioned \| Pending \| Precision \| Agent verdicts \|$/m);
  assert.match(out, /^\| lane-a \| 8 \| 5 \| 0 \| 0 \| 0 \| 0 \| 100% \| 3 \|$/m);
  assert.match(out, /^\| lane-d \| 4 \| 3 \| 1 \| 0 \| 0 \| 0 \| n\/a \| 0 \|$/m);
});

test('calibration fails by name on a missing folder or a bad threshold', async () => {
  const missing = await run(['calibration', '--logs', path.join(tempDir('cal'), 'none')]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /calibration: no run-log folder at/);
  assert.equal((await run(['calibration', '--logs', REVIEWS, '--min-precision', '1.5'])).code, 1);
  assert.equal((await run(['calibration', '--logs', REVIEWS, '--min-precision', 'x'])).code, 1);
  assert.equal(calibrationReport(REVIEWS).includes('## Severities'), true);
});

// ---------- corpus ----------

const REPORT_HEAD = '## Pre-PR Review — feature/x\n\n';
const writeReport = (body) => {
  const f = path.join(tempDir('corpus'), 'report.md');
  fs.writeFileSync(f, REPORT_HEAD + body);
  return f;
};

test('corpus list prints each case with its lanes and title', async () => {
  const r = await run(['corpus', 'list']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.out.split('\n'), [
    'cache-key-scope  [code-reviewer]  Cache written under one key scope and read under another',
    'cancelled-job-done  [silent-failure-hunter, code-reviewer]  A job that reports a cancelled run as done and swallows the failure',
  ]);
});

test('corpus score: found, missed and extra; a line inside the range matches; lane shown but not required', async () => {
  const pass = writeReport([
    '### Must fix before submitting (issue:)',
    '- [silent-failure-hunter] The batch failure is swallowed and the job marked done — src/jobs/exportJob.js:13',
    '  Suggested fix: rethrow after recording failed — src/jobs/exportJob.js:99',
    '- [silent-failure-hunter] (plausible) A cancelled export is recorded as done — .\\src\\jobs\\exportJob.js:15',
    '',
    '### Suggestions and nits',
    '- [code-simplifier] Name the status strings — src/jobs/exportJob.js:6',
    '',
    '### Questions for the author (question:)',
    '- [code-reviewer] Should a cancelled export keep its partial file? — src/jobs/exportJob.js:15',
    '',
  ].join('\n'));
  const r = await run(['corpus', 'score', '--case', 'cancelled-job-done', '--report', pass]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^Corpus case cancelled-job-done: 2 expected, 2 found, 0 missed, 1 extra$/m);
  assert.match(r.out, /^FOUND E1 \[silent-failure-hunter\] src\/jobs\/exportJob\.js:12-14 — .* — by \[silent-failure-hunter\]$/m);
  assert.match(r.out, /^FOUND E2 \[code-reviewer\] src\/jobs\/exportJob\.js:9,15 — .* — by \[silent-failure-hunter\] \(other lane\)$/m);
  assert.match(r.out, /^EXTRA \[code-simplifier\] Name the status strings/m);
  assert.doesNotMatch(r.out, /Should a cancelled export/, 'a question is not a finding');
});

test('corpus score exits 1 on a missed row; Refuted by verification and Runtime checks do not count as found', async () => {
  const miss = writeReport([
    '### Review before submitting (warning:)',
    '- [silent-failure-hunter] The batch failure is swallowed — src/jobs/exportJob.js:12-14',
    '  - [code-reviewer] An indented sub-item is not a finding — src/jobs/exportJob.js:9',
    '',
    '### Refuted by verification',
    '- [code-reviewer] A cancelled run is recorded as done — src/jobs/exportJob.js:15 — evidence: quoted',
    '',
    '### Runtime checks',
    '- [code-reviewer] Cancel an export mid-run; a defect shows status done — src/jobs/exportJob.js:15',
    '',
  ].join('\n'));
  const r = await run(['corpus', 'score', '--case', 'cancelled-job-done', '--report', miss]);
  assert.equal(r.code, 1);
  assert.match(r.out, /2 expected, 1 found, 1 missed, 0 extra/);
  assert.match(r.out, /^MISSED E2 \[code-reviewer\] src\/jobs\/exportJob\.js:9,15 — /m);
  // A finding just outside the range, at either end, is extra, not found; the range start is inclusive too.
  const before = await run(['corpus', 'score', '--case', 'cache-key-scope', '--report', writeReport('### Must fix before submitting (issue:)\n- [code-reviewer] Unscoped key — src/catalog/priceCache.js:9\n')]);
  assert.equal(before.code, 1);
  assert.match(before.out, /1 expected, 0 found, 1 missed, 1 extra/);
  const start = await run(['corpus', 'score', '--case', 'cache-key-scope', '--report', writeReport('### Must fix before submitting (issue:)\n- [code-reviewer] Unscoped key — src/catalog/priceCache.js:10\n')]);
  assert.equal(start.code, 0, 'the range start is inclusive');
  const off = await run(['corpus', 'score', '--case', 'cache-key-scope', '--report', writeReport('### Must fix before submitting (issue:)\n- [code-reviewer] Unscoped key — src/catalog/priceCache.js:19\n')]);
  assert.equal(off.code, 1);
  assert.match(off.out, /1 expected, 0 found, 1 missed, 1 extra/);
  const edge = await run(['corpus', 'score', '--case', 'cache-key-scope', '--report', writeReport('### Must fix before submitting (issue:)\n- [code-reviewer] Unscoped key — src/catalog/priceCache.js:18\n')]);
  assert.equal(edge.code, 0, 'the range end is inclusive');
});

test('corpus score: `* [lane]` bullets count; a wide range or a bare file name matches no row', async () => {
  const r = await run(['corpus', 'score', '--case', 'cancelled-job-done', '--report', writeReport([
    '### Must fix before submitting (issue:)',
    '* [silent-failure-hunter] The batch failure is swallowed — src/jobs/exportJob.js:13',
    '- [code-reviewer] Everything in this file is wrong — src/jobs/exportJob.js:1-999',
    '- [code-reviewer] A cancelled run is recorded as done — exportJob.js:15',
    '',
  ].join('\n'))]);
  assert.equal(r.code, 1);
  assert.match(r.out, /2 expected, 1 found, 1 missed, 2 extra/);
  assert.match(r.out, /^FOUND E1 .* by \[silent-failure-hunter\]$/m);
  assert.match(r.out, /^MISSED E2 /m);
});

test('corpus score: a row with a list of lines is found at any of them, and its neighbour is unaffected', async () => {
  for (const loc of ['9', '15', '9-15']) {
    const r = await run(['corpus', 'score', '--case', 'cancelled-job-done', '--report', writeReport([
      '### Must fix before submitting (issue:)',
      '- [silent-failure-hunter] The batch failure is swallowed — src/jobs/exportJob.js:13',
      `- [code-reviewer] A cancelled run is recorded as done — src/jobs/exportJob.js:${loc}`,
      '',
    ].join('\n'))]);
    assert.equal(r.code, 0, `${loc}: ${r.out}`);
    assert.match(r.out, /2 expected, 2 found, 0 missed, 0 extra/, loc);
    assert.match(r.out, /^FOUND E2 \[code-reviewer\] .* by \[code-reviewer\]$/m, loc);
  }
  const only = await run(['corpus', 'score', '--case', 'cancelled-job-done', '--report', writeReport('### Must fix before submitting (issue:)\n- [code-reviewer] Cancelled run recorded as done — src/jobs/exportJob.js:9-15\n')]);
  assert.equal(only.code, 1);
  assert.match(only.out, /2 expected, 1 found, 1 missed, 0 extra/);
  assert.match(only.out, /^MISSED E1 /m, 'a 9-15 finding counts by its first line, so not for E1 (12-14)');
});

test('corpus list warns about a case with no title or Lanes: line and a folder with no case.md', async () => {
  const root = tempDir('corpus-list');
  const corpus = path.join(root, 'tests', 'fixtures', 'corpus');
  for (const [id, files] of [['good', { 'case.md': '# Good\nLanes: code-reviewer\n', 'expected.md': 'x' }], ['bare', { 'case.md': 'no title\n' }], ['orphan', { 'expected.md': 'x' }]]) {
    fs.mkdirSync(path.join(corpus, id), { recursive: true });
    for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(corpus, id, f), t);
  }
  const r = await run(['corpus', 'list', '--repo', root]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.out.split('\n'), ['bare  []  ', 'good  [code-reviewer]  Good']);
  assert.deepEqual(r.err.split('\n'), [
    'WARN corpus: bare/case.md has no `# <title>` heading',
    'WARN corpus: bare/case.md has no `Lanes:` line, so no lane change selects it',
    'WARN corpus: orphan has expected.md but no case.md, so it is not listed',
  ]);
  assert.equal((await run(['corpus', 'list'])).err, '', 'the shipped corpus has no warning');
});

test('corpus score names a report with no finding section instead of reporting every row missed', async () => {
  const r = await run(['corpus', 'score', '--case', 'cache-key-scope', '--report', writeReport('## Findings\n- [code-reviewer] Unscoped key — src/catalog/priceCache.js:12\n')]);
  assert.equal(r.code, 1);
  assert.match(r.err, /corpus: no ### Must fix, Review before submitting or Suggestions heading in .*report\.md/);
  assert.equal(r.out, '');
});

// Every expected range must sit on lines the case's diff adds, so a stale range cannot pass or fail by accident.
test('every corpus expected range falls inside lines its diff.patch adds', () => {
  const root = path.join(FIX, 'corpus');
  const ids = fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, 'expected.md')));
  assert.ok(ids.length >= 2);
  for (const id of ids) {
    const added = new Map();
    let file = null;
    let line = 0;
    for (const l of fs.readFileSync(path.join(root, id, 'diff.patch'), 'utf8').split(/\r?\n/)) {
      const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
      if (l.startsWith('+++ ')) {
        file = l.slice(4).replace(/^b\//, '');
        added.set(file, new Set());
      } else if (h) line = Number(h[1]);
      else if (file && l.startsWith('+')) added.get(file).add(line++);
      else if (file && l.startsWith(' ')) line++;
    }
    for (const e of parseExpected(fs.readFileSync(path.join(root, id, 'expected.md'), 'utf8'))) {
      assert.ok(added.has(e.file), `${id} ${e.id}: ${e.file} is not in diff.patch`);
      for (const r of e.ranges) for (let n = r.from; n <= r.to; n++) assert.ok(added.get(e.file).has(n), `${id} ${e.id}: ${e.file}:${n} is not an added line`);
    }
  }
});

test('parseExpected reads ranges and lists, and refuses a backwards range, a malformed range and a table with no rows', () => {
  const head = '| Id | Lane | File | Lines | Defect |\n|----|------|------|-------|--------|\n';
  assert.deepEqual(parseExpected(`${head}| E1 | a | ./src/x.js | 7 | d |\n`), [{ id: 'E1', lane: 'a', file: 'src/x.js', ranges: [{ from: 7, to: 7 }], defect: 'd' }]);
  assert.deepEqual(parseExpected(`${head}| E1 | a | x.js | 9, 15 | d |\n`)[0].ranges, [{ from: 9, to: 9 }, { from: 15, to: 15 }]);
  assert.deepEqual(parseExpected(`${head}| E1 | a | x.js | 9-9, 15-16 | d |\n`)[0].ranges, [{ from: 9, to: 9 }, { from: 15, to: 16 }]);
  assert.throws(() => parseExpected(`${head}| E1 | a | x.js | 9, 16-15 | d |\n`), /Lines 16-15 run backwards/);
  assert.throws(() => parseExpected(`${head}| E1 | a | x.js | 9, | d |\n`), /Lines must be a-b/);
  assert.throws(() => parseExpected(`${head}| E1 | a | src/x.js | 9-3 | d |\n`), /corpus: expected row E1: Lines 9-3 run backwards/);
  assert.throws(() => parseExpected(`${head}| E1 | a | src/x.js | nine | d |\n`), /Lines must be a-b/);
  assert.throws(() => parseExpected(head), /corpus: expected\.md has no/);
  assert.throws(() => parseExpected('# no table\n'), /corpus: expected\.md has no/);
});

test('corpus fails by name on a bad case, a missing report or a missing option', async () => {
  const report = writeReport('');
  const cases = [
    [['score', '--case', 'nope', '--report', report], /corpus: no case nope/],
    [['score', '--case', '../x', '--report', report], /corpus: not a case id/],
    [['score', '--case', 'cache-key-scope', '--report', path.join(tempDir('corpus'), 'none.md')], /corpus: report not found/],
    [['score', '--case', 'cache-key-scope'], /corpus: score needs --case <id> and --report <file>/],
    [['nope'], /usage: corpus list/],
  ];
  for (const [argv, re] of cases) {
    const r = await run(['corpus', ...argv]);
    assert.equal(r.code, 1, argv.join(' '));
    assert.match(r.err, re);
  }
});

// ---------- metrics capture ----------

test('readTranscript keeps one usage per message id, one result per tool use, and finds invocations', () => {
  const ev = readTranscript(MAIN);
  assert.equal(ev.usage.size, 4, 'the <synthetic> message is not billed');
  assert.equal(ev.usage.get('m1').u.output_tokens, 40, 'the last usage for an id wins');
  assert.equal(ev.results.get('r1'), 300);
  assert.deepEqual(ev.invocations.map((i) => `${i.workflow}:${i.source}`), ['ship:command', 'pre-pr-review:skill-tool']);
  assert.equal(ev.info.branch, 'feature/4242-x');
});

test('measureAgent counts only the window, sizes reads and redacts paths', () => {
  const ev = readTranscript(MAIN);
  const m = measureAgent(ev, at(1), at(60), ROOTS, 'orchestrator');
  assert.equal(m.turns, 3);
  assert.equal(m.initialContextTokens, 2505);
  assert.equal(m.peakContextTokens, 6005);
  assert.equal(m.tokens.cacheWrite1h, 500);
  assert.equal(m.tokens.output, 60);
  const all = measureAgent(ev, at(0), at(60), ROOTS, 'orchestrator');
  assert.deepEqual([all.filesRead.reads, all.filesRead.totalChars, all.filesRead.avgChars], [2, 400, 200]);
  assert.deepEqual(all.filesRead.top.map((t) => t.path), ['src/A.cs', '<scratchpad>']);
});

test('redactPath maps repo, scratchpad, claude-home, tool-output and external paths', () => {
  const home = path.join(os.tmpdir(), 'fakehome');
  const h = `${home.replace(/\\/g, '/')}/.claude`;
  assert.equal(redactPath('\\work\\acmeapp\\src\\B.cs', ['\\work\\acmeapp']), 'src/B.cs');
  assert.equal(redactPath('/tmp/claude-1000/p/s/scratchpad/d.diff', ROOTS, home), '<scratchpad>');
  assert.equal(redactPath(`${h}/memory/x.md`, ROOTS, home), '<claude-home>');
  assert.equal(redactPath(`${h}/projects/p/s/tool-results/a.txt`, ROOTS, home), '<tool-output>');
  assert.equal(redactPath('/etc/hosts', ROOTS, home), '<external>');
  assert.equal(redactPath('relative/x.md', ROOTS, home), 'relative/x.md');
});

test('agentResult reads a resumed verifier: leads from its lead report, RAISE/KEEP from its severity review', () => {
  const texts = [
    { text: '1. REFUTED - [code-reviewer] a\n2. PLAUSIBLE - [pr-test-analyzer] b\n3. CONFIRMED - [code-reviewer] c' },
    { text: 'Severity review.\nRAISE S3 - suggestion to warning\nRAISE N1 - nit to warning\nKEEP: S1, S2, Q1' },
  ];
  const a = agentResult('review-verifier', texts);
  assert.deepEqual(a.leads, { CONFIRMED: 1, PLAUSIBLE: 1, REFUTED: 1 });
  assert.deepEqual(a.severityReview, { raised: 2, kept: 3 });
  const b = agentResult('review-verifier', [{ text: '1. KEEP. accurate\n2. KEEP. tested\nKEEP: 1, 2' }]);
  assert.equal(b.leads, undefined);
  assert.deepEqual(b.severityReview, { raised: 0, kept: 2 });
  assert.deepEqual(agentResult('refuter', [{ text: 'VERDICT: ACCEPT | REWORK' }]), {}, 'a template line is not a verdict');
});

test('agentResult counts a verifier\'s lead verdicts and its findings-mode verdicts apart', () => {
  // One message answering both batches under headings, numbered A1.. and B1.. (the shape a combined prompt gets).
  const both = [
    '# review-verifier: x -> main (leads A1-A3, findings mode B1-B2)',
    '## A. Leads',
    'A1. CONFIRMED — [code-reviewer] a',
    'A2. PLAUSIBLE — [code-reviewer] b',
    '**A3.** PLAUSIBLE — [code-reviewer] c',
    '## B. Findings mode',
    'B1. CONFIRMED — [silent-failure-hunter] d',
    'B12. REFUTED — [code-reviewer] e',
  ].join('\n');
  const a = agentResult('review-verifier', [{ ts: 2, text: both }], [1]);
  assert.deepEqual([a.leads, a.findings], [{ CONFIRMED: 1, PLAUSIBLE: 2, REFUTED: 0 }, { CONFIRMED: 1, PLAUSIBLE: 0, REFUTED: 1 }]);
  // A verifier resumed for finding verification: the reply after the findings-mode prompt is the findings set.
  const resumed = agentResult('review-verifier', [
    { ts: 1, text: '1. REFUTED - a\n2. CONFIRMED - b' },
    { ts: 3, text: '1. CONFIRMED - x\n2. CONFIRMED - y\n3. PLAUSIBLE - z' },
  ], [2]);
  assert.deepEqual([resumed.leads, resumed.findings], [{ CONFIRMED: 1, PLAUSIBLE: 0, REFUTED: 1 }, { CONFIRMED: 2, PLAUSIBLE: 1, REFUTED: 0 }], 'more findings than leads never replace the lead count');
  // A findings-mode verifier launched on its own reports findings only.
  const fresh = agentResult('review-verifier', [{ ts: 5, text: '1. CONFIRMED - x' }], [4]);
  assert.deepEqual([fresh.leads, fresh.findings], [undefined, { CONFIRMED: 1, PLAUSIBLE: 0, REFUTED: 0 }]);
  const o = loopOutcomes([
    { agentType: 'review-verifier', result: resumed },
    { agentType: 'review-verifier', result: fresh },
  ]);
  assert.deepEqual(o.verifier, { CONFIRMED: 1, PLAUSIBLE: 0, REFUTED: 1 });
  assert.deepEqual(o.verifierFindings, { CONFIRMED: 3, PLAUSIBLE: 1, REFUTED: 0 });
});

test('loopOutcomes counts REWORK rounds and first-pass acceptance in dispatch order', () => {
  const o = loopOutcomes([
    { agentType: 'refuter', startedUtc: new Date(at(1)).toISOString(), result: { verdicts: ['REWORK', 'ACCEPT'] } },
    { agentType: 'refuter', startedUtc: new Date(at(2)).toISOString(), result: { verdicts: ['ACCEPT', 'REWORK'] } },
    { agentType: 'builder', startedUtc: new Date(at(0)).toISOString(), result: { statuses: ['DONE', 'BLOCKED'] } },
  ]);
  assert.deepEqual(o.refuter, { verdicts: 4, accept: 2, rework: 2, acceptedFirstPass: 1, openRework: 1 });
  assert.deepEqual(o.builder, { done: 1, blocked: 1, partial: 0 });
});

test('findingsFromLog counts a non-canonical verdict as pending', () => {
  const f = findingsFromLog(fs.readFileSync(path.join(REVIEWS, '2026-01-05-feature-101-login.md'), 'utf8'), 'x.md');
  assert.deepEqual(f.byVerdict, { confirmed: 1, falsePositive: 1, wontFix: 1, notActioned: 1, pending: 2, agent: 0 });
  assert.deepEqual(f.byLane['code-reviewer'], { total: 4, confirmed: 1, falsePositive: 1, wontFix: 1, notActioned: 0, pending: 1, agent: 0 });
  assert.equal(f.bySeverity.warning, 2);
  assert.equal(f.verification, null);
  assert.deepEqual(findingsFromLog(fs.readFileSync(RECALL_LOG, 'utf8'), 'x.md').verification, { checked: 5, confirmed: 4, plausible: 0, refuted: 1 });
});

test('a review run starts at its invocation; a later session capture links it as a child run', () => {
  const child = runReport(MAIN, 'pre-pr-review', { until: at(60), roots: ROOTS }).report;
  assert.equal(child.startedUtc, new Date(at(30)).toISOString());
  assert.equal(child.totals.agents, 1);
  assert.equal(child.agents[0].agentType, 'review-verifier');
  assert.deepEqual(child.outcomes.verifier, { CONFIRMED: 1, PLAUSIBLE: 1, REFUTED: 1 });
  Object.assign(child, { runId: 'child-run', file: 'x/child-run.json' });
  const parent = runReport(MAIN, 'session', { until: at(60), roots: ROOTS, existing: [child] }).report;
  const v = parent.agents.find((a) => a.agentType === 'review-verifier');
  assert.deepEqual(parent.childRuns, [{ runId: 'child-run', workflow: 'pre-pr-review', file: 'x/child-run.json' }]);
  assert.equal(v.childRunId, 'child-run');
  assert.equal(parent.totals.tokens.context - parent.totals.ownTokens.context, v.tokens.context);
  assert.deepEqual(parent.outcomes.builder, { done: 2, blocked: 0, partial: 0 });
  assert.equal(parent.outcomes.refuter.accept, 2);
  assert.equal(parent.outcomes.refuter.acceptedFirstPass, 1);
  assert.equal(parent.endedUtc, new Date(at(32)).toISOString());
  assert.equal(parent.wallClockSeconds, 32 * 60);
  assert.ok(parent.totals.tokensByModel['claude-sonnet-5-5']);
});

test('findTranscript looks the session up under the projects folder and names a miss', () => {
  assert.equal(findTranscript('sess-1', path.dirname(PROJ)), MAIN);
  assert.throws(() => findTranscript('nope', path.dirname(PROJ)), /metrics: no transcript for session nope/);
  assert.throws(() => findTranscript(undefined, path.dirname(PROJ)), /metrics: no session id/);
  assert.throws(() => findTranscript('../x', path.dirname(PROJ)), /not a session id/);
});

test('metrics capture --print writes nothing; without it, one report under <out>/<yyyy-MM>/', async () => {
  const out = tempDir('metrics');
  const printed = await run(['metrics', 'capture', '--workflow', 'pre-pr-review', '--transcript', MAIN, '--log', path.join(REVIEWS, '2026-01-05-feature-101-login.md'), '--mode', 'lite', '--version', '1.2.3', '--out', out, '--print']);
  assert.equal(printed.code, 0, printed.err);
  assert.deepEqual(fs.readdirSync(out), []);
  const report = JSON.parse(printed.out);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.branch, 'feature/4242-x', 'a transcript passed by path keeps its own branch');
  assert.equal(report.ticket, '4242');
  assert.equal(report.mode, 'lite');
  assert.equal(report.skillVersion, '1.2.3');
  assert.match(report.runId, /^20260109T123000Z-pre-pr-review-4242-([0-9a-f]{6}|unknow)$/);
  assert.equal(report.outcomes.findings.byVerdict.confirmed, 1);
  const written = await run(['metrics', 'capture', '--workflow', 'pre-pr-review', '--transcript', MAIN, '--out', out]);
  assert.equal(written.code, 0, written.err);
  assert.equal(path.dirname(written.out), path.join(out, '2026-01'));
  assert.equal(JSON.parse(fs.readFileSync(written.out, 'utf8')).runId, path.basename(written.out, '.json'));
  const again = await run(['metrics', 'capture', '--workflow', 'pre-pr-review', '--transcript', MAIN, '--log', path.join(REVIEWS, '2026-01-05-feature-101-login.md'), '--out', out]);
  assert.equal(again.out, written.out, 'a recapture after the verdict sweep replaces the same report');
  assert.equal(fs.readdirSync(path.join(out, '2026-01')).length, 1);
  const recaptured = JSON.parse(fs.readFileSync(again.out, 'utf8'));
  assert.equal(recaptured.outcomes.findings.byVerdict.confirmed, 1);
  assert.deepEqual(recaptured.childRuns, [], 'a recapture never links its own earlier report');
  assert.deepEqual(recaptured.totals.ownTokens, recaptured.totals.tokens);
  // --out outside the repo: no home, scratchpad, drive or parent segment in `file`, here or in a parent's childRuns.
  const runId = recaptured.runId;
  assert.equal(recaptured.file, `<out>/2026-01/${runId}.json`);
  const session = await run(['metrics', 'capture', '--workflow', 'session', '--transcript', MAIN, '--out', out, '--print']);
  const parent = JSON.parse(session.out);
  assert.equal(parent.childRuns.length, 1, 'the written review report becomes a child run');
  assert.equal(parent.childRuns[0].file, `<out>/2026-01/${runId}.json`);
  for (const f of [recaptured.file, parent.file, parent.childRuns[0].file]) {
    assert.doesNotMatch(f, /\.\.|^[A-Za-z]:|^\/|tmp|temp|users|home/i, f);
  }
  // --out inside the repo keeps the repo-relative path (nothing written with --print).
  const inRepo = await run(['metrics', 'capture', '--workflow', 'pre-pr-review', '--transcript', MAIN, '--out', path.join(REPO, '.orc', 'metrics'), '--print']);
  assert.equal(JSON.parse(inRepo.out).file, `.orc/metrics/2026-01/${runId}.json`);
});

test('metrics capture warns when the workflow was never invoked or a Leads: count is missing', async () => {
  const none = await run(['metrics', 'capture', '--workflow', 'release', '--transcript', MAIN, '--print']);
  assert.equal(none.code, 0, none.err);
  assert.match(none.err, /WARN metrics: no \/release invocation in sess-1; the report covers the whole session/);
  assert.equal(JSON.parse(none.out).startedUtc, new Date(at(0)).toISOString());
  const leads = await run(['metrics', 'capture', '--workflow', 'pre-pr-review', '--transcript', MAIN, '--log', path.join(REVIEWS, '2026-01-12-feature-104-gate.md'), '--print']);
  assert.match(leads.err, /WARN metrics: 2026-01-12-feature-104-gate\.md: the Leads: line has no count for: plausible, refuted/);
  assert.deepEqual(JSON.parse(leads.out).outcomes.findings.leads, { raised: 4, confirmed: 2, plausible: null, refuted: null });
  const ok = await run(['metrics', 'capture', '--workflow', 'pre-pr-review', '--transcript', MAIN, '--print']);
  assert.equal(ok.err, '');
});

test('metrics capture fails by name on a missing transcript, run log, workflow or bad mode', async () => {
  const cases = [
    [['--workflow', 'pre-pr-review', '--transcript', path.join(PROJ, 'missing.jsonl')], /metrics: transcript not found/],
    [['--workflow', 'pre-pr-review', '--transcript', MAIN, '--log', 'missing.md'], /metrics: run log not found/],
    [['--transcript', MAIN], /metrics: capture needs --workflow/],
    [['--workflow', 'pre-pr-review', '--transcript', MAIN, '--mode', 'half'], /metrics: --mode must be lite or full/],
  ];
  for (const [argv, re] of cases) {
    const r = await run(['metrics', 'capture', ...argv, '--print']);
    assert.equal(r.code, 1, argv.join(' '));
    assert.match(r.err, re);
  }
  assert.equal((await run(['metrics', 'nope'])).code, 1);
});

// ---------- metrics report ----------

test('cost prices every token class and refuses an unknown model', () => {
  const prices = { cacheWrite5mMultiplier: 1.25, cacheWrite1hMultiplier: 2, models: { m: { input: 4, output: 20, cacheRead: 0.2 } } };
  const M = 1e6;
  assert.ok(Math.abs(cost({ m: { input: M, cacheWrite5m: M, cacheWrite1h: M, cacheRead: M, output: M } }, prices) - (4 + 5 + 8 + 0.2 + 20)) < 1e-9);
  assert.equal(cost({ other: { input: 1, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 } }, prices), null);
  assert.equal(isoWeek(Date.UTC(2026, 0, 1)), '2026-W01');
  assert.equal(isoWeek(Date.UTC(2027, 0, 1)), '2026-W53');
});

test('metrics report counts a nested run once and shows loop, lane and unpriced sections', async () => {
  const dir = tempDir('runs');
  const child = runReport(MAIN, 'pre-pr-review', { until: at(60), roots: ROOTS }).report;
  Object.assign(child, { runId: 'child-run', developer: 'abc123', branch: 'feature/4242-x', schemaVersion: 1 });
  child.outcomes.findings = findingsFromLog(fs.readFileSync(path.join(REVIEWS, '2026-01-05-feature-101-login.md'), 'utf8'), 'x.md');
  const parent = runReport(MAIN, 'session', { until: at(60), roots: ROOTS, existing: [child] }).report;
  Object.assign(parent, { runId: 'parent-run', developer: 'abc123', branch: 'feature/4242-x', schemaVersion: 1 });
  fs.mkdirSync(path.join(dir, '2026-01'));
  fs.writeFileSync(path.join(dir, '2026-01', 'child-run.json'), JSON.stringify(child));
  fs.writeFileSync(path.join(dir, '2026-01', 'parent-run.json'), JSON.stringify(parent));
  fs.writeFileSync(path.join(dir, 'broken.json'), '{');
  const prices = path.join(dir, 'prices.json');
  fs.writeFileSync(prices, JSON.stringify({ cacheWrite5mMultiplier: 1.25, cacheWrite1hMultiplier: 2, models: { 'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 } } }));
  const r = await run(['metrics', 'report', '--dir', dir, '--prices', prices]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /2 runs \(1 nested in a parent run\)/);
  assert.match(r.out, /\| pre-pr-review \| 1 \(1 nested\) \|/);
  assert.equal([...r.out.matchAll(/^\| review-verifier \| 1 \|/gm)].length, 1);
  assert.match(r.out, /parent-run \| session/);
  assert.match(r.out, /2 tasks accepted, 50% on the first pass; 1 REWORK/);
  assert.match(r.out, /\| Pending \| Precision \| Agent verdicts \|/);
  // 2 developer verdicts: under calibration's minimum of 5, so n/a as in `calibration`.
  assert.match(r.out, /^\| code-reviewer \| 4 \| 1 \| 1 \| 1 \| 0 \| 1 \| n\/a \| 0 \|$/m);
  assert.match(r.out, /missing from the price table.*claude-sonnet-5-5/);
  assert.equal(loadRuns(dir).length, 2);
  assert.match(metricsReport([]), /No run reports found/);
  const missing = await run(['metrics', 'report', '--dir', path.join(dir, 'none')]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /metrics: no metrics folder at/);
});
