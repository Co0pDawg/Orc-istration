# 2026-09-24 — Petsoft — 17329 plan 8: Hours of Operation Playwright

| # | Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|-------|-------|---------|--------|-----------|-----|--------|-------|
| 1 | builder | opus | 8-task spec: 4 page objects, profile, provisioning flag, new suite, docs; run, 3 mutations, db checks | 238k | 74 | 28 | 8/8 green after fixing a delete-redirect race it found itself | earned |
| 2 | refuter | opus | rerun (= 2nd run on cached org) + own mutation (skip open override) | 156k | 36 | 7 | ACCEPT; 3 should-fixes (docs-row merge conflict with PR 6007, substring no-op check, cosmetic) | earned — the map-row conflict would have bitten the merge |
| 3 | code-reviewer | fable | pre-PR | 129k | 12 | 3 | approved; 3 nits (2 fixed) | marginal |
| 4 | playwright-reviewer | fable | pre-PR | 117k | 8 | 1 | approved; 1 warning fixed, 2 nits | earned — positional cell read |
| 5 | comment-analyzer | fable | pre-PR | 137k | 18 | 3 | approved; 1 stale neighbouring map clause fixed | marginal |
| 6 | code-simplifier | fable | pre-PR | 111k | 6 | 1 | approved; 1 fold applied, 2 nits wont-fix | marginal |

Totals: ~888k agent tokens, 154 tool uses, ~43 agent-minutes. Fable context: ~120k at task start, ~175k at writing.
Fable inline: ~25 fact-finding tool calls (hours views, Book page JS, timeslot procs/clamp, schedule week nav, provisioning keystone), spec, worktree, should-fix + nit batch (python edits; one regex-escape build break, fixed), local reruns, calibration log, PR draft.

Loop signal: zero REWORK rounds — the spec's "Established facts" carried every selector, format and clamp location, and the builder's only surprise (45-minute grid ⇒ 08:30/11:30 not 08:15/11:15) was a correct deviation. Pre-PR fan-out of 4 produced 1 warning worth fixing; the refuter had already found the merge-conflict risk.

Spec misses (mine):
- Said 08:15/11:15 for the count-0 checks without computing the shift grid (04:00 + 45-minute steps). Rule: when asserting an absent slot, derive it from the grid arithmetic in the spec.
- Did not state that PR 6007's docs-map row must be taken verbatim (only said so for the .cs hunk) → refuter found the conflict.
- Did not warn that a delete-then-redirect can pass a count-0 wait before the page reloads; builder hit it once (fixed with NetworkIdle after the wait).
- Spec line "verify once on the live page" for the override time ids was fine, but the same caveat should have covered the Schedules Index week filter (builder found the Filter button itself).
