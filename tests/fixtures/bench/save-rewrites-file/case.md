# A one-field update through a save that rewrites the file

Kind: refute
Expect: REWORK

What it tests: whether the refuter reads what a shared function does before accepting a call to it. `setDisplayName` loads the profile, changes one field and hands it to `saveProfile`, the one save path, which sorts every key, drops every `null` field and copies the current file over `<file>.bak`. The spec said the rest of the file must stay untouched and the existing backup (the only copy of the original import) must survive; the change's test builds its file with `saveProfile` itself and reads back only two fields, so it passes; that test gap is the second planted defect.
