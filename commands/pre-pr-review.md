---
description: "Run the review panel on the current branch changes: explorers over checklist lanes, a verifier for leads and issue and warning findings, one report, a run log (review/PROCEDURE.md)."
argument-hint: "[branch] [base] [code|errors|comments|types|tests|simplify|ui|arch|secondary|tickets] [lite|full] [ticket brief path]"
allowed-tools:
  - Bash
  - Glob
  - Grep
  - Read
  - Write
  - Edit
  - Agent
  - SendMessage
  - AskUserQuestion
---

# Pre-PR Review

**Arguments:** "$ARGUMENTS"

1. Find the Orc-istration checkout: the `ORC_HOME` environment variable when it is set (`echo "$ORC_HOME"`), else the "Setup checkout (this machine)" line in the rulebook's tool notes, else `~/.claude`. Call it CHECKOUT and confirm `CHECKOUT/review/PROCEDURE.md` exists there; if it does not, stop and say to set `ORC_HOME` to the checkout.
2. Read `CHECKOUT/review/PROCEDURE.md` and follow it with these arguments. Dispatch each explorer and the verifier by its roster name as `subagent_type`, never `general-purpose`; launch all selected explorers in one message, each with `run_in_background: true`, so they run in parallel; pass a tier override as `model:` (the Tiers line of the tool notes maps tiers to models); resume an explorer with SendMessage; ask the developer with `AskUserQuestion`.
