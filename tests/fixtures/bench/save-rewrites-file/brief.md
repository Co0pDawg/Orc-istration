# Refuter brief: set the display name

1. **Goal**, in one sentence.
   Review the builder's change on branch `change` against the spec and intent below, and return ACCEPT or REWORK.
2. **Scope**: exact files or URLs.
   The current folder, a git repo checked out on branch `change`; the diff is `git diff base...change` (`src/store.js`, `test/store.test.mjs`).
3. **May change / must not change.**
   Read-only review: change nothing in this folder.
   The spec the builder had: add `setDisplayName(file, name)` to `src/store.js`, which sets the `displayName` field of a profile file. Only that field may change: every other field, its value (`null` included), the key order and the formatting stay exactly as they were. The existing `<file>.bak` is the only copy of the profile as first imported and must not be overwritten or removed. Add a test.
4. **Must verify**: exact commands.
   `git diff base...change` and `node --test`.
5. **Do not**: known traps.
   Do not edit, commit or switch branches in this folder. Mutation tests run only in a throwaway worktree (`git worktree add`), removed before you report.
6. **Output format and cap** (default 40 lines).
   Your role's report format, at most 40 lines, starting with the `VERDICT:` line.
7. **Known**: facts already established.
   Node 22, ES modules, `node:test` with `assert/strict`, no dependencies. The builder reports that `node --test` passes. Profile files are also written by an import tool, so they hold `null` fields and keys in any order.
8. **Scratch path**: `<session scratchpad>/<agent>-<topic>.md` for overflow; the report is the path plus a short summary.
   none: the report fits the cap; return it inline.
9. **Intent** (refuters; builders and debuggers write `n/a`): the ticket brief path or the acceptance criteria verbatim, or `none: <why>`.
   Acceptance criteria: a user can rename themselves without any other change to their profile file, and the backup of their original import is kept.
10. **Data precondition** (builders/refuters): the real rows or paths the feature depends on; query them, don't exercise one seeded row. The loop verifies the spec; this line makes the spec verify the requirement.
   Check with a profile file as the import tool writes it: unsorted keys, a `null` field and an existing `.bak` file.
11. **Board** (builders/refuters): `BOARD: <board address> card cards/<card id> stage <label>`, so the agent posts its milestones and moves its own stage. Give the full `cards/<id>` path, or the agent may look the card up wrong and skip every board write.
   BOARD: none
