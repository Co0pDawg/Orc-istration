---
name: ship-prompts
description: Regenerate, test and ship a change to Orc-istration's own sources (AGENTS.md, roles, adapters, profiles, skills, workflows, standards, tools) through sync, golden, tests, check, the README and wiki, and the live install. Use only in the Orc-istration repo after editing one of those sources.
---

# Ship prompts

A project skill: it loads only in a session opened in this repo. `CONTRIBUTING.md` is the source of truth for every step here; follow it over this file.

Show this as a visible checklist.

1. **Generated files.** Never hand-edit `CLAUDE.md`, `agents/*.md`, the generated `commands/*.md` or `tests/golden/**`. Run:
   ```
   node tools/orc.mjs sync
   node tools/orc.mjs golden
   git diff tests/golden
   ```
   Read the golden diff: every change must be one you meant.
2. **Tests and caps.** Run `npm test`, then `node tools/orc.mjs check`. Report the antigravity headroom line; the rulebook built from `AGENTS.md` must stay under its byte cap.
3. **Tracked paths.** `.gitignore` is an allow-list. For each new top-level path, skill folder or command, run `git check-ignore <path>`: no output means it is tracked. Add a `!/` line when it is not. Then `git status --porcelain` shows only the files you meant.
4. **Review tier.** `node tools/orc.mjs review-tier` says `Full` for any prompt source (`AGENTS.md`, `roles/`, adapter notes, profiles, `review/`, `workflows/`, `commands/`, any `SKILL.md`, standards, `orchestration/*.md`). Prompts are product, not docs.
5. **README and wiki.** A change to a command, flag, role, workflow, skill, mode, install step, supported tool or limit updates `README.md` (and `docs/cli.md` for commands and flags) in the same change. For the wiki:
   - Clone `https://github.com/Co0pDawg/Orc-istration.wiki.git` into the scratchpad.
   - Before any commit, copy this repo's local identity into the clone: set its `user.name` and `user.email` to the values `git config --local user.name` and `git config --local user.email` print here. The global identity must never reach this public wiki; if this repo has no local identity, stop and ask.
   - Edit the matching page. Add a new page to `_Sidebar.md` and the Home index, and keep the `Next: [[...]]` chain unbroken.
   - Push the wiki only after the PR merges, and only with the user's OK.
6. **Public repo.** No private project names, tickets, customer names or people's names from cost logs or other projects. Anonymise the evidence.
7. **PR.** Branch off `main` in a worktree, and open a draft PR against `main`. Fill in the template's Docs checklist, and end the description with the PR footer from the tool notes.
8. **Live install.** After the merge, and with the user's OK because it writes the live setup:
   - Run `node tools/orc.mjs status --tool claude-code --home <home>`, then `install --tool claude-code --home <home>` as a dry run, then with `--apply`.
   - Copy changed `skills/*` folders into `~/.claude/skills` by hand.
   - Live-test a changed agent definition from a fresh session whose project has no agents of the same names.
