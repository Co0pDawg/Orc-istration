# 2026-10-16 Petsoft: Trail-Code trial

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| researcher | sonnet | Install trail-code in a sandbox, build tier-1 graph in throwaway worktree, compare 4 C# lookups vs grep | 62,584 | 17 | 9.9 | Not useful: 0 callers on all 4 targets, false callers on CreateInvoice, no .cshtml | earned: one dispatch settled adopt/skip |

**Totals:** 1 dispatch, 62.6k subagent tokens, ~10 min. Fable context: small at start (one WebFetch + reply) and at write.

**Loop signal:** no build loop, no pre-PR review tier (read-only trial).

**Spec misses:** brief asked for rg; rg not on Git Bash PATH, agent used git grep (fine). Brief named MCP tools that have no CLI form; `trail mcp` not exercised.
