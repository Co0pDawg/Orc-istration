# 2026-10-06 Petsoft PR 6118 (#17609) review + live test

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| builder | opus | Live-app run of PR How-to-Test steps | 157,132 | 76 | 26 | All steps PASS on fresh build | earned: found stale binary (bug repro'd live = red), then green after rebuild |

Fable inline: diff read, sibling-bug grep, targeted tests (18/18), mutation check (3 fail).

## Totals
1 dispatch, 157k subagent tokens. Fable context: not captured.

## Loop signal
No pre-PR review tier run (4-line rename read inline; full tier offered, not requested). No later review/CI data yet.

## Spec misses
- Mutation check restored files without rebuilding; the live builder started on a buggy binary. Rebuild after any mutation restore.
- PR test steps omit approving Pending Approval portal reservations (100% refundable until approved).
