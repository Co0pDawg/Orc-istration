---
description: Write a PR description for the current branch from its diff and work items, and open it as a draft PR through the tracker helper, or leave a markdown file without one (workflows/draft-pr.md).
allowed-tools:
  - Bash
  - Glob
  - Grep
  - Read
  - Write
  - Edit
  - AskUserQuestion
---

# Draft PR

**Arguments:** "$ARGUMENTS"

1. Find the Orc-istration checkout: the `ORC_HOME` environment variable when it is set (`echo "$ORC_HOME"`), else the "Setup checkout (this machine)" line in the rulebook's tool notes, else `~/.claude`. Call it CHECKOUT and confirm `CHECKOUT/workflows/draft-pr.md` exists there; if it does not, stop and say to set `ORC_HOME` to the checkout.
2. Read `CHECKOUT/workflows/README.md`, then `CHECKOUT/workflows/draft-pr.md`, and follow it. Ask the developer with `AskUserQuestion`.
