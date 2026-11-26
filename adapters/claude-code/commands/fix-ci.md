---
description: "Get a failing CI pipeline back to green: classify the failures, fix and verify locally, deliver when authorized, queue a run, wait, review, with a cycle cap (workflows/fix-ci.md)."
argument-hint: "[run URL | build id | <pipeline> <run number>] [cycle cap]"
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
---

# Fix CI

**Arguments:** "$ARGUMENTS"

1. Find the Orc-istration checkout: the `ORC_HOME` environment variable when it is set (`echo "$ORC_HOME"`), else the "Setup checkout (this machine)" line in the rulebook's tool notes, else `~/.claude`. Call it CHECKOUT and confirm `CHECKOUT/workflows/fix-ci.md` exists there; if it does not, stop and say to set `ORC_HOME` to the checkout.
2. Read `CHECKOUT/workflows/README.md`, then `CHECKOUT/workflows/fix-ci.md`, and follow it with these arguments. Run the Step 7 poll with `run_in_background: true`; ask the developer with `AskUserQuestion`.
