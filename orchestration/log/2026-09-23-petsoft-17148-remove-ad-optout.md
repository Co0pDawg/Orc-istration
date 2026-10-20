# 2026-09-23 — Petsoft — remove the "Hide Petsoft Ads" org opt-out

Date: 2026-09-23
Project: Petsoft
Branch: feature/17148-house-ads (PR 5990, Cooper's)
Task: #17148. Product decision from Ira in Teams: org owners cannot turn off ads; the tier is the only switch.
Outcome: shipped. Pushed f0ee65c3a; build 0 warnings; HouseAd unit tests 45/45; the gate mutation was caught. PR description and the 17148 checklist are updated.

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | builder | Opus 5.5 | remove the rule end to end: gate, Up.sql cleanup, local row, Identifiers regen, tests, docs | 110,256 | 20 | 6.9 | DONE; also caught an extra XMLDoc ref and dead settings-page helpers | earned — the regen + local DB + FK-order work was over 5 tool calls |
| 2 | fable | Opus 5.5 | inline review of the diff + FK check (instead of a refuter, since the diff is small and mostly deletion) | — | 2 | 2 | ACCEPT | earned |

**Totals:** 110k subagent tokens, about 7 min of agent time. Fable context: unmeasured by /context (session budget went from about 15.00M to 14.96M left over this task).

**Loop signal:** the builder raised 2 scope items beyond the spec (the AuthenticatedLayout XMLDoc, and settings-page helpers left with no callers). Both were correct. No refuter was run; the inline review found nothing.

**Spec misses:** the spec listed reference sites from a grep that excluded some doc comments. Lesson: a grep for a removed identifier should include camelCase ids and prose in every file type, not just the canonical name.
