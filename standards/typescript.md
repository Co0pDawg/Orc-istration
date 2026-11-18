---
id: typescript
title: TypeScript and JavaScript
kind: language
detect:
  - "tsconfig.json"
  - "package.json"
  - "*.ts"
  - "*.mts"
  - "*.js"
  - "*.mjs"
  - "*.cjs"
requires: []
reviewed: 2026-11-18
sources:
  - https://www.typescriptlang.org/tsconfig/
  - https://typescript-eslint.io/getting-started/
  - https://typescript-eslint.io/rules/no-explicit-any/
  - https://typescript-eslint.io/rules/no-floating-promises/
  - https://typescript-eslint.io/rules/naming-convention/
  - https://prettier.io/docs/rationale
  - https://prettier.io/docs/integrating-with-linters
  - https://eslint.org/docs/latest/rules/eqeqeq
  - https://eslint.org/docs/latest/rules/no-eval
  - https://eslint.org/docs/latest/rules/prefer-const
  - https://eslint.org/docs/latest/rules/no-var
  - https://nodejs.org/api/test.html
  - https://nodejs.org/en/learn/getting-started/security-best-practices
  - https://docs.npmjs.com/cli/v10/commands/npm-audit
  - https://typescript-eslint.io/rules/consistent-type-imports/
  - https://typescript-eslint.io/rules/no-non-null-assertion/
  - https://typescript-eslint.io/rules/only-throw-error/
  - https://typescript-eslint.io/rules/no-misused-promises/
  - https://nodejs.org/api/packages.html
  - https://nodejs.org/api/child_process.html
  - https://nodejs.org/api/assert.html
  - https://prettier.io/docs/options
---

# TypeScript and JavaScript

Rules for TypeScript and modern JavaScript on Node. The compiler (`tsc`) enforces type rules, ESLint with typescript-eslint enforces language rules, and Prettier owns layout.

## Tooling and formatting
- Set `"strict": true` in `tsconfig.json`; it enables `noImplicitAny`, `strictNullChecks`, `useUnknownInCatchVariables` and the rest of the strict family. [1]
- Consider `"noUncheckedIndexedAccess": true` so index-signature reads are typed `T | undefined`. [1]
- Lint with ESLint flat config (`eslint.config.mjs`) extending `@eslint/js` recommended plus `tseslint.configs.recommended`; the `strict` and `stylistic` presets add more opinionated and purely stylistic rules. [2]
- Use the type-checked presets (such as `recommended-type-checked`) so the promise and throw rules below can run. [4]
- Format with Prettier, which decides layout, quote style and semicolons. [6]
- Add `eslint-config-prettier` to switch off ESLint rules that conflict with Prettier, and run `prettier --check .` as its own step rather than through `eslint-plugin-prettier`, which the docs call generally not recommended. [7]
- Keep line width, quote style and trailing commas at Prettier's defaults (80 columns, double quotes, trailing commas everywhere) unless the repo's Prettier config says otherwise. [22]
- Prefer `// eslint-disable-next-line <rule>` on the line above over the trailing `// eslint-disable-line` form, because Prettier can move end-of-line comments. [6]

## Naming
- Use `camelCase` for variables, functions, parameters and properties; the rule's defaults also let variables be `UPPER_CASE`. [5]
- Use `PascalCase` for classes, interfaces, enums, type aliases and type parameters. [5]
- For function components, consider allowing both `camelCase` and `PascalCase` function names in the naming rule. [5]
- Enforce naming with `@typescript-eslint/naming-convention` in `eslint.config.mjs`. [5]

## Language and API usage
- Prefer `unknown` to `any`, and enable `@typescript-eslint/no-explicit-any` (part of the `recommended` preset). [3]
- Avoid the postfix `!` non-null assertion; restructure so the type shows the value is present, or use optional chaining with a fallback (`no-non-null-assertion`, in the `strict` preset). [16]
- Declare with `const`; use `let` only for bindings that are reassigned (`prefer-const`). [10]
- Do not use `var`; `let` and `const` are block scoped, which avoids silently overriding an outer variable (`no-var`). [11]
- Compare with `===` and `!==` only, because `==` and `!=` coerce their operands (`eqeqeq`). [8]
- Write `import type { X }` for imports used only as types, so a transpiler can remove them without type information (`consistent-type-imports`). [15]
- Set the `"type"` field in `package.json` explicitly; a `.mjs` file is always an ES module and a `.cjs` file is always CommonJS, whatever the field says. [19]
- Declare a package's entry points in `package.json` `"exports"`; once it is defined, subpaths that are not listed are unavailable to importers. [19]

## Errors, logging and nulls
- Handle every promise: `await` it, `return` it, attach `.catch()`, or mark it deliberately with `void` (`no-floating-promises`). [4]
- Do not rely on `void` to deal with a rejection that matters; it only silences the rule and the rejection is still unhandled. [4]
- Do not pass an async function where a void-returning callback is expected (`forEach(async ...)`, async event handlers) and do not use a promise as a condition (`no-misused-promises`). [18]
- Combine an array of promises with `Promise.all` (or `allSettled`, `any`, `race`) and await the result, instead of leaving them unhandled. [4]
- Throw only `Error` objects or subclasses, never strings or plain objects (`only-throw-error`). [17]
- In `catch`, treat the caught value as `unknown` and narrow it (`instanceof Error`) before reading its fields. [1]

## Testing
- With the built-in `node:test` runner (`node --test`), name files `*.test.mjs` or `*.test.ts` so discovery finds them; TypeScript discovery is off under `--no-strip-types`. [12]
- Prefer the strict assertion methods `assert.strictEqual` and `assert.deepStrictEqual`; the docs mark `equal` and `deepEqual` as legacy. [21]
- Mark async tests `async` and `await` every `t.test()` subtest; subtests still running when the parent finishes are cancelled and count as failures. [12]
- Mock through `t.mock` (functions, methods, timers) so the runner restores them when the test ends; advance mocked timers with `tick()`. [12]
- Pass a string to `skip` or `todo` (`{ skip: 'why' }`) to say why the test is not running. [12]

## Security
- Never run untrusted input through `eval()`; it opens the program to injection attacks (`no-eval`). [9]
- Run child processes with `execFile` or `spawn` and an argument array, leaving the `shell` option off; with `exec` or a shell enabled, crafted input with shell metacharacters can run extra commands. [20]
- Validate untrusted JSON with a schema and do not recursively merge it into shared objects (prototype pollution). [13]
- Check keys with `Object.hasOwn(obj, key)` and create lookup objects without a prototype using `Object.create(null)`. [13]
- Compare secrets with `crypto.timingSafeEqual`, a constant-time comparison. [13]
- Use a lockfile and install with `npm ci`, which fails when the lockfile and `package.json` disagree. [13]
- Run `npm audit` in CI with an explicit threshold such as `--audit-level=high`; it exits non-zero at or above that severity. [14]
- Check dependency names for typos (typosquatting) and consider `--ignore-scripts` to stop install scripts from running. [13]
- Set `headersTimeout`, `requestTimeout` and `keepAliveTimeout` on `http.Server`, and attach socket error handlers. [13]

## Review checklist
- [ ] `tsconfig.json` still has `"strict": true`.
- [ ] No new `any` or non-null `!` assertions.
- [ ] No `var`, no `==` / `!=`, no `eval`.
- [ ] Every promise is awaited, returned, caught or explicitly `void`-ed; no `forEach(async ...)`.
- [ ] Only `Error` instances are thrown; `catch` values are narrowed before use.
- [ ] Type-only imports use `import type`; `package.json` sets `"type"` explicitly.
- [ ] Names follow the naming-convention lint config; ESLint and `prettier --check` pass.
- [ ] No child processes spawned through a shell with untrusted input, and no untrusted JSON merged into shared objects.
- [ ] New or changed behaviour has a `node:test` test using strict assertions.
- [ ] Dependency changes keep the lockfile in sync and `npm audit` passes at the repo's threshold.
