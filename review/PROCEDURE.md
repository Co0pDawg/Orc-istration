# Pre-PR Review Procedure

Version: 1.2.0 (bump on change: major = workflow reshape, minor = new behavior, patch = fix or wording; the metrics
capture records it)

The orchestrator's procedure for the review panel: a pre-submission review of every change a branch introduces
relative to a base branch, run by read-only explorer agents over checklist lanes, with leads settled by a verifier,
one consolidated report, a run log for calibration and per-run metrics. It is tool-neutral; each tool's notes say how
to dispatch an agent by roster name, override its tier for one dispatch, resume it and ask the user a question, and
name the command or skill that runs this file.

`CHECKOUT` below is the setup checkout (the Orc-istration clone). Find the Orc-istration checkout: the "Setup checkout (this machine)" line in the rulebook's tool notes, else `setupCheckout` in `config.json` (under `ORC_DATA_DIR` when set, else under `~/.orc/`), else ask the user. Call it CHECKOUT and confirm `CHECKOUT/review/PROCEDURE.md` exists there; if it does not, stop and say so. Every `review/...` path is relative to it. The review itself runs in the
reviewed repo's working directory.

**Arguments (all optional):**
- First token: source branch to review (e.g. `feature/1234-export-csv`). Omit to use `HEAD`.
- Second token (if it looks like a branch name): base branch to compare against (e.g. `main`, `develop`). Default: the
  repo's default branch (`git symbolic-ref --short refs/remotes/origin/HEAD`, without `origin/`), else `main`.
- Remaining tokens: scope filters — one or more of `code`, `errors`, `comments`, `types`, `tests`, `simplify`, `ui`,
  `arch`, `secondary`, `tickets`. Omit to run all applicable lanes.
- `lite` or `full`: the run mode for this run only (see [Lite mode](#lite-mode)). Neither one restricts the lanes.
- A path to a ticket brief or ticket text file, or a ticket id the developer then pastes: the intent context for
  Step 1.

A token is treated as a branch name if it contains `/` or `-`, OR if it matches one of the common single-word branch
names (`main`, `master`, `develop`, `staging`, `hotfix`, `release`), AND it does not match a known scope keyword or
mode keyword, AND it is not an existing file path. All other tokens are scope filters.

---

## Step 1 — Collect scope

Parse the arguments to determine:
- `TARGET` — first branch-like token, or `HEAD` if none
- `BASE` — second branch-like token, or the default above
- Scope filters — any remaining tokens matching known keywords

Fetch first so the comparison is against the current remote base, not a stale local ref — a stale `origin/<BASE>`
silently reviews the wrong diff:

```
git fetch origin <BASE>
git diff --name-only origin/<BASE>...<TARGET> -- . ':!.orc/'
git diff origin/<BASE>...<TARGET> -- . ':!.orc/'
```

`.orc/` holds the review run logs and metrics this procedure writes (`review/calibration.md`, `review/metrics.md`; a
repo may configure another folder, which is then excluded the same way); they are never reviewed, so pass the same
exclusion wherever an agent's prompt gives it a diff command.

Also collect the change's intent:

```
git log origin/<BASE>..<TARGET> --pretty=format:"%s%n%b"
```

**Stop on a merged branch.** If `git merge-base origin/<BASE> <TARGET>` equals `git rev-parse <TARGET>`, every commit
on the branch is already in `<BASE>`: say so, naming the merge commit when
`git log origin/<BASE> --merges --ancestry-path <TARGET>..origin/<BASE>` finds it, and stop. Against that empty diff
every ticket item would read Not implemented. The one exception is `TARGET` `HEAD` with uncommitted changes, the
pre-commit case in `review/selection.md` ("Reviewing uncommitted work").

**Project review rules.** Find the reviewed repo's review rules: `REVIEW.md` at its root, or the path its rulebook
names (`review/shared-rules.md`, **Project review rules**). Note the path for every prompt; with none, say so in one
line and continue — the lanes skip the checks that depend on it.

### Ticket brief

Injecting the *why* eliminates the largest category of irrelevant review comments. When the developer gave a ticket —
a brief file, ticket text in the conversation, a pasted work item, or a PR description — write the ticket brief every
agent reads to `<scratchpad>/ticket-brief-<branch-slug>.md` (slug = branch name with `/` replaced by `-`; `<scratchpad>` is
the tool's session scratch folder, or `.orc/tmp/` in the reviewed repo when the tool has none):

1. A header: branch, base, and where the text came from.
2. A **Spec items** table (`| Id | Item | Source |`), one row per checkable requirement: `S1`..`Sn` from the
   acceptance criteria, then from the description, then requirements later comments add (a later comment outranks the
   criteria it changes when the developer or the ticket's owner made or confirmed it; say so in the row). Requirements agreed after the ticket was written (a plan's decisions)
   get `R1`..`Rn`. Each How to Test step in a PR description gets a `PR-HT<n>` row. Mark an item from a parent ticket
   as `goal` or `context` in its Source cell when it is not this branch's work.
3. The source text verbatim: description, acceptance criteria, repro steps, comments, PR description and threads.

A brief file the developer gives that already has a Spec items table is used as is. `BRIEF` is that file. Read only
its **Spec items** table, for the Step 4 coverage table; agents read the rest themselves.

When no ticket was given and the session is interactive, ask once with the tool's question mechanism for the ticket
text or a brief path, with a "No ticket — review without one" option. With no brief, agents get the commit messages
and any PR description you hold as their intent context, and `ticket-coverage` does not run.

---

## Step 2 — Select lanes

Read `review/selection.md` and follow it (Steps 1–2, the architecture triggers and the project paths) to determine
which lanes to run, using the changed file list from Step 1. Each lane is a checklist (`review/lanes/<lane>.md`) that
one of the explorer agents runs (up to five, by diff size and selection). Step 3 groups the selected lanes into
explorers:

| Explorer (roster name) | Default tier | Lanes |
|---|---|---|
| `review-code-explorer` | High | code-reviewer (always), architecture-reviewer, type-design-analyzer, code-simplifier |
| `review-failure-explorer` | High | silent-failure-hunter |
| `review-docs-explorer` | High | comment-analyzer |
| `review-checklist-explorer` | Mid | pr-test-analyzer, ui-test-reviewer, secondary-artifacts, ticket-coverage |
| `review-design-explorer` | High | architecture-reviewer, type-design-analyzer, code-simplifier (large diffs only) |
| `review-verifier` | High | settles leads, verifies findings and reviews severity (Step 3) |

An explorer runs only when at least one of its lanes is selected. Without scope filters `code-reviewer` is always
selected, so `review-code-explorer` always runs; scope filters can leave it out (`errors comments` runs only the
failure and docs explorers).

**Size the grouping to the diff.** From `git diff --shortstat origin/<BASE>...<TARGET> -- . ':!.orc/'` (run logs and
metrics under `.orc/` never count; files changed; insertions +
deletions = changed lines):

- **Small** (15 files or fewer and 300 changed lines or fewer): the `comment-analyzer` lane runs inside
  `review-code-explorer`; no `review-docs-explorer`. A separate agent's starting context costs more than the lane on a
  diff this size.
- **Large** (60 files or more, or 2000 changed lines or more): `architecture-reviewer`, `type-design-analyzer` and
  `code-simplifier` move to `review-design-explorer`, so `review-code-explorer` spends its pass on correctness and
  security (`code-reviewer` and angles A–D); error handling is always in `review-failure-explorer`. The cross-file
  angles E (sibling surfaces), F (co-change) and I (write/read agreement) move with them: tell
  `review-design-explorer` to run them and `review-code-explorer` to skip them.
- Otherwise the table above applies as is, without `review-design-explorer`.

Say the size and grouping in one line.

With a `BRIEF`, also select `ticket-coverage`; without one, drop it and say so in one line.

If scope filter keywords were provided, restrict the selected lanes to the ones they name (branch-name tokens alone do
not restrict anything). `arch`, `secondary` and `tickets` are the exceptions: they run `architecture-reviewer`,
`secondary-artifacts` and `ticket-coverage` even when the trigger tables did not select them (`tickets` still needs a
`BRIEF`):

| Keyword | Lane |
|---------|-------|
| `code` | `code-reviewer` |
| `errors` | `silent-failure-hunter` |
| `comments` | `comment-analyzer` |
| `types` | `type-design-analyzer` |
| `tests` | `pr-test-analyzer` |
| `simplify` | `code-simplifier` |
| `ui` | `ui-test-reviewer` |
| `arch` | `architecture-reviewer` |
| `secondary` | `secondary-artifacts` |
| `tickets` | `ticket-coverage` |

### Lite mode

Lite mode runs the same explorers and verifier with every one on the Mid tier, for developers whose plan has a tight
usage limit. It is on when the `lite` token is passed, or when the developer's rulebook contains the line
`Orc review: lite` and `full` was not passed; it pre-selects the **All Mid** model choice in Step 3 without asking.
Say which mode is running in one line.

- **Not for sensitive diffs.** If the diff touches an extra-scrutiny area the project's review rules name (payment,
  admin, authentication, data scrubbing and the like), run full mode and say why in one line.
- Lane selection is unchanged.
- The Verdict line and the run log's agents line end with `(lite)`.

---

## Step 3 — Run agents

In lite mode, follow [Lite mode](#lite-mode) wherever it differs from this step.

**Choose the tiers.** The procedure does not pin models; the developer chooses, and the default is each agent's own
tier (its role file, the table in Step 2) with one adjustment. Ask with the tool's question mechanism, single choice:

- **Default (Recommended):** each explorer and the verifier on its own tier, except `review-checklist-explorer` on High
  when the `ui-test-reviewer` lane is selected (UI test convention findings were lost when that lane ran on Mid).
- **All Mid (lite):** every explorer and the verifier on Mid. Cheapest; weaker on docs and code-correctness lanes.
- **All High:** every explorer and the verifier on High. Most thorough; the checklist explorer costs several times more.
- **Role tiers only:** each agent on its role's tier, with no adjustment for the UI test lane.

Do not ask when the answer is already known or no one can answer: lite mode pre-selects **All Mid**; a line
`Orc review models: default|mid|high|role-tiers` in the developer's rulebook pre-selects that option; and when another
workflow invoked this one or the session is non-interactive, use **Default**. Say the choice in one line. Pass the
chosen tier as a per-dispatch model override on each explorer and verifier launch (the tool notes map tiers to
models), and omit it for agents that keep their own tier.

Before launching, for every changed code file look for its exact sibling `<path>.md` in the same directory (per the
annotation files section of `review/selection.md`). Collect the pairs found — regardless of whether the `.md` side is
in the diff — for `comment-analyzer`.

Launch every explorer that has a selected lane **in parallel**, in the background where the tool can, dispatching each
by its roster name from the Step 2 table (never a general-purpose agent: the explorer roles are read-only and carry
their own instructions and tier). When more High-tier explorers would run at once than the rulebook allows in flight,
stage them, `review-code-explorer` first. Do not read or paste lane definitions; each explorer reads its own.

Each explorer's prompt holds:

- The lanes selected for it, by name
- `CHECKOUT` (the absolute path of the setup checkout, so it can read `review/contract.md`, `review/shared-rules.md`
  and `review/lanes/`)
- `BRANCH`, `BASE`, and the diff command (`git diff origin/<BASE>...<TARGET> -- . ':!.orc/'`), plus the changed-file
  list. Do not paste the diff; the explorer reads it once itself
- The path of the project's review rules, or "none"
- The matching area doc if the project's documentation map names one for the changed paths
- The intent context from Step 1: the commit messages, plus the `BRIEF` path with an instruction to read the brief
  before the diff. With no `BRIEF`, any ticket or PR description you hold, verbatim.
- For whichever explorer runs `comment-analyzer`: the code/annotation pairs collected above, to read in full whether or
  not the `.md` side is in the diff
- For `review-checklist-explorer` with the `secondary-artifacts` lane: any list of likely-stale artifacts the caller
  passed (a plan's list), as candidates to judge
- For `review-code-explorer` and `review-design-explorer` on a large diff: which of them runs angles E, F and I

Note each explorer's agent id; lead routing resumes them.

### Routed agents

Before launching, read `routing` from the shared `config.json` (under `ORC_DATA_DIR` when set, else `~/.orc/`). If `config.json` exists but cannot be read or parsed, tell the user and note it in the Step 4 report (never report it as no route), and launch in-session. Otherwise, a role's own `routing` entry is either a plain tool id string or a list of tool ids; its first tool is that string or the list's first item. Any explorer or `review-verifier` whose own `routing` entry names first a tool other than the one the orchestrator is running in is dispatched headlessly there; the `fallback` key alone never reroutes a role. With no config or no such entry, nothing changes.

- **Command:** run from the reviewed repo's root, in the background where the tool can, saving stdout only to a file outside the reviewed repo (the tool's scratch folder, or the system temp folder when it has none) and stderr to a separate file there:
  ```
  node <CHECKOUT>/tools/orc.mjs dispatch --tool <that tool> --role <role> --brief <prompt file> --no-lint --timeout 1800
  ```
  `tools/orc.mjs` passes stdout through unchanged; for a tool such as Antigravity that prints one JSON object whose `response` string holds the report, read the `response` string as the report before any format check.
- **Prompt file:** write it outside the reviewed repo (the tool's scratch folder, or the system temp folder when it has none). Put in it the same items an in-session prompt holds (for an explorer, the items above; for `review-verifier`, the lead-routing, finding-verification or severity-review items below), plus explicit orders to report inline, change no file and write no board. Pass `--no-lint` because an explorer or verifier prompt is not a marching-orders brief.
- **Tier override:** when Step 3's model choice overrides the agent's tier, pass `--model <slug>` with that tool's model for the chosen tier (from `models.json`, `~/.orc/models.json` or `models.local.json`, using `headless.<tier>` when defined for that tool). With `--tool`, `--model` replaces only the model passed to that tool and leaves the role's or tier's effort unchanged.
- **No resume:** a routed agent cannot be resumed. Leads owned by a routed explorer go to `review-verifier`, and when `review-verifier` is routed each verifier step launches a fresh run.
- **Fallback on failure:** if the run cannot start, exits non-zero or returns no report in the expected format, launch the same role in-session as usual and note `<role> ran in-session: <tool> failed (<reason>)` in both the Step 4 report and the Step 5 run log.
- **Clean-tree check:** from the repo root, record before launching and compare after each routed agent ends (writing the check's output files outside the reviewed repo, in the tool's scratch folder or the system temp folder when it has none): `git rev-parse HEAD`; `git rev-parse --abbrev-ref HEAD`; `git status --porcelain --untracked-files=all -- . ':!.orc/'`; the `git hash-object` of a file written by `git diff HEAD --binary --output=<file outside the repo> -- . ':!.orc/'`; the `git hash-object` of a file written by `git diff --cached HEAD --binary --output=<file outside the repo> -- . ':!.orc/'`; and the `git hash-object` of each file listed by `git ls-files --others --exclude-standard -- . ':!.orc/'`. A configured run-log folder is excluded in place of `.orc/`, as in Step 1. Gitignored files are not covered. If any of these commands fails, report the check as inconclusive, naming the command and path; never treat it as unchanged. Report any difference to the user and do not revert it.

### Waiting

Wait for every explorer to complete before routing leads. While agents run and as results arrive, do **not** relay
raw agent output or per-finding commentary into the conversation — at most a one-line status per agent
(`review-code-explorer: done, 9 findings, 4 leads`). Findings appear only once, in the consolidated Step 4 report.

### Lead routing

Explorers report suspected defects they could not settle as **leads** (`review/contract.md`) instead of dropping them
or asking them as questions. Settle every lead before the report:

1. Pool the leads. Drop a lead that duplicates a **finding** (same `file:line` or same mechanism) and merge duplicate
   leads. A lead that matches only a question is still verified; if it is confirmed, the finding replaces the
   question.
2. A lead whose `Owner` lane belongs to a **different** explorer that ran: resume that explorer with the batch of leads
   it owns (one message per explorer, using the id from Step 3): "Verify these leads with your context, per the
   explorer contract's *When resumed to verify leads* section." It keeps its context, so verification reuses what it
   already read. In a tool that cannot resume an agent, or when that explorer ran headlessly on another tool (an
   explorer that fell back to an in-session run can still be resumed), these leads go to the verifier in step 3 instead.
3. Every other lead (an explorer's own-lane lead, no owner, or an owner whose explorer did not run): one
   `review-verifier` agent, all leads in one batch, with `CHECKOUT`, `BRANCH`, `BASE`, the diff command, the project's
   review rules path and the `BRIEF` path. Run it in parallel with step 2's messages.
4. `CONFIRMED` and `PLAUSIBLE` leads become findings under their original lane tag, at the severity the verifier or
   owning explorer gave; tag `PLAUSIBLE` ones `(plausible)`. `REFUTED` leads leave the report; count them.
5. A `PLAUSIBLE` lead marked `Check by: runtime` is also listed under **Runtime checks** in the report, with its
   `Runtime steps:` and the expected result against the defective one (see [Runtime checks](#runtime-checks)).

### Finding verification

Explorers verify their own findings, but an explorer that is wrong about a caller or a guard is wrong with
confidence, and a fix built on a wrong finding costs more than the check. Before severity review, send every `issue:`
and `warning:` finding that did not come from a lead the verifier or an owning explorer already settled to
`review-verifier` in **findings mode**: one batch, each with its number, lane tag, severity, text, location and
evidence, plus `CHECKOUT`, `BRANCH`, `BASE`, the diff command, the project's review rules path and the `BRIEF` path.
Resume the lead-routing verifier if one ran and can be resumed (not routed); otherwise launch one. Skip the step when
there are no issues or warnings.

- `CONFIRMED` findings stay, and `PLAUSIBLE` ones stay tagged `(plausible)`, each at the severity the verifier
  returns: a raise moves the finding to its new severity section with the verifier's reason (the verifier never
  lowers one).
- A `PLAUSIBLE` finding the verifier says only a running app can settle comes with its `Runtime steps:`; list it
  under **Runtime checks** as well, like a runtime lead.
- `REFUTED` findings leave the severity sections and move to **Refuted by verification** in the report, each with the
  verifier's quoted evidence, so the developer can overrule a wrong refutation. Count them in the Verdict block. They
  are logged with an agent verdict (Step 5).

### Severity review

After lead routing, send every remaining `suggestion:`, `nit:` and `question:` to `review-verifier` in
**severity-review** mode: one line each (number, lane tag, severity, text, location), with `CHECKOUT`, `BRANCH`,
`BASE`, the diff command and the `BRIEF` path. Resume the lead-routing verifier if one ran and can be resumed (not
routed); otherwise launch one. Apply every `RAISE` line: the item moves to its new severity section, keeps its lane
tag, and carries the verifier's reason; a raised question becomes a finding with the question appended. The verifier
never lowers or drops an item. Skip this step when there are no suggestions, nits or questions.

---

## Step 4 — Report

**The report is the deliverable and it comes first.** There is no item limit: report every finding, ranked by impact
within its section. Produce the full consolidated report below (and the Step 5 log) before touching any file — never
jump from collecting findings into fixing them, even when a fix looks obvious or the session has prior context on the
issue. Apply fixes only after the report is delivered and the user asks for them.

Before listing, merge findings from different lanes that target the same `file:line`, or the same spec item id, into a
single entry that names both lanes — do not list the same line twice. Merge only on the same location: findings about
different files, callers or call sites stay separate entries even when they share one cause (a test gap in three
callers is three entries). Use the format `- [laneA, laneB] finding — file:line` for merged entries. Keep each
finding's `Suggested fix:` and `Screenshot:` lines with it. Then produce a consolidated summary:

```
## Pre-PR Review — <branch name>

### Must fix before submitting (issue:)
- [lane] finding — file:line

### Review before submitting (warning:)
- [lane] finding — file:line

### Suggestions and nits
- [lane] finding — file:line

### Questions for the author (question:)
- [lane] question — file:line or spec item id

### Ticket coverage
| Id | Item | In How to Test? | Static | Evidence |

### Not verified
- ticket-coverage's Not verified list

### Runtime checks
- [lane] <check> — file:line
  Steps: <what to do in the running app>
  Expected: <a correct build> / Defective: <what shows the defect>

### Refuted by verification
- [lane] <severity>: finding — file:line
  Evidence: <the verifier's quoted line, constraint or count>

### Strengths
- One to three things the change does well, specific to this diff (omit the section if nothing stands out)

### Verdict
approved | needs changes | informational — N issue / N warning / N suggestion / N nit / N question
Leads: N raised, N confirmed, N plausible, N refuted
Verification: N checked, N confirmed, N plausible, N refuted
Severity review: N raised
Agents: <routed agents, e.g. review-failure-explorer on codex (silent-failure-hunter), or <role> ran in-session: <tool> failed (<reason>)>
```

**Ticket coverage** (only with a `BRIEF`) has one row per id from the brief's Spec items table, plus the edge-case
rows (`<id>a`) the agents added. **Static** is `ticket-coverage`'s status. Omit **Not verified** when it listed
nothing. Omit **Runtime checks**, **Refuted by verification** and the `Verification:` line when they would be empty.
Include `Agents:` only when a role was routed (including fallbacks), and note any unreadable or unparseable `config.json` in the report; omit `Agents:` when every agent ran in-session without routing.
The counts in the first Verdict line leave refuted findings out.

### Runtime checks

**Runtime checks** lists the `PLAUSIBLE` leads marked `Check by: runtime`, and the `PLAUSIBLE` findings that finding
verification returned with `Runtime steps:`: each stays a finding in its severity
section and is repeated here with its steps. The panel itself never runs the app. Running the checks belongs to the
caller: the developer, or the `start` workflow's live step when that workflow invoked the review. Whoever runs one
records its result in the run log's `## Runtime checks` table (Step 6).

> This review is static — it does not compile the branch or run tests. Run the project's build and the affected tests
> (its rulebook or review rules name the commands) before treating a clean review as a green branch.

Then, when the project has PR guidelines (its review rules or rulebook name them), check the diff against them — for
example screenshots for UI changes, or schema, config-key and shared-contract changes called out in the description —
and list anything the description still has to cover.

---

## Step 5 — Log the run

Write the run log record exactly as `review/calibration.md` specifies (its location, file name, header lines, table
and carry-forward from an earlier run of the same branch). One row per finding in the report, plus one row per
finding under **Refuted by verification**, its verdict already set to
`false-positive — refuted by verifier: <evidence> (agent)`. The agent cell uses
exact **lane** names (the tag on each finding, never an explorer name), comma-separated for merged findings, so
per-lane aggregation keys stay stable. The Where cell takes the spec item id for a finding about a requirement. When
the report has **Runtime checks**, the log gets a `## Runtime checks` table with each check's Result `_not run_`.

**Metrics.** Then capture the run's token, context and outcome metrics (`review/metrics.md`):

```
node <CHECKOUT>/tools/orc.mjs metrics capture --workflow pre-pr-review --log <the run log> --mode <lite|full> --version <this file's version>
```

Add `--session <id>` or `--transcript <path>` when the tool notes say how to find the current session. It prints the
report's path; keep it as `METRICS`. The report is written into the reviewed repo (default `.orc/metrics/`) and stays
uncommitted unless the repo commits its `.orc/` folder. Capture reads Claude Code transcripts only: outside Claude Code
it prints `metrics: skipped (...)` and exits 0, so there is no `METRICS`, and the review goes on. When it exits 1, put
its error line under the Step 4 report and carry on: metrics never block a review.

---

## Step 6 — Capture verdicts in-session

Verdicts are recorded **as the session resolves each finding**, not in a separate triage pass. Update the run log's
verdict cells, using the verdict values in `review/calibration.md`, at these moments:

- **A finding is fixed** (you apply the fix, or the user fixes it and tells you): it is confirmed, fixed in session.
  Accepting and fixing a finding *is* the confirmation — no separate sign-off needed. The verdict ends with its
  source: `(developer)` when the developer asked for the fix or made it, `(agent)` when a workflow applied it on its
  own, until the developer confirms it (then change it to `(developer)`). A `secondary-artifacts`
  `(out-of-repo)` finding is not fixed here; once the user accepts it, it is confirmed and handed to the artifact's
  owner.
- **A finding is discussed and rejected**: false-positive (the finding was wrong) or wont-fix (right but not worth
  acting on), each with the reason. The reason is the calibration payload — capture the user's actual objection, not a
  paraphrase of the finding. A developer who overrules a verifier refutation replaces that row's agent verdict with
  their own.
- **A runtime check is run**: set its Result to `pass` or `fail — <what was seen>`. A failed check confirms its
  finding, `(developer)` when the developer ran it and `(agent)` when a workflow's live step did. A passed check sets
  only the Result to `pass`: the `(plausible)` finding's verdict stays open for the developer to give (a pass on one
  path rarely proves the defect impossible).
- **The review concludes** (the user asks to commit, open a PR, or moves on): sweep remaining `suggestion:`/`nit:`
  rows to not-actioned — logged but not engaged with, excluded from precision math. `issue:`/`warning:` rows the user
  never addressed stay pending; list them when closing so nothing blocking is silently dropped. After the sweep, run
  the Step 5 metrics capture again with the same arguments so the report carries the final verdicts (outside Claude
  Code it reports skipped again, and the review goes on).

The verdict command (your tool notes name it; or `review/calibration.md` followed by hand) remains available
for leftovers and corrections, but a session that fixes findings as it goes should end with nothing pending.

**Calibration trigger.** After the sweep, apply the calibration trigger in `review/calibration.md`. When it trips,
close with one line offering the calibration report (the command your tool notes name, or
`node <CHECKOUT>/tools/orc.mjs calibration`). Do not run it unprompted, and do not mention the trigger when it has not
tripped.
