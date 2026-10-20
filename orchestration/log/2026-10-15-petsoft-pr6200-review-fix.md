# PR 6200 review + fix (2026-10-15)

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| general-purpose (code-reviewer) | opus | Panel: correctness/tenant/session | 172,493 | 44 | 14.8 | 1 pre-existing warning (GET CSRF), password-reset ticket idea | marginal: no change-introduced defect found; slowest agent |
| general-purpose (silent-failure-hunter) | opus | Panel: error paths | 141,429 | 27 | 7.1 | 1 warning (refuted: documented intent), 4 suggestions | marginal: warning was a false positive; concurrency suggestions are real but minor |
| general-purpose (architecture-reviewer) | opus | Panel: flow/rollout (forced at XL) | 144,501 | 26 | 10.9 | 1 warning (retention hides live sessions from eviction) + 2 questions | earned: found the only change-introduced security gap, and both author questions |
| general-purpose (pr-test-analyzer) | opus | Panel: AC→test map | 164,862 | 12 | 3.9 | 2 warnings (owner predicate, eviction untested) | earned: both confirmed; the eviction gap was mutation-proved |
| general-purpose (comment-analyzer) | sonnet | Panel: docs/annotations | 136,983 | 16 | 5.5 | 2 issues (stale retention annotation and summary), 2 nits | earned: all fixed |
| general-purpose (type-design-analyzer) | sonnet | Panel: types | 85,164 | 9 | 3.4 | 0 findings | waste: no findings; the diff's types were trivial |
| general-purpose (code-simplifier) | sonnet | Panel: polish | 103,071 | 10 | 3.4 | 1 suggestion, 2 nits | marginal: none actioned |
| refuter | opus | Verify the 7 issues and warnings | 102,109 | 18 | 7.5 | 5 confirmed, 1 refuted, 1 pre-existing | earned: refuted the silent-failure-hunter warning and mutation-proved the eviction gap |
| builder | opus | Fix: retention cutoff, 2 tests, docs | 128,432 | 36 | 12.5 | done, 100/100 filtered, mutations fail | earned |
| refuter | opus | Static check of the fixes | 96,215 | 13 | 3.9 | ACCEPT + 1 wording should-fix | earned: cheap, and caught the annotation heading |

Totals: 10 dispatches, ~1.28M subagent tokens. Fable context: not captured at start, and not captured at writing either (no status line read).
Loop signal: peer-review tier XL with the full panel (7 agents), refuter-verified. The live-app How-to-Test run was skipped at Cooper's call (the Petsoft_PR6200 DB copy was restored, but KmsDbTool was never run on it). Later review/CI catches: none known yet.
Spec misses: (1) Fable's first BACKUP went to the session scratchpad, which the SQL service account cannot write to; use InstanceDefaultBackupPath. (2) The merge with develop was not a pure test conflict: develop's new QA endpoint carried a fail-open gate (fixed in the merge). (3) The classifier blocked resolving a conflict that dropped develop's test assertions even with Cooper's go-ahead; Cooper added a scoped Edit allow rule.

peer-review: score=1379 (product 869, tests 1856, docs 186) scored against a synthetic develop+6199@7f72db85d base, because 6199 is unmerged and its later fix 2f2ef0445 is not in 6200. Size tier L; risk hits MfaController.cs, Persistence.sql, Up.sql → tier XL. Unscoped score against develop was 1860.
Tuning note: type-design-analyzer on a diff whose "types" are view models plus one column add returned nothing. Consider not selecting it unless a type file adds or reshapes a public type.

## Round 2 (Cooper asked to address questions + suggestions)

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| builder | opus | Concurrency catches, Rise log level, 3 test gaps, forwarded-headers extraction | 197,349 | 72 | 20.4 | done, 372/372 filtered, 4 mutations fail | earned; missed a loop guard (it flagged this itself), and Fable added the 3-conflict cap and test inline |
| refuter | opus | Static check of round 2 | 117,959 | 13 | 4.2 | REWORK: misplaced doc comment; should-fix: eviction retry could delete a newly signed-in row | earned: the should-fix was a real correctness bug, fixed inline |

Round-2 totals: 2 dispatches, ~315k. Inline by Fable: Redis check via az (App Config labels: UAT/UAT-DEMO empty), filing bugs 17586 (extended) + 17940, the 17890 decision comment, the cap, and the refuter fixes. Full test run 6562/0, then a targeted rerun of 342/0 after the final edit. Pushed cd553bdba; PR thread 42089.
Spec miss: the round-2 spec did not ask for a loop bound on the retention retry, nor for limiting the eviction retry to the originally found ids. Both were caught (one by the builder, one by the refuter).
