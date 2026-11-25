# Builder brief: enable one feature in the settings file

1. **Goal**, in one sentence.
   Add `enableFeature(file, name)` to `src/settings.js`, which switches one feature on in a settings file and changes nothing else in it.
2. **Scope**: exact files or URLs.
   `src/settings.js`, `test/settings.test.mjs` (paths relative to the current folder, a git repo on branch `base`).
3. **May change / must not change.**
   May change: those two files. Must not change: `normalizeSettings`, `loadSettings` and `writeSettings` keep their behaviour; `package.json`; no new files, no dependencies.
   `enableFeature(file, name)` reads the JSON file, sets `features[name]` to `true` and writes the file back as two-space indented JSON with a trailing newline. Every other key, the order of every key, nested values, `null` values and keys the app does not know stay exactly as they were. When there is no `features` object, add one after the existing keys. Fill in no defaults.
4. **Must verify**: exact commands.
   `node --test` (all tests pass, the existing ones and the ones you add).
5. **Do not**: known traps.
   Do not commit. `normalizeSettings` drops unknown keys and adds defaults: it is for reading, not for this write.
6. **Output format and cap** (default 40 lines).
   At most 20 lines: files changed, the test command and its result.
7. **Known**: facts already established.
   Node 22, ES modules, `node:test` with `assert/strict`. Settings files are written by other tools too, so they hold keys this app does not know.
8. **Scratch path**: `<session scratchpad>/<agent>-<topic>.md` for overflow; the report is the path plus a short summary.
   none: the report fits the cap; return it inline.
9. **Intent** (refuters; builders and debuggers write `n/a`): the ticket brief path or the acceptance criteria verbatim, or `none: <why>`.
   n/a
10. **Data precondition** (builders/refuters): the real rows or paths the feature depends on; query them, don't exercise one seeded row. The loop verifies the spec; this line makes the spec verify the requirement.
   Test with a file that holds unknown keys, nested values and a `null`, in an order that is not alphabetical, and compare the whole output text.
11. **Board** (builders/refuters): `BOARD: <board address> card cards/<card id> stage <label>`, so the agent posts its milestones and moves its own stage. Give the full `cards/<id>` path, or the agent may look the card up wrong and skip every board write.
   BOARD: none
