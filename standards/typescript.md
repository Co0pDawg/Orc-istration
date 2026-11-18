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
---

# TypeScript and JavaScript

Rules for TypeScript and modern JavaScript on Node. The compiler (`tsc`) enforces type rules, ESLint with typescript-eslint enforces language rules, and Prettier owns layout.

## Tooling and formatting
- Set `"strict": true` in `tsconfig.json`; it turns on `noImplicitAny`, `strictNullChecks`, `useUnknownInCatchVariables` and the other strict flags. Do not switch an individual strict flag off without a comment saying why. [1]
- Consider `"noUncheckedIndexedAccess": true` so index-signature reads are typed `T | undefined`. [1]
- Lint with ESLint flat config (`eslint.config.mjs`) extending `@eslint/js` recommended plus `tseslint.configs.recommended`; prefer `strict` and `stylistic` for new code. [2]
- Use the type-checked presets (such as `recommended-type-checked`) so the promise and throw rules below can run. [4]
- Format with Prettier and let it own layout, quotes and semicolons; do not hand-format against its output. [6]
- Add `eslint-config-prettier` to switch off conflicting ESLint rules, and run `prettier --check .` separately; do not run Prettier as an ESLint rule. [7]
- Keep line width, quote style and trailing commas at the formatter defaults unless the repo's Prettier config says otherwise. [6]
- Disable a lint rule with `// eslint-disable-next-line <rule>` on the line above, never the trailing `// eslint-disable-line` form, which Prettier may move. [6]

## Naming
- Use `camelCase` for variables, functions, parameters and properties; `UPPER_CASE` is allowed for constants. [5]
- Use `PascalCase` for classes, interfaces, enums, type aliases and type parameters. [5]
- Function components may be `PascalCase`; allow that in the naming rule rather than renaming them. [5]
- Enforce naming with `@typescript-eslint/naming-convention` in `eslint.config.mjs`, not by review comments. [5]

## Language and API usage
- Replace `any` with `unknown` and narrow before use; enable `@typescript-eslint/no-explicit-any`. [3]
- Do not use the postfix `!` non-null assertion; narrow the value or restructure so the type shows it is present (`no-non-null-assertion`, in the `strict` preset). [16]
- Declare with `const`; use `let` only for bindings that are reassigned (`prefer-const`). [10]
- Never use `var`; block-scoped `let` and `const` avoid accidental overwrites (`no-var`). [11]
- Compare with `===` and `!==` only; loose equality coerces types (`eqeqeq`). [8]
- Write `import type { X }` for type-only imports so transpilers can drop them (`consistent-type-imports`). [15]
- Use ES modules (`import` / `export`): set `"type": "module"` in `package.json`, or use `.mjs` for modules and `.cjs` for CommonJS files. [19]
- Declare a package's public entry points in `package.json` `"exports"`; deep imports into other paths are then blocked. [19]
- Do not call `eval()` and do not build code from strings (`no-eval`). [9]

## Errors, logging and nulls
- Handle every promise: `await` it, `return` it, attach `.catch()`, or mark it deliberately with `void` (`no-floating-promises`). [4]
- Do not rely on `void` to hide a rejection that matters; it silences the rule, the error is still unhandled. [4]
- Do not pass an async function where a void callback is expected (`forEach(async ...)`, async event handlers) and do not use a promise as a condition (`no-misused-promises`). [18]
- Run independent async work through `Promise.all` and await the result, rather than leaving an array of promises. [4]
- Throw only `Error` objects (or subclasses), never strings or plain objects (`only-throw-error`). [17]
- In `catch`, treat the caught value as `unknown` and narrow it (`instanceof Error`) before reading its fields. [1]

## Testing
- Prefer the built-in `node:test` runner with `node:assert`, run by `node --test`; name files `*.test.ts` / `*.test.mjs` so discovery finds them. [12]
- Use `assert.strictEqual` and `assert.deepStrictEqual` rather than the loose variants. [12]
- Mark async tests `async` and `await` every `t.test()` subtest; unawaited subtests are cancelled and counted as failures. [12]
- Mock with `t.mock` (functions, methods, timers) so mocks are restored after the test; advance fake timers with `tick()` instead of waiting. [12]
- Give every `skip` or `todo` a reason string. [12]

## Security
- Never pass untrusted input to `eval`, `new Function` or `vm`; use a data format such as JSON. [13]
- Run child processes with `execFile` or `spawn` and an argument array, leaving the `shell` option off; with `exec` or a shell enabled, input containing shell metacharacters can run arbitrary commands. [20]
- Validate untrusted JSON with a schema and do not recursively merge it into shared objects (prototype pollution). [13]
- Check keys with `Object.hasOwn(obj, key)` on parsed data, and use `Object.create(null)` for lookup maps. [13]
- Compare secrets with `crypto.timingSafeEqual`, not `===`. [13]
- Commit the lockfile and install with `npm ci` in CI so installs match it. [13]
- Run `npm audit` in CI with an explicit threshold such as `--audit-level=high`; it exits non-zero at or above that severity. [14]
- Review dependency names for typosquatting and consider `--ignore-scripts` on installs of unfamiliar packages. [13]
- Set `headersTimeout`, `requestTimeout` and `keepAliveTimeout` on `http.Server`, and attach socket error handlers. [13]

## Review checklist
- [ ] `tsconfig.json` still has `"strict": true` and no new per-flag opt-out without a reason.
- [ ] No new `any` or non-null `!` without a justified comment.
- [ ] No `var`, no `==` / `!=`, no `eval`, no `new Function` on dynamic strings.
- [ ] Every promise is awaited, returned, caught or explicitly `void`-ed; no `forEach(async ...)`.
- [ ] Only `Error` instances are thrown; `catch` values are narrowed before use.
- [ ] Type-only imports use `import type`; modules are ESM or correctly named `.mjs` / `.cjs`.
- [ ] Names follow camelCase / PascalCase per the lint config; ESLint and `prettier --check` pass.
- [ ] No shell-string process spawning, and no untrusted JSON merged into shared objects.
- [ ] New or changed behaviour has a `node:test` test with strict assertions and no committed `.only`.
- [ ] Dependency changes keep the lockfile in sync and `npm audit` passes at the repo's threshold.
