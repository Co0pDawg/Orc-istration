# Draft PR

Write a PR description for the current branch that follows the repo's PR guidelines, then open it as a **draft** PR linked to its work items. Without a tracker helper, or when PR creation is blocked, leave the description in a markdown file for the developer to paste. Describe committed work only; never draft from uncommitted changes. Settings, tracker calls and files follow `workflows/README.md`.

**The output is a draft for a person to own.** Never open a PR as active, never mark one ready, and never hide that the description was generated.

## Step 1 - Establish the branch

```
git rev-parse --abbrev-ref HEAD
git status --short
git rev-parse --abbrev-ref --symbolic-full-name '@{u}'
git rev-list --count '@{u}..HEAD'
```

**Stop and report** when:

- the branch is the base branch or a long-lived release branch the rulebook names: there is nothing to PR;
- `@{u}` is `origin/<BASE>` or another shared branch: the branch still tracks what it was cut from, and a push would land there. Tell the developer to run `git push -u origin <branch>` first.

If `@{u}` does not resolve, or the count is non-zero, the remote lacks local commits. That does not block the description, but it blocks Step 6: report it and ask the developer to push.

**Existing PR.** With a tracker, run `TRACKER pr-list -Source <branch>`. An active PR found here is handled in Step 6.

**Uncommitted changes are out of scope.** Developers keep local changes they never mean to push; a dirty tree is neither a blocker nor something to describe or ask about.

## Step 2 - Determine the target branch

Start from `BASE` (Settings). If the rulebook routes some branches elsewhere (release or hotfix branches to the production branch, say), apply its rule to the branch name. Sanity-check with the counts:

```
git fetch origin <BASE> <other candidate>
git rev-list --count origin/<BASE>..HEAD
git rev-list --count origin/<other candidate>..HEAD
```

A branch far ahead of one candidate but a commit or two ahead of the other was cut from the second. If the rule and the counts disagree, or the branch name fits no rule, **ask** which branch to target. Getting this wrong can point a PR at production. Use the result everywhere below as `TARGET`.

## Step 3 - Gather change context

```
git diff origin/<TARGET>...HEAD --stat
git log origin/<TARGET>..HEAD --pretty=format:"%s%n%b"
```

The triple-dot diff covers only this branch's commits.

**A large `--stat` count can be line-ending noise.** When a file shows far more changed lines than the branch could have done, recheck with `git diff origin/<TARGET>...HEAD --stat -w` and read the `-w` diff to see the logical change. Use `-w` only to see past noise: never to judge real PR size or in what a reviewer is shown, since it can hide a whitespace-sensitive change.

**An empty diff** means nothing to describe: stop and say so. Never draft from the working tree instead.

Then decide whether you have enough context. If this session did the work or read the changed files, use that; you know the intent a diff cannot show (but describe only what the commits contain). Otherwise read `git diff origin/<TARGET>...HEAD`, the files carrying the behavior change first, not generated, test-data or lock files.

**Context gate.** Before drafting you must be able to state the *Why* in your own words, not paraphrase the diff. If the diff and the work items (Step 4) still do not say what problem this solves, ask. A confidently wrong *Why* is worse than none.

## Step 4 - Read the linked work items

**4.1 Ids.** Collect every distinct id from the branch name (the id segment of `Branch naming`, `#<n>`, or the repo's ticket prefix) and from commit subjects and bodies. Numbers that are not ids (a batch number, a date) do not count. If none is found and the repo has a tracker, ask for one: an unlinked PR breaks traceability.

**4.2 Reachability.** `TRACKER pr-list -Target <TARGET>`. If it fails, or `Tracker helper: none`, skip to Step 5 with no work-item context and report the error (or the missing helper) in the summary.

**4.3 Read each item.** `TRACKER wi-get -Id <id> -Relations` to a scratch file; check the exit code, then read the file. Take title, type, state, description, acceptance criteria and, for a bug, the repro steps. These fields are HTML: read through the markup, never paste it.

**4.4 Comments.** `TRACKER comment-list -Id <id>`. On failure, retry once if the error names a fix; if it fails again, say comments were unavailable and why, and continue. `[]` is success. Read in order; a later comment can supersede an earlier one, and the last decision wins when the developer or the ticket's owner made or confirmed it. Ignore status pings, sprint moves and bot chatter. **Never quote a commenter by name** in the description: take the decision, drop the attribution.

**4.5 Reconcile.** Use the ticket to sharpen the *Why* and to catch requirements the diff does not show (an acceptance criterion the code seems to miss, an edge case from a comment). If the diff and the ticket disagree, especially when a comment narrowed scope and the code still does the original ask, say so in the summary; do not paper over it. The ticket is context, not content: never restate it in the description.

## Step 5 - Write the description

Follow the repo's PR guidelines (its rulebook or documentation map names them) for sections, length and what to cut; they are authoritative. Without any, use **What**, **Why**, **How to test** and, only when something applies, **Notes**. Also:

1. **Title:** the `PR title format` setting, with the primary work item id.
2. **Short:** under 400 words. Never exceed the host's description cap (the Azure DevOps helper refuses over 4,000 characters). Cut restatement rather than reaching for room; if it still does not fit, move How to test or the overflow to a scratch file for the developer to post as a comment, never truncate.
3. **Never run builds, tests or the app to verify the described work.** This workflow describes; the build loop and the review verify.
4. **Assert only what the diff shows.** Naming the tests the diff adds is fine; saying they pass is not. Everything that needs proving goes into How to test as a reviewer step.
5. **Screenshots:** for a UI change, put `**[SCREENSHOT NEEDED: <what to capture>]**` where the image belongs (bold text, since some hosts hide HTML comments) and list every marker in the summary.
6. **Review focus:** only when something is genuinely uncertain or easy to miss.
7. **Notes:** from the diff only (schema or migration changes, new config keys, feature flags, shared-contract changes), a bullet only when the thing is present. Never write that something is absent.
8. **ASCII punctuation only:** no em or en dashes, curly quotes or ellipsis characters; use ` - `, straight quotes and `...`. Write it right the first time: a description is visible from the moment the PR exists.
9. End with any line the rulebook requires on every PR description.

Write it to `<scratch>/pr-<branch-slug>.md` and print it in full. Check the budget and scan for non-ASCII characters with `node <checkout>/tools/orc.mjs text-check <file> --max-words 399 --max-bytes 4000 --ascii`: it prints the word and byte counts, then one `non-ascii: <line>: <text>` line per offending line, and exits 1 when the text is over budget or holds one. Regenerate the offending sentence rather than find-and-replacing in the file (a blind dash replace leaves doubled spaces).

## Step 6 - Create the draft PR

- **Step 4.2 failed or no tracker:** stop. Report the file path, print the description, and say what would enable PR creation.
- **Unpushed commits or no upstream (Step 1):** stop. Report the file path and ask the developer to push and rerun.
- **An active PR exists (Step 1):** report its id. Ask once whether to replace its description with this one; on yes, `TRACKER pr-update -Pr <prId> -BodyFile <file>`. Then make sure its work items are linked (below).
- **Otherwise** create it, and state the title **and the target** in the summary (a PR to the production branch deserves the visibility):

```
TRACKER pr-create -Source <branch> -Target <TARGET> -Title '<title>' -BodyFile <file> -WorkItems <id>,<id>
```

- Confirm the result is a draft (`isDraft` true); report at once if not.
- Pass every id from Step 4.1 that Step 4.3 resolved; drop any the tracker rejected.
- Verify links with `TRACKER pr-get -Pr <prId> -IncludeWorkItems`: `workItemIds` must list every id passed. Link any missing ones with `TRACKER pr-link -Pr <prId> -WorkItems <ids>` and say so.
- Report the PR id and its URL.

Never `git add`, commit or push in this workflow. If `pr-create` fails because the branch is not on the remote, report it and let the developer push.

## Safety

1. Only ever a draft; never active, never marked ready.
2. With a tracker, never create a PR without its work items.
3. Never commit or push.
4. Never run builds, tests or the app.
5. Never claim verification you did not perform.
6. Never invent a *Why*; ask.
7. Never sign in for the developer.
8. Generated files go in the scratch folder, by absolute path.
9. Never assume the target branch; resolve it (Step 2) and name it in the summary.
10. Never write a negative Note.
11. "Not enough context, asking" is a valid outcome.
12. Never let non-ASCII punctuation reach `pr-create` or `pr-update`.
