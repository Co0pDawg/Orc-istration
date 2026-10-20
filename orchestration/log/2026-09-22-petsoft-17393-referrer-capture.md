# 2026-09-22 — Petsoft — 17393 marketing referrer/campaign capture

Task: implement work item 17393 end to end (spec, plan, filter + proc + view + Admin page + tests + docs + Playwright).

| # | Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | builder | opus | Tasks 1–4, 6 (schema, filter, lead link, Admin page, docs) | 263k | 97 | 22 | DONE, green build, 33/33 filtered tests, KmsDbTool applied, screenshots | earned — one dispatch covered all code; caught LeadHistory temporal need the plan missed |
| 2 | refuter | opus | Round 1 review | 137k | 23 | 148 (wall; idle waiting on bg) | REWORK: 3 must-fix (CAMPAIGN from MARKETING_CAMPAIGN_ID, unbounded in-memory load, missing Demo tests) + 4 should-fix | earned — must-fix 1 was a real spec miss affecting 1,111 legacy rows |
| 3 | builder (resumed #1) | opus | Rework round 1 (10 items) | 289k (delta) | 17 | 7 | DONE, 54/54 filtered | earned — context reuse: 17 tool uses for 10 fixes |
| 4 | refuter | opus | Round 2 review | 118k | 14 | 2.5 | REWORK: 1 must-fix (`[` unescaped in LIKE, IPv6 host) + 2 nits | marginal — the finding was real but Fable fixed it inline in 4 tool calls; a 118k dispatch for one escape char |
| 5 | builder | opus | Task 5 Playwright in separate worktree | 159k | 44 | 16 | DONE 1/1, DB-verified lead attribution and spoof-key skip | earned — live-app verification isolated from the refuter's test host, zero collisions |
| 6 | general-purpose x6 (pre-pr-review agents) | fable | code-reviewer 152k/25, silent-failure-hunter 140k/10, comment-analyzer 167k/25, type-design 146k/16, playwright 106k/9, simplifier 137k/12 | 848k | 97 | ~11 | 20 findings, 0 issues | earned — staged 3+3, no 429s; the GPT mirror found the one warning (untraced /Features) none of the Claude agents did |
| 7 | builder | opus | 14 review fixes in one pass incl. Playwright + live app | 136k | 38 | 10 | DONE, 24 filtered + PW 1/1 | earned — one dispatch for all fixes |

Totals: 12 dispatches (7 build/review loop + 6 review agents counted as one row), ~1.95M subagent tokens, 330 tool uses. Fable context: ~40k at task start, ~110k at writing (after review).

Loop signal: 2 REWORK rounds, both with real findings; round 2 fix done inline by Fable per the "after two rounds Fable reads and decides" rule. No 429s. Parallel refuter + worktree Playwright builder worked (diff copied via `git diff --binary | git apply` plus untracked-file copy).

Spec misses: (1) spec §4 listed only utm keys for the view and forgot the existing `campaign` id — the whole legacy Promos scheme; (2) plan omitted `history.LeadHistory` for the system-versioned Lead table; (3) plan's REFERER_HOST expression returned NULL for path-less referrers; (4) plan said `[Keyless]` view entity but TestKmsDbContext cannot seed keyless entities. All caught by the builder or refuter, none escaped.
