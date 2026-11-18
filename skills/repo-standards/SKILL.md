---
name: repo-standards
description: Set up or refresh a repo's coding standards (STANDARDS.md at the project root) from the cited archive and/or the user's own files. Use when the user asks to set up, refresh or import coding standards, and before the first orchestrated build in a repo without STANDARDS.md.
---

# Repo standards

This skill exists only where `~/.claude` is the setup checkout, because Claude Code loads skills from `~/.claude/skills`. Elsewhere, follow the procedure directly.

Follow `<setup>/orchestration/standards.md` step by step. Resolve `<setup>` as that file says: the `ORC_HOME` environment variable, the "Setup checkout (this machine)" line in the rulebook's tool notes, `~/.claude` when it has `tools/orc.mjs`, else ask the user. Commands run as `node <setup>/tools/orc.mjs standards ...` with `--repo <project>`; do not hard-code `~/.claude`.

Step 2 is one `AskUserQuestion` call. Build question 1 from the `detect --json` result: the detected ids, most matches first, 2 to 4 options per question. With fewer than 2 detected, fill up to 2 with undetected archive ids (not marked Recommended). With more than 4, split them across two multi-select questions of at least 2 each (5 as 3+2, 6 as 3+3); past 8, name the rest in a description and leave them to Other. The free-text "Other" is added automatically, so do not add it as an option.

```json
{
  "questions": [
    {
      "question": "Which stacks should STANDARDS.md cover?",
      "header": "Stacks",
      "multiSelect": true,
      "options": [
        { "label": "csharp (Recommended)", "description": "Detected: 4 matches, e.g. src/App/App.csproj" },
        { "label": "sql (Recommended)", "description": "Detected: 2 matches, e.g. db/schema.sql" }
      ]
    },
    {
      "question": "Do you have your own standards to import?",
      "header": "Import",
      "multiSelect": false,
      "options": [
        { "label": "No, the archive is enough", "description": "Use only the archive sections picked above" },
        { "label": "Yes, a local file or folder", "description": "Give the path in the notes or in Other" },
        { "label": "Yes, a URL", "description": "I fetch it and import it as Markdown" }
      ]
    }
  ]
}
```

Keep each `header` to 12 characters or fewer.

When `STANDARDS.md` already exists (`detect --json` gives `standardsFile: true`), the one ask holds three questions:

- Q1 (single-select): keep / re-apply as is / add stacks when `current` is not `null`. For a hand-written file (`current` is `null`), it is keep / replace it with the archive (`--force`, with a backup); "Add stacks" needs a marker.
- Q2 (multi-select): the stacks to add or use, from the detected ids not in `current.stacks`. With fewer than 2 left, fill up to 2 with undetected archive ids that are not in `current.stacks`.
- Q3: the import question above.

With a marker, the first two look like this:

```json
{
  "questions": [
    {
      "question": "STANDARDS.md exists (csharp, sql). What should happen to it?",
      "header": "Existing",
      "multiSelect": false,
      "options": [
        { "label": "Keep it", "description": "Change nothing" },
        { "label": "Re-apply as is", "description": "Rebuild the same stacks and imports from the archive" },
        { "label": "Add stacks", "description": "Keep csharp and sql, and add the stacks picked next" }
      ]
    },
    {
      "question": "Which stacks should be added (only with Add stacks)?",
      "header": "Add stacks",
      "multiSelect": true,
      "options": [
        { "label": "typescript (Recommended)", "description": "Detected: 12 matches, e.g. web/app.ts" },
        { "label": "playwright", "description": "Not detected" }
      ]
    }
  ]
}
```

"Add stacks" applies `current.stacks` plus the new ones. The marker keeps import names only, so ask for the paths of `current.imports` and pass each with `--from` again.

Then run `standards apply` as a dry run, show the section list, and run it again with `--apply`. Leave the file uncommitted and say so.
