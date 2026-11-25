# A spec requirement silently dropped

Kind: refute
Expect: REWORK

What it tests: whether the refuter checks the spec line by line rather than the diff on its own. The spec lists three username rules; the change implements and tests two of them (allowed characters, starts with a letter) and leaves out the third (must not end with a hyphen). Everything it does is correct and every test passes, so only a requirement-by-requirement check finds that `abc-` is still accepted.
