# Refuter brief: username rules

1. **Goal**, in one sentence.
   Review the builder's change on branch `change` against the spec and intent below, and return ACCEPT or REWORK.
2. **Scope**: exact files or URLs.
   The current folder, a git repo checked out on branch `change`; the diff is `git diff base...change` (`src/username.js`, `test/username.test.mjs`).
3. **May change / must not change.**
   Read-only review: change nothing in this folder.
   The spec the builder had: add three rules to `validateUsername(name)`, each adding its own problem string to the list it returns. (a) Only lower-case letters, digits and hyphens are allowed. (b) The name must start with a letter. (c) The name must not end with a hyphen. The length rules stay as they are. Add a test for each rule.
4. **Must verify**: exact commands.
   `git diff base...change` and `node --test`.
5. **Do not**: known traps.
   Do not edit, commit or switch branches in this folder. Mutation tests run only in a throwaway worktree (`git worktree add`), removed before you report.
6. **Output format and cap** (default 40 lines).
   Your role's report format, at most 40 lines, starting with the `VERDICT:` line.
7. **Known**: facts already established.
   Node 22, ES modules, `node:test` with `assert/strict`, no dependencies. The builder reports that `node --test` passes.
8. **Scratch path**: `<session scratchpad>/<agent>-<topic>.md` for overflow; the report is the path plus a short summary.
   none: the report fits the cap; return it inline.
9. **Intent** (refuters; builders and debuggers write `n/a`): the ticket brief path or the acceptance criteria verbatim, or `none: <why>`.
   Acceptance criteria: a username is 3 to 20 characters of lower-case letters, digits and hyphens, starts with a letter and does not end with a hyphen; the sign-up form shows every rule a name breaks.
10. **Data precondition** (builders/refuters): the real rows or paths the feature depends on; query them, don't exercise one seeded row. The loop verifies the spec; this line makes the spec verify the requirement.
   Try a name that breaks each rule on its own, and one that breaks two at once.
11. **Board** (builders/refuters): `BOARD: <board address> card cards/<card id> stage <label>`, so the agent posts its milestones and moves its own stage. Give the full `cards/<id>` path, or the agent may look the card up wrong and skip every board write.
   BOARD: none
