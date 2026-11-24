# A correct, well-tested slug option

Kind: refute
Expect: ACCEPT

What it tests: whether the refuter accepts a change that meets its spec. `slugify` gains a `separator` option (`-` by default, `_` or `.`; anything else throws a `RangeError`) and keeps its old behaviour; the new tests cover each allowed separator, trimming at both ends, the default and the refusal. A REWORK here is a false REWORK, which costs a builder round for nothing.
