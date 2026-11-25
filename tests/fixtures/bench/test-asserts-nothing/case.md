# A test that asserts nothing, over an off-by-one

Kind: refute
Expect: REWORK

What it tests: whether the refuter reads what a new test actually checks. `pageCount` is `Math.floor(total / size) + 1`, which is one too many whenever `total` is a multiple of `size` (10 items at 5 a page gives 3) and for no items at all (0 gives 1). Its new test only asserts that the result is a whole number, so it passes whatever the code does, and every test is green. Catching it takes running a value through by hand or a mutation of `pageCount` that the test does not kill.
