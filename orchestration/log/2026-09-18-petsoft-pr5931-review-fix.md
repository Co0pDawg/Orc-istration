# 2026-09-18 — Petsoft — PR 5931 pre-pr-review + fix loop

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| code-reviewer (claude) | session (Opus) | review | 139,896 | 19 | 3.9 | 8 findings | earned — HttpGet + unscoped run load |
| silent-failure-hunter (claude) | session | review | 112,653 | 16 | 3.4 | 7 findings | earned — partial-post deletion |
| comment-analyzer (claude) | session | review | 143,835 | 24 | 4.2 | 6 findings | marginal — mostly duplicates + doc typo |
| type-design-analyzer (claude) | session | review | 102,077 | 11 | 3.0 | 5 findings | marginal — but refuted a sibling's bulk-guard finding |
| pr-test-analyzer (claude) | session | review | 119,383 | 15 | 2.3 | 7 findings | earned — test gaps turned into 6 tests |
| playwright-reviewer (claude) | session | review | 119,441 | 17 | 3.2 | 7 findings | earned — provisioning self-heal issue |
| code-simplifier (claude) | session | review | 111,014 | 14 | 2.2 | 8 findings | marginal — 3 of 8 applied |
| 3x GPT mirrors (sol) | GPT | review mirror | n/a | n/a | ~8 | 9 findings | earned — 3 pre-existing tenant findings no Claude agent raised |
| builder | opus | 24-item fix spec | 158,687 | 37 | 14.2 | 23/24 done, 15/15 tests, 3 mutation checks | earned |
| refuter | opus | attack builder diff | 112,554 | 19 | 3.2 | ACCEPT, 2 should-fix | earned — cleared the deterministic-name risk, caught stale message text |

## Totals
Subagents: ~1.12M tokens (Claude) + 3 GPT runs; 10 Claude dispatches. Fable context: ~70k at task start (large CLAUDE.md/memory preload), ~135k at record time (estimate; status line not read).

## Loop signal
One builder round, refuter ACCEPT first pass, zero REWORK. Fable made one inline edit (guard message) and reran the filtered tests.

## Spec misses
- Spec said "<same message>" for the widened guard; the old text misdescribed a partial post — refuter caught it.
- Spec 20 asked for reuse-by-lookup without checking FacilityIdByNameAsync throws on a miss and that FacilityCreatePage was out of scope; refuter showed the risk was unreachable anyway.
- Session ran the review agents on the session model (Opus) before the /model switch to Fable; sed -i stripped CRLF on the inline edit (fixed with unix2dos).

## Addendum — live Playwright run
| builder (PW) | opus | first-ever run of the 2 new PW tests, own worktree + Petsoft_DEVELOP copy on :7399 | (see notification) | — | — | 2/2 pass fresh org, 2/2 pass cached org, DB rows confirm zero services | earned |
