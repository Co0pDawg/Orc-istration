import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retry } from '../src/retry.js';

test('returns the first success', async () => {
  let calls = 0;
  const value = await retry(async () => {
    calls++;
    if (calls < 2) throw new Error('flaky');
    return 'ok';
  }, { attempts: 3, sleep: async () => {} });
  assert.strictEqual(value, 'ok');
  assert.strictEqual(calls, 2);
});

test('rethrows the last error when every attempt fails', async () => {
  await assert.rejects(retry(async (i) => { throw new Error(`fail ${i}`); }, { attempts: 2, sleep: async () => {} }), /fail 1/);
});
