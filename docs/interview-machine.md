# Interview machine: install the sprint kit

Written for Claude Code to follow, step by step, on a machine you do not own: for example an interviewer's laptop with an editor (such as Visual Studio) and the Claude app. The goal is a verified sprint kit in under 5 minutes, before the clock of a timed build starts. The starter prompt is in [`example-prompts.md`](example-prompts.md#starter-prompt-interview-machine).

The sprint kit is the roster agents, the generated rulebook, the `sprint` skill (so `/sprint` works), the git guard hook and a permission preset for the project's stack (its build, test, run and package-restore commands; read-only git already runs without a prompt). Those preset rules run the project's own code and accept any flags, so they are for an exercise you trust, not a safety boundary. It leaves out the board, the cost log, the worklog and peon hooks, plugins, the status line, and model and effort settings. Nothing personal goes on the machine. Everything it writes is under `<home>/.claude`, it backs up what it replaces, and `uninstall` puts it back.

## Ground rules on a borrowed machine

- The user should have the interviewer's agreement to install tooling on the machine. If you are not sure they have it, ask once before step 3.
- Write only under the user profile. Do not change system settings, global git config or anything outside `<home>`.
- The sprint commits locally only. Do not push, open a pull request or sign in to anything unless the user says so.
- Questions about AI use are answered truthfully, by the user and by you.
- Your shell may not keep a `cd` from one command to the next, so every command below names its paths in full.

## 1. Prerequisites (under 1 minute)

Run each and note the result:

```
git --version
node --version
claude --version
```

- **Node 22 or later** is needed for the install. If `node` is missing or older, take the no-Node path below; do not install Node without the user's yes.
- **git** is needed to clone. Without it, see step 2.
- **Claude Code** is what you are running in; `claude --version` failing in the shell is fine.

Find the user's home folder, which every command below calls `<home>`:

```
node -p "require('os').homedir()"
```

## 2. Clone outside `~/.claude` (under 1 minute)

Never clone into `<home>/.claude`; that folder belongs to Claude Code. Clone next to it:

```
git clone https://github.com/Co0pDawg/Orc-istration.git "<home>/Orc-istration"
```

The folder it makes, `<home>/Orc-istration`, is `<clone>` below. The repository is public, so no sign-in is needed. Without git, download https://github.com/Co0pDawg/Orc-istration/archive/refs/heads/main.zip and extract it into `<home>`: it makes the folder `<home>/Orc-istration-main`, which is then `<clone>`.

## 3. Dry run (seconds)

Run the install from the exercise folder: without `--stack` it detects the stack there (`dotnet` for a `.sln`, `.slnx` or `.csproj`, `node` for `package.json`, `python` for `pyproject.toml` or `requirements.txt`). If the exercise folder does not exist yet or holds no project, pass the stack instead (`--stack dotnet`, `--stack node` or `--stack python`), or leave it out and re-run step 4 with it later: a second run only adds what is missing.

```
node "<clone>/tools/orc.mjs" install --tool claude-code --sprint-kit --home "<home>"
```

It writes nothing. Read the output:

- `sprint kit: stack ...` names the stack it found; `no stack detected` means no preset (pass `--stack`).
- `would create` / `would replace ...` for each file; `would replace (hand-written; backed up, uninstall restores it)` marks a file of the owner's, such as an existing `CLAUDE.md`.
- `would unchanged: ... (already there and not installed by orc ...)` marks an identical copy the owner already has (such as a hand-copied `SKILL.md`); it stays theirs, and uninstall leaves it.
- `would keep (hand-copied hook script, differs; --force replaces it, with a backup)` means the owner has an older `guard.mjs`. It is kept, so `status` will say `differs` for it; run the install with `--force` added to replace it (a backup is kept and uninstall restores it).
- `would add to settings.json ...` for the guard hook and each preset entry; existing entries are kept, and a working guard the owner already has is not added twice.
- `WARN ... which is not on disk, so it guards nothing` names an old guard hook whose script is gone; the kit adds its own guard and leaves that entry alone. Mention it to the user.
- `refused: ... settings.json is not valid JSON` means the owner's `settings.json` is broken. Stop and tell the user; do not edit it.
- `refused: ... records a full orc install, not a sprint kit` means this machine already has Orc-istration installed. Stop and tell the user: the roster is already there, and the message says how to add `/sprint`.
- `--apply would refuse` means a file installed earlier by orc was edited by hand. Stop and tell the user.

## 4. Apply (seconds)

The same command with `--apply`, from the same folder (and with the same `--stack`, if you passed one):

```
node "<clone>/tools/orc.mjs" install --tool claude-code --sprint-kit --home "<home>" --apply
```

Each replaced file is first copied to `<file>.orc-backup-<time>`, and `settings.json` is backed up once, before its first change. The manifest `<home>/.claude/.orc-manifest.claude-code.json` records every file and every `settings.json` entry the kit added.

## 5. Verify (1 minute)

```
node "<clone>/tools/orc.mjs" status --tool claude-code --home "<home>"
```

On a clean machine it ends with `status claude-code: all same` and exits 0, including the line `same: ... settings.json (sprint kit entries present)`. An `extra: ... (not installed by orc)` line is an agent of the owner's own in `<home>/.claude/agents`: that is fine, and it makes the last line read `out of date` and the exit code 1. A `differs` line for `tools/guard.mjs` after a `kept (hand-copied hook script, differs ...)` line in step 4 is the owner's older copy: fine, or run step 4 with `--force` to replace it with a backup. Otherwise a `missing`, `differs`, `edited since install`, `stale` or `missing in settings.json` line means the install is not right; run step 4 again, and tell the user if it persists.

Then check that Claude Code sees the kit. A session that started before the install may not list the new agents and skill, so ask the user to open a fresh Claude Code session in the exercise folder. In it, confirm that:

- `/sprint` appears in the slash-command list;
- `/agents` lists the roster: `builder`, `refuter`, `scout`, `researcher`, `debugger` and the `review-*` agents.

Tell the user in one line that the sprint kit is installed and verified.

## 6. Start the sprint

In the exercise folder, start the sprint with the minutes and the task, for example `/sprint 45` followed by the interviewer's task, or "start a 45-minute sprint: <task>". The skill reads `orchestration/sprint.md` from the clone (the rulebook's "Setup checkout (this machine)" line points at it) and runs the timebox. There is no board on this machine; the rulebook says so, and sprint mode waives it anyway.

## 7. Clean up afterwards

When the user is done, remove the kit, then the clone:

```
node "<clone>/tools/orc.mjs" uninstall --tool claude-code --home "<home>" --apply
```

- It deletes the files the kit installed, removes the kit's `settings.json` entries (the owner's own entries, and any added since, stay), and moves each backed-up file back into place, such as the owner's `CLAUDE.md`. When `settings.json` has not changed since the install, its backup is moved back byte for byte, so no backup is left behind.
- When the owner's `settings.json` changed during the sprint, only the kit's entries are removed and its backup stays: show it to the user, who can delete it once satisfied.
- A kit file edited during the sprint is kept and its original is not restored over it; the output names both. `uninstall --apply --force` deletes the edited copy after a backup and then restores the original.
- A `WARN` line means something could not be undone as planned (a backup gone, a file in the way); show it to the user.
- The output ends with a `left: <path> (<why>)` line for every `.orc-backup-` file it leaves. Delete only the ones it calls a copy of a kit file (`safe to delete`), with the user's yes. Show every other one to the user as possibly theirs (`it may be the owner's`, the original of a kept file, the settings backup) and leave it unless they say otherwise.

Then delete `<clone>`, from a shell whose folder is not inside it. The exercise folder and its commits belong to the interviewer; leave them.

## The no-Node path

Without Node 22 or later nothing is installed: there is no roster, no `/sprint`, no guard hook and no preset.

1. Find `<home>` without Node: `$env:USERPROFILE` in PowerShell, `$HOME` in bash.
2. Get the repository (step 2: `git clone`, or the zip, which extracts to `<home>/Orc-istration-main`) so `orchestration/sprint.md` is on disk.
3. Read `<clone>/orchestration/sprint.md` and follow it for the sprint, with the built-in agents: `general-purpose` in the builder's place (brief: Goal, Scope, May change, Must verify, Do not) and a second `general-purpose` agent as the refuter, told to review the slice's commit adversarially and report must-fixes only.
4. With no guard hook, check the branch yourself before each commit: never commit to `main`, `develop` or `master`.
5. Clean up by deleting `<clone>`; nothing else was written.
