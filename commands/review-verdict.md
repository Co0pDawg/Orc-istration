---
description: Record confirmed / false-positive / wont-fix verdicts on findings from a review panel run, confirm or overrule agent verdicts, and log escaped defects, in its run log (review/calibration.md).
argument-hint: "[branch or run log file] [verdicts, e.g. 1 confirmed, 2 fp: covered by an end-to-end test]"
allowed-tools:
  - Bash
  - Glob
  - Grep
  - Read
  - Edit
  - AskUserQuestion
---

# Review Verdict

**Arguments:** "$ARGUMENTS"

1. Find the Orc-istration checkout: the `ORC_HOME` environment variable when it is set (`echo "$ORC_HOME"`), else the "Setup checkout (this machine)" line in the rulebook's tool notes, else `~/.claude`. Call it CHECKOUT and confirm `CHECKOUT/review/calibration.md` exists there; if it does not, stop and say to set `ORC_HOME` to the checkout.
2. Read `CHECKOUT/review/calibration.md` and follow its verdict procedure with these arguments. Ask for a missing reason with `AskUserQuestion`.
