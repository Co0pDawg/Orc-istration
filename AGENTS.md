# Contributing to Orc-istration (agents and people)

This repo builds and installs an orchestration setup (a rulebook, a roster of agent roles and per-tool notes) into each AI coding tool's home folder. It is a standalone checkout: nothing here is loaded as the product while you work on it. This file holds the rules for changing the repo; the product rules live in `core/AGENTS.md`.

## Sources

- `core/AGENTS.md`: the product rulebook, installed into every tool.
- `core/roles/*.md`: the agent roles.
- `adapters/`: one adapter per tool, with its tool notes.
- `profiles/`, `skills/`, `review/`, `workflows/`, `standards/`: profiles, skills, the review panel, workflows and the coding-standards archive.

## Rules

- Never hand-edit `tests/golden/**`; `node tools/orc.mjs golden` writes it.
- After editing a source, run `node tools/orc.mjs golden`, review `git diff tests/golden`, then `npm test` and `node tools/orc.mjs check`.
- Every user-facing change updates `README.md` and `docs/cli.md` in the same change.
- Draft pull requests only; never commit to `main`.
- Keep this file short and free of product rules: a tool that opens this repo loads it, and the product rulebook must not load twice.

## More

- `CONTRIBUTING.md`: the source table, the edit loop, traps and the test map.
- The `ship-prompts` project skill (`.claude/skills/ship-prompts/SKILL.md`) walks the loop from a source edit to the live install.
