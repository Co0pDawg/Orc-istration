---
description: "File a work item from this conversation: title, user-story description and acceptance criteria, confirmed before it is created (workflows/create.md)."
argument-hint: "[type=<type>] [area=<area>] [iteration=<iteration>]"
allowed-tools:
  - Bash
  - Glob
  - Grep
  - Read
  - Write
  - AskUserQuestion
---

# Create

**Arguments:** "$ARGUMENTS"

1. Find the Orc-istration checkout: the `ORC_HOME` environment variable when it is set (`echo "$ORC_HOME"`), otherwise `~/.claude`. Call it CHECKOUT and confirm `CHECKOUT/workflows/create.md` exists there; if it does not, stop and say to set `ORC_HOME` to the checkout.
2. Read `CHECKOUT/workflows/README.md`, then `CHECKOUT/workflows/create.md`, and follow it with these arguments. Ask the developer with `AskUserQuestion`.
