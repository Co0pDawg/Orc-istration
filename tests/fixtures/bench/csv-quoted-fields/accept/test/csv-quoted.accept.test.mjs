import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine } from '../src/csv.js';

test('unquoted fields behave as before', () => {
  assert.deepStrictEqual(parseLine('a,b,c'), ['a', 'b', 'c']);
  assert.deepStrictEqual(parseLine('a,,c'), ['a', '', 'c']);
  assert.deepStrictEqual(parseLine(''), ['']);
});

test('a quoted field may hold commas', () => {
  assert.deepStrictEqual(parseLine('"a,b",c'), ['a,b', 'c']);
  assert.deepStrictEqual(parseLine('x,"1,2,3"'), ['x', '1,2,3']);
});

test('two double quotes inside a quoted field are one literal quote', () => {
  assert.deepStrictEqual(parseLine('"say ""hi""",x'), ['say "hi"', 'x']);
  assert.deepStrictEqual(parseLine('"""",y'), ['"', 'y']);
});

test('an empty quoted field is an empty string', () => {
  assert.deepStrictEqual(parseLine('"",b'), ['', 'b']);
  assert.deepStrictEqual(parseLine('a,""'), ['a', '']);
});
