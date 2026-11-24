# Expected findings: save-rewrites-file

| Id | File | Lines | Defect |
|----|------|-------|--------|
| E1 | src/store.js | 5-10, 16-21 | `setDisplayName` writes through `saveProfile`, which re-sorts every key, drops `null` fields and overwrites `<file>.bak`: the rest of the file changes and the only backup of the original is lost |
