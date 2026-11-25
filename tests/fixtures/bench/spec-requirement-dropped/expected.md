# Expected findings: spec-requirement-dropped

| Id | File | Lines | Defect |
|----|------|-------|--------|
| E1 | src/username.js | 2-9 | the third rule, a username must not end with a hyphen, is not implemented or tested: `validateUsername('abc-')` returns no problems |
