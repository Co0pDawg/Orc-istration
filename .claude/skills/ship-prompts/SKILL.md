---
name: ship-prompts
description: Regenerate, test and ship a change to Orc-istration's own sources (core/AGENTS.md, core/roles, the procedure catalogue core/procedures.mjs, adapters, profiles, orchestration procedures, workflows, review, standards, tools) through golden, tests, check, the README and wiki, and the live install (sync --apply). Use only in the Orc-istration repo after editing one of those sources.
---

# Ship prompts

A project skill: it loads only in a session opened in this repo. `CONTRIBUTING.md` is the source of truth for every step here; follow it over this file.

Show this as a visible checklist.

1. **Generated files.** Never hand-edit `tests/golden/**` or a generated skill or command. A new or renamed routine, workflow or review procedure is an entry in `core/procedures.mjs` (plus each rendering adapter's `procedureNotes`); its steps live in its tool-neutral file (`orchestration/`, `workflows/` or `review/`). Run:
   ```
   node tools/orc.mjs golden
   git diff tests/golden
   ```
   Read the golden diff: every change must be one you meant.
2. **Tests and caps.** Run `npm test`, then `node tools/orc.mjs check`. Report the antigravity headroom line; the rulebook built from `core/AGENTS.md` must stay under its byte cap.
3. **Tracked paths.** `.gitignore` is a standard deny-list (cost logs, `orchestration/board/`, `.orc/`, `models.local.json`, `dist/`, `.claude/*` except `.claude/skills/ship-prompts/`, and `.agents/*` except `.agents/skills/ship-prompts/` stay ignored). Run `git status --porcelain` so only the files you meant are staged.
4. **Review tier.** `node tools/orc.mjs review-tier` says `Full` for any prompt source (`core/AGENTS.md`, `core/roles/`, `adapters/*.notes.md`, `adapters/<tool>/`, `profiles/`, `.claude/`, `.agents/`, any `SKILL.md`, `standards/`, `review/`, `workflows/`, `orchestration/{standards,sprint,board,brief,wrap-up}.md`, `orchestration/sprint/`). Prompts are product, not docs.
5. **README and wiki.** A change to a command, flag, role, workflow, skill, mode, install step, supported tool or limit updates `README.md` (and `docs/cli.md` for commands and flags) in the same change. For the wiki:
   - Clone `https://github.com/Co0pDawg/Orc-istration.wiki.git` into the scratchpad.
   - Before any commit, copy this repo's local identity into the clone: set its `user.name` and `user.email` to the values `git config --local user.name` and `git config --local user.email` print here. The global identity must never reach this public wiki; if this repo has no local identity, stop and ask.
   - Edit the matching page. Add a new page to `_Sidebar.md` and the Home index, and keep the `Next: [[...]]` chain unbroken.
   - Push the wiki only after the PR merges, and only with the user's OK.
6. **Public repo.** No private project names, tickets, customer names or people's names from cost logs or other projects. Anonymise the evidence.
7. **PR.** Branch off `main` in a worktree, and open a draft PR against `main`. Fill in the template's Docs checklist, and end the description with the PR footer from the tool notes.
8. **Live install.** After the merge, and with the user's OK because it writes the live setup:
   - Run `node tools/orc.mjs status --all` (or `status --tool claude-code`), then `node tools/orc.mjs sync` as a dry run, then `node tools/orc.mjs sync --apply` (or `install --tool <id> --apply` for one tool). That installs the generated files (agents, skills and commands), hook scripts and the `orc-permissions` skill; nothing is copied by hand. A hand copy from before generation is kept until deleted (`doctor` warns about it).
   - Live-test a changed agent definition from a fresh session whose project has no agents of the same names.
