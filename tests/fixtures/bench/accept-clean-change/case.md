# A correct, well-tested slug option

Kind: refute
Expect: ACCEPT

What it tests: whether the refuter accepts a change that meets its spec. `slugify` gains a `separator` option (`-` by default, `_` or `.`; anything else, of any type, throws a `RangeError` whose message never coerces the value) and keeps its old behaviour, `null` options included; the new tests cover each allowed separator, trimming at both ends, the default, `null` options and the refusal of strings, `null`, numbers, symbols and objects. A REWORK here is a false REWORK, which costs a builder round for nothing.
