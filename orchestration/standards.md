# Repo standards setup

This procedure sets up a project's coding standards: `STANDARDS.md` at the project's root. Builders follow it, and refuters check diffs against its Review checklists. Each section comes from the cited archive in this setup checkout (`standards/`, format in `standards/README.md`), or from the user's own files.

`<repo>` below is the project, and `<setup>` is the setup checkout, found in this order:

1. The `ORC_HOME` environment variable, when set.
2. The "Setup checkout (this machine)" line in your rulebook's tool notes (`install` writes it).
3. For Claude Code, `~/.claude` when it is the checkout (it has `tools/orc.mjs`).
4. If none applies, ask the user for the path.

## When to run it

- Before the first orchestrated build in a repo that has no `STANDARDS.md`.
- When the user asks for it.
- Once per project after installing the setup: `install` ends by printing a pointer to this procedure.

## Step 1: detect

```
node "<setup>/tools/orc.mjs" standards detect --repo <repo> --json
```

The result lists each detected archive id with its match count and example paths. An id pulled in only through another entry's `requires` carries `requiredBy`. `standardsFile` says whether `STANDARDS.md` exists, and `current` holds the `stacks` and `imports` its orc marker records (`null` with no valid marker). `archive` lists every id available. `truncated` or a non-zero `unreadable` means the scan is partial; it also warns on stderr.

## Step 2: ask the user (one ask)

Ask a single several-picks question. In Claude Code, that is one `AskUserQuestion` with `multiSelect: true`. Other tools use their own question tool, or a plain numbered question. Each question needs 2 to 4 options, plus a free-text "Other".

If `STANDARDS.md` already exists (`standardsFile` is true), the same single ask holds three questions instead:

- **Question 1** (single-select):
  - With an orc marker (`current` is not `null`): "Keep it", "Re-apply as is" or "Add stacks".
  - Hand-written (`current` is `null`): "Keep it" or "Replace it with the archive". Replacing needs `--force`, which backs the old file up first. "Add stacks" needs a non-null `current`, so it is not offered.
- **Question 2** (multi-select): the stacks to add (with "Add stacks"), or the stacks to use (with "Replace it"). Build it like the stacks question below from the detected ids not in `current.stacks`; when fewer than 2 remain, fill up to 2 options with undetected archive ids that are not in `current.stacks` either.
- **Question 3**: the import question below.

"Add stacks" applies `current.stacks` plus the new ones, so nothing is dropped. The marker keeps only import names, so every import in `current.imports` must be passed again with `--from`: ask for their paths. Re-applying over edits needs `--force`, which backs the old file up first.

- **Question 1: "Which stacks should STANDARDS.md cover?"** (multi-select)
  - List the detected archive ids, most matches first, and mark the detected ones as recommended.
  - When fewer than 2 are detected, fill up to 2 options with undetected archive ids, not marked recommended.
  - When more than 4 are detected, split them across two questions in the same ask, at least 2 options each (5 as 3+2, 6 as 3+3). Past 8, name the rest in an option's description and leave them to "Other".
  - The free-text "Other" lets the user name a stack that was not detected or is not in the archive.
- **Question 2: "Do you have your own standards to import?"** (single-select)
  - "No, the archive is enough".
  - "Yes, a local file or folder" (the path goes in the notes or in Other).
  - "Yes, a URL".

## Step 3: stacks not in the archive

1. Dispatch a researcher (Mid tier) for each such stack to write the entry in the archive format (`standards/README.md`) to its scratch path, named `<id>.md` so the id matches the file name. The researcher writes its scratch file through a shell redirect.
2. Validate it: make a temp copy of the setup checkout, put the entry in the copy's `standards/`, and run `node "<setup>/tools/orc.mjs" check --repo <temp copy>`. Fix any problem it reports for the entry.
3. Import it with `--from <scratch>/<id>.md`: an archive-format file (frontmatter with `id` and a non-empty `sources` list) is validated again and rendered like a stack, with its Sources and Reviewed lines. Or, if the user agrees, add it to the setup checkout's archive (as a pull request). The archive is public: never add company-specific or imported content to it.

## Step 4: imports

- For a local file or folder, pass it as `--from <path>`. A folder contributes its `.md` files, not recursively, sorted by name, leaving out the apply target itself.
- For a URL, fetch it with the tool's web fetch, save it as Markdown in the scratch folder, and pass that file as `--from`.
- If a private or internal URL cannot be fetched, ask the user to export it to a file.
- Imported content goes only into the project's `STANDARDS.md`, never into the setup repo.

## Step 5: apply

```
node "<setup>/tools/orc.mjs" standards apply --repo <repo> --stack <id>,<id> [--from <path>]...
```

- That first run is a dry run. It prints the target, its state (`create`, `replace`, `unchanged`, `REPLACE DROPS`, `REPLACE EDITED` or `REPLACE HAND-WRITTEN`) and the section list. `--stack` entries add their `requires`, and say so.
- Show the user the section list, then run the same command again with `--apply`.
- `REPLACE DROPS` (the new set leaves out a stack or import the marker records; the line names them), `REPLACE EDITED` (the team edited the file) and `REPLACE HAND-WRITTEN` (no orc marker): the dry run exits 0 and adds an `--apply would refuse` line, and `--apply` refuses with exit 1. Pass `--force` only when the user agrees; it backs the file up to `<file>.orc-backup-<stamp>`.
- `--out <rel>` writes somewhere other than `STANDARDS.md`. The path must stay inside the repo.
- Leave the file uncommitted, and say so. It is a project change, committed with the task's branch under the normal rules.
- A `--force` run leaves its backup `STANDARDS.md.orc-backup-<stamp>` in the project root. Do not commit it; delete it once the user is happy with the new file.

## Step 6: use it

From then on:

- Builder briefs list `STANDARDS.md` under Known. Builders follow the sections for the stacks they touch and say in their report which they applied.
- Refuter briefs name its Review checklists. Refuters check the diff against the checklist of every section whose stack the diff touches, and list each failed item as a finding with its section.
