// orchestration/sprint/story-template.html: the page's inline script, run in node:vm against a tiny stub document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const TEMPLATE = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'orchestration', 'sprint', 'story-template.html'), 'utf8');
const SCRIPT = /<script>\r?\n([\s\S]*?)<\/script>/.exec(TEMPLATE)[1];
const SAMPLE = /<script type="application\/json" id="sprint-events">([\s\S]*?)<\/script>/.exec(TEMPLATE)[1];
const IDS = ['sprint-events', 'story-error', 'story-title', 'story-clock', 'story-elapsed', 'story-tiles', 'story-acs', 'story-timeline'];

// Values from the vm realm have that realm's prototypes; compare them as plain JSON.
const plain = (v) => JSON.parse(JSON.stringify(v));

function makeNode(tag) {
  return {
    tagName: tag, className: '', textContent: '', hidden: false, children: [], attrs: {},
    appendChild(child) { this.children.push(child); return child; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
  };
}

// Runs the script against a stub document whose sprint-events block holds blockText.
function runPage(blockText) {
  const nodes = Object.fromEntries(IDS.map((id) => [id, makeNode(id)]));
  nodes['sprint-events'].textContent = blockText;
  nodes['story-error'].hidden = true;
  const document = {
    title: 'How this was built',
    getElementById: (id) => nodes[id] ?? null,
    createElement: makeNode,
    createTextNode: (text) => ({ text }),
  };
  const context = vm.createContext({ document });
  vm.runInContext(SCRIPT, context);
  return { nodes, document, logic: vm.runInContext('storyLogic', context) };
}

const textOf = (n) => (n.text ?? n.textContent ?? '') + (n.children ?? []).map(textOf).join('');
const { logic: L } = runPage(SAMPLE);
const ZONE = -300;

test('story page: offsetMinutes reads Z, +HH:MM, -HH:MM and +HHMM, and null without an offset', () => {
  assert.strictEqual(L.offsetMinutes('2026-01-05T10:00:00Z'), 0);
  assert.strictEqual(L.offsetMinutes('2026-01-05T10:00:00-05:00'), -300);
  assert.strictEqual(L.offsetMinutes('2026-01-05T10:00:00+0530'), 330);
  assert.strictEqual(L.offsetMinutes('2026-01-05T10:00:00'), null);
  assert.strictEqual(L.offsetMinutes(undefined), null);
});

test('story page: parseTime treats an offsetless time as invalid once a zone is set', () => {
  assert.strictEqual(L.parseTime('2026-01-05T10:00:00', ZONE), null);
  assert.notStrictEqual(L.parseTime('2026-01-05T10:00:00', null), null);
  assert.strictEqual(L.parseTime('2026-01-05T10:00:00-05:00', ZONE).toISOString(), '2026-01-05T15:00:00.000Z');
  for (const bad of ['yesterday', '', 42, null, undefined]) assert.strictEqual(L.parseTime(bad, ZONE), null, String(bad));
});

test('story page: events sort by time, with invalid and offsetless times last in recorded order', () => {
  const events = [
    { at: 'not a time', title: 'bad-1' },
    { at: '2026-01-05T10:20:00-05:00', title: 'b' },
    { at: '2026-01-05T10:20:00', title: 'offsetless' },
    { at: '2026-01-05T15:05:00Z', title: 'a' },
    'not an object',
    { title: 'bad-2' },
  ];
  assert.deepStrictEqual(plain(L.sortEvents(events, ZONE).map((e) => e.title)), ['a', 'b', 'bad-1', 'offsetless', 'bad-2']);
});

test('story page: kindOf keeps the six kinds and maps anything else to other', () => {
  for (const kind of ['requirement', 'decision', 'build', 'review', 'correction', 'milestone']) {
    assert.strictEqual(L.kindOf({ kind }), kind);
  }
  for (const kind of ['Review', 'bogus', '', undefined, 3]) assert.strictEqual(L.kindOf({ kind }), 'other', String(kind));
  assert.strictEqual(L.kindLabel('milestone'), 'Milestone');
});

test('story page: clock times use the sprint offset, on a 12-hour clock', () => {
  assert.strictEqual(L.clockTime('2026-01-05T15:07:00Z', ZONE), '10:07 AM');
  assert.strictEqual(L.clockTime('2026-01-05T12:00:00-05:00', ZONE), '12:00 PM');
  assert.strictEqual(L.clockTime('2026-01-06T05:05:00Z', ZONE), '12:05 AM');
  assert.strictEqual(L.clockTime('2026-01-05T23:59:00-05:00', ZONE), '11:59 PM');
  assert.strictEqual(L.clockTime('nope', ZONE), L.DASH);
  assert.strictEqual(L.DASH.charCodeAt(0), 0x2013);
});

test('story page: elapsed minutes and event time labels', () => {
  const start = '2026-01-05T10:00:00-05:00';
  assert.strictEqual(L.minutesBetween(start, '2026-01-05T10:31:59-05:00', ZONE), 31);
  assert.strictEqual(L.minutesBetween(start, '2026-01-05T10:31:00', ZONE), null);
  assert.strictEqual(L.eventTime({ at: '2026-01-05T10:28:00-05:00' }, start, ZONE), '10:28 AM (28 min)');
  assert.strictEqual(L.eventTime({ at: '2026-01-05T10:28:00-05:00', late: true }, start, ZONE), '10:28 AM (28 min), noted late');
  assert.strictEqual(L.eventTime({ at: 'garbage' }, start, ZONE), 'time not recorded');
  assert.strictEqual(L.eventTime({}, start, ZONE), 'time not recorded');
  const sorted = [{ at: '2026-01-05T10:10:00-05:00' }, { at: '2026-01-05T10:40:00-05:00' }, { at: 'bad' }];
  assert.strictEqual(L.elapsed({ start }, sorted, ZONE), 40, 'the last event with a valid time');
});

test('story page: AC status is compared exactly; other values are unknown and not counted as met', () => {
  assert.deepStrictEqual(plain(L.acStatus('met')), ['ok', 'Met']);
  assert.deepStrictEqual(plain(L.acStatus('not met')), ['danger', 'Not met']);
  for (const s of ['Met', 'MET', 'not-met', 'done', '', undefined]) assert.deepStrictEqual(plain(L.acStatus(s)), ['info', 'Unknown'], String(s));
});

test('story page: tiles count met ACs, unknowns, reviews and corrections, and show the hidden score only when given', () => {
  const meta = {
    start: '2026-01-05T10:00:00-05:00', coreComplete: '2026-01-05T10:31:00-05:00',
    acs: [{ id: 'AC-1', status: 'met' }, { id: 'AC-2', status: 'Met' }, { id: 'AC-3', status: 'not met' }],
    tests: { passed: 5, total: 6 },
  };
  const events = [{ kind: 'review' }, { kind: 'review' }, { kind: 'correction' }, { kind: 'Correction' }];
  const tiles = plain(L.tiles(meta, events, ZONE));
  assert.deepStrictEqual(tiles, [
    ['Core complete', '31 min'],
    ['Acceptance criteria met', '1 of 3 (1 unknown)'],
    ['Tests passing', '5 of 6'],
    ['Reviews', 2],
    ['Self-corrections', 1],
  ]);
  const withHidden = plain(L.tiles({ ...meta, hidden: { found: 3, total: 4 } }, events, ZONE));
  assert.deepStrictEqual(withHidden[2], ['Hidden criteria found', '3 of 4']);
  assert.deepStrictEqual(plain(L.tiles({}, [], null)).map((t) => t[1]), [L.DASH, L.DASH, L.DASH, 0, 0]);
});

test('story page: rootProblem names what is missing and points to make-story.mjs', () => {
  assert.strictEqual(L.rootProblem({ meta: {}, events: [] }), null);
  const bare = L.rootProblem([]);
  assert.match(bare, /missing a "meta" object and an "events" array/);
  assert.match(bare, /make-story\.mjs/);
  assert.match(L.rootProblem({ meta: {} }), /"events" array/);
  assert.doesNotMatch(L.rootProblem({ meta: {} }), /"meta" object/);
  assert.match(L.rootProblem({ meta: [], events: [] }), /"meta" object/);
  assert.match(L.rootProblem(null), /"meta" object and an "events" array/);
});

test('story page: the sample renders its tiles, ACs and timeline with no error', () => {
  const { nodes, document } = runPage(SAMPLE);
  assert.strictEqual(nodes['story-error'].hidden, true);
  assert.strictEqual(document.title, 'How Example project was built');
  assert.strictEqual(nodes['story-title'].textContent, 'Example project');
  assert.strictEqual(nodes['story-clock'].textContent, '45-minute sprint, 10:00 AM to 10:45 AM.');
  assert.strictEqual(nodes['story-elapsed'].textContent, 'Elapsed: 36 min to the last event.');
  assert.deepStrictEqual(nodes['story-tiles'].children.map((li) => li.className), Array(6).fill('ui-card'));
  assert.deepStrictEqual(nodes['story-acs'].children.map((li) => li.children[0].className), ['ui-chip ui-chip--ok', 'ui-chip ui-chip--danger']);
  const items = nodes['story-timeline'].children;
  assert.deepStrictEqual(items.map((li) => li.attrs['data-kind']), ['requirement', 'build', 'review', 'correction', 'milestone', 'decision']);
  assert.match(textOf(items[3]), /Caught by: the refuter, not the tests/);
});

test('story page: a bare array in the block shows the alert and renders no empty sprint', () => {
  const { nodes } = runPage('[{"at": "2026-01-05T10:00:00Z", "kind": "build", "title": "x"}]');
  assert.strictEqual(nodes['story-error'].hidden, false);
  assert.strictEqual(nodes['story-error'].className, 'ui-alert ui-alert--danger');
  assert.match(nodes['story-error'].textContent, /"meta" object and an "events" array.*make-story\.mjs/);
  assert.deepStrictEqual(nodes['story-tiles'].children, []);
  assert.deepStrictEqual(nodes['story-timeline'].children, []);
});

test('story page: unreadable JSON shows the alert', () => {
  const { nodes } = runPage('{ not json');
  assert.strictEqual(nodes['story-error'].hidden, false);
  assert.match(nodes['story-error'].textContent, /could not be read as JSON/);
});

test('story page: an event with an invalid time renders last, labelled "time not recorded", with no datetime', () => {
  const block = JSON.stringify({
    meta: { start: '2026-01-05T10:00:00-05:00' },
    events: [
      { at: '2026-01-05T10:20', kind: 'decision', title: 'offsetless' },
      { at: '2026-01-05T10:05:00-05:00', kind: 'build', title: 'first' },
    ],
  });
  const items = runPage(block).nodes['story-timeline'].children;
  assert.deepStrictEqual(items.map((li) => li.children[3].children[0].textContent), ['first', 'offsetless']);
  assert.strictEqual(items[1].children[2].textContent, 'time not recorded');
  assert.strictEqual(items[1].children[2].attrs.datetime, undefined);
  assert.strictEqual(items[0].children[2].attrs.datetime, '2026-01-05T10:05:00-05:00');
});

test('story page: the script never writes HTML strings or loads anything', () => {
  assert.doesNotMatch(SCRIPT, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|fetch\(|XMLHttpRequest|import\(/);
});
