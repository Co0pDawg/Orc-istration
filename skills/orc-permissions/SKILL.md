---
name: orc-permissions
description: Add the allow rules an orchestrated task needs to the user's Claude Code settings, so builders and refuters stop pausing on routine commands (the orc CLI, tests, scratch files, worktrees). Use when the user asks to cut permission prompts for orchestration, to "allow these" after an agent stalls on a prompt, or when setting up a new machine; not for hooks, models or other settings.
---

# Orc permissions

This skill exists only where `~/.claude/skills` holds a copy of it. Elsewhere, add the rules below to the tool's own allow-list by hand.

It edits `permissions` in the user settings file, `~/.claude/settings.json`, because agents work in worktrees outside any one project. Use a project's `.claude/settings.local.json` instead only when the user asks for one project.

## What a rule can and cannot do

A rule matches the text of a command, and `*` matches any text, spaces and `..` included. Three things follow:

- **A path in a rule is not a scope.** `Bash(rm -rf C:/wt/*)` also matches `rm -rf C:/wt/x D:/photos` and `rm -rf C:/wt/../data`. So this skill has no "delete only under the worktree folder" rule: none can be written.
- **A wildcard before the program's argument approves anything.** `Bash(node *tools/orc.mjs *)` matches `node -e "<any code>" tools/orc.mjs x`. Rules here start with the full command and keep `*` at the end.
- **The text must match as typed.** `rm -rf $H` holds `$H`, not a path; `node "C:/x/tools/orc.mjs"` does not match a rule written without the quotes; `/c/x` and `~/x` may not match a rule written `C:/x`.

## The rules

`<setup>` is the setup checkout, written the way the rulebook's "Setup checkout" line writes it, with forward slashes.

| Group | Rules | Why |
|---|---|---|
| Core | `Bash(node tools/orc.mjs *)`, `Bash(node <setup>/tools/orc.mjs *)`, `Bash(node "<setup>/tools/orc.mjs" *)`, `Bash(npm test *)`, `Bash(npm run check)`, `Bash(node --test *)` | The orc CLI, from the checkout and by full path with and without quotes, and the repo's test runs |
| Scratch files | `Bash(mkdir *)`, `Bash(printf *)`, `Bash(cygpath *)`, `Bash(attrib *)` (Windows only) | Refuters build throwaway homes and fixtures |
| Worktrees | `Bash(git worktree add *)`, `Bash(git worktree list *)`, plus each worktree folder in `permissions.additionalDirectories` | Parallel builders and refuters each get a worktree |
| Worktree removal (risky) | `Bash(git worktree remove *)` | A refuter removes its mutation worktree when it finishes. The rule also approves `remove --force` on any worktree, which discards uncommitted work there |
| Blanket delete (risky) | `Bash(rm -rf *)` | Any `rm -rf`, in every project, with no prompt |

Without the two risky rules, `git worktree remove` and every `rm -rf` still prompt. `git worktree prune` always prompts.

Read-only commands inside the session's working directories (`ls`, `cat`, `head`, read-only `git`) need no rule. A `cd` outside those directories and the target of a redirect (`> file`) are checked separately, whatever is allowed here.

## Steps

1. Read `~/.claude/settings.json`.
   - Not valid JSON: stop and say so. Never write over a file you could not parse.
   - Missing: tell the user, and on their yes start from `{ "permissions": { "allow": [] } }`.
   - `permissions`, `allow` or `additionalDirectories` missing: create it when step 4 needs it.
2. Find the worktree folders: run `git worktree list` in the setup checkout and take the parent of each worktree other than the checkout itself. A folder qualifies only when it holds nothing but worktrees and scratch folders. Never use the home folder, a drive root, the setup checkout or the folder above it; when worktrees sit beside the checkout, add none and say so. Show the user the folders you found, since step 3 asks about them; when there is more than one, list each. Write them with forward slashes.
3. Ask in one `AskUserQuestion` call with three questions. The question tool takes at most four options per question, so the risky rules get questions of their own:
   1. multiSelect, "Which rule groups?": Core, Scratch files, Worktrees (name the folders from step 2 in its description).
   2. single-select, "Allow `git worktree remove` without asking?": "Do not add (Recommended)" first, then "Add it", described as: any agent may force-remove any worktree, losing uncommitted work in it.
   3. single-select, "Allow every `rm -rf` without asking?": "Do not add (Recommended)" first, then "Add it", described as: any session, in any project, may delete anything without asking.

   Add a risky rule only when the user picks "Add it" in this call. A request made earlier in the conversation does not skip the question; the question is the warning.
4. Copy the settings file to `settings.json.orc-backup-<timestamp>` beside it (the name `orc.mjs hooks --apply` uses). Then merge:
   - Append each chosen rule that is not already in `permissions.allow`, and each folder that is not in `permissions.additionalDirectories`.
   - Keep every existing key, rule and the order of the file.
   - Never remove or loosen a `deny` or `ask` rule. Skip any rule that an existing `deny` or `ask` rule covers: both win over `allow`, so the rule would do nothing.
5. Parse the file again. If it is not valid JSON, copy the backup back and say the edit was undone. Otherwise report the rules added, the rules already present, the rules skipped with the `deny` or `ask` rule that covers each, and the backup's path.

## After the edit

Put this in agent briefs under "Do not": write full literal paths in commands, not shell variables, and one path per `rm -rf`; a command such as `rm -rf $H` or `node $R/tools/orc.mjs` matches none of the path rules above. The guard hook, when installed, still blocks its hard git rules whatever is allowed here.

A running session reads the new rules on its next command; if it keeps asking, restart it.
