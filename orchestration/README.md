# Orchestration Cost Log

Scope: one record per orchestrated task (a session where Fable dispatched scouts, researchers, builders, refuters, or debuggers from `~/.claude/agents/`). The analog of the pre-PR review calibration log: it captures what each dispatch cost and whether it earned its keep, so the roster and the marching orders can be tuned on data after a few rounds.

## Where

`~/.claude/orchestration/log/<date>-<project>-<slug>.md`. User-level, not in any repo — the roster applies to every project.

## Record format

Header lines: Date, Project, Branch, Task (ticket or one line), Outcome (shipped / partial / abandoned, and what verification passed).

One table row per dispatch, in dispatch order. A resumed agent (SendMessage rework) is its own row with the token delta, not the cumulative figure the resume notification reports.

| Column | Meaning |
|---|---|
| # | dispatch order |
| Agent | roster name (`scout`, `researcher`, `builder`, `refuter`, `debugger`) or `fable` for inline work |
| Model | as run |
| Purpose | one line |
| Tokens | subagent tokens from the completion notification |
| Tools | tool uses |
| Time | wall clock, minutes |
| Result | what came back: rows located, ACCEPT/REWORK, DONE, etc. |
| Value | `earned` / `marginal` / `waste` plus the reason — the verdict column. `earned` = the output changed what Fable did next or caught a real defect; `marginal` = correct but Fable could have done it in under five tool calls; `waste` = wrong, ignored, or duplicated |

Below the table:

- **Totals** — tokens and wall clock across dispatches, plus a `Fable context: <start>k → <end>k` line read from the status line or `/context` at task start and when the record is written. Thirteen records in the first week all said `unmeasured`, which left the main question (did Fable's share drop?) unanswerable; the line is mandatory from 2026-09-15.
- **Loop signal** — what the builder→refuter loop actually caught: spec defects found by the builder, refuter must-fixes confirmed vs. rejected, REWORK rounds. This is the precision/recall analog.
- **Spec misses** — anything Fable's marching orders got wrong that cost a dispatch or a rework round. These are the source material for tightening the spec template in `~/.claude/CLAUDE.md`.

## First review (2026-09-15, 13 records)

~14.5M subagent tokens, ~110 dispatches; 80 earned / 9 marginal / 4 waste. Opus ~75% of spend. Refuters earned in 6 of 7 runs but twice missed requirement-level defects the pre-PR review agents caught. Scouts were half marginal (overlapping briefs; design questions). All 4 wastes were rate-limit deaths or a wrong-cwd dispatch. Changes made: Fable-context line, Opus fan-out cap of 3, scouts for locations only, data-precondition line in the marching orders.

## Second review — questions for the week of 2026-09-15 to 09-22

Answer each from the records; every one is a yes/no or a number, so the review takes minutes, not a session.

1. **Did Fable's share drop?** Sum the `Fable context` deltas and compare to subagent tokens per task. Target: Fable under 20% of the task total. If the line is missing from any record, that record failed the format.
2. **Did the rate-limit guard hold?** Count 429/session-limit deaths. Last week: 14 mentions, 4 dispatches lost. Target: zero. If any, was the cap of three violated or is the cap itself too high?
3. **Did the data-precondition line catch requirement defects?** For each builder/refuter loop, did pre-PR review agents find anything the loop missed? Last week: 2 of 7. If it is still above zero, the line is not being obeyed or the refuter orders need it too.
4. **Are scouts worth keeping?** Value column for scouts, with overlapping briefs banned. Last week 2 earned / 2 marginal. If marginal stays at half, replace scouts with Fable's own grep.
5. **Is the researcher still 7 for 7 earned?** If yes, look for builder work that was really research (reading before editing) and move it down a tier.
6. **Refuter precision.** Must-fixes confirmed vs. rejected, and REWORK rounds per task. Last week: 1 false positive on facts, 2 REWORK rounds on the largest tasks. If a second REWORK round ever changed nothing, drop to one round.
7. **Where did builder tokens go?** For each builder, was the spend dominated by the edit, by verification, or by rediscovery of something the spec should have stated? Last week's largest builders were all verification-heavy. If rediscovery appears, the Known line is underused.
8. **Spec misses by category.** Tally last week's categories: wrong precedent, missing test guidance, contradicting rules across specs, wrong cwd/worktree, CRLF/tooling. Which one is still recurring? That is the next template line.
9. **GPT mirrors.** Did `comment-analyzer-gpt` or `code-reviewer-gpt` find a distinct defect again? Last week: 3 times. If zero, stop starting the gateway by default.
10. **Wastes.** List every `waste` row and its cause. Any cause that appears twice across the two weeks gets a rule.

Write the answers as a dated section above this one and log which questions produced a change.

## Reviewing the data

After roughly five records, read the `Value` column per agent type and the Spec misses across records. Questions to answer: which agent type is most often `marginal` (candidate for a cheaper model or for inlining); whether refuters find defects Fable's own diff read did not; whether scout fan-out beats one researcher; and whether builder cost is dominated by verification (Playwright runs) rather than the edit.
