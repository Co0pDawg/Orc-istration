---
description: Grill the developer on a plan until no decision is left open, in rounds of questions, then append the settled answers to the plan as a Decisions list (workflows/grill.md).
argument-hint: "[plan file]"
allowed-tools:
  - Bash
  - Glob
  - Grep
  - Read
  - Write
  - Edit
  - AskUserQuestion
  - Agent
---

# Grill

**Arguments:** "$ARGUMENTS"

1. Find the Orc-istration checkout: the `ORC_HOME` environment variable when it is set (`echo "$ORC_HOME"`), else the "Setup checkout (this machine)" line in the rulebook's tool notes, else `~/.claude`. Call it CHECKOUT and confirm `CHECKOUT/workflows/grill.md` exists there; if it does not, stop and say to set `ORC_HOME` to the checkout.
2. Read `CHECKOUT/workflows/grill.md` and follow it with these arguments. Ask every round with `AskUserQuestion`; look facts up with `scout` or `researcher` as `subagent_type`.
