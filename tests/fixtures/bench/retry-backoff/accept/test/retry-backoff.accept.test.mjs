import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retry } from '../src/retry.js';

const recorder = () => {
  const delays = [];
  return { delays, sleep: async (ms) => { delays.push(ms); } };
};

test('waits baseMs * 2 ** n between attempts, capped at maxMs, and never after the last attempt', async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  await assert.rejects(
    retry(async () => { calls++; throw new Error(`boom ${calls}`); }, { attempts: 5, baseMs: 100, maxMs: 300, sleep }),
    /boom 5/,
  );
  assert.strictEqual(calls, 5);
  assert.deepStrictEqual(delays, [100, 200, 300, 300]);
});

test('defaults: 3 attempts, baseMs 100, maxMs 2000', async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  await assert.rejects(retry(async () => { calls++; throw new Error('x'); }, { sleep }));
  assert.strictEqual(calls, 3);
  assert.deepStrictEqual(delays, [100, 200]);
});

test('stops at the first success and returns its value', async () => {
  const { delays, sleep } = recorder();
  const value = await retry(async (i) => { if (i < 2) throw new Error('not yet'); return i; }, { attempts: 4, baseMs: 10, sleep });
  assert.strictEqual(value, 2);
  assert.deepStrictEqual(delays, [10, 20]);
});

test('an error isRetryable rejects is rethrown at once, without waiting', async () => {
  const { delays, sleep } = recorder();
  const fatal = new Error('fatal');
  let calls = 0;
  await assert.rejects(
    retry(async () => { calls++; throw fatal; }, { attempts: 5, sleep, isRetryable: (e) => e !== fatal }),
    (e) => e === fatal,
  );
  assert.strictEqual(calls, 1);
  assert.deepStrictEqual(delays, []);
});

test('a retryable error followed by a non-retryable one stops at the second', async () => {
  const { delays, sleep } = recorder();
  const fatal = new Error('fatal');
  let calls = 0;
  await assert.rejects(
    retry(async () => { calls++; throw calls === 1 ? new Error('flaky') : fatal; }, { attempts: 5, baseMs: 50, sleep, isRetryable: (e) => e !== fatal }),
    (e) => e === fatal,
  );
  assert.strictEqual(calls, 2);
  assert.deepStrictEqual(delays, [50]);
});
