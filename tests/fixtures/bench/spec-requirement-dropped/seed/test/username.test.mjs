import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateUsername } from '../src/username.js';

test('a name of 3 to 20 characters has no problems', () => {
  assert.deepStrictEqual(validateUsername('abc'), []);
  assert.deepStrictEqual(validateUsername('a'.repeat(20)), []);
});

test('length limits', () => {
  assert.deepStrictEqual(validateUsername('ab'), ['too short']);
  assert.deepStrictEqual(validateUsername('a'.repeat(21)), ['too long']);
});
