# Capped exponential backoff in a retry helper

Kind: build
Accept: node --test test/retry-backoff.accept.test.mjs

What it tests: adding options to an async helper without breaking its contract, with time injected so the tests never sleep. `retry` calls a function until it succeeds or the attempts run out; the builder must wait between attempts (`baseMs * 2 ** n`, capped at `maxMs`), through an injected `sleep`, never after the last attempt, and rethrow at once, without waiting, an error that `isRetryable` rejects. The hidden acceptance tests check the delay sequence and the cap, the number of calls, the last error being rethrown, and the non-retryable path.
