# Lane Selection Guide

Scope: which review lanes run for a given diff. `review/PROCEDURE.md` Step 2 follows this guide, then groups the
selected lanes into explorers.

---

## Lanes

Each lane is a checklist in `review/lanes/<lane>.md`, run inside one of the read-only explorer agents.

| Lane | What it reviews |
|------|----------------|
| `code-reviewer` | Correctness/logic bugs, security pattern violations (hardcoded secrets, injection, open redirects), authorization and tenant scoping, the project's stack checks (migration co-change, UI test hooks), deprecated API usage, naming consistency (only when a style rule is explicit), dead code. `warning:`/`suggestion:` at confidence ≥ 76, `issue:` at ≥ 91, `nit:` at 51–75 |
| `silent-failure-hunter` | Null/error handling gaps: unguarded nullable dereferences, swallowed exceptions, unchecked result objects, silent fallback behavior, over-broad error propagation, build and pipeline output that degrades quietly |
| `comment-analyzer` | Comment accuracy against the code (including parameter/return type claims), comment rot, documentation accuracy and doc/code co-change, `<filename>.md` annotation file accuracy |
| `type-design-analyzer` | Type encapsulation, invariant expression, setter discipline, null suppression: a 1–10 rating across four axes per type |
| `pr-test-analyzer` | Missing test coverage for changed logic (UI/end-to-end tests satisfy UI coverage) and the quality of added tests; gaps rated ≥ 5 criticality only |
| `ui-test-reviewer` | UI and end-to-end test quality: locator patterns, hardcoded waits, async discipline, assertion correctness, page-object structure, test-side coverage gaps |
| `code-simplifier` | Clarity, maintainability and over-engineering (`yagni:`/`delete:`/`stdlib:`/`reuse:`/`native:` tags); `suggestion:`/`nit:` only, never a gate |
| `architecture-reviewer` | End-to-end feature design: flow from entry point to side effects, layering, cross-file DRY and KISS, endpoint contracts and repeated submission, integration partial failure, retry safety, concurrency, workflow edge cases. Opens with a flow summary; at most five findings; no `nit:` |
| `secondary-artifacts` | Walkthroughs, screenshots, manual test cases, changelogs and help content the diff makes stale. Each finding is tagged `(in-repo)` or `(out-of-repo)`; the output ends with a `Searched:` line |
| `ticket-coverage` | The branch against the ticket brief, by reading the code: a static status for every spec item, PR description claims the diff doesn't support, scope beyond the tickets, How to Test steps that no longer match the code. No `nit:` |

**Out of scope for every lane:** product and business-rule decisions, whether a PR or change should exist, and design
trade-offs the ticket records as deliberate. `architecture-reviewer` reports a design concern only when it can name a
concrete failure scenario or an existing mechanism the change duplicates.

## Project paths

The tables below speak of source files, test folders, UI test folders, entry points and the documentation map. The
project's review rules (`review/shared-rules.md`, **Project review rules**) say which paths those are in the reviewed
repo, and may add or remove triggers. Without them, judge from the repo's layout: test folders are paths such as
`tests/`, `test/`, `*.Tests/`, `__tests__/` and files named `*.test.*`, `*.spec.*` or `*_test.*`; UI test folders are
the end-to-end suite (Playwright, Cypress, Selenium and the like).

## Step 1 — Always run

Run `code-reviewer` on every PR regardless of what changed. Run `code-simplifier` on every PR whose diff contains code
files (source in any programming language, views and templates) — its findings are `suggestion:`/`nit:` only and never
gate, and a simplification suggestion on a line that also drew an `issue:` is still useful when the author fixes that
line. Do not gate it behind a clean pass from the other lanes: a first pass rarely comes back clean, so gating it that
way means the rerun never happens and the polish findings are never delivered.

Run `ticket-coverage` whenever the run has a ticket brief, whatever the diff contains.

## Step 2 — Run based on file patterns

| If the diff contains... | Add these lanes |
|-------------------------|-----------------|
| Any source file outside the test folders and the UI test folders | `silent-failure-hunter` |
| An entry point, background job, integration or schema change, per [Architecture reviewer triggers](#architecture-reviewer-triggers) below | `architecture-reviewer` |
| New or substantially modified type files (models, records, classes, interfaces) | `type-design-analyzer` |
| Any `.md` files under `docs/` | `comment-analyzer` |
| Any file under the UI test folders | `ui-test-reviewer` |
| A routed view or page (not a layout partial with no route of its own), navigation, a controller action or route handler, a page script, or any walkthrough, screenshot or help-content asset the repo keeps. The `secondary` scope keyword runs it on any diff | `secondary-artifacts` |
| Logic files outside the UI test folders changed with no corresponding UI test changes | `pr-test-analyzer` |
| Code under a path the project's documentation map covers, with the mapped doc absent from the diff | `comment-analyzer` — flag missing or stale area documentation |
| Any changed code file that has a sibling `<filename>.md` annotation file (see below) | `comment-analyzer` — verify the annotation file against the change |
| Any deploy-pipeline or site-config file (CI workflow YAML, build config, static-site config) — excluding vendored libraries (`*.min.js`, `*.d.ts`, third-party trees) | `silent-failure-hunter` |

## Architecture reviewer triggers

`architecture-reviewer` reviews flow, integrations and failure handling. It is the most expensive lane per run, and a
diff that changes none of those things gives it nothing to review. Select it when the diff, outside the test folders,
does **any** of the following:

| The diff... | Detect with |
|---|---|
| Adds or changes an entry point | A new controller, route handler, endpoint or webhook file, or a changed one whose diff adds or removes a route, HTTP-verb attribute or handler signature |
| Touches background or deferred work | A job, scheduled task, hosted/worker service, queue consumer or event handler (a file whose name contains `Handler`, `Job`, `Worker` or `Consumer`, not an exception handler) |
| Touches an integration | Payment, accounting, messaging or email code, or added lines that call an HTTP client, an email or SMS sender, a third-party SDK, or add a third-party `<script src=` |
| Changes data shape or procedures | Schema source, migrations or stored procedures |
| Changes a service or a money path | A file named `*Service.*`, `*Factory.*`, `*Module.*` or `*Processor.*`, or a file in or below a payments, invoicing or billing folder. Charging, invoicing, refund and billing logic often lives here rather than in a gateway project, and a two-file change to it can double-charge |

Check the name-only list first, then grep the added lines for the attribute, signature and call patterns. Grep
application files only (outside tool config such as `.claude/`, `docs/`, `scripts/` and the test folders), so a script
tag in a tool file or a comment in a test does not select the lane. Diffs that match none of these skip it: copy and
label changes, CSS and view-only tweaks, fixes inside an existing method, docs, and test-only branches. The `arch`
scope keyword runs it on any diff regardless.

## Area documentation

When the project keeps a documentation map (a table of code paths to the doc that covers each, usually in its
rulebook; the project's review rules say where), that map is the authority on which doc covers a given code path. Do
not derive the doc path from the code path: a folder that happens to share the area's name is often unrelated to the
code that changed. Resolve the map row first, then apply the four-step procedure in the **Doc/Code Co-Change Norm**
section of `review/lanes/comment-analyzer.md` — which also governs severity, including the `suggestion:` cap when the
map has no row for the changed paths.

Two things the map lookup requires:

- **Read the map as the diff leaves it.** A PR that introduces an area doc normally adds its map row in the same
  change; resolving against the base-branch copy will miss it and produce a false positive.
- **Most specific row wins.** Broad rows and narrow ones (a named feature under the same area) can both match. Take
  the narrowest matching row, then check the broader one separately under step 2 — it is a finding only if the diff
  makes something that doc actually says untrue.

Confirm a doc's existence with the file tools, not a shell `ls` — see the **Path and existence checks** Shared Review
Rule for why a backslash path in a POSIX shell reports a present file as missing.

## Annotation files (`<filename>.md`)

Some projects pair a code file with a `<filename>.md` annotation file in the same directory (e.g. `InvoiceFactory.cs` /
`InvoiceFactory.cs.md`) carrying the "why" behind non-obvious code. Unlike the area-documentation check above, this
one must fire **whether or not** the `.md` file appears in the diff — the failure mode to catch is exactly the case
where the code changed and nobody touched the annotation.

For every changed code file, look for its exact sibling (`<path>.md`, same directory, same base filename). If one exists:
- Pass **both** file paths to whichever explorer runs `comment-analyzer`, regardless of whether the `.md` is in the
  diff — do not rely on the diff alone to surface it.
- If the `.md` is not in the diff at all, that means "read it and check," not "flag it." A code change that touches
  logic with no numbered annotation attached to it is the common case and requires no `.md` change at all — do not
  report a finding merely because the annotation file is absent from the diff. Only report when the read-and-check
  turns up one of the concrete problems in `comment-analyzer.md`'s Annotation File Accuracy section (a pointer whose
  annotation no longer matches, an orphaned entry, a dangling pointer, etc.). "No finding" is the expected, correct
  outcome for most PRs that touch an annotated file.

## Reviewing uncommitted work

A branch is sometimes reviewed before its first commit, where `git diff origin/<BASE>...<TARGET>` comes back empty.
That empty three-dot diff is what licenses diffing the working tree instead — and the working-tree diff must still be
taken against the merge-base (`git diff $(git merge-base origin/<BASE> HEAD)`), never plain `git diff origin/<BASE>`,
which is the two-dot shape the **Diff basis** Shared Review Rule rejects. Confirm the three-dot diff is empty first;
otherwise the branch does have commits and the ordinary rule applies. Some defects are only visible on one side of a
commit, such as a build value derived from file history that the commit itself resets.

## Examples

**Typical feature PR** touching controllers and models with no doc or test changes:

1. `code-reviewer` (always)
2. `silent-failure-hunter` (source files changed)
3. `type-design-analyzer` (new model files added)
4. `pr-test-analyzer` (logic changed, no test files in diff)
5. `code-simplifier` (code files in diff)
6. `architecture-reviewer` (if the controllers add or change an action; see [Architecture reviewer triggers](#architecture-reviewer-triggers))
7. `secondary-artifacts` (if the controllers add or change an action, or a routed view changed)
8. `ticket-coverage` (the run has a ticket brief)

**UI test PR** touching only the UI test folders, with no application code changes:

1. `code-reviewer` (always)
2. `ui-test-reviewer` (UI test files changed)
3. `code-simplifier` (code files in diff)

UI test files are excluded from the `silent-failure-hunter`, `architecture-reviewer` and `pr-test-analyzer` trigger
rules — those lanes target application logic, not test infrastructure. Unit and integration test folders are likewise
excluded from `silent-failure-hunter`, but they **do** trigger `pr-test-analyzer`, which owns test quality.

**Documentation-only PR** touching only `.md` files under `docs/`:

1. `code-reviewer` (always)
2. `comment-analyzer` (`.md` files changed)

## Detecting file patterns in CI

In a pipeline triggered by a pull request, retrieve the changed file list with
`git diff --name-only origin/<target branch>...HEAD` and match it against the tables above to decide which lanes the
later steps run. The architecture reviewer triggers also match added lines, so grep
`git diff origin/<target branch>...HEAD` for the route, signature and call patterns in that section.
