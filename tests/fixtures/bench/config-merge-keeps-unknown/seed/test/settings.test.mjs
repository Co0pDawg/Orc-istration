import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSettings, normalizeSettings } from '../src/settings.js';

test('normalizeSettings fills the defaults', () => {
  assert.deepStrictEqual(normalizeSettings({}), { theme: 'light', fontSize: 12, features: {} });
});

test('loadSettings reads and normalizes a file', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'settings-')), 'settings.json');
  fs.writeFileSync(file, '{"theme":"dark","extra":1}');
  assert.deepStrictEqual(loadSettings(file), { theme: 'dark', fontSize: 12, features: {} });
});
