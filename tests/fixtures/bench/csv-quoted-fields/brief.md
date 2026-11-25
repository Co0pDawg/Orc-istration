# Builder brief: quoted CSV fields

1. **Goal**, in one sentence.
   Make `parseLine` in `src/csv.js` handle RFC 4180 quoted fields.
2. **Scope**: exact files or URLs.
   `src/csv.js`, `test/csv.test.mjs` (paths relative to the current folder, a git repo on branch `base`).
3. **May change / must not change.**
   May change: those two files. Must not change: `package.json`; no new files, no dependencies.
   Rules: a field wrapped in double quotes may contain commas; inside a quoted field two double quotes (`""`) stand for one literal double quote; a field that is exactly `""` is an empty string; unquoted fields keep today's behaviour (split on every comma, empty fields kept, an empty line is one empty field). The input is one line with no line breaks; behaviour on malformed quoting is not specified.
4. **Must verify**: exact commands.
   `node --test` (all tests pass, the existing ones and the ones you add).
5. **Do not**: known traps.
   Do not commit. Do not change the function's name or signature. Do not use a regular expression that splits on commas outside quotes without handling `""`.
6. **Output format and cap** (default 40 lines).
   At most 20 lines: files changed, the test command and its result.
7. **Known**: facts already established.
   Node 22, ES modules, `node:test` with `assert/strict`. The existing tests pass on the base commit.
8. **Scratch path**: `<session scratchpad>/<agent>-<topic>.md` for overflow; the report is the path plus a short summary.
   none: the report fits the cap; return it inline.
9. **Intent** (refuters; builders and debuggers write `n/a`): the ticket brief path or the acceptance criteria verbatim, or `none: <why>`.
   n/a
10. **Data precondition** (builders/refuters): the real rows or paths the feature depends on; query them, don't exercise one seeded row. The loop verifies the spec; this line makes the spec verify the requirement.
   Cover each rule in item 3 with its own test: embedded commas, escaped quotes, an empty quoted field, and unquoted fields unchanged.
11. **Board** (builders/refuters): `BOARD: <board address> card cards/<card id> stage <label>`, so the agent posts its milestones and moves its own stage. Give the full `cards/<id>` path, or the agent may look the card up wrong and skip every board write.
   BOARD: none
