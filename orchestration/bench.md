# Replay benchmark

A small set of fixed, invented cases that the checkout's builder and refuter roles run headlessly, each scored with what it cost. The review corpus (`review/corpus.md`) shows when the review panel misses something; the bench shows what a change to a role, a rule or a model tier does to the build loop: whether builders still finish the job, how far an unattended refuter ACCEPT can be trusted, and what each passing run costs. `node tools/orc.mjs bench` lists the cases, runs them and reports on the results. It runs on Claude Code only.

The cases are invented for the bench, each built around one mechanism a builder or refuter is known to get wrong; they are not replays of real past tasks, and no project's code or history is in them. "Replay" means every variant gets the same fixed case.

## When to run it

Run every case, as a baseline and as a variant, before keeping any of these changes:

- `roles/builder.md` or `roles/refuter.md`, or the shared rules they follow (`AGENTS.md`, the marching orders);
- `models.json`, when it changes the model or effort of the builder's or refuter's tier;
- a tier experiment, such as a Mid-tier refuter (`--models` with an override file).

Run the baseline on the base branch and the variant on the change, or on one checkout with two `--models` files. One run per case is noisy; use `--runs 3` or more before trusting a difference.

## Case format

A case is a folder `tests/fixtures/bench/<id>/` in the setup checkout, where `<id>` is lower-case words joined by hyphens. Keep every case small and self-contained, with invented Node code, `node --test` tests and no dependencies: no project, product, company or person names, since the repo is public. Fixtures are stored with LF line endings (`.gitattributes`), and the bench turns CRLF into LF when it copies them.

- `case.md`: a `# <title>` heading, a `Kind: build` or `Kind: refute` line, then what the case tests and what an agent has to do to get it right. A `build` case adds an `Accept: <command>` line; a `refute` case adds an `Expect: ACCEPT` or `Expect: REWORK` line.
- `seed/`: the scratch repo's files at the base commit.
- `brief.md`: the marching orders the agent gets on stdin. It passes `node tools/orc.mjs brief lint <file> --role builder` (or `refuter`) with `BOARD: none`, and names no path outside the scratch repo (no scratch-pad path: item 8 says to return the report inline).
- `build` only: `accept/`, the hidden acceptance tests. They are copied into the scratch repo only after the agent has finished, at the same relative paths (`accept/test/x.accept.test.mjs` becomes `test/x.accept.test.mjs`, replacing any file of that name), so the agent cannot read them. Name them `*.accept.test.mjs`.
- `refute` only: `change.patch`, the builder's diff as `git diff` output against the seed, and, for `Expect: REWORK`, `expected.md`, a table of each planted defect:

```markdown
| Id | File | Lines | Defect |
|----|------|-------|--------|
| E1 | src/paginate.js | 7-10 | <one-line defect> |
```

**Lines** follows `review/corpus.md`: a range in the changed file's numbering, one line, or a comma list. Make the patch with real git (seed, edit, `git diff`) and check the ranges against the changed file. List every real defect in the change, a weak test included: an unlisted one lets a REWORK look right for the wrong reason, and one in an `Expect: ACCEPT` case makes a correct refuter look wrong. A defect that is something missing has no line of its own, so its row names the place a reviewer would cite: `spec-requirement-dropped` E1 is the function the dropped rule belongs in, so it measures "cited the function", not "named the missing rule".

A new case must be sound without a model: for `build`, the `Accept:` command fails on the bare seed and passes after a reference solution is applied by hand (never committed); for `refute`, `git apply --check change.patch` succeeds on the seed, and the seed's and the change's own tests pass, so the planted defect is not caught by the case's tests.

`bench list` prints one line per case (id, kind, title) and a `WARN` line on stderr for each problem: no title, no `Kind:` line, no `seed/` or `brief.md`, a build case with no `Accept:` line or `accept/`, a refute case with no `Expect:` line or `change.patch`, an `Expect: REWORK` case without a readable `expected.md`, and a folder with no `case.md`. `bench run` refuses a malformed case before starting anything.

## Procedure

1. **Dry run.** `node tools/orc.mjs bench run --dry-run` prints each case's command and starts nothing.
2. **Run.** `node tools/orc.mjs bench run [--case <id>]... [--variant <label>] [--models <file>] [--runs <n>] [--budget-usd <n>] [--timeout <seconds>]`. Each case run:
   - creates a scratch repo in a fresh temp folder: `git init -b base` (never `main`, `master` or `develop`, which the git guard protects), the seed committed on `base`; for `refute`, branch `change` with `change.patch` applied and committed, left checked out;
   - runs the role there: `claude -p --agent <role> --agents <json> --model <m> --effort <e> --output-format json --permission-mode acceptEdits --allowedTools <list> --max-budget-usd <n> --no-session-persistence`, the brief on stdin, never through a shell. The `--agents` definition is the agent file `build --tool claude-code` would write for the checkout's `roles/<role>.md`, so a role edit on a branch is measured without installing it. Model and effort come from `models.json` merged with `--models <file>` (the `models.local.json` shape, validated as `check` validates that file); `models.local.json` itself is not read, so a run depends only on the checkout and the flags. Allowed tools: builder `Read Edit Write Glob Grep Bash(node:*) Bash(npm:*) Bash(git:*)`, refuter the same without `Edit` and `Write`;
   - scores the run, writes `<out>/<runId>/<case>.json` (`<case>.<n>.json` with `--runs` above 1), and deletes the scratch repo (`--keep` keeps it and prints its path).
   The default out folder is `<repo top of the current folder>/.orc/bench`; `runId` is `<UTC yyyyMMddTHHmmssZ>-<variant>`. A failed run is still a result (below); the command goes on to the next case and exits 1 at the end if any run errored. `ORC_TOOL_BIN_CLAUDE_CODE` points at the executable, as for `dispatch`.
3. **Report.** `node tools/orc.mjs bench report [--dir <dir>] [--out <file>] [--force]` prints one row per variant over every result found, then a per-case table. `--out` refuses an existing file unless `--force` is given. A file it cannot read as a result is listed under **Skipped files**, never dropped silently.
4. **Judge.** Keep a change only when the false-ACCEPT rate does not rise, the build pass rate and the defects found do not fall, and the cost per pass is worth what it buys. Read the per-case table for the case that moved, and rerun it with `--keep-output` to read what the agent said.

## Scoring rules

- **Build:** after the agent finishes, `accept/` is copied in and the `Accept:` command runs in the scratch repo, with no shell: it is split on spaces (no quoting), and a leading `node` is the Node running orc. Exit 0 is `pass`, anything else `fail`.
- **Refute verdict:** the last line of the agent's final text in the refuter report format (`roles/refuter.md`: `VERDICT: ACCEPT` or `VERDICT: REWORK`, at the start of the line; `**` or backtick decoration is allowed). The template line itself (`VERDICT: ACCEPT | REWORK`) and a bare `ACCEPT` or `REWORK` are not verdicts. No verdict is an `error`. A refute run is `pass` when the verdict equals `Expect:`, else `fail`; defects found are reported apart and do not change the outcome.
- **Defects:** for `Expect: REWORK`, each `expected.md` row is `found` when the final text anywhere cites `path:line` (or `path:a-b`) in the row's file with the first line inside one of its ranges, using the corpus matching (`review/corpus.md`). The scratch repo's own path is removed first, so an absolute citation counts.
- **Errors:** a non-zero exit, a timeout (`--timeout`, default 900 seconds, kills the process tree), a budget stop or any other error the CLI's result JSON reports (a non-success `subtype`, or `is_error`), output that is not the result JSON, a tool that cannot start and a scratch repo that cannot be set up are each recorded with `outcome: "error"` and the reason. An error is never a pass. Its tokens and cost are still recorded when the result JSON carries them, since the money was spent. For a refute case the result file still records the verdict and defects read from any final text, for diagnosis, but the report gives them no weight (below).
- **Report columns**, per variant over all its runs:
  - **Runs** and **Errors**.
  - **Build pass**: passing build runs over all build runs, errors included.
  - **Verdict right**: passing refute runs over all refute runs, errors included.
  - **False ACCEPT**: `Expect: REWORK` runs where the refuter said ACCEPT, over the `Expect: REWORK` runs that finished (outcome `pass` or `fail`). This is the number that says how far an unattended ACCEPT can be trusted. Errored runs are left out of it, even when their partial text holds a verdict: an error is not a verdict, and counting one would move the rate either way. They show in **Errors**.
  - **False REWORK**: `Expect: ACCEPT` runs where the refuter said REWORK, over the `Expect: ACCEPT` runs that finished.
  - **Defects found**: found rows over expected rows, over every `Expect: REWORK` run. An errored run's rows count as expected and not found, whatever its partial text cited, so errors lower this figure rather than vanish from it.
  - **Tokens** (input, cache write, cache read and output added up) and **Cost (USD)**. Tokens are dominated by cache reads (one high-tier refuter run on a small case was about 360k tokens, most of them cache reads, for about $0.70), so compare variants on Cost; Tokens shows where the volume went.
  - **Tokens per pass** and **Cost per pass**: the variant's total over its passing runs (build and refute), so failed and errored runs count in the price of a pass; `n/a` when none pass.
  - A run with no token or no cost figure counts as 0 in a sum, and every cell built on that sum (Tokens, Cost, the per-pass cells and the per-case table) ends `(+n unknown)` with the number of such runs, so a missing figure never reads as cheap.
- A rate over fewer than 5 runs is printed as its count (`2/3`), not a bare percentage; with 5 or more it is a percentage with its count; `n/a` when no run applies.

## Result schema

The figures come from the CLI's `--output-format json` result, whose fields were checked on a real run (Claude Code 2.1.331, Windows): `result` (the final text), `total_cost_usd`, `num_turns`, `is_error`, `subtype` and `modelUsage` (per-model counters in camelCase: `inputTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens`, `outputTokens`). The same run confirmed that the inline `--agents` JSON and the comma-joined `--allowedTools` value work.

`schemaVersion` 1. One JSON file per case run:

| Field | Meaning |
|---|---|
| `schemaVersion` | 1 |
| `case`, `kind`, `variant`, `run` | the case id, `build` or `refute`, the `--variant` label, the run number (from 1) |
| `role`, `model`, `effort` | the role run and the model and effort it ran at (`effort` is `null` when the tier sets none) |
| `startedAt` | when the run started (ISO 8601, UTC) |
| `outcome`, `error` | `pass`, `fail` or `error`; the reason for an error, else `null` |
| `verdict`, `expect`, `defects` | refute only: `ACCEPT`, `REWORK` or `null`; the case's `Expect:`; `[{id, found}]`, one per `expected.md` row (empty for `Expect: ACCEPT`) |
| `tokens` | `{input, cacheWrite, cacheRead, output}` from the result JSON: the per-model `modelUsage` totals when present, else the top-level `usage`; `null` with no result JSON |
| `costUsd`, `turns` | the result JSON's `total_cost_usd` and `num_turns`, or `null` |
| `wallClockSeconds` | from scratch repo to score, one decimal |
| `gitHead`, `gitDirty` | the checkout's `HEAD` and whether it had uncommitted changes (`null` outside a git repo) |
| `claudeVersion` | from `claude --version`, or `null` |

**Privacy.** As in `review/metrics.md`: a result stores no prompt text, agent output or absolute path. An `error` reason has the scratch repo, the checkout, the temp folder and the home folder replaced by placeholders, and any other absolute path by `<path>`. Only `--keep-output` writes the agent's final text, beside the result as `<case>.output.md`; it may name paths, so keep it out of anything shared.

## What it does not measure

- **Isolation.** A headless run loads the machine's Claude Code setup: the user's `~/.claude/CLAUDE.md`, settings, hooks (the git guard among them) and MCP servers. Compare variants on one machine with one setup. `--strict-mcp-config` and `--permission-prompts none` exist for a stricter run but are not passed.
- **A sandbox.** The scratch repo is the working folder, not a jail. The agent runs with `--permission-mode acceptEdits` and `Bash(node:*)`, `Bash(npm:*)` and `Bash(git:*)` allowed, so a command it runs can read or write outside the scratch repo (a `node -e` script, an `npm` lifecycle script, a `git -C <path>`). Run the bench as a user and on a machine where that is acceptable.
- **The loop.** Each case is one role, one run: no REWORK round, no orchestrator, no board. A refuter case measures a verdict on a fixed diff, not the refuter's effect on a builder.
- **Scale.** The cases are small on purpose; a role that does well here can still fail on a large change.
- **Other tools.** Only Claude Code has a bench recipe; `--tool` with any other id exits 1.
