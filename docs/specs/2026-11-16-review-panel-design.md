# Review panel in Orc-istration — design

Date: 2026-11-16. Source: the pre-PR review 5.x panel (explorers + verifier) and its per-run metrics, from the private repo where they were first built. Owner's decisions are marked **(decided)**; my calls are marked **(call)**.

## Intent

Orc-istration's rulebook says "run a full multi-agent review" for the Full tier, but the panel itself only exists inside one employer's repo, which is going away. Port the panel so any repo, from any supported tool, gets the same review: explorers that run checklist lanes, leads settled by a verifier, one consolidated report, a run log that feeds calibration, and per-run metrics.

## Goals

- The full panel in Orc-istration, tool-neutral at the core. **(decided)**
- A Claude Code `/pre-pr-review` command on top of the neutral procedure. **(decided)**
- Run log + in-session verdicts, model choice with lite mode, calibration report, per-run metrics. **(decided)**
- Stack-specific checks generalized; source-repo-only pieces dropped. **(decided)**

## Non-goals

- GPT mirror, `runtime-validator`, `ticket-env.ps1`, the ADO ticket-brief script, the 16 golden calibration cases (built from the source repo's diffs), the Excel workbook, the `/start` and `/peer-review` integrations. **(call: dropped as source-repo-only or tool-specific)**
- Rewriting lane wording. Lanes keep their existing text except where a source-repo term must go. **(call)**

## Anti-goals

- No source-repo or employer names, teammate names, ticket ids or internal terms anywhere in tracked files or history. The repo is public.
- No change to the existing five roles or to how Claude Code's current agents behave.
- No machine-specific absolute path in tracked or golden files.

## Layout

- `roles/review-code-explorer.md`, `review-failure-explorer.md`, `review-docs-explorer.md`, `review-design-explorer.md`, `review-checklist-explorer.md`, `review-verifier.md`: read-only, capabilities list/search/read/shell, tier from each source agent's `model:` line (opus = High, sonnet = Mid). Every adapter generates them; golden tests updated for all 7 tools.
- `review/PROCEDURE.md`: the neutral orchestrator procedure, ported from `.claude/commands/pre-pr-review.md` (scope, lane selection with the small/large sizing, launch, lead routing, severity review, report, run log, verdict capture, metrics). Model names become tiers. "Ask" becomes the tool's own question mechanism.
- `review/contract.md` (explorer contract), `review/shared-rules.md`, `review/selection.md` (the Agent Selection Guide from `ai-pr-review.md`).
- `review/lanes/`: code-reviewer, architecture-reviewer, type-design-analyzer, code-simplifier, silent-failure-hunter, comment-analyzer, pr-test-analyzer, ticket-coverage, secondary-artifacts, ui-test-reviewer.
  - **Generalized (decided):** stack-specific checks (tenant scoping, antiforgery, Up.sql, Razor, ADO) are replaced by "the project's review rules": the lanes read `REVIEW.md` at the reviewed repo's root when it exists, or the path the project's own rulebook names. **(call)**
  - `playwright-reviewer` becomes `ui-test-reviewer` (generic UI/end-to-end test conventions). `secondary-artifacts` keeps its method (docs, screenshots, changelogs and help content that a code change makes stale) without the source repo's artifact lists.
  - `ticket-coverage` takes a brief file or ticket text the developer gives; no tracker script. **(call)**
- `review/calibration.md`: run-log format, verdict values (confirmed / false-positive / wont-fix), and the calibration-report procedure.
- `review/metrics.md`: the metrics report schema, privacy rules and field definitions.
- `AGENTS.md` Full-tier line points at `review/PROCEDURE.md`. The rulebook must stay under Antigravity's 24,000-byte cap.
- **Claude Code commands (decided):** the claude-code adapter also writes `commands/pre-pr-review.md`, `commands/review-verdict.md` and `commands/calibration-report.md`. Each is a thin wrapper that says "follow `review/<file>` in the Orc-istration checkout", with the checkout path resolved at install time or through an environment variable. It is never a hard-coded path in golden files. **(call)** Tracked by the install manifest like the agent files.

## Tooling (`node tools/orc.mjs ...`, Node 22+, no dependencies)

- `calibration [--logs <dir>]`: aggregates run logs into per-lane precision (confirmed vs false-positive vs wont-fix) and flags lanes below a threshold. This ports `/calibration-report`'s aggregation; the recommendations stay in `review/calibration.md`.
- `metrics capture|report`: a Node port of `agent-metrics.ps1` (capture one run's tokens, context, file reads and outcome) and `agent-metrics-report.ps1` (aggregate). It reads Claude Code session transcripts only; other tools are listed as unsupported in their adapter notes. JSON per run under the reviewed repo (default `.orc/metrics/`; see the run-log location below).
- The run log and metrics live in the reviewed repo under `.orc/` by default, configurable. The repo decides whether to commit them. **(call)**

## Verification

- `npm test` and `node tools/orc.mjs check` green, with golden files regenerated for all 7 adapters. CI is green on Ubuntu and Windows.
- A scrub test (extending the existing owner-name test) fails on a denylist (source-repo and employer names, teammate surnames, internal tool names and ticket-id patterns, built from fragments) across all tracked files.
- `calibration` and `metrics` have tests on fixture logs and transcripts, which are synthetic, not copied from real runs.
- **Live acceptance:** after the build, the orchestrator runs `/pre-pr-review` from this machine's installed Claude Code copy on the PR's own diff, and the report and run log come out in the documented format.

## Build plan

Two builders in parallel, split by file ownership, then one refuter each:
- **A (panel):** `roles/review-*`, `review/` except `calibration.md` and `metrics.md`, the claude-code adapter commands, `AGENTS.md`, `README.md`, goldens, scrub test.
- **B (tooling):** `tools/lib/calibration.mjs`, `tools/lib/metrics.mjs`, their `orc.mjs` subcommands and tests, `review/calibration.md`, `review/metrics.md`.

One branch `review-panel` off `origin/main`, in a worktree outside `~/.claude`, which is this machine's live config. One PR to `main`.

## Left to the builder

The exact frontmatter per adapter, how the install path reaches the command wrappers, and the wording of the generalized lane lines.
