# Interview machine: install the sprint kit

Written for Claude Code to follow, step by step, on a machine you do not own: for example an interviewer's laptop with an editor (such as Visual Studio) and the Claude app. The goal is a verified sprint kit in under 5 minutes, before the clock of a timed build starts. The starter prompt is in [`example-prompts.md`](example-prompts.md#starter-prompt-interview-machine).

The sprint kit is the roster agents, the generated rulebook, the `sprint` skill (so `/sprint` works), the git guard hook and a permission preset for the project's stack. It leaves out the board, the cost log, the worklog and peon hooks, plugins, the status line, and model and effort settings. Nothing personal goes on the machine. Everything it writes is under `<home>/.claude`, it backs up what it replaces, and `uninstall` puts it back.

## Ground rules on a borrowed machine

- The user should have the interviewer's agreement to install tooling on the machine. If you are not sure they have it, ask once before step 3.
- Write only under the user profile. Do not change system settings, global git config or anything outside `<home>`.
- The sprint commits locally only. Do not push, open a pull request or sign in to anything unless the user says so.
- Questions about AI use are answered truthfully, by the user and by you.

## 1. Prerequisites (under 1 minute)

Run each and note the result:

```
git --version
node --version
claude --version
```

- **Node 22 or later** is needed for the install. If `node` is missing or older, take the no-Node path below; do not install Node without the user's yes.
- **git** is needed to clone. Without it, download https://github.com/Co0pDawg/Orc-istration/archive/refs/heads/main.zip and extract it to the folder named in step 2.
- **Claude Code** is what you are running in; `claude --version` failing in the shell is fine.

Find the user's home folder, which every command below calls `<home>`:

```
node -p "require('os').homedir()"
```

## 2. Clone outside `~/.claude` (under 1 minute)

Never clone into `<home>/.claude`; that folder belongs to Claude Code. Clone next to it:

```
git clone https://github.com/Co0pDawg/Orc-istration.git "<home>/Orc-istration"
cd "<home>/Orc-istration"
```

The repository is public, so no sign-in is needed. Run the remaining commands from this folder.

## 3. Dry run (seconds)

Pick the stack of the exercise: `dotnet` (a `.sln` or `.csproj`), `node` (`package.json`) or `python` (`pyproject.toml` or `requirements.txt`). Pass it with `--stack`; the install runs from the clone, so it cannot detect the exercise's stack itself. If the stack is not known yet, leave `--stack` out and re-run step 4 with it later: a second run only adds what is missing.

```
node tools/orc.mjs install --tool claude-code --sprint-kit --stack dotnet --home "<home>"
```

It writes nothing. Read the output:

- `would create` / `would replace ...` for each file; `would replace (hand-written; backed up, uninstall restores it)` marks a file of the owner's, such as an existing `CLAUDE.md`.
- `would add to settings.json ...` for the guard hook and each preset entry; existing entries are kept.
- A `refused: ... settings.json is not valid JSON` line means the owner's `settings.json` is broken. Stop and tell the user; do not edit it.
- `--apply would refuse` means a file installed earlier by orc was edited by hand. Stop and tell the user.

## 4. Apply (seconds)

```
node tools/orc.mjs install --tool claude-code --sprint-kit --stack dotnet --home "<home>" --apply
```

Each replaced file is first copied to `<file>.orc-backup-<time>`, and `settings.json` is backed up once, before its first change. The manifest `<home>/.claude/.orc-manifest.claude-code.json` records every file and every `settings.json` entry the kit added.

## 5. Verify (1 minute)

```
node tools/orc.mjs status --tool claude-code --home "<home>"
```

It must end with `status claude-code: all same` and exit 0, including the line `same: ... settings.json (sprint kit entries present)`.

Then check that Claude Code sees the kit. A session that started before the install may not list the new agents and skill, so ask the user to open a fresh Claude Code session in the exercise folder. In it, confirm that:

- `/sprint` appears in the slash-command list;
- `/agents` lists the roster: `builder`, `refuter`, `scout`, `researcher`, `debugger` and the `review-*` agents.

Tell the user in one line that the sprint kit is installed and verified.

## 6. Start the sprint

In the exercise folder, start the sprint with the minutes and the task, for example `/sprint 45` followed by the interviewer's task, or "start a 45-minute sprint: <task>". The skill reads `orchestration/sprint.md` from the clone (the rulebook's "Setup checkout (this machine)" line points at it) and runs the timebox. There is no board on this machine; the rulebook says so, and sprint mode waives it anyway.

## 7. Clean up afterwards

When the user is done, remove the kit and the clone:

```
node tools/orc.mjs uninstall --tool claude-code --home "<home>" --apply
```

- It deletes the files the kit installed, removes the kit's `settings.json` entries (the owner's own entries, and any added since, stay), and restores each backed-up file, such as the owner's `CLAUDE.md`. When `settings.json` has not changed since the install, its backup goes back byte for byte.
- A kit file edited during the sprint is kept and its original is not restored over it; the output names both. `uninstall --apply --force` deletes the edited copy after a backup and then restores the original.

Then delete the clone: leave the clone folder (`cd "<home>"`) and remove `<home>/Orc-istration`. The exercise folder and its commits belong to the interviewer; leave them.

## The no-Node path

Without Node 22 or later nothing is installed: there is no roster, no `/sprint`, no guard hook and no preset.

1. Get the repository (step 2, or the zip download) so `orchestration/sprint.md` is on disk.
2. Read `orchestration/sprint.md` and follow it for the sprint, with the built-in agents: `general-purpose` in the builder's place (brief: Goal, Scope, May change, Must verify, Do not) and a second `general-purpose` agent as the refuter, told to review the slice's commit adversarially and report must-fixes only.
3. With no guard hook, check the branch yourself before each commit: never commit to `main`, `develop` or `master`.
4. Clean up by deleting the downloaded folder; nothing else was written.
