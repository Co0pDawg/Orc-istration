<!-- orc standards: stacks=powershell,typescript; imports=; sha256=14d8bbea1867c57f398b2e5dccb7a8aa8850df28d0277f43a4fa893a68de81c3 -->
# Coding standards

Builders follow the sections for the stacks they touch. Refuters check each diff against the Review checklist of every section whose stack the diff touches. The team may edit this file, but a re-apply (`tools/orc.mjs standards apply` in the setup checkout) then needs `--force`, which keeps a backup.

Contents:

- PowerShell (`powershell`)
- TypeScript and JavaScript (`typescript`)

## PowerShell

Rules for PowerShell scripts, modules and manifests. PSScriptAnalyzer enforces most of the mechanical rules; Pester covers behavior. Notes marked "(5.1)" or "(7+)" concern Windows PowerShell 5.1 versus PowerShell 7.

### Tooling and formatting
- Use PSScriptAnalyzer, the static checker for scripts and modules, over the whole project with `Invoke-ScriptAnalyzer -Path . -Recurse`, and use its `Severity` setting to choose which levels (such as Error and Warning) are reported. [2][9]
- Keep rule choices in a `PSScriptAnalyzerSettings.psd1` at the repo root, which the analyzer finds when given the project root. [9]
- Suppress a rule with `SuppressMessageAttribute`, use its `Scope` and `Target` to limit the suppression, and record the reason in `Justification`. [9]
- Run the compatibility rules (`PSUseCompatibleSyntax`, `PSUseCompatibleCommands`) when a script must run on more than one PowerShell version. [9]
- Indent code consistently and avoid backtick line continuation. [3]
- State in the script's documentation which PowerShell version it targets. [3]

### Naming
- Name each function `Verb-Noun`, capitalizing every word, with the verb taken from `Get-Verb` and a singular noun. [1][4]
- Never use a synonym of an approved verb (`Remove`, not `Delete`), and avoid the reserved verbs `ForEach`, `Ping`, `Sort`, `Tee` and `Where`. [1]
- Put a short prefix at the start of the noun (`Get-AcmeConfig`) so your names are unlikely to collide with commands that ship or are written later. [4]
- Reuse the standard parameter names and casing (`ComputerName`, not `Computer` or `Server`). [4]

### Language and API usage
- Turn on strict mode with `Set-StrictMode -Version 3.0`; it makes uninitialized variables, references to missing properties and invalid array indexes errors. [5]
- Prefer a pinned version over `-Version Latest`, because the meaning of `Latest` can change in newer releases. [5]
- Declare functions with `[CmdletBinding()]` and a `param()` block, which adds the common parameters such as `-Verbose` and `-Debug`. [4][7]
- Give every parameter a type, mark required ones `[Parameter(Mandatory)]`, and validate with attributes such as `[ValidateNotNullOrEmpty()]`. [4]
- Do not give a mandatory parameter a default value; for an optional one, combine a validation attribute with a default. [4]
- Do not hardcode values that belong in parameters, such as computer names. [3][4]
- Do not use aliases (`gci`, `%`, `?`, `iex`) or positional parameters in saved code; spell out cmdlets and name parameters. [3][4]
- Give functions whose verbs change state (`Set`, `New`, `Remove`, `Update`) `[CmdletBinding(SupportsShouldProcess)]`, and call `$PSCmdlet.ShouldProcess(...)` to confirm the change. [3][7]
- Set `ConfirmImpact` only together with `SupportsShouldProcess`; the prompt appears only when the impact is at or above `$ConfirmPreference`. [7]
- Do not default a `[switch]` parameter to `$true`. [3]
- Avoid global variables and assigned variables that are never used. [3]
- Use `Write-Verbose` for progress diagnostics rather than inline comments. [4]
- Reserve `Write-Host` for text meant only for the console. [3]
- Accept pipeline input with `ValueFromPipeline` and process it in a `process` block. [4]
- (5.1 vs 7+) Do not use `??`, `??=` or `?.` in scripts that must still run on Windows PowerShell 5.1. [10]
- (5.1 vs 7+) Do not rely on cmdlets absent from PowerShell 7 (for example the `*-Transaction` and `*-EventLog` cmdlets) in cross-version scripts. [10]
- (5.1 vs 7+) Run PowerShell 7 as `pwsh` and Windows PowerShell as `powershell.exe`; the two can be installed side by side. [10]
- (5.1 vs 7+) Pass `-Encoding` explicitly when writing files that other tools or versions will read: in 5.1 `Out-File` writes UTF-16LE and `Set-Content` uses the ANSI code page, while 7 writes UTF-8 without a BOM. [12]

### Errors, logging and nulls
- Use `-ErrorAction Stop` on cmdlet calls inside `try`/`catch`, because only terminating errors are caught. [3][4]
- For calls that are not cmdlets, such as .NET methods, set `$ErrorActionPreference` to `Stop`, since `-ErrorAction` cannot be passed. [3][4]
- Avoid changing `$ErrorActionPreference` globally; a change made in a local scope reverts when that scope exits. [4][6]
- Do not leave a `catch` block empty. [3]
- Do not use `$?` or a null check as the way to detect failure. [3]
- (7+) On versions that have `$PSNativeCommandUseErrorActionPreference`, a native command's non-zero exit code raises no error by default (the variable defaults to `$false`); set it to `$true` or check `$LASTEXITCODE` after the call. [6]
- Copy `$Error[0]`, the most recent error, into your own variable before handling it. [3]

### Testing
- Write Pester tests in `*.Tests.ps1` files, grouped with `Describe` and `Context`, with each check in an `It` block that uses `Should`. [11]
- Put shared setup in `BeforeAll`, and use Pester's mocking (`Mock`) for dependencies. [11]
- Run the suite with `Invoke-Pester` from the CI build script; Pester can write test-result and code-coverage files for CI reporting. [11]
- Add comment-based help (`.SYNOPSIS`, `.PARAMETER`, `.EXAMPLE`) to every exported function. [3][4]

### Security
- Avoid `Invoke-Expression` on user-supplied input: verify a command is safe before running it, prefer predefined input options, and use the call operator `&` to run commands, which is the safer route. [3][8]
- Take credentials as a `[PSCredential]` parameter rather than separate `-Username` and `-Password` parameters, and avoid plain-text passwords. [3]
- Avoid `ConvertTo-SecureString` on plain-text input, and avoid assigning a password to a variable as a string literal (`$Password = 'string'`). [3]
- Do not initialize variables that hold API keys or credentials in a script, and do not hardcode a `-ComputerName` argument. [3]

### Review checklist
- [ ] `Invoke-ScriptAnalyzer` was run on the changed files, and each suppression is scoped and has a `Justification`.
- [ ] Every function is named `Verb-Noun` with an approved verb and a singular noun.
- [ ] Scripts enable strict mode with a pinned version, and cmdlet calls inside `try`/`catch` use `-ErrorAction Stop`.
- [ ] Functions use `[CmdletBinding()]`, typed and validated parameters, and no aliases or positional arguments.
- [ ] Functions that change state declare `SupportsShouldProcess` and call `ShouldProcess`.
- [ ] No `Invoke-Expression` on user input, no `-Password` parameters and no plain-text passwords.
- [ ] No empty `catch` blocks, and `Write-Host` is used only for console-only text.
- [ ] New logic has a Pester test, and the tests pass.
- [ ] Syntax, cmdlets and file encodings suit every PowerShell version the script claims to support.
- [ ] Exported functions have comment-based help with parameter documentation and an example.

### Sources

1. https://learn.microsoft.com/en-us/powershell/scripting/developer/cmdlet/approved-verbs-for-windows-powershell-commands
2. https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/overview
3. https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/rules-recommendations
4. https://learn.microsoft.com/en-us/powershell/scripting/learn/ps101/09-functions
5. https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/set-strictmode
6. https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_preference_variables
7. https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_functions_cmdletbindingattribute
8. https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/invoke-expression
9. https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/using-scriptanalyzer
10. https://learn.microsoft.com/en-us/powershell/scripting/whats-new/differences-from-windows-powershell
11. https://pester.dev/docs/quick-start
12. https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding

Reviewed 2026-11-18.

## TypeScript and JavaScript

Rules for TypeScript and modern JavaScript on Node. The compiler (`tsc`) enforces type rules, ESLint with typescript-eslint enforces language rules, and Prettier owns layout.

### Tooling and formatting
- Set `"strict": true` in `tsconfig.json`; it enables `noImplicitAny`, `strictNullChecks`, `useUnknownInCatchVariables` and the rest of the strict family. [1]
- Consider `"noUncheckedIndexedAccess": true` so index-signature reads are typed `T | undefined`. [1]
- Lint with ESLint flat config (`eslint.config.mjs`) extending `@eslint/js` recommended plus `tseslint.configs.recommended`; the `strict` and `stylistic` presets add more opinionated and purely stylistic rules. [2]
- Use the type-checked presets (such as `recommended-type-checked`) so the promise and throw rules below can run. [4]
- Format with Prettier, which decides layout, quote style and semicolons. [6]
- Add `eslint-config-prettier` to switch off ESLint rules that conflict with Prettier, and run `prettier --check .` as its own step rather than through `eslint-plugin-prettier`, which the docs call generally not recommended. [7]
- Keep line width, quote style and trailing commas at Prettier's defaults (80 columns, double quotes, trailing commas everywhere) unless the repo's Prettier config says otherwise. [22]
- Prefer `// eslint-disable-next-line <rule>` on the line above over the trailing `// eslint-disable-line` form, because Prettier can move end-of-line comments. [6]

### Naming
- Use `camelCase` for variables, functions, parameters and properties; the rule's defaults also let variables be `UPPER_CASE`. [5]
- Use `PascalCase` for classes, interfaces, enums, type aliases and type parameters. [5]
- For function components, consider allowing both `camelCase` and `PascalCase` function names in the naming rule. [5]
- Enforce naming with `@typescript-eslint/naming-convention` in `eslint.config.mjs`. [5]

### Language and API usage
- Prefer `unknown` to `any`, and enable `@typescript-eslint/no-explicit-any` (part of the `recommended` preset). [3]
- Avoid the postfix `!` non-null assertion; restructure so the type shows the value is present, or use optional chaining with a fallback (`no-non-null-assertion`, in the `strict` preset). [16]
- Declare with `const`; use `let` only for bindings that are reassigned (`prefer-const`). [10]
- Do not use `var`; `let` and `const` are block scoped, which avoids silently overriding an outer variable (`no-var`). [11]
- Compare with `===` and `!==` only, because `==` and `!=` coerce their operands (`eqeqeq`). [8]
- Write `import type { X }` for imports used only as types, so a transpiler can remove them without type information (`consistent-type-imports`). [15]
- Set the `"type"` field in `package.json` explicitly; a `.mjs` file is always an ES module and a `.cjs` file is always CommonJS, whatever the field says. [19]
- Declare a package's entry points in `package.json` `"exports"`; once it is defined, subpaths that are not listed are unavailable to importers. [19]

### Errors, logging and nulls
- Handle every promise: `await` it, `return` it, attach `.catch()`, or mark it deliberately with `void` (`no-floating-promises`). [4]
- Do not rely on `void` to deal with a rejection that matters; it only silences the rule and the rejection is still unhandled. [4]
- Do not pass an async function where a void-returning callback is expected (`forEach(async ...)`, async event handlers) and do not use a promise as a condition (`no-misused-promises`). [18]
- Combine an array of promises with `Promise.all` (or `allSettled`, `any`, `race`) and await the result, instead of leaving them unhandled. [4]
- Throw only `Error` objects or subclasses, never strings or plain objects (`only-throw-error`). [17]
- In `catch`, treat the caught value as `unknown` and narrow it (`instanceof Error`) before reading its fields. [1]

### Testing
- With the built-in `node:test` runner (`node --test`), name files `*.test.mjs` or `*.test.ts` so discovery finds them; TypeScript discovery is off under `--no-strip-types`. [12]
- Prefer the strict assertion methods `assert.strictEqual` and `assert.deepStrictEqual`; the docs mark `equal` and `deepEqual` as legacy. [21]
- Mark async tests `async` and `await` every `t.test()` subtest; subtests still running when the parent finishes are cancelled and count as failures. [12]
- Mock through `t.mock` (functions, methods, timers) so the runner restores them when the test ends; advance mocked timers with `tick()`. [12]
- Pass a string to `skip` or `todo` (`{ skip: 'why' }`) to say why the test is not running. [12]

### Security
- Never run untrusted input through `eval()`; it opens the program to injection attacks (`no-eval`). [9]
- Run child processes with `execFile` or `spawn` and an argument array, leaving the `shell` option off; with `exec` or a shell enabled, crafted input with shell metacharacters can run extra commands. [20]
- Validate untrusted JSON with a schema and do not recursively merge it into shared objects (prototype pollution). [13]
- Check keys with `Object.hasOwn(obj, key)` and create lookup objects without a prototype using `Object.create(null)`. [13]
- Compare secrets with `crypto.timingSafeEqual`, a constant-time comparison. [13]
- Use a lockfile and install with `npm ci`, which fails when the lockfile and `package.json` disagree. [13]
- Run `npm audit` in CI with an explicit threshold such as `--audit-level=high`; it exits non-zero at or above that severity. [14]
- Check dependency names for typos (typosquatting) and consider `--ignore-scripts` to stop install scripts from running. [13]
- Set `headersTimeout`, `requestTimeout` and `keepAliveTimeout` on `http.Server`, and attach socket error handlers. [13]

### Review checklist
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

### Sources

1. https://www.typescriptlang.org/tsconfig/
2. https://typescript-eslint.io/getting-started/
3. https://typescript-eslint.io/rules/no-explicit-any/
4. https://typescript-eslint.io/rules/no-floating-promises/
5. https://typescript-eslint.io/rules/naming-convention/
6. https://prettier.io/docs/rationale
7. https://prettier.io/docs/integrating-with-linters
8. https://eslint.org/docs/latest/rules/eqeqeq
9. https://eslint.org/docs/latest/rules/no-eval
10. https://eslint.org/docs/latest/rules/prefer-const
11. https://eslint.org/docs/latest/rules/no-var
12. https://nodejs.org/api/test.html
13. https://nodejs.org/en/learn/getting-started/security-best-practices
14. https://docs.npmjs.com/cli/v10/commands/npm-audit
15. https://typescript-eslint.io/rules/consistent-type-imports/
16. https://typescript-eslint.io/rules/no-non-null-assertion/
17. https://typescript-eslint.io/rules/only-throw-error/
18. https://typescript-eslint.io/rules/no-misused-promises/
19. https://nodejs.org/api/packages.html
20. https://nodejs.org/api/child_process.html
21. https://nodejs.org/api/assert.html
22. https://prettier.io/docs/options

Reviewed 2026-11-18.
