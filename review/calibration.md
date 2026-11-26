# Review calibration

The review panel's memory. Every review writes a run log with one row per finding; the developer's verdict on each row records whether the lane that raised it was right, and defects the review missed are added later as escaped defects. `node tools/orc.mjs calibration` turns those into per-lane precision and recall, and the procedure below turns recurring false positives and escapes into lane fixes. The regression corpus ([corpus.md](corpus.md)) checks that a lane fix does not lose what the lane already catches.

This file is the single source for the run-log format, the verdict values, how verdicts are captured, and the calibration-report procedure. `review/PROCEDURE.md` points here for its run-log and verdict steps.

## Run log

**Location.** `.orc/reviews/<YYYY-MM-DD>-<branch-slug>.md` in the reviewed repo, where the slug is the branch name with `/` replaced by `-`. When the file exists, append `-2`, `-3` and so on. A project whose review rules name another folder uses that one and passes it to `calibration --logs <dir>`. The repo decides whether `.orc/` is committed; most keep it untracked.

**Format.** Write the log after the report:

```markdown
# Review Log: <TARGET> → <BASE>

Date: <YYYY-MM-DD>
Agents: <explorers run, each with its lanes — naming `on <tool>` for any routed agent, e.g. review-code-explorer (code-reviewer), review-failure-explorer on codex (silent-failure-hunter), review-verifier; append `<role> ran in-session: <tool> failed (<reason>)` for any routed fallback>
Leads: <N raised, N confirmed, N plausible, N refuted>
Verification: <N checked, N confirmed, N plausible, N refuted>   <!-- only when finding verification ran -->
Verdict: <verdict> — N issue / N warning / N suggestion / N nit / N question
Carried forward: N of M findings (from <previous log file>)   <!-- only when a previous run exists -->
Searched: <secondary-artifacts' Searched: line, verbatim>   <!-- only when secondary-artifacts ran; its Not searched: lines go here too -->

| # | Severity | Agent | Finding (one line) | Where | Verdict |
|---|----------|-------|--------------------|-------|---------|
| 1 | issue | code-reviewer | <one-line summary> | file:line | _pending_ |
| 2 | warning | code-reviewer | <one-line summary> | file:line | false-positive — refuted by verifier: <evidence> (agent) |

## Runtime checks   <!-- only when the report has Runtime checks -->

| # | Check | Steps | Result |
|---|-------|-------|--------|
| 1 | <what is checked, with the finding's number> | <what to do; what a defect would show> | _not run_ |
```

- One row per finding in the report, numbered from 1, then one row per finding the verifier refuted in finding verification (the report's **Refuted by verification**), with its verdict already set as above.
- **Severity** is one of `issue`, `warning`, `suggestion`, `nit`, `question`.
- **Agent** holds exact lane names, never an explorer name: `code-reviewer`, `architecture-reviewer`, `type-design-analyzer`, `code-simplifier`, `silent-failure-hunter`, `comment-analyzer`, `pr-test-analyzer`, `ticket-coverage`, `secondary-artifacts`, `ui-test-reviewer`. A merged finding lists its lanes comma-separated (`code-reviewer, silent-failure-hunter`), with no other format, so per-lane keys stay stable. Use the lane tag on each finding.
- On the **`Agents:`** header line, name the tool of every routed agent (`<role> on <tool> (<lanes>)`, e.g. `review-failure-explorer on codex (silent-failure-hunter)`, or `review-verifier on codex`), and note any routed fallback as `<role> ran in-session: <tool> failed (<reason>)`. `calibration` ignores the `Agents:` header line and reads lane keys only from the finding table's **Agent** column; `metrics capture` reads `<role> on <tool>` entries on `Agents:` to mark mixed-tool runs as partial (`review/metrics.md`).
- **Where** is `file:line`, or the spec item id for a finding about a requirement.
- **Verdict** is the last column and starts `_pending_`.
- A literal pipe inside a cell is written `\|`. The parser splits on unescaped pipes only.
- **Runtime checks** lists the report's runtime checks. Result starts `_not run_`; whoever runs the check (the developer, or a workflow's live step) sets `pass` or `fail — <what was seen>`. The panel never runs the app.
- `calibration` reads only tables whose header names `Severity`, `Agent` and, last, `Verdict`, and the escaped-defects table below. Any other table in the file, Runtime checks included, is ignored. A clean review keeps the heading and has no table.
- **`## Second review`**, appended by wrap-up on a Full change, holds plain lines: the second reviewer's tool, the reviewed commit, and its verdict or why it did not run (`orchestration/wrap-up.md`). `calibration` ignores it.

**Escaped defects.** A defect the review should have caught but did not is appended to the log of the review that missed it, under its own heading:

```markdown
## Escaped defects

| # | Lane | Defect (one line) | Where | Found by | Why missed |
|---|------|-------------------|-------|----------|------------|
| 1 | silent-failure-hunter | <one-line summary> | file:line | teammate | <what the lane did not check> |
```

- Record one when a defect in code the review covered is found after it: by a teammate's review, a live run or production.
- **Lane** is the lane whose checklist should have caught it (exact lane names, comma-separated when two should have), not the lane that happened to run.
- **Found by** is who or what found it: `teammate`, `live run`, `production`, or a short name for another source.
- **Why missed** is the rule or angle the lane lacked, written as a general rule; it is the recall payload, as a false-positive reason is the precision payload.
- Number the rows from 1 within the table. The same pipe rule applies.
- `calibration` reads a row only under this exact header, with a whole-number `#` and every cell. A row it cannot read is dropped and listed under **Parser warnings** in its report (how many and why), as is an `## Escaped defects` section with no rows.

**Carry-forward.** Before writing, look for earlier logs of the same branch (`.orc/reviews/*<branch-slug>*.md`). When a new finding matches a row in the most recent earlier log (same file and substantially the same finding), copy that row's verdict instead of `_pending_`. A re-run must not reopen findings the developer already resolved. Only new findings start `_pending_`.

**Metrics.** Then capture the run's metrics (see [metrics.md](metrics.md)): `node <orc checkout>/tools/orc.mjs metrics capture --workflow pre-pr-review --log <the log file> --mode <lite|full> --version <procedure version>`. It prints the report's path. Outside Claude Code it prints `metrics: skipped (...)` and exits 0, and the review goes on. When it exits 1, put its error line under the report and carry on: metrics never block a review.

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

**Verdict source.** A verdict may end with who gave it: `(developer)` or `(agent)`. Write it at the end; `calibration` reads `(agent)` anywhere in the cell as the agent's, so a note added after it does not turn it into the developer's. `(agent)` marks a verdict the orchestrator or a verifier reached without the developer saying so: a fix a workflow applied on its own (`confirmed — fixed in session (agent)`), or a verifier refutation (`false-positive — refuted by verifier: <evidence> (agent)`). A verdict with no suffix is the developer's, so older logs read unchanged. `calibration` counts a `confirmed`, `false-positive` or `wont-fix` verdict carrying `(agent)` only under Agent verdicts: it is left out of precision, recall and the triaged count the trigger uses. When the developer confirms or overrules an agent verdict, replace it with theirs.

### In-session capture

Record verdicts as the session resolves each finding, not in a separate pass. Update the log's Verdict cells at these moments:

- **A finding is fixed:** set `confirmed — fixed in session (developer)` when the developer asked for the fix or made it, and `confirmed — fixed in session (agent)` when a workflow applied it on its own; it stays `(agent)` until the developer confirms it. Accepting and fixing a finding is the confirmation.
- **A finding is discussed and rejected:** set `false-positive — <reason>` or `wont-fix — <reason>`, with the developer's actual objection.
- **A runtime check is run:** set its Result in the Runtime checks table; a `fail` confirms its finding, with the source of whoever ran it; a `pass` leaves the finding's verdict for the developer to give.
- **The review concludes** (the developer commits, opens a PR or moves on): sweep the remaining `suggestion:` and `nit:` rows to `not-actioned`. `issue:` and `warning:` rows nobody addressed stay `_pending_`; list them when closing so nothing blocking is dropped silently. Then run the same `metrics capture` command again: the run keeps its id, so the report is replaced with the final verdict counts.

**Calibration trigger.** After the sweep, check whether enough new signal has piled up:

1. Run `calibration` and read the "Triaged verdicts" count (developer rows starting `confirmed`, `false-positive` or `wont-fix`; agent verdicts do not count).
2. Compare it with the `triaged:` value in `.orc/reviews/.last-sweep` (a missing file counts as 0).
3. The trigger trips at 20 or more new triaged verdicts since the marker. It also trips at once when the developer gave a `false-positive` this session and that lane now has 3 or more false positives. An agent verdict (a verifier refutation) never trips it.

When it trips, close with one line offering to run the calibration report. Do not run it unprompted, and do not mention the trigger when it has not tripped.

### Later triage

For leftovers, corrections and older logs (the `review-verdict` command or skill runs these steps; your tool notes name it):

1. **Find the log.** Use the branch or file name given, otherwise the most recently modified file in the log folder. If the folder is empty, say so and stop.
2. **Show what is open.** List every `_pending_` row by its number, every row with a non-canonical verdict, offering to normalize it, and every `(agent)` verdict, offering the developer to confirm or overrule it. With nothing open, summarize the recorded verdicts and stop.
3. **Collect verdicts.** Map the developer's words to the four values above, with the same shorthand, aliases and reason rule. Rows the developer did not address stay `_pending_`.
4. **Edit the Verdict cells in place.** Change no other column.
5. **Record escaped defects.** When the developer reports a defect the review missed, append it to that run's log under `## Escaped defects` (format above), asking which lane should have caught it and why it was missed when they did not say.
6. **Close the loop.** If a lane now has 3 or more false positives, or 2 or more escaped defects, across the logs, say so and suggest the calibration report.

## Calibration report

### 1. Aggregate

```
node <orc checkout>/tools/orc.mjs calibration [--logs <dir>] [--min-precision <0-1>]
```

`--logs` defaults to `.orc/reviews/` under the current repo. The command counts; never hand-count table rows. It prints:

- a summary line: logs parsed and skipped, findings, the triaged-verdict count the trigger uses (developer verdicts only), agent verdicts and escaped defects;
- a **Lanes** table: findings, confirmed, false positive, wont fix, not actioned, unverdicted (pending plus non-canonical), precision, flag, agent verdicts, escaped and recall. Confirmed, false positive and wont fix hold developer verdicts only, so the verdict columns add up to findings. Precision is `confirmed / (confirmed + false-positive)` and shows only from 5 such verdicts. Recall is `confirmed / (confirmed + escaped)` and shows only when the lane has at least one escaped defect and 5 or more such rows; with no escape recorded it is `n/a`, since nobody has yet looked for what the lane missed. A lane is flagged when its precision is below `--min-precision` (default 0.6), when it has 3 or more false positives, or when it has 2 or more escaped defects;
- a **Severities** table with the same verdict counts and agent verdicts (escaped defects have no severity);
- the non-canonical verdicts, and the files it skipped with the reason.

A file without the `# Review Log` heading and without a finding table is skipped. A missing folder exits 1 with a named error.

### 2. Report

Present to the developer:

- the Lanes table, with the flagged lanes first;
- recurring `false-positive` and `wont-fix` **reasons**, grouped by pattern (the same rule misread, the same missing context). Read the reason text in the logs; recurrence across runs is the signal worth acting on, and a one-off is not;
- escaped defects by lane, with their **Why missed** text grouped by pattern the same way;
- noise candidates: lanes whose `suggestion:` and `nit:` volume is high and mostly `not-actioned`. Findings nobody engages with cost tokens and give no signal;
- non-canonical verdicts to normalize, using the Verdicts rules above.

### 3. Recommend

For each actionable pattern, propose a fix in this order, always:

1. Inject the missing context into the lane definition: a carve-out, a precondition or a named exception.
2. Narrow the lane's scope to exclude the category.
3. Lower the category's severity.

For a missed-defect pattern, the fix is the other way round: add the check, angle or precondition the lane lacked.

Flag any lane with 3 or more false positives, or 2 or more escaped defects, as a recalibration target. Rank the recommendations by how often each pattern recurs. A fix that narrows a lane or lowers a severity (options 2 and 3) must be re-run on the regression corpus before it is kept (step 4), because narrowing is how a lane starts missing what it caught. Then stop and wait for approval; do not edit lane definitions unprompted.

Write each fix as a general rule. Never quote a specific run's finding or file in a lane definition, because a lane that reads the answer stops testing the rule.

### 4. Apply and verify

For each approved recommendation:

1. Edit the lane definition, and reconcile any higher-level doc it now contradicts (the project's review rules or rulebook).
2. Run the affected lane on every regression-corpus case that names it and score each run ([corpus.md](corpus.md)). A missed expected finding blocks the change until it is explained; a regression means the edit overshot, so fix it before finishing. For a missed-defect pattern, add a corpus case for it first, so the run shows the fix now catches it.

The corpus replaces re-running a past review; only when no corpus case covers the pattern, re-run the affected lane on the diff of a past run that showed it (`git diff <base>...<branch>`, or the merge commit's diff when the branch is gone), where the false positive must stay silent and that run's confirmed findings must still be found.

### 5. Reset the trigger marker

Write `.orc/reviews/.last-sweep`:

```
date: <YYYY-MM-DD>
triaged: <the "Triaged verdicts" count calibration printed>
```

The calibration trigger compares against this file to decide when enough new verdicts have accumulated.
