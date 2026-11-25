import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enableFeature } from '../src/settings.js';

const fileWith = (obj) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'accept-')), 'settings.json');
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
  return file;
};

test('a file with unknown keys round-trips, with only the feature added', () => {
  const file = fileWith({ zeta: 1, theme: 'dark', plugins: [{ id: 'p', on: null }], features: { a: false }, custom: { nested: [1, 'two'] } });
  enableFeature(file, 'b');
  const expected = { zeta: 1, theme: 'dark', plugins: [{ id: 'p', on: null }], features: { a: false, b: true }, custom: { nested: [1, 'two'] } };
  assert.strictEqual(fs.readFileSync(file, 'utf8'), `${JSON.stringify(expected, null, 2)}\n`);
});

test('a missing features object is added after the existing keys, and no default is filled in', () => {
  const file = fileWith({ beta: true, alpha: 'x' });
  enableFeature(file, 'search');
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(Object.keys(after), ['beta', 'alpha', 'features']);
  assert.deepStrictEqual(after, { beta: true, alpha: 'x', features: { search: true } });
});

test('an already enabled feature leaves the file text unchanged', () => {
  const file = fileWith({ features: { a: true }, keep: null });
  const before = fs.readFileSync(file, 'utf8');
  enableFeature(file, 'a');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
});

test('a disabled feature is switched on in place, keeping the order of the other features', () => {
  const file = fileWith({ features: { x: true, y: false, z: true } });
  enableFeature(file, 'y');
  assert.deepStrictEqual(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')).features), [['x', true], ['y', true], ['z', true]]);
});
