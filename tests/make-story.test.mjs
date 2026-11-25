import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(REPO, 'orchestration', 'sprint', 'make-story.mjs');
const BLOCK = /<script type="application\/json" id="sprint-events">([\s\S]*?)<\/script>/g;
const USAGE = /usage: node make-story\.mjs --events/;

// A temp dir removed when the test ends, pass or fail. Links (junctions) at its top level are removed
// first, on their own, so the recursive removal never walks into the folder a link points to.
function setup(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orc-story-'));
  t.after(() => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.lstatSync(full).isSymbolicLink()) fs.rmSync(full, { recursive: false, force: true });
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

function runArgs(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

function run(dir, extra = []) {
  return runArgs(['--events', path.join(dir, 'events.json'), '--meta', path.join(dir, 'meta.json'),
    '--out', path.join(dir, 'docs', 'story.html'), ...extra]);
}

const outPath = (dir) => path.join(dir, 'docs', 'story.html');
const blockData = (dir) => JSON.parse([...fs.readFileSync(outPath(dir), 'utf8').matchAll(BLOCK)][0][1]);

// Script-breaking text, line separators, and the replacement patterns a string replacer would expand.
const HOSTILE = '</script><img src=x onerror="alert(1)"><!-- ' + String.fromCharCode(0x2028, 0x2029) + " $& $' $` $1 $$";
const META = { title: 'Example', clock: 45, start: '2026-01-05T10:00:00-05:00', acs: [{ id: 'AC-1', text: 'a <b> $&', status: 'met' }] };
const EVENTS = [
  { at: '2026-01-05T10:07:00-05:00', kind: 'requirement', title: 'Requirements agreed' },
  { at: '2026-01-05T10:28:00-05:00', kind: 'correction', title: HOSTILE, detail: "x </SCRIPT> y $'", caughtBy: 'the refuter', fix: 'f', guard: 'g' },
];

test('make-story: hostile text stays inside the sprint-events block and parses back to the same data', (t) => {
  const dir = setup(t, { 'events.json': JSON.stringify(EVENTS), 'meta.json': JSON.stringify(META) });
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '', 'a complete correction gives no warning');
  const page = fs.readFileSync(outPath(dir), 'utf8');
  const blocks = [...page.matchAll(BLOCK)];
  assert.equal(blocks.length, 1, 'exactly one sprint-events block');
  const inner = blocks[0][1];
  assert.ok(!inner.includes('<'), 'no "<" inside the block');
  assert.ok(!inner.includes(String.fromCharCode(0x2028)) && !inner.includes(String.fromCharCode(0x2029)), 'no raw U+2028 or U+2029');
  assert.deepStrictEqual(JSON.parse(inner), { meta: META, events: EVENTS });
  // The rest of the template is unchanged: only the block contents were replaced.
  const template = fs.readFileSync(path.join(REPO, 'orchestration', 'sprint', 'story-template.html'), 'utf8');
  assert.equal(page.replace(BLOCK, ''), template.replace(BLOCK, ''));
});

test('make-story: an events file that is not a JSON array exits 1 and writes nothing', (t) => {
  for (const bad of ['{"at": "x"}', '[1, 2]', '{ not json']) {
    const dir = setup(t, { 'events.json': bad, 'meta.json': JSON.stringify(META) });
    const r = run(dir);
    assert.equal(r.status, 1, `events ${bad}`);
    assert.match(r.stderr, /make-story: .*events/);
    assert.equal(fs.existsSync(outPath(dir)), false);
  }
});

test('make-story: a meta file that is not a JSON object exits 1', (t) => {
  const dir = setup(t, { 'events.json': JSON.stringify(EVENTS), 'meta.json': '[]' });
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /meta file .* must hold a JSON object/);
});

const GOOD = { at: '2026-01-05T10:07:00-05:00', kind: 'build', title: 'Slice 1 committed' };
const EVENT_CASES = [
  [{ ...GOOD, at: undefined }, 'events[1].at'],
  [{ ...GOOD, at: '2026-01-05T10:07:00' }, 'events[1].at'],
  [{ ...GOOD, at: 'yesterday' }, 'events[1].at'],
  [{ ...GOOD, at: 1767625620000 }, 'events[1].at'],
  [{ ...GOOD, at: '2026-13-45T10:07:00Z' }, 'events[1].at'],
  [{ ...GOOD, kind: 'bogus' }, 'events[1].kind'],
  [{ ...GOOD, kind: 'Build' }, 'events[1].kind'],
  [{ ...GOOD, kind: undefined }, 'events[1].kind'],
  [{ ...GOOD, title: '' }, 'events[1].title'],
  [{ ...GOOD, title: '   ' }, 'events[1].title'],
  [{ ...GOOD, title: 5 }, 'events[1].title'],
  [{ ...GOOD, title: undefined }, 'events[1].title'],
  [{ ...GOOD, late: 'yes' }, 'events[1].late'],
];

test('make-story: each invalid event exits 1 naming the event index and field, and writes nothing', (t) => {
  for (const [bad, field] of EVENT_CASES) {
    const dir = setup(t, { 'events.json': JSON.stringify([GOOD, bad]), 'meta.json': JSON.stringify(META) });
    const r = run(dir);
    assert.equal(r.status, 1, `${field}: ${JSON.stringify(bad)}`);
    assert.ok(r.stderr.includes(field), `${field} named in: ${r.stderr}`);
    assert.equal(fs.existsSync(outPath(dir)), false);
  }
});

const META_CASES = [
  [{ start: '2026-01-05T10:00:00' }, 'meta.start'],
  [{ deadline: 'soon' }, 'meta.deadline'],
  [{ coreComplete: '2026-01-05 10:31' }, 'meta.coreComplete'],
  [{ acs: {} }, 'meta.acs'],
  [{ acs: ['AC-1'] }, 'meta.acs[0]'],
  [{ acs: [{ text: 't', status: 'met' }] }, 'meta.acs[0].id'],
  [{ acs: [{ id: 'AC-1', status: 'met' }] }, 'meta.acs[0].text'],
  [{ acs: [{ id: 'AC-1', text: 't', status: 'met' }, { id: 'AC-2', text: 't', status: 'Met' }] }, 'meta.acs[1].status'],
  [{ tests: 6 }, 'meta.tests'],
  [{ tests: { passed: -1, total: 6 } }, 'meta.tests.passed'],
  [{ tests: { passed: 6, total: 1.5 } }, 'meta.tests.total'],
  [{ tests: { passed: 6 } }, 'meta.tests.total'],
  [{ hidden: { found: 'x', total: 4 } }, 'meta.hidden.found'],
  [{ hidden: { found: 5, total: 4 } }, 'meta.hidden.found must not exceed'],
];

test('make-story: each invalid meta field exits 1 naming the field', (t) => {
  for (const [bad, field] of META_CASES) {
    const dir = setup(t, { 'events.json': JSON.stringify([GOOD]), 'meta.json': JSON.stringify({ ...META, ...bad }) });
    const r = run(dir);
    assert.equal(r.status, 1, `${field}: ${JSON.stringify(bad)}`);
    assert.ok(r.stderr.includes(field), `${field} named in: ${r.stderr}`);
    assert.equal(fs.existsSync(outPath(dir)), false);
  }
});

test('make-story: valid optional fields and every offset form are accepted', (t) => {
  const events = [
    { ...GOOD, at: '2026-01-05T15:07:00Z' },
    { ...GOOD, at: '2026-01-05T20:37:00.250+05:30', kind: 'milestone', late: false },
    { ...GOOD, at: '2026-01-05T10:40-05:00', kind: 'decision', late: true },
  ];
  const meta = { ...META, deadline: '2026-01-05T15:45:00Z', coreComplete: '2026-01-05T10:31:00-05:00',
    acs: [{ id: 'AC-1', text: 't', status: 'not met' }], tests: { passed: 0, total: 0 }, hidden: { found: 4, total: 4 } };
  const dir = setup(t, { 'events.json': JSON.stringify(events), 'meta.json': JSON.stringify(meta) });
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepStrictEqual(blockData(dir), { meta, events });
});

test('make-story: a correction missing caughtBy, fix or guard warns on stderr and still writes', (t) => {
  const events = [GOOD, { ...GOOD, kind: 'correction', caughtBy: 'the refuter', fix: '' }];
  const dir = setup(t, { 'events.json': JSON.stringify(events), 'meta.json': JSON.stringify(META) });
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /make-story: warning: events\[1\] \(correction\) has no fix, guard/);
  assert.deepStrictEqual(blockData(dir).events, events);
});

test('make-story: argument errors exit 1 with the usage line', (t) => {
  const dir = setup(t, { 'events.json': JSON.stringify([GOOD]), 'meta.json': JSON.stringify(META) });
  const ev = ['--events', path.join(dir, 'events.json')];
  const me = ['--meta', path.join(dir, 'meta.json')];
  const out = ['--out', outPath(dir)];
  const cases = [
    [[...ev, ...me, ...out, '--bogus', 'x'], /unknown argument "--bogus"/],
    [['stray', ...ev, ...me, ...out], /unknown argument "stray"/],
    [[...me, ...out, '--events'], /--events needs a value/],
    [['--events', '--meta', path.join(dir, 'meta.json'), ...out], /--events needs a value/],
    [[...me, ...out], /--events is required/],
    [[...ev, ...out], /--meta is required/],
    [[...ev, ...me], /--out is required/],
    [[], /--events is required/],
  ];
  for (const [args, message] of cases) {
    const r = runArgs(args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, message, args.join(' '));
    assert.match(r.stderr, USAGE, args.join(' '));
  }
  assert.equal(fs.existsSync(outPath(dir)), false);
});

test('make-story: a missing events file exits 1 with "cannot read"', (t) => {
  const dir = setup(t, { 'meta.json': JSON.stringify(META) });
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cannot read the events file/);
});

test('make-story: files that start with a byte order mark are accepted', (t) => {
  const bom = String.fromCharCode(0xfeff);
  const dir = setup(t, { 'events.json': bom + JSON.stringify(EVENTS), 'meta.json': bom + JSON.stringify(META) });
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepStrictEqual(blockData(dir), { meta: META, events: EVENTS });
});

test('make-story: an unwritable --out exits non-zero with "cannot write"', (t) => {
  const dir = setup(t, { 'events.json': JSON.stringify(EVENTS), 'meta.json': JSON.stringify(META) });
  // The output's folder would sit under a file, so it cannot be created.
  const r = runArgs(['--events', path.join(dir, 'events.json'), '--meta', path.join(dir, 'meta.json'),
    '--out', path.join(dir, 'events.json', 'docs', 'story.html')]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /cannot write/);
});

test('make-story: a template without the sprint-events block exits 1', (t) => {
  const dir = setup(t, { 'events.json': JSON.stringify(EVENTS), 'meta.json': JSON.stringify(META), 'plain.html': '<!doctype html><p>no block</p>' });
  const r = run(dir, ['--template', path.join(dir, 'plain.html')]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /exactly one sprint-events block; found 0/);
  assert.equal(fs.existsSync(outPath(dir)), false);
});

test('make-story: a template with two sprint-events blocks exits 1 and writes nothing', (t) => {
  const block = '<script type="application/json" id="sprint-events">{}</script>';
  const dir = setup(t, { 'events.json': JSON.stringify(EVENTS), 'meta.json': JSON.stringify(META), 'two.html': `<!doctype html>${block}${block}` });
  const r = run(dir, ['--template', path.join(dir, 'two.html')]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /exactly one sprint-events block; found 2/);
  assert.equal(fs.existsSync(outPath(dir)), false);
});

test('make-story: runs when started through a junction or symlink to its folder', (t) => {
  const dir = setup(t, { 'events.json': JSON.stringify(EVENTS), 'meta.json': JSON.stringify(META) });
  const link = path.join(dir, 'linked-sprint');
  try {
    fs.symlinkSync(path.dirname(SCRIPT), link, 'junction');
  } catch (e) {
    if (e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
    t.skip(`cannot create a directory link here (${e.code})`);
    return;
  }
  const out = outPath(dir);
  const r = spawnSync(process.execPath, [path.join(link, 'make-story.mjs'), '--events', path.join(dir, 'events.json'), '--meta', path.join(dir, 'meta.json'), '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(out), true);
});
