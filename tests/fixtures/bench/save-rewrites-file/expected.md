# Expected findings: save-rewrites-file

| Id | File | Lines | Defect |
|----|------|-------|--------|
| E1 | src/store.js | 5-10, 16-21 | `setDisplayName` writes through `saveProfile`, which re-sorts every key, drops `null` fields and overwrites `<file>.bak`: the rest of the file changes and the only backup of the original is lost |
| E2 | test/store.test.mjs | 24-30 | the `setDisplayName` test writes its fixture through `saveProfile` (already sorted, no `null`, no prior `.bak`) and reads back only two fields, so it cannot see the reordering, the dropped `null` field or the overwritten backup |
