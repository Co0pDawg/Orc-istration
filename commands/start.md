---
description: "Work a ticket end to end: fetch and judge it, plan, branch, grill, builder/refuter loop with commit and push per accepted task, full tests once, pre-PR review, durable-rules check, live checklist on the ticket (workflows/start.md)."
argument-hint: <work item id or URL> [--lite|--full]
allowed-tools:
  - Bash
  - Glob
  - Grep
  - Read
  - Write
  - Edit
  - AskUserQuestion
  - Agent
  - SendMessage
  - EnterPlanMode
  - ExitPlanMode
---

# Start

**Arguments:** "$ARGUMENTS"

1. Find the Orc-istration checkout: the `ORC_HOME` environment variable when it is set (`echo "$ORC_HOME"`), otherwise `~/.claude`. Call it CHECKOUT and confirm `CHECKOUT/workflows/start.md` exists there; if it does not, stop and say to set `ORC_HOME` to the checkout.
2. Read `CHECKOUT/workflows/README.md`, then `CHECKOUT/workflows/start.md`, and follow it with these arguments. Run the grill and the review panel in this session by following `CHECKOUT/workflows/grill.md` and `CHECKOUT/review/PROCEDURE.md`; launch the panel's explorers in one message, each with `run_in_background: true`. Plan with EnterPlanMode and ExitPlanMode; dispatch every agent by its roster name as `subagent_type`; resume a builder with SendMessage; ask the developer with `AskUserQuestion`.
