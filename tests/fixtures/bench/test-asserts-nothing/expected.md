# Expected findings: test-asserts-nothing

| Id | File | Lines | Defect |
|----|------|-------|--------|
| E1 | src/paginate.js | 7-10 | `pageCount` is `Math.floor(total / size) + 1`: one page too many when `total` is a multiple of `size` (10/5 gives 3) and 1 instead of 0 for no items |
| E2 | test/paginate.test.mjs | 16-21 | the `pageCount` test asserts only that the result is an integer, so it passes for any implementation and never checks a count |
