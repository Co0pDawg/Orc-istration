import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(REPO, 'skills', 'sprint', 'make-story.mjs');
const BLOCK = /<script type="application\/json" id="sprint-events">([\s\S]*?)<\/script>/g;

function setup(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orc-story-'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

function run(dir, extra = []) {
  const args = [SCRIPT, '--events', path.join(dir, 'events.json'), '--meta', path.join(dir, 'meta.json'),
    '--out', path.join(dir, 'docs', 'story.html'), ...extra];
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

const HOSTILE = '</script><img src=x onerror="alert(1)"><!-- ' + String.fromCharCode(0x2028, 0x2029);
const META = { title: 'Example', clock: 45, start: '2026-01-05T10:00:00-05:00', acs: [{ id: 'AC-1', text: 'a <b>', status: 'met' }] };
const EVENTS = [
  { at: '2026-01-05T10:07:00-05:00', kind: 'requirement', title: 'Requirements agreed' },
  { at: '2026-01-05T10:28:00-05:00', kind: 'correction', title: HOSTILE, detail: 'x </SCRIPT> y', caughtBy: 'the refuter' },
];

test('make-story: hostile text stays inside the sprint-events block and parses back to the same data', () => {
  const dir = setup({ 'events.json': JSON.stringify(EVENTS), 'meta.json': JSON.stringify(META) });
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  const page = fs.readFileSync(path.join(dir, 'docs', 'story.html'), 'utf8');
  const blocks = [...page.matchAll(BLOCK)];
  assert.equal(blocks.length, 1, 'exactly one sprint-events block');
  const inner = blocks[0][1];
  assert.ok(!inner.includes('<'), 'no "<" inside the block');
  assert.ok(!inner.includes(String.fromCharCode(0x2028)) && !inner.includes(String.fromCharCode(0x2029)), 'no raw U+2028 or U+2029');
  assert.deepStrictEqual(JSON.parse(inner), { meta: META, events: EVENTS });
  // The rest of the template is unchanged: only the block contents were replaced.
  const template = fs.readFileSync(path.join(REPO, 'skills', 'sprint', 'story-template.html'), 'utf8');
  assert.equal(page.replace(BLOCK, ''), template.replace(BLOCK, ''));
});

test('make-story: an events file that is not a JSON array exits 1 and writes nothing', () => {
  for (const bad of ['{"at": "x"}', '[1, 2]', '{ not json']) {
    const dir = setup({ 'events.json': bad, 'meta.json': JSON.stringify(META) });
    const r = run(dir);
    assert.equal(r.status, 1, `events ${bad}`);
    assert.match(r.stderr, /make-story: .*events/);
    assert.equal(fs.existsSync(path.join(dir, 'docs', 'story.html')), false);
  }
});

test('make-story: a meta file that is not a JSON object exits 1', () => {
  const dir = setup({ 'events.json': JSON.stringify(EVENTS), 'meta.json': '[]' });
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /meta file .* must hold a JSON object/);
});

test('make-story: a template without the sprint-events block exits 1', () => {
  const dir = setup({ 'events.json': JSON.stringify(EVENTS), 'meta.json': JSON.stringify(META), 'plain.html': '<!doctype html><p>no block</p>' });
  const r = run(dir, ['--template', path.join(dir, 'plain.html')]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /exactly one sprint-events block; found 0/);
  assert.equal(fs.existsSync(path.join(dir, 'docs', 'story.html')), false);
});
