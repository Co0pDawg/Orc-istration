// calibration and metrics: synthetic run logs (tests/fixtures/reviews) and a synthetic Claude Code session
// (tests/fixtures/transcripts/proj/sess-1: a main thread, a builder, a refuter and a review-verifier).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../tools/orc.mjs';
import { parseRunLog, verdictOf, calibrationReport } from '../tools/lib/calibration.mjs';
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

test('calibration fails by name on a missing folder or a bad threshold', async () => {
  const missing = await run(['calibration', '--logs', path.join(tempDir('cal'), 'none')]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /calibration: no run-log folder at/);
  assert.equal((await run(['calibration', '--logs', REVIEWS, '--min-precision', '1.5'])).code, 1);
  assert.equal((await run(['calibration', '--logs', REVIEWS, '--min-precision', 'x'])).code, 1);
  assert.equal(calibrationReport(REVIEWS).includes('## Severities'), true);
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
  assert.deepEqual(f.byVerdict, { confirmed: 1, falsePositive: 1, wontFix: 1, notActioned: 1, pending: 2 });
  assert.deepEqual(f.byLane['code-reviewer'], { total: 4, confirmed: 1, falsePositive: 1, wontFix: 1, notActioned: 0, pending: 1 });
  assert.equal(f.bySeverity.warning, 2);
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
  assert.match(r.out, /\| code-reviewer \| 4 \| 1 \| 1 \| 1 \| 0 \| 1 \| 50% \|/);
  assert.match(r.out, /missing from the price table.*claude-sonnet-5-5/);
  assert.equal(loadRuns(dir).length, 2);
  assert.match(metricsReport([]), /No run reports found/);
  const missing = await run(['metrics', 'report', '--dir', path.join(dir, 'none')]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /metrics: no metrics folder at/);
});
