// Calls `fn(attempt)` (attempt counts from 0) until it resolves, at most `attempts` times, and rethrows the last error.
export async function retry(fn, { attempts = 3 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
