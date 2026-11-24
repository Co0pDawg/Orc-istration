import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveProfile, loadProfile } from '../src/store.js';

const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'store-')), 'profile.json');

test('saveProfile sorts keys, drops nulls and keeps a backup', () => {
  const file = tempFile();
  fs.writeFileSync(file, 'old');
  saveProfile(file, { b: 1, a: null, c: 'x' });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{\n  "b": 1,\n  "c": "x"\n}\n');
  assert.strictEqual(fs.readFileSync(`${file}.bak`, 'utf8'), 'old');
});

test('loadProfile reads what saveProfile wrote', () => {
  const file = tempFile();
  saveProfile(file, { name: 'n' });
  assert.deepStrictEqual(loadProfile(file), { name: 'n' });
});
