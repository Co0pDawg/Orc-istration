---
name: wrap-up
description: Finish an orchestrated task (full test projects once, the diff read, the pre-PR review tier, the cost log, the handoff note, the board marked Done). Use when the builder/refuter loop of an orchestrated task is accepted and before reporting it done or opening the PR; not in sprint mode, which waives most of this.
---

# Wrap-up

This skill exists only where `~/.claude/skills` holds a copy of it. Elsewhere, follow the rulebook's "Build loop", "Pre-PR review tiers" and "Cost log" sections directly; they win over anything here.

Resolve `<setup>` in this order: the `ORC_HOME` environment variable, the "Setup checkout (this machine)" line in the rulebook's tool notes, `~/.claude` when it has `tools/orc.mjs`, else ask the user. Commands run as `node "<setup>/tools/orc.mjs" ...`, quoted.

Show this as a visible checklist and tick each step as it finishes.

1. **Full tests.** Run each full test project once, by project name, one at a time, in the background. Run them while a refuter does its static pass if one is still running. A green run older than the last edit does not count.
2. **Diff read.** Read the whole final diff yourself against the base branch. Confirm any defect an agent reported by reading the code or reproducing it, and say which.
3. **Review tier.** Run `review-tier --base origin/<base>` in the repo.
   - **Light** only when all three hold: the diff is tests and docs only; the refuter gave ACCEPT after mutation checks; the refuter's brief used the repo's test conventions as its checklist. Then run a docs and comment review only.
   - **Full** otherwise: run `/pre-pr-review` (the review panel, staged 3+3).
   - Escalate Light to Full if it finds anything beyond doc wording. Fix nits inline only when cheap and in a file already in the diff; log the rest `not-actioned`.
4. **Docs co-change.** If the repo has a rule that user-facing changes update its README or wiki in the same change, check that they did.
5. **Cost log.** Draft it with `costlog --session <session id>`:
   - Local board: add `--board <address> --board-repo <board repo>`.
   - Artifact board: read the session doc and every card whose `session` is this one, write them to `<scratchpad>/board-export.json` as `{"sessions": {"<session id>": {...}}, "cards": {"<card id>": {...}}}` with bare ids as keys (`t1`, not `cards/t1`, so they match each event's `card`), and pass `--board-export` with that file.
   Fill each `TODO` and save it as `~/.orc/log/<date>-<project>-<slug>.md` (`ORC_DATA_DIR` when set), following `<setup>/orchestration/log/TEMPLATE.md`. The orchestrator's context size comes from the status line or `/context`. Target: orchestrator share under 20% of tokens.
6. **Anomalies.** For anything odd in this task that no rule covers, add one line to `~/.orc/log/anomalies.md` beside the cost logs. Search the file for the same cause first and promote a repeat (`<setup>/orchestration/README.md`, "Anomaly log"). Skip the step when there was nothing.
7. **Handoff.** Update the task's handoff doc with the decisions, what is done, what is open and the exact next step.
8. **PR.** Commit only on a feature branch, never on `main` or `develop`. Open a draft PR against the base branch, with the PR footer the tool notes give. Confirm before pushing.
9. **Board.** Write the commit and PR fields, then mark the session Done with `completed` and a closing `now` (see the `board` skill).
