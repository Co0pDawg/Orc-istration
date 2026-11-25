import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine } from '../src/csv.js';

test('splits plain fields', () => {
  assert.deepStrictEqual(parseLine('a,b,c'), ['a', 'b', 'c']);
});

test('keeps empty fields', () => {
  assert.deepStrictEqual(parseLine('a,,c'), ['a', '', 'c']);
  assert.deepStrictEqual(parseLine(''), ['']);
});
