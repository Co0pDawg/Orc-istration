# Review calibration

The review panel's memory. Every review writes a run log with one row per finding; the developer's verdict on each row records whether the lane that raised it was right. `node tools/orc.mjs calibration` turns those verdicts into per-lane precision, and the procedure below turns recurring false positives into lane fixes.

This file is the single source for the run-log format, the verdict values, how verdicts are captured, and the calibration-report procedure. `review/PROCEDURE.md` points here for its run-log and verdict steps.

## Run log

**Location.** `.orc/reviews/<YYYY-MM-DD>-<branch-slug>.md` in the reviewed repo, where the slug is the branch name with `/` replaced by `-`. When the file exists, append `-2`, `-3` and so on. A project whose review rules name another folder uses that one and passes it to `calibration --logs <dir>`. The repo decides whether `.orc/` is committed; most keep it untracked.

**Format.** Write the log after the report:

```markdown
# Review Log: <TARGET> → <BASE>

Date: <YYYY-MM-DD>
Agents: <explorers run, each with its lanes, e.g. review-code-explorer (code-reviewer, silent-failure-hunter), review-docs-explorer (comment-analyzer), review-verifier>
Leads: <N raised, N confirmed, N plausible, N refuted>
Verdict: <verdict> — N issue / N warning / N suggestion / N nit / N question
Carried forward: N of M findings (from <previous log file>)   <!-- only when a previous run exists -->
Searched: <secondary-artifacts' Searched: line, verbatim>   <!-- only when secondary-artifacts ran; its Not searched: lines go here too -->

| # | Severity | Agent | Finding (one line) | Where | Verdict |
|---|----------|-------|--------------------|-------|---------|
| 1 | issue | code-reviewer | <one-line summary> | file:line | _pending_ |
```

- One row per finding in the report, numbered from 1.
- **Severity** is one of `issue`, `warning`, `suggestion`, `nit`, `question`.
- **Agent** holds exact lane names, never an explorer name: `code-reviewer`, `architecture-reviewer`, `type-design-analyzer`, `code-simplifier`, `silent-failure-hunter`, `comment-analyzer`, `pr-test-analyzer`, `ticket-coverage`, `secondary-artifacts`, `ui-test-reviewer`. A merged finding lists its lanes comma-separated (`code-reviewer, silent-failure-hunter`), with no other format, so per-lane keys stay stable. Use the lane tag on each finding.
- **Where** is `file:line`, or the spec item id for a finding about a requirement.
- **Verdict** is the last column and starts `_pending_`.
- A literal pipe inside a cell is written `\|`. The parser splits on unescaped pipes only.
- `calibration` reads only tables whose header names `Severity`, `Agent` and, last, `Verdict`. Any other table in the file is ignored. A clean review keeps the heading and has no table.

**Carry-forward.** Before writing, look for earlier logs of the same branch (`.orc/reviews/*<branch-slug>*.md`). When a new finding matches a row in the most recent earlier log (same file and substantially the same finding), copy that row's verdict instead of `_pending_`. A re-run must not reopen findings the developer already resolved. Only new findings start `_pending_`.

**Metrics.** Then capture the run's metrics (see [metrics.md](metrics.md)): `node <orc checkout>/tools/orc.mjs metrics capture --workflow pre-pr-review --log <the log file> --mode <lite|full> --version <procedure version>`. It prints the report's path. When it exits 1, put its error line under the report and carry on: metrics never block a review.

## Verdicts

Each finding resolves to exactly one of four values:

| Verdict | Meaning | Feeds into |
|---|---|---|
| `confirmed` | The finding was real. Append `— fixed in session` when it was fixed during the review | Precision; a hard-to-find one may earn a detection rule |
| `false-positive — <reason>` | The finding was wrong | Precision; the reason is the missing context a lane fix needs |
| `wont-fix — <reason>` | Right, but not worth acting on | Consider lowering the category's severity |
| `not-actioned` | A `suggestion:` or `nit:` nobody engaged with | Nothing; left out of precision |

- Shorthand: `fp` means `false-positive` and `wf` means `wont-fix`.
- Normalize `fixed`, `valid` and `resolved` to `confirmed` without asking. `accepted` is ambiguous: ask whether the finding was accepted and fixed (`confirmed`) or the code was accepted as-is (`wont-fix`).
- A `false-positive` or `wont-fix` needs a reason. Write it as the rule you wish the lane had known, not a paraphrase of the finding. If the developer gave none, ask before writing.
- Anything else in the cell is non-canonical. `calibration` counts it as unverdicted and lists it under "Non-canonical verdicts" until someone normalizes it.

### In-session capture

Record verdicts as the session resolves each finding, not in a separate pass. Update the log's Verdict cells at these moments:

- **A finding is fixed** (by you, or the developer says they fixed it): set `confirmed — fixed in session`. Accepting and fixing a finding is the confirmation.
- **A finding is discussed and rejected:** set `false-positive — <reason>` or `wont-fix — <reason>`, with the developer's actual objection.
- **The review concludes** (the developer commits, opens a PR or moves on): sweep the remaining `suggestion:` and `nit:` rows to `not-actioned`. `issue:` and `warning:` rows nobody addressed stay `_pending_`; list them when closing so nothing blocking is dropped silently. Then run the same `metrics capture` command again: the run keeps its id, so the report is replaced with the final verdict counts.

**Calibration trigger.** After the sweep, check whether enough new signal has piled up:

1. Run `calibration` and read the "Triaged verdicts" count (rows starting `confirmed`, `false-positive` or `wont-fix`).
2. Compare it with the `triaged:` value in `.orc/reviews/.last-sweep` (a missing file counts as 0).
3. The trigger trips at 20 or more new triaged verdicts since the marker. It also trips at once when this session recorded a `false-positive` and that lane now has 3 or more false positives.

When it trips, close with one line offering to run the calibration report. Do not run it unprompted, and do not mention the trigger when it has not tripped.

### Later triage

For leftovers, corrections and older logs (the Claude Code `/review-verdict` command runs these steps):

1. **Find the log.** Use the branch or file name given, otherwise the most recently modified file in the log folder. If the folder is empty, say so and stop.
2. **Show what is open.** List every `_pending_` row by its number, and every row with a non-canonical verdict, offering to normalize it. With nothing open, summarize the recorded verdicts and stop.
3. **Collect verdicts.** Map the developer's words to the four values above, with the same shorthand, aliases and reason rule. Rows the developer did not address stay `_pending_`.
4. **Edit the Verdict cells in place.** Change no other column.
5. **Close the loop.** If a lane now has 3 or more false positives across the logs, say so and suggest the calibration report.

## Calibration report

### 1. Aggregate

```bash
node <orc checkout>/tools/orc.mjs calibration [--logs <dir>] [--min-precision <0-1>]
```

`--logs` defaults to `.orc/reviews/` under the current repo. The command counts; never hand-count table rows. It prints:

- a summary line: logs parsed and skipped, findings, and the triaged-verdict count the trigger uses;
- a **Lanes** table: findings, confirmed, false positive, wont fix, not actioned, unverdicted (pending plus non-canonical) and precision, which is `confirmed / (confirmed + false-positive)`. Precision shows only from 5 such verdicts. A lane is flagged when its precision is below `--min-precision` (default 0.6) or when it has 3 or more false positives;
- a **Severities** table with the same counts;
- the non-canonical verdicts, and the files it skipped with the reason.

A file without the `# Review Log` heading and without a finding table is skipped. A missing folder exits 1 with a named error.

### 2. Report

Present to the developer:

- the Lanes table, with the flagged lanes first;
- recurring `false-positive` and `wont-fix` **reasons**, grouped by pattern (the same rule misread, the same missing context). Read the reason text in the logs; recurrence across runs is the signal worth acting on, and a one-off is not;
- noise candidates: lanes whose `suggestion:` and `nit:` volume is high and mostly `not-actioned`. Findings nobody engages with cost tokens and give no signal;
- non-canonical verdicts to normalize, using the Verdicts rules above.

### 3. Recommend

For each actionable pattern, propose a fix in this order, always:

1. Inject the missing context into the lane definition: a carve-out, a precondition or a named exception.
2. Narrow the lane's scope to exclude the category.
3. Lower the category's severity.

Flag any lane with 3 or more false positives as a recalibration target. Rank the recommendations by how often each pattern recurs. Then stop and wait for approval; do not edit lane definitions unprompted.

Write each fix as a general rule. Never quote a specific run's finding or file in a lane definition, because a lane that reads the answer stops testing the rule.

### 4. Apply and verify

For each approved recommendation:

1. Edit the lane definition, and reconcile any higher-level doc it now contradicts (the project's review rules or rulebook).
2. Re-run the affected lane on the diff of a past run that showed the pattern (`git diff <base>...<branch>`, or the merge commit's diff when the branch is gone). The false positive must stay silent and that run's confirmed findings must still be found. A regression means the edit overshot; fix it before finishing.

### 5. Reset the trigger marker

Write `.orc/reviews/.last-sweep`:

```
date: <YYYY-MM-DD>
triaged: <the "Triaged verdicts" count calibration printed>
```

The calibration trigger compares against this file to decide when enough new verdicts have accumulated.
