# Workflows

Tool-neutral procedures for the work around the build loop. Each is a plain markdown procedure the orchestrator follows; in Claude Code a thin `commands/<name>.md` wrapper finds this checkout and runs it.

| Workflow | What it does |
|---|---|
| `start.md` | Work a ticket end to end: fetch and judge it, plan, branch, grill, builder/refuter loop per task with commit and push after ACCEPT, full tests once, pre-PR review, live verification, durable-rules check, live checklist on the ticket |
| `grill.md` | Interview the developer on a plan until no decision is open; append a Decisions list |
| `draft-pr.md` | Write the PR description from the branch and its work items; open it as a draft |
| `peer-review.md` (+ `peer-review-score.sh`) | Review and fix a teammate's PR at a tier sized to its diff |
| `create.md` | File a work item from the conversation |
| `fix-ci.md` | Get a failing CI pipeline back to green in diagnose, fix, deliver, queue, wait, review cycles |

These rules hold in every workflow.

## Settings

A workflow never hardcodes a repo's commands, branches or tracker. It reads each setting, in this order:

1. The **Project settings** section of the target repo's rulebook (`AGENTS.md`, else `CLAUDE.md`, at the repo root): `Tracker helper`, `Base branch`, `Branch naming`, `PR title format`, `Build`, `Test, filtered`, `Test, full`, `Run the app`, `Review rules`. The template is `templates/AGENTS.md`.
2. Git, for the base branch only: `git symbolic-ref --short refs/remotes/origin/HEAD`, without `origin/`.
3. One question to the developer, asked once per run; use the answer for the rest of the run and suggest adding it to Project settings.

A step that needs a setting it still lacks stops, names the setting, and points at `docs/adopt-a-repo.md` in this checkout. With `Tracker helper: none`, every tracker step is skipped and the workflow says so in one line; it never fakes a tracker result.

## Tracker calls

`TRACKER <verb> ...` means: run the `Tracker helper` command with that verb (`docs/tracker-contract.md`). Write its output to a file in the session's scratch folder by absolute path, check the exit code, then read the file. On a non-zero exit, read the error line first: retry once if it names a fix you can make, otherwise report it verbatim and carry on or stop as the step says. Never sign in on the developer's behalf, and never fetch or print a credential.

## Files

Generated files (ticket dumps, descriptions, comment bodies, downloads) go in the session's scratch folder by absolute path, never in the working tree. Run logs and metrics go in the target repo's `.orc/` folder, which the review panel already uses and keeps out of its diffs; they stay uncommitted unless the repo commits `.orc/`.

## Orchestration

The rulebook (`core/AGENTS.md` in this checkout) governs every dispatch: marching orders, the build loop, the rate-limit guard, test runs, the pre-PR review tiers and the board. Dispatch agents by roster name. Ask the developer through the tool's question prompt (in Claude Code, `AskUserQuestion`), never only in prose.

**Lite mode** saves usage on a tight plan: `--lite`, or the line `Orc orchestration: lite` in the developer's rulebook (`--full` overrides it). Each workflow says what it changes. A change in an extra-scrutiny area the target repo's rulebook or review rules name always runs full.

**Metrics** (Claude Code only): `node <checkout>/tools/orc.mjs metrics capture --workflow <name> [--mode lite|full]` writes a report under `.orc/metrics/` (`review/metrics.md`). A capture that exits 1 is noted in the summary and never stops the run.

**Changing a workflow:** git history is the record. Keep step numbers stable, since workflows cite each other's steps.
