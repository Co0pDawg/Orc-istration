---
name: repo-standards
description: Set up or refresh a repo's coding standards (STANDARDS.md at the project root) from the cited archive and/or the user's own files. Use when the user asks to set up, refresh or import coding standards, and before the first orchestrated build in a repo without STANDARDS.md.
---

# Repo standards

Follow `orchestration/standards.md` in the setup checkout (normally `~/.claude/orchestration/standards.md`) step by step. Commands run as `node ~/.claude/tools/orc.mjs standards ...` with `--repo <project>`.

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

Keep each `header` to 12 characters or fewer. When `STANDARDS.md` already exists, the first question is instead keep it / re-apply / add stacks (single-select).

Then run `standards apply` as a dry run, show the section list, and run it again with `--apply`. Leave the file uncommitted and say so.
