import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from '../src/paginate.js';

const items = ['a', 'b', 'c', 'd', 'e'];

test('returns the items of one page', () => {
  assert.deepStrictEqual(page(items, 1, 2), ['a', 'b']);
  assert.deepStrictEqual(page(items, 3, 2), ['e']);
});

test('a page past the end is empty', () => {
  assert.deepStrictEqual(page(items, 4, 2), []);
});
