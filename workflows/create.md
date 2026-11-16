# Create

Turn the current conversation (a plan, a bug investigation, a feature discussion) into a new work item: draft a title, an "As a / I want to / so that" description and bulleted acceptance criteria from what was actually discussed, confirm with the developer, create it, and optionally attach a supporting document. Settings, tracker calls and files follow `workflows/README.md`; it needs a tracker helper.

**This workflow never touches git, builds, tests or runs anything.** It reads the conversation and writes to the tracker (and the scratch folder).

**Arguments:** optional type, area and iteration (e.g. `type=Bug area=Payments`). Anything not given comes from what the repo's rulebook says about filing work items; failing that, the type is the tracker's story type (ask when the conversation is clearly a bug), the area is the project default, and there is **no iteration**, so the item lands on the backlog.

## Step 1 - Confirm tracker access

`TRACKER pr-list -Target <BASE>`. If it fails, stop and report the error verbatim. With `Tracker helper: none`, stop and say so.

## Step 2 - Draft from the conversation

Read back through the conversation, not the branch or diff.

- **Actor, action, outcome:** who the user is (a customer, an account owner, a staff member, an admin, the team itself), what they want to do, and why. This maps onto "As a `[user]`, I want to `[action]`, so that I can `[outcome]`."
- **A plan file** from this session is the primary source over a looser paraphrase of the chat; its context section usually states actor, action and outcome cleanly.
- **Title:** short, imperative, sentence case, no ticket-number prefix.
- **Description** (HTML): the "As a / I want to / so that" sentence as its own paragraph, plus one short paragraph of context if it sharpens the *why* (a limit being hit, a manual process being replaced). Do not restate the conversation.
- **Acceptance criteria** (HTML `<ul><li>` list): concrete, testable outcomes, one behavior per bullet, user-visible first.

If the intent is ambiguous, or the conversation spans more than one item, ask the developer to confirm scope and actor before drafting. Print the full draft before creating anything.

## Step 3 - Confirm before creating

Ask the developer to approve, showing the title, description and acceptance criteria, the type, the area, and the iteration (none, so the backlog, unless they named one). Never create without explicit approval: this is an outward-facing write.

## Step 4 - Create the work item

Write the description to `<scratch>/desc.html` and the criteria to `<scratch>/ac.html`, then:

```
TRACKER wi-create -Type '<type>' -Title '<title>' -BodyFile <scratch>/desc.html [-Set 'System.AreaPath=<area>']
TRACKER wi-update -Id <id> -FieldFromFile Microsoft.VSTS.Common.AcceptanceCriteria -BodyFile <scratch>/ac.html
```

`<id>` is the `id` from `wi-create`.

- Set no iteration unless the developer asked for one in this session (then say back that it is no longer a backlog item).
- **ASCII punctuation only** in both fields: no em or en dashes, curly quotes or ellipsis characters. Trackers render them inconsistently across their web UI, emails and exports.
- Verify with `TRACKER wi-get -Id <id>`: title, area and iteration as intended.
- Report the new id and its URL.

## Step 5 - Offer an attachment

Ask whether to attach a supporting document. Offer this session's plan file by name when there is one; otherwise ask which local file, or none. On approval: `TRACKER wi-attach -Id <id> -File <absolute path>`. On decline, skip it.

## Step 6 - Report

The new id and URL, the type, area and iteration used, and whether a document was attached (which one). If Step 1 failed, report only that.

## Safety

1. Never create a work item without the Step 3 approval.
2. Never set an iteration the developer did not ask for.
3. Never invent an area more specific than the default unless the developer or the rulebook names one.
4. Never invent the actor, action or outcome; ask.
5. Never attach a file without approval for that file.
6. Never write non-ASCII punctuation to a work item field.
7. Generated files go in the scratch folder, by absolute path.
8. Never sign in for the developer.
9. Never touch git, build, test or run the app.
