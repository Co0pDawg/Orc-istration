# PR 6066 test (#13833 Contacts/Addresses merge, Darrius) — 2026-10-01

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result | Rating |
|---|---|---|---|---|---|---|---|---|
| 1 | builder | opus | worktree + DB copy, build, unit + CustomerTests, live How-to-Test walk, probes | 199,098 | 80 | 20.5 | 4 defects (A–D), all reproduced live | earned — A/B/C are real regressions the PR's tests miss |

Totals: 1 dispatch, ~199k subagent tokens, ~21 min. Fable context: ~78k at start, ~110k at writing.
Loop signal: test-only task, no review tier run. Fable diff read added 2 probes (Address FK, default-contact delete); both produced findings (D + FK rollback check).
Spec misses: brief did not mention the Parents area reuses ContactsListModel/ContactEditModel — builder found B/C on its own; next time grep model reuse across Areas before writing the brief.

## Round 2: fix + push (101ee0837)
| # | Agent | Model | Purpose | Tokens | Tools | Min | Result | Rating |
|---|---|---|---|---|---|---|---|---|
| 2 | builder | opus | fix A–D + tests + live walk | 223,142 | 92 | 23 | all fixed, mutation-proved | earned |
| 2b | builder (resumed) | opus | Parents tenant scoping (E) | ~21,400 delta | 17 | 7.4 | fixed, 3 tests fail on old code | earned — closed an IDOR |
| 3 | refuter | sonnet | static + filtered rerun | 95,180 | 8 | 1.1 | ACCEPT, 0 must-fix | earned — Sonnet because the builder was ~245k |
Totals (all rounds): ~535k subagent tokens. Fable context: ~110k → ~135k.
Loop signal: no /pre-pr-review run on the fix commit (product code → full tier is owed; offered to user). Nothing caught after the push yet.
Spec misses: the fix spec missed the Parents tenant gap; the builder found it. Grep the Parents reuse of Customers models when speccing.

## Round 3: develop merge
| 4 | builder | opus | verify merge: KmsDbTool on copy, unit + 13 PW | 83,746 | 18 | 6.1 | all green | earned |
Conflicts (3 UITests/map files) resolved by Fable inline. PR thread 41126 posted at the user's request (no ado.ps1 verb for PR threads; used REST with the helper's token resource).
