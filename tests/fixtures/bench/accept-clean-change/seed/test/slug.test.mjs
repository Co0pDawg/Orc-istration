import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slug.js';

test('lower-cases and joins words with hyphens', () => {
  assert.strictEqual(slugify('Hello World'), 'hello-world');
});

test('collapses runs and trims the ends', () => {
  assert.strictEqual(slugify('  Rock & Roll!! '), 'rock-roll');
  assert.strictEqual(slugify('***'), '');
});
