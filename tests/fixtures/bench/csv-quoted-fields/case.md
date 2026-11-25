# Quoted fields in a CSV line parser

Kind: build
Accept: node --test test/csv-quoted.accept.test.mjs

What it tests: a small, well-specified change to one function, with edge cases the brief names but the seed's tests do not cover. `parseLine` splits on every comma; the builder must add RFC 4180 quoting: a field wrapped in double quotes may hold commas, `""` inside it is one literal quote, and `""` alone is an empty field. The hidden acceptance tests check embedded commas, escaped quotes, an empty quoted field, and that unquoted fields behave as before.
