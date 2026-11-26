# Tracker contract

The workflows in `workflows/` reach a work tracker, a code host and a CI system only through one command, the repo's **tracker helper**, named on the `Tracker helper:` line of the target repo's Project settings (`templates/AGENTS.md`). This page is what that command must do. `tools/tracker/ado.ps1` implements it for Azure DevOps; `docs/adopt-a-repo.md` says what to do for any other tracker.

## Calling convention

- One verb per call: `<helper> <verb> -Param value ...`. Long text (descriptions, comments) always goes in a file passed as `-BodyFile`, UTF-8, never inline.
- Success: exit 0 and JSON on stdout. Failure: exit 1 and one named error line on stderr (what failed and, when known, the fix, such as "run `az login`"). Never exit 0 on a failed call, and never print a credential.
- An unknown verb exits 2 with usage.
- `-WhatIf` (optional) prints each request instead of sending it, without the auth header; the reference implementation's tests use it.
- No defaults for where to talk to: the organization, project and repository come from parameters or environment variables, and a missing one fails before any call.
- Ids are integers. A work item's fields are under `.fields`, keyed by field reference names. The workflows read these by name, so a helper for another tracker maps its own fields onto them:
  - `System.WorkItemType`, `System.State`, `System.Title`, `System.Description`
  - `Microsoft.VSTS.Common.AcceptanceCriteria`, `Microsoft.VSTS.Common.Priority`, and `Microsoft.VSTS.TCM.ReproSteps` (a bug's detail) when the tracker has them.

## Work items

| Verb | Inputs | Output | Used by |
|---|---|---|---|
| `wi-get` | `-Id`, `[-Relations]` | the item: `id`, `fields`, and with `-Relations` a `relations[]` of `{rel, url, attributes.name}` (parent `System.LinkTypes.Hierarchy-Reverse`, children `-Forward`, `System.LinkTypes.Related`, attachments `AttachedFile`, PR and branch links `ArtifactLink`) | start, draft-pr, create |
| `wi-batch` | `-Ids 1,2`, `[-Fields a,b]` | `[{id, fields}]`; an unreadable id is left out with a warning on stderr | (optional; no workflow here calls it) |
| `wi-update` | `-Id`, `[-Set 'Field=value',...]`, `[-BodyFile]` (description, or a bug's repro steps), `[-FieldFromFile <field> -BodyFile]` | the updated item | start, create |
| `wi-create` | `-Type`, `-Title`, `[-BodyFile]`, `[-Set ...]`, `[-Parent <id>]` | the new item (`id`) | start, create |
| `wi-attach` | `-Id`, `-File` | the updated item | start, create |
| `wi-link-branch` | `-Id`, `-Branch` | the updated item (a branch link in its relations) | start |
| `download` | `-Url` (an attachment URL from `wi-get`), `-OutFile` | `{outFile}`; refuses a URL outside the tracker's own host | start |
| `wiql` / `query` | `-Query <text>` or `-QueryFile`, `[-Top]`; or `-Name <saved query>` | `[{id, type, state, title, assignedTo, iteration}]` in the query's order | (optional; the worklog uses `wiql`) |

## Comments on a work item

| Verb | Inputs | Output | Used by |
|---|---|---|---|
| `comment-list` | `-Id` | every comment, oldest first; `[]` when there are none | start, draft-pr |
| `comment-add` | `-Id`, `-BodyFile` | the comment, with its `id` | start |
| `comment-edit` | `-Id`, `-CommentId`, `-BodyFile` | the comment | start |

## Pull requests

| Verb | Inputs | Output | Used by |
|---|---|---|---|
| `pr-list` | `[-Source <branch>]`, `[-Target <branch>]`, `[-Status active\|all]` | `[{pullRequestId, status, title, isDraft, ...}]`; also the cheap reachability probe the workflows run first | start, draft-pr, create |
| `pr-get` | `-Pr`, `[-IncludeWorkItems]` | the PR (`pullRequestId`, `status`, `title`, `description`, `isDraft`, `sourceRefName`, `targetRefName`) plus `workItemIds: int[]` with the switch | start, draft-pr, peer-review |
| `pr-create` | `-Source`, `-Target`, `-Title`, `-BodyFile`, `[-WorkItems 1,2]` | the PR; **always a draft**; refuses a description over the host's size cap before sending | draft-pr |
| `pr-update` | `-Pr`, `[-Title]`, `[-BodyFile]` | the PR | draft-pr |
| `pr-link` | `-Pr`, `-WorkItems 1,2` | one entry per linked item | draft-pr |
| `pr-comments` | `-Pr` | `[{threadId, status, published, filePath, line, comments: [{id, author, published, content}]}]`, people's comments only, oldest first | peer-review |
| `pr-comment-add` | `-Pr`, `-BodyFile`, `[-Resolved]` | the new top-level thread (never a reply inside someone else's thread) | peer-review |
| `pr-attach` | `-Pr`, `-File` | `{url}` of the uploaded image, for a description or comment to embed | (optional; no workflow here calls it) |

## CI

| Verb | Inputs | Output | Used by |
|---|---|---|---|
| `build-find` | `-Pipeline <name>`, `-Run <run number>` | `[build]` | fix-ci |
| `build-get` | `-Build <id>` | the build: `id`, `buildNumber`, `status`, `result`, `sourceBranch`, `sourceVersion`, and the pipeline file path when the host has one | fix-ci |
| `build-list` | `-Branch <branch, ref or PR id>`, `[-Pipeline]`, `[-Top 5]` | `[{id, buildNumber, pipeline, status, result, sourceBranch, sourceVersion, queueTime, finishTime}]`, newest first | fix-ci |
| `build-timeline` | `-Build`, `[-Failed]` | `[{id, parentId, type, name, result, logId, issues}]`; `-Failed` keeps failed steps only | fix-ci |
| `build-log` | `-Build`, `-Log <logId>`, `-OutFile` | `{outFile}` | fix-ci |
| `build-queue` | `-Pipeline <name>`, `-Branch` | `{id, buildNumber, status, url}` | fix-ci |
| `test-results` | `-Build`, `[-Name <run name pattern>]`, `[-Failed]` | `[{runId, runName, results: [{id, name, outcome, errorMessage, attachments}]}]` | fix-ci |

## The Azure DevOps implementation

`tools/tracker/ado.ps1` (PowerShell 7) implements every verb above. Organization, project and repository come from `-Organization`/`-Project`/`-Repository`, else `ORC_ADO_ORG`/`ORC_ADO_PROJECT`/`ORC_ADO_REPO`; there are no defaults. It signs in with `az login` (it asks `az` for a token) or `AZURE_DEVOPS_EXT_PAT`. Its self-check needs no network or login: `pwsh -NoProfile -File tools/tracker/ado.Tests.ps1`.

A target repo's Project settings line for it: `Tracker helper: pwsh -NoProfile -File <checkout>/tools/tracker/ado.ps1`, with the three `ORC_ADO_*` variables set in the environment.

The worklog (`extras/worklog/`) looks up an ADO helper through `WORKLOG_ADO`, else `ORC_ADO_SCRIPT`; point either at this script. The worklog also dot-sources it for `Invoke-Ado`, `$orgUrl`, `$api` and `$Repository`, so those names are part of this script's interface.
