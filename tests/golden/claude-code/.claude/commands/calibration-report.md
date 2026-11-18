---
description: Aggregate review run-log verdicts into per-lane precision and ranked recalibration recommendations (review/calibration.md).
argument-hint: "[lane to focus on, e.g. code-reviewer]"
allowed-tools:
  - Bash
  - Glob
  - Grep
  - Read
  - Edit
---

# Calibration Report

**Arguments:** "$ARGUMENTS"

1. Find the Orc-istration checkout: the `ORC_HOME` environment variable when it is set (`echo "$ORC_HOME"`), else the "Setup checkout (this machine)" line in the rulebook's tool notes, else `~/.claude`. Call it CHECKOUT and confirm `CHECKOUT/review/calibration.md` exists there; if it does not, stop and say to set `ORC_HOME` to the checkout.
2. Read `CHECKOUT/review/calibration.md` and follow its calibration-report procedure with these arguments; the counting is `node CHECKOUT/tools/orc.mjs calibration`. Recommend, then wait for approval before editing any lane or role.
