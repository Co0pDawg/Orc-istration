# Review metrics

Per-run token, context and outcome numbers for review runs, so a change to a lane, a procedure step or a model choice can be judged by what it cost and how often its findings held up. Each run writes one JSON report; `node tools/orc.mjs metrics report` aggregates them.

This file is the single source for the report schema, the privacy rules and the field definitions.

## Supported tools

Capture reads **Claude Code session transcripts only**. Claude Code records each session under `~/.claude/projects/<project>/`: `<session>.jsonl` for the main thread, and `<session>/subagents/agent-<id>.jsonl` with `agent-<id>.meta.json` (agent type, description) for each subagent. Each API message carries its `usage` and model. Tool calls and tool results give the files read and their sizes.

Other tools (Codex, Gemini CLI, Copilot, Cursor, OpenCode, Antigravity) are unsupported: they write no transcript in this shape. A review run in one of them skips the metrics step; its run log still feeds `calibration`.

Nothing is counted during the run. Capture reads the transcripts afterwards, so a run cannot under-report by skipping a step.

## Capture

```bash
node <orc checkout>/tools/orc.mjs metrics capture --workflow pre-pr-review [--session <id>] [--transcript <path>] [--log <run log>] [--mode lite|full] [--version <v>] [--out <dir>] [--print]
```

- **Transcript:** `--transcript <path>` reads that file. Otherwise `--session <id>`, or the `CLAUDE_CODE_SESSION_ID` environment variable inside Claude Code, is looked up as `~/.claude/projects/*/<id>.jsonl`.
- **Window:** `--workflow pre-pr-review` starts the run at the session's last `/pre-pr-review` invocation (a typed command or a Skill tool call) and ends it at the last activity of any agent. `--workflow session` covers the whole transcript. Any other name is matched against invocations the same way. When the session holds no matching invocation, the report covers the whole session and the command prints a `WARN` line on stderr. A run log whose `Leads:` line lacks a count warns the same way, and that count is `null`.
- **Output:** one file at `<out>/<yyyy-MM>/<runId>.json`, where `--out` defaults to `.orc/metrics/` under the current repo. The command prints the file's path. `--print` writes nothing and prints the report instead.
- **Re-capture:** a run keeps its `runId` (the start time does not change), so running the same command again replaces the report. The review procedure does this after its verdict sweep, so the report carries the final verdict counts.
- **Errors:** a missing transcript, session, run log or workflow name exits 1 with a `metrics:` error. The review procedure reports it and carries on.

## Nested runs

A run captured over a window that contains an earlier report for the same session (for example a `session` capture after a review) lists that report under `childRuns`. The agents it already counted are tagged with its `runId` in `childRunId`. The outer run's `totals` still cover everything; `ownTokens` leave the tagged agents out. The aggregate counts a nested run once: global and per-developer totals use top-level runs only, and the agent table takes tagged agents from the child's report.

## Privacy

Reports may be committed and read by anyone with repository access.

- **Developer:** the first 12 hex characters of SHA-256 of the lower-cased `git config user.email`, or `unknown`. This is pseudonymous, not anonymous: anyone who knows an email can recompute it.
- **Paths:** only repo-relative paths are kept (`filesRead.top`, the five largest per agent). The roots are the repo, its worktrees and the transcripts' own working folders. Anything else becomes `<scratchpad>`, `<tool-output>` (output Claude Code spilled to a file), `<claude-home>` or `<external>`.
- **Never stored:** prompt text, file contents, tool output, agent reports and commit messages. The only free text is each agent's `description`, the short dispatch label the orchestrator writes, so keep secrets and customer data out of dispatch labels.
- Run logs stay wherever the repo keeps `.orc/reviews/`; a report carries only their counts.

## Field reference

`schemaVersion` is `1`. Token figures are sums over an agent's API messages inside the run window.

| Field | Meaning |
|---|---|
| `runId` | `<start yyyyMMddTHHmmssZ>-<workflow>-<ticket or branch>-<developer hash prefix>`; names never collide across developers |
| `file` | The report's path relative to the repo root; `<out>/<yyyy-MM>/<runId>.json` when `--out` is outside the repo, so no home or scratchpad path is stored |
| `ticket`, `branch` | `branch` is the transcript's recorded branch when `--transcript` is given, else the checked-out branch; `ticket` is the first 4 to 6 digit number in it |
| `skillVersion`, `mode` | `--version` and `--mode` as passed |
| `sessionId`, `claudeCodeVersion`, `entrypoint` | From the transcript |
| `startedUtc`, `endedUtc`, `wallClockSeconds` | From the invocation (or the first activity, for `session`) to the last activity of any agent |
| `totals.agents`, `agentsByType` | Subagents that did anything in the window; the main thread is not counted |
| `tokens` | `input`, `cacheWrite5m`, `cacheWrite1h`, `cacheRead`, `output`, and `context` = input + both cache writes + cache read: every input token processed, summed over turns. Context is the main size and cost driver |
| `tokensByModel` | The same counters split by model, which pricing uses |
| `ownTokens` | `tokens` minus agents tagged with a child run |
| `initialContextTokens` | The first turn's context: system prompt, tools, rulebook and dispatch prompt. The cost of starting the agent at all |
| `peakContextTokens` | The largest single-turn context, against the model's window |
| `runtimeSeconds` | An agent's first to last activity |
| `turns` | API messages, one model response each |
| `toolCalls`, `toolResultChars` | Calls and result characters per tool. Explorers read most code through the shell (`git diff`, `git show`), so their reading shows here |
| `filesRead` | Read tool calls only: `reads`, `distinct` files, `totalChars`, `avgChars` per read, and the five largest files |
| `agentId`, `agentType`, `description`, `spawnDepth` | From the subagent's file name and its `.meta.json` (`unknown` type without one) |
| `childRuns`, `childRunId` | Nested-run links |
| `result` | Per agent: `verdicts` (a refuter's `VERDICT: ACCEPT \| REWORK`), `statuses` (a builder's `STATUS: DONE \| BLOCKED \| PARTIAL`), and for `review-verifier` its `leads`, `findings` and `severityReview` |
| `outcomes.refuter` | `verdicts`, `accept`, `rework`, `acceptedFirstPass` (accepts with no REWORK since the previous accept) and `openRework` (REWORK with no later accept) |
| `outcomes.builder` | Counts of `done`, `blocked` and `partial` reports |
| `outcomes.verifier` | Lead counts by verdict, counting only leads a verifier settled (`result.leads`), never finding verification. Each verifier's lead count comes from its message that settles the most leads; a verifier resumed for its severity review reports its leads in an earlier message, and `result.severityReview` holds its RAISE and KEEP counts. Verdict lines are numbered `3.`, `A3.` or `Lead 3:` |
| `outcomes.verifierFindings` | Finding verification (procedure 1.1.0) counts by verdict (`result.findings`), summed apart from the leads. A verifier message counts as findings when a prompt or message sent to that verifier before it named **findings mode**; inside one message, a heading that names only leads or only findings (`## A. Leads`, `## B. Findings mode`) switches the count for the lines below it, so one reply to both batches splits correctly |
| `outcomes.findings` | From `--log`: `leads` (the `Leads:` line), `verification` (the `Verification:` line: `checked`, `confirmed`, `plausible`, `refuted`; `null` when finding verification did not run), `bySeverity`, `byVerdict` (once per finding) and, per lane, `total`, `confirmed`, `falsePositive`, `wontFix`, `notActioned`, `pending` and `agent`. A finding tagged with two lanes counts under each; a non-canonical verdict counts as `pending`; a `confirmed`, `false-positive` or `wont-fix` verdict carrying `(agent)` (`calibration.md`, "Verdict source") counts only under `agent`, exactly as `calibration` counts it |

Characters, not tokens, measure tool output and files: a token is roughly three to four characters of code.

## Report

```bash
node <orc checkout>/tools/orc.mjs metrics report [--dir <dir>] [--prices <file>] [--out <file>]
```

`--dir` defaults to `.orc/metrics/` under the current repo; every `*.json` with a `runId` and schema version 1 below it is read, and unreadable files are skipped. The markdown goes to stdout, or to `--out <file>`, which refuses to overwrite an existing file unless `--force` is passed. It has these sections: Workflows (medians and cost), nested-run splits, Agents (per type, with success rates), Build loop, Review lanes, Weekly trend (ISO weeks) and Developers.

| Agent | Success rate shown |
|---|---|
| `builder` | Share of `DONE` reports |
| `refuter` | Share of `ACCEPT` verdicts; the Build loop line adds first-pass acceptance and REWORK rounds per accepted task |
| `review-verifier` | Leads upheld (confirmed or plausible) |
| review lanes | Precision = confirmed / (confirmed + false-positive), from developer verdicts only (agent verdicts have their own column) and shown only from 5 such verdicts (`n/a` below), exactly as `calibration` computes it, from the latest report per workflow, branch and developer, because a re-run carries earlier verdicts forward |

**Prices.** Costs are API-equivalent dollars per million tokens, computed at report time, so a price change re-prices every run. Cache writes are priced as input times 1.25 (5-minute) or 2 (1-hour). The built-in table is in `tools/lib/metrics.mjs`; `--prices <file>` replaces it with a JSON file of the same shape (`cacheWrite5mMultiplier`, `cacheWrite1hMultiplier`, `models: { <id>: { input, output, cacheRead } }`). A model missing from the table is listed under the report and left out of cost totals, never priced at zero. Subscription seats are not billed per token.

**Comparing a change.** Filter by `skillVersion` or date and compare medians before and after. One run is noise: single-run variance on the same branch is close to the effects worth measuring.

## Changing the schema

Add fields freely. A rename or a changed meaning bumps `schemaVersion`, and `metrics report` must then read both versions, because old reports stay where they were written.
