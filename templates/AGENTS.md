# AGENTS.md

<!-- Starting rulebook for a repo worked with Orc-istration (docs/adopt-a-repo.md). Replace every <...>, delete what does not apply, and keep it short: agents read all of it on every task. -->

<One paragraph: what this product is, its stack (language, framework, database), and where its main areas live.>

## Project settings

The Orc-istration workflows (`workflows/*.md` in the setup checkout) read these lines by their exact key names. A step that needs a missing setting stops and names it.

- Tracker helper: <command implementing ORC docs/tracker-contract.md, or "none">
- Base branch: <default: the repo's default branch>
- Branch naming: <e.g. feature/<id>-<slug>>
- PR title format: <e.g. #<id> - Short description in sentence case>
- Build: <command>
- Test, filtered: <command with a <filter> placeholder>
- Test, full: <one command per test project; run one at a time>
- Run the app: <command and URL, or "none">
- Review rules: <path, default REVIEW.md>

Optional lines (delete the ones you do not use):

- Work on a story is tracked on a child <Task>. (The start workflow then finds or creates that child and commits against it; without this line it works the ticket itself.)
- Orc orchestration: lite (the start and peer-review workflows run lighter; usually kept in a developer's own rulebook instead, `docs/adopt-a-repo.md`.)
- Orc review: lite (the review panel runs every agent on the Mid tier; same place.)

## Projects and commands

<One line per project or package: its name and what it holds. Name anything the build does not cover.>

- Restore: `<command>`
- Build: `<command>` (the same as the Build setting above)
- Run: `<command>` at `<URL>`
- Test one project at a time: `<command>`. <Name any project that must never run as part of a bulk test command, and why (for example a UI suite that waits on a running app).>
- Local database: `<read-only query command, or "none">`. Never point it at a shared or production database.

## Default behaviors (unless the user explicitly overrides)

- **Match the request.** Asking to explain, diagnose, review or plan authorizes reading and answering, not editing. "Change", "fix" or "implement" authorizes the work and its verification.
- **Refresh git state before editing and again before handing off.** Other sessions and agents may commit and run tests in parallel worktrees; never revert or "clean up" changes you did not make.
- **Stop a command that runs past five minutes** and report what it was doing rather than waiting on it. <Name any expected exception, such as a full UI suite.>
- **Leave changes unstaged, never commit, except in a builder/refuter loop.** Outside a loop the developer reviews, stages and commits. Inside one, the orchestrator commits each refuter-accepted task on its own feature branch and pushes; never on <base branch> or <release branch>. Builders never commit.
- **Verify the build before declaring done.** "This should work" without a passing build is not done.
- **Run affected tests.** After a logic change, run the relevant test project and fix failures before finishing.
- **Verify by running the app, not just by testing it.** Exercise the change through the interface a real caller uses, and state plainly what you did not verify.
- **Confirm before any destructive action** (deleting files, dropping tables, resetting branches, anything hard to reverse), even after a general "go ahead".
- **Record traps where they bite.** A non-obvious trap (a framework quirk, a schema rule, a test-data pitfall) goes in as one line in the matching doc from the map below, in the same PR, not in anyone's personal notes.

## Terminology

<Words the product uses and the ones it avoids, one line each: the name of the core record, user-facing labels that differ from database names, spelling choices.>

## Security and review essentials

<The compliance bar the code must meet, if any.> Apply extra scrutiny, and flag any uncertainty to the user before proceeding, in these areas:

- <Payment or billing code: no logging of card data, tokens or credentials; no error handling that could swallow a payment failure.>
- <Admin or cross-tenant areas: an action here can affect every customer.>
- <Authentication and authorization.>
- <Data-scrubbing or data-export scripts.>

<Tenant scoping, request-forgery protection, secrets handling: the rules the reviewers should enforce. Put the full review criteria in the Review rules file named above.>

## Database

<Where schema changes go, how migrations run, which changes need a hand-written script. Never run a migration against a non-local database.>

## Branching and PRs

<Branch model, where feature branches start and merge, how a hotfix reaches production (the start workflow follows this when the ticket is a production fix), PR title and description rules, draft or ready, reviewers.>

## Documentation map

Read the mapped doc before modifying its area. If the diff changes behavior a mapped doc describes, update that doc in the same PR.

| Area (code-path triggers) | Doc |
|---|---|
| <UI: views, styles, scripts> | <docs/ui-guidelines.md> |
| <Tests> | <docs/testing-guidelines.md> |
| <Coding conventions> | <docs/coding-guidelines.md> |
| <Pull requests> | <docs/pr-guidelines.md> |

## Environments

| Environment | URL | Deployed from |
|---|---|---|
| <name> | <url> | <branch or pipeline> |
