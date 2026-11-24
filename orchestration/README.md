# Orchestration Cost Log

Scope: one record per orchestrated task (a session where the orchestrator dispatched roster agents: scouts, researchers, builders, refuters, debuggers, or the `review-*` panel). The analog of the pre-PR review calibration log: it captures what each dispatch cost and whether it earned its keep, so the roster and the marching orders can be tuned on data after a few rounds.

## Where

`~/.claude/orchestration/log/<date>-<project>-<slug>.md`, from `orchestration/log/TEMPLATE.md`. User-level, not in any repo — the roster applies to every project. `node tools/orc.mjs costlog --session <id>` drafts a record from the board (`docs/cli.md`).

The cost log records live tasks. To measure a change to the builder or refuter role, a rule or a model tier before keeping it, run the replay benchmark on fixed cases: `bench.md`. Unattended runs of labelled GitHub issues, outside any orchestrated task and the board, are `queue.md`.

## Record format

Header lines: Date, Project, Branch, Task (ticket or one line), Outcome (shipped / partial / abandoned, and what verification passed).

One table row per dispatch, in dispatch order. A resumed agent (SendMessage rework) is its own row with the token delta, not the cumulative figure the resume notification reports.

| Column | Meaning |
|---|---|
| # | dispatch order |
| Agent | roster name (`scout`, `researcher`, `builder`, `refuter`, `debugger`, a `review-*` agent) or `orchestrator` for inline work |
| Model | as run |
| Purpose | one line |
| Tokens | subagent tokens from the completion notification |
| Tools | tool uses |
| Time | wall clock, minutes |
| Result | what came back: rows located, ACCEPT/REWORK, DONE, etc. |
| Value | `earned` / `marginal` / `waste` plus the reason — the verdict column. `earned` = the output changed what the orchestrator did next or caught a real defect; `marginal` = correct but the orchestrator could have done it in under five tool calls; `waste` = wrong, ignored, or duplicated |

Below the table:

- **Totals** — tokens and wall clock across dispatches, plus a `Orchestrator context: <start>k → <end>k` line read from the status line or `/context` at task start and when the record is written. Thirteen records in the first week all said `unmeasured`, which left the main question (did the orchestrator's share drop?) unanswerable; the line is mandatory from 2026-09-15.
- **Loop signal** — what the builder→refuter loop actually caught: spec defects found by the builder, refuter must-fixes confirmed vs. rejected, SPEC VS INTENT entries, REWORK rounds. This is the precision/recall analog.
  - **Escaped defects** — one line per defect found after the loop accepted: what it was, who caught it (review panel, teammate, live run, owner), and why the loop missed it. Write `none` when there were none.
- **Spec misses** — anything the orchestrator's marching orders got wrong that cost a dispatch or a rework round. These are the source material for tightening the marching orders in the rulebook (`AGENTS.md`).

## First review (2026-09-15, 13 records)

~14.5M subagent tokens, ~110 dispatches; 80 earned / 9 marginal / 4 waste. Opus ~75% of spend. Refuters earned in 6 of 7 runs but twice missed requirement-level defects the pre-PR review agents caught. Scouts were half marginal (overlapping briefs; design questions). All 4 wastes were rate-limit deaths or a wrong-cwd dispatch. Changes made: the orchestrator-context line, Opus fan-out cap of 3, scouts for locations only, data-precondition line in the marching orders.

## Review questions

Run a review every 10 records or so (the same cadence as re-testing single-incident rules, `docs/rulebook-notes.md`). Answer each question from the records since the last review; every one is a yes/no or a number, so the review takes minutes, not a session.

1. **Did the orchestrator's share stay under target?** Sum the `Orchestrator context` deltas and compare to subagent tokens per task. Target: the orchestrator under 20% of the task total. A record missing the line failed the format.
2. **Did any dispatch die on a rate or session limit?** Target: zero. If any, was the cap of three high-tier agents in flight broken, or is the cap too high?
3. **Did defects escape the loop?** Count the Escaped defects lines. For each, did the marching orders carry the data precondition and the intent? If they did, the refuter missed it; if not, the spec did.
4. **Are scouts worth keeping?** Value column for scouts. If half or more are `marginal`, replace scouts with the orchestrator's own grep.
5. **Is the researcher still earning?** If every researcher row is `earned`, look for builder work that was really research (reading before editing) and move it down a tier.
6. **Refuter precision.** Must-fixes confirmed vs. rejected, and REWORK rounds per task. If a second REWORK round ever changed nothing, drop to one round.
7. **Where did builder tokens go?** For each builder, was the spend dominated by the edit, by verification, or by rediscovery of something the spec should have stated? If rediscovery appears, the Known line is underused.
8. **Spec misses by category** (wrong precedent, missing test guidance, contradicting rules across specs, wrong cwd or worktree, CRLF or tooling, intent the spec dropped). Which one is recurring? That is the next marching-orders line.
9. **Wastes.** List every `waste` row and its cause. Any cause that appears in two reviews gets a rule.
10. **Open anomalies.** Read the `open` lines of the anomaly log (below). Promote each one that has met its row's threshold, drop each one that is stale, and set the status on both.

Write the answers as a dated section under **First review** and log which questions produced a change.

## Reviewing the data

After roughly five records, read the `Value` column per agent type and the Spec misses across records. Questions to answer: which agent type is most often `marginal` (candidate for a cheaper model or for inlining); whether refuters find defects the orchestrator's own diff read did not; whether scout fan-out beats one researcher; and whether builder cost is dominated by verification (Playwright runs) rather than the edit.

## Anomaly log

Scope: something that went wrong or behaved oddly and that no existing rule covers, in any session (orchestrated, inline or sprint). The cost log takes only orchestrated tasks, the review calibration log takes only review-panel findings, and `docs/rulebook-notes.md` takes an incident only once it has a rule. Without a holding place, an oddity is either lost or turned into a rule on one sighting.

`anomalies.md` in the folder that holds the cost logs (`~/.claude/orchestration/log/` in Claude Code): one append-only file, local and untracked. One line per entry:

`<date> | <project> | <what happened> | <what was expected> | <how it was caught> | <status>`

Status is `open`, `ruled` (name the rule), `tooled` (name the guard, tool or skill), `memory` or `dropped`. Something an existing rule already covers is not an anomaly: it goes in the cost log's Spec misses or Escaped defects.

Before adding a line, search the file for the same cause. A second occurrence is promoted, and what it becomes depends on what repeated. The one exception is a procedure: it becomes a skill on the third explanation, so a procedure explained twice stays `open`.

| The repeat is | It becomes |
|---|---|
| A constraint ("never do X") | A rulebook line, with its incident in `docs/rulebook-notes.md` |
| Something a script can check | A guard or a tool |
| A multi-step procedure the user explains a third time | A skill |
| A personal preference | A memory or a standing preference |

A single occurrence is promoted at once only when the consequence was severe: lost data or work, or something that left the session (a push, a post, a message). A repeated one-line instruction becomes a rule or a memory, not a skill, because every skill's description loads into every session.
