# The standards archive

Each `standards/<id>.md` file holds the coding standards for one stack (a language, framework or tool). `node tools/orc.mjs standards apply` composes the files a project picks into that project's `STANDARDS.md`, which builders follow and refuters check diffs against. The setup procedure is [`orchestration/standards.md`](../orchestration/standards.md). This README describes the format; it is not an archive entry, and `list`, `detect`, `apply` and `check` skip it.

`node tools/orc.mjs check` validates every entry, so run it after adding or changing one.

## File layout

```
---
id: csharp
title: C# and .NET
kind: language
detect:
  - "*.csproj"
  - "*.sln"
  - "global.json"
requires: []
reviewed: 2026-11-18
sources:
  - https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/coding-style/coding-conventions
  - https://...
---

# C# and .NET

One or two sentences: what this covers, and which tool enforces the mechanical parts.

## Tooling and formatting
- <rule>. [1]
## Naming
## Language and API usage
## Errors, logging and nulls
## Testing
## Security
## Review checklist
- [ ] <a yes/no check a refuter can apply to a diff>
```

## Frontmatter

The frontmatter is read by this repo's own small parser (`tools/lib/frontmatter.mjs`), not a YAML library:

- Use flat keys only, and write list items as `  - value`.
- Quote with double quotes (a JSON string) any value that starts with `*` or other YAML punctuation. Leave URLs unquoted.
- Write `requires: []` when the list is empty.

The fields:

- `id`: the file name without `.md`.
- `title`: the section title used in `STANDARDS.md`.
- `kind`: `language`, `framework` or `tool`. `apply` orders the sections languages first, then frameworks, then tools.
- `detect`: a non-empty list of file-name globs (`*` and `?` only, case-insensitive), matched against base names anywhere in a project. Folders such as `.git`, `node_modules`, `bin`, `obj`, `dist`, `build`, `vendor`, `target`, `.venv` and `venv` are skipped. Pick names specific enough to avoid false positives: `*.csproj` is a good glob, `*.json` is not. Content matching is not supported.
- `requires`: the ids of the entries this one builds on (for example, `aspnet-core` requires `csharp`). `apply` adds them, and `detect` reports them as `required by <id>`.
- `reviewed`: the date the entry was last checked against its sources, as `YYYY-MM-DD`.
- `sources`: a non-empty list of URLs. A citation `[n]` in the body refers to the n-th URL, counting from 1.

## Body

- Aim for 60 to 110 lines.
- Keep the sections in the order shown above. Leave out a section that has nothing useful, except `## Review checklist`. That section is always present, with 6 to 12 `- [ ]` items.
- Write each rule as one imperative, concrete and checkable line ("Use `PascalCase` for public members"), never as a vague one ("write clean code").
- Prefer rules a linter or formatter enforces, and name the tool and its config file.
- Where common practice is genuinely split (tabs or spaces, line length), state the formatter's default and add "unless the repo's formatter config says otherwise".
- Do not add an introduction or a conclusion beyond the one or two opening sentences.

## Citations

- End every rule with a citation `[n]`. Review checklist items restate rules from the sections above, so they need not carry `[n]`; rules in every other section must.
- `check` checks the range of every `[n]`, not that each rule has one. `check` fails on any `[n]` outside the sources list (code spans and fenced code are not scanned).
- Cite primary or widely adopted authorities only: the language or vendor docs, an official style guide (PEP 8, the Google style guides, Effective Go, the Rust API Guidelines, Microsoft Learn, OWASP), or the official docs of the named linter.
- Do not cite blogs, Medium or Stack Overflow.
- Drop any rule you cannot cite. Do not keep it marked as unverified.

## Copyright and neutrality

- Write every rule in your own words, and never copy sentences from a source. Short identifiers, option names and code tokens are fine.
- The archive is public. Do not include company names, project names or ticket numbers. A team's own rules go into its project's `STANDARDS.md` through `apply --from`, never into this folder.
