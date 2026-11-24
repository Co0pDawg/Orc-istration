# Refuter brief: page count

1. **Goal**, in one sentence.
   Review the builder's change on branch `change` against the spec and intent below, and return ACCEPT or REWORK.
2. **Scope**: exact files or URLs.
   The current folder, a git repo checked out on branch `change`; the diff is `git diff base...change` (`src/paginate.js`, `test/paginate.test.mjs`).
3. **May change / must not change.**
   Read-only review: change nothing in this folder.
   The spec the builder had: add `pageCount(total, size)` to `src/paginate.js`, returning how many pages `total` items fill at `size` items per page (`size` is a positive whole number). No items means 0 pages; a last, partly filled page counts as a page. `page` is unchanged. Add tests for the count.
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
   Acceptance criteria: the pager shows "page N of M" with the right M for any number of items, including none and an exact multiple of the page size.
10. **Data precondition** (builders/refuters): the real rows or paths the feature depends on; query them, don't exercise one seeded row. The loop verifies the spec; this line makes the spec verify the requirement.
   Check the count for no items, fewer items than a page, an exact multiple of the page size and one item past it.
11. **Board** (builders/refuters): `BOARD: <board address> card cards/<card id> stage <label>`, so the agent posts its milestones and moves its own stage. Give the full `cards/<id>` path, or the agent may look the card up wrong and skip every board write.
   BOARD: none
