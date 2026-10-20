# Project memory: setup and upkeep outline

Memory is a folder of small markdown notes that Claude Code loads at session start, so a new session does not rebuild context. This outline describes the structure of an existing project's memory (structure only) for a new project to follow.

## Where it lives

`~/.claude/projects/<project-folder>/memory/`, where `<project-folder>` is the project's absolute path with separators and the drive colon replaced by dashes (`C:\Dev\App` becomes `c--Dev-App`). One folder per working directory. It is outside git and not tracked in this repo. The rest of `projects/<project-folder>/` is session transcripts (uuid-named); ignore them.

## Layout

- `MEMORY.md`: the index, loaded into every session. About 110 lines in the example project; keep it short.
- One `<type>_<slug>.md` file per memory, such as `feedback_<topic>.md` or `project_<topic>.md`.
- `archive/`: retired notes and dated `MEMORY.md.bak-<date>` copies taken before a big prune.

## Index rules

- One line per memory, under about 150 characters: `- [Title](file.md) — one-line hook`.
- No content in the index, only a pointer and the reason to open the file. Long lines get truncated on load, so put the key fact first.
- No frontmatter in `MEMORY.md`.
- Add the line when you create a file; remove it when you delete one.

## Note format

Frontmatter, then a body. Fields seen in the example: `name`, `description` (one line; used to judge relevance), `type`, and a session-origin id that is added automatically. Neutral example:

```
---
name: Prefer short answers
description: User wants terse replies unless asked for detail
type: feedback
---
Keep replies short.

**Why:** the user said long answers slow review.

**How to apply:** lead with the result; add detail only on request.
```

Feedback and project notes carry the rule or fact, then **Why** and **How to apply**. Cross-link related notes with `[[file_name]]` (file name without `.md`) in the body.

## The four types

| Type | Holds | Example topic |
|---|---|---|
| `user` | Who the user is, role, preferences, where their personal files are | working style, doc locations |
| `feedback` | Corrections and confirmed ways of working, with the reason | reply length, time format |
| `project` | State of ongoing work not derivable from code or git: decisions, open follow-ups, where a draft lives | a feature's current status |
| `reference` | Pointers to external systems and how to query them | dashboard location, API recipe |

## Save or not

Save: an explicit "remember this"; a correction given twice; a non-obvious decision and its reason; where something lives outside the repo.

Do not save: anything readable from code or `git log` (file maps, who changed what); one-off task details; secrets or credentials; a gotcha every contributor needs. Codebase gotchas belong in the repo docs (rules files or the area doc), added in the PR that finds them, so teammates and CI agents get them. Memory is personal and per machine.

## Update, do not duplicate

Before creating a note, scan the index and grep the folder for the topic. Edit the existing file and its index line. If two notes cover one topic, merge them and delete one. Write absolute dates, not "next week". If a note names a file, flag or function, verify it still exists before relying on it; a memory is a claim about the past.

## Pruning

- When the index nears its length limit, or on a schedule: copy `MEMORY.md` to `archive/MEMORY.md.bak-<date>`, move notes whose work shipped or was abandoned into `archive/`, and drop their lines.
- Delete notes that turned out wrong. Collapse several finished-work notes into one.
- When a gotcha note is promoted to repo docs, delete the memory.

## Division of labour

| Place | Holds | Audience |
|---|---|---|
| `CLAUDE.md` (global and project) | Rules and commands every session must follow | everyone, every session |
| Repo docs and rule files | How the code and areas work; gotchas | the team and agents; versioned in the PR |
| Memory | Personal preferences, in-flight project state, pointers | one user on one machine |

Test: if a teammate needs it, it goes in the repo; if it is a rule for every session, `CLAUDE.md`; if it is about this user or in-flight state, memory.

## New project setup

1. Work in the project once; the folder is created on first save.
2. Ask Claude to remember the first real preference or decision; it creates `MEMORY.md` and the note.
3. Check the index line and the note's frontmatter.
4. Do the first prune when the index passes about 100 lines.
