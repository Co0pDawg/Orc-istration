# A settings update that must keep every other key

Kind: build
Accept: node --test test/enable-feature.accept.test.mjs

What it tests: whether the builder writes one field without rewriting the rest of the file. The seed has a `normalizeSettings` that fills defaults and drops keys it does not know, used by the app when it reads settings; reusing it on the write path is the easy, wrong route. `enableFeature(file, name)` must set `features[name] = true` and leave every other key, its order and every unknown field exactly as it was. The hidden acceptance tests round-trip a file with extra keys and nested unknown values, check key order and the exact output text, and check that no default is added.
