---
name: orc-permissions
description: Add the allow rules an orchestrated task needs to the user's Claude Code settings, so builders and refuters stop pausing on routine commands (the orc CLI, tests, scratch files, worktrees). Use when the user asks to cut permission prompts for orchestration, to "allow these" after an agent stalls on a prompt, or when setting up a new machine; not for hooks, models or other settings.
---

# Orc permissions

This skill exists only where `~/.claude/skills` holds a copy of it. Elsewhere, add the rules below to the tool's own allow-list by hand.

It edits `permissions` in the user settings file, `~/.claude/settings.json`, because agents work in worktrees outside any one project. Use a project's `.claude/settings.local.json` instead only when the user asks for one project.

## The rules

| Group | Rules | Why |
|---|---|---|
| Core | `Bash(node *tools/orc.mjs *)`, `Bash(npm test)`, `Bash(npm run check)`, `Bash(node --test *)` | The orc CLI and the repo's test runs |
| Scratch files | `Bash(mkdir *)`, `Bash(printf *)`, `Bash(cygpath *)`, `Bash(attrib *)` (Windows only) | Refuters build throwaway homes and fixtures |
| Worktrees | `Bash(git worktree *)`, plus the worktree parent folder in `permissions.additionalDirectories` | Parallel builders and refuters each get a worktree |
| Scoped delete | `Bash(rm -rf <worktree parent>/*)` | Cleaning a throwaway folder under the worktree parent |
| Blanket delete | `Bash(rm -rf *)` | Any `rm -rf`, in every project, with no prompt |

`cd`, `echo`, `ls`, `cat`, `head`, `find` without `-delete` or `-exec`, and read-only `git` commands need no rule.

## Steps

1. Read `~/.claude/settings.json`. If it is missing or is not valid JSON, stop and say so; never write over a file you could not parse.
2. Find the worktree parent: the folder that holds this machine's orchestration worktrees (`git worktree list` in the setup checkout shows it). Ask the user when it is not clear. Write it with forward slashes.
3. Ask which groups to add in one multiSelect `AskUserQuestion`. Offer Core, Scratch files, Worktrees and Scoped delete as the recommended set. Offer Blanket delete last, unselected, and state that it lets any session delete anything without asking. Add it only when the user picks it in this question or asked for it in their own words.
4. Merge. Append each chosen rule that is not already in `permissions.allow`; append the worktree parent to `permissions.additionalDirectories` the same way. Keep every existing key, rule and the order of the file. Never remove or loosen a `deny` or `ask` rule, and skip any rule that an existing `deny` rule covers.
5. Parse the file again to confirm it is valid JSON, then report the rules added, the rules already present, and the rules skipped.

## What rules cannot fix

A rule matches the command text as written. `rm -rf $H` does not match a path-scoped rule, because the text holds `$H`, not the path; only Blanket delete covers it. Say this in the report, and put it in agent briefs under "Do not": write full paths in commands, not shell variables. The guard hook, when installed, still blocks its hard git rules whatever is allowed here.

A running session reads the new rules on its next command; if it keeps asking, restart it.
