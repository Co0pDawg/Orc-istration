---
id: powershell
title: PowerShell
kind: language
detect:
  - "*.ps1"
  - "*.psm1"
  - "*.psd1"
requires: []
reviewed: 2026-11-18
sources:
  - https://learn.microsoft.com/en-us/powershell/scripting/developer/cmdlet/approved-verbs-for-windows-powershell-commands
  - https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/overview
  - https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/rules-recommendations
  - https://learn.microsoft.com/en-us/powershell/scripting/learn/ps101/09-functions
  - https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/set-strictmode
  - https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_preference_variables
  - https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_functions_cmdletbindingattribute
  - https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/invoke-expression
  - https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/using-scriptanalyzer
  - https://learn.microsoft.com/en-us/powershell/scripting/whats-new/differences-from-windows-powershell
  - https://pester.dev/docs/quick-start
  - https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding
---

# PowerShell

Rules for PowerShell scripts, modules and manifests. PSScriptAnalyzer enforces most of the mechanical rules; Pester covers behavior. Notes marked "(5.1)" or "(7+)" concern Windows PowerShell 5.1 versus PowerShell 7.

## Tooling and formatting
- Use PSScriptAnalyzer, the static checker for scripts and modules, over the whole project with `Invoke-ScriptAnalyzer -Path . -Recurse`, and use its `Severity` setting to choose which levels (such as Error and Warning) are reported. [2][9]
- Keep rule choices in a `PSScriptAnalyzerSettings.psd1` at the repo root, which the analyzer finds when given the project root. [9]
- Suppress a rule with `SuppressMessageAttribute`, use its `Scope` and `Target` to limit the suppression, and record the reason in `Justification`. [9]
- Run the compatibility rules (`PSUseCompatibleSyntax`, `PSUseCompatibleCommands`) when a script must run on more than one PowerShell version. [9]
- Indent code consistently and avoid backtick line continuation. [3]
- State in the script's documentation which PowerShell version it targets. [3]

## Naming
- Name each function `Verb-Noun`, capitalizing every word, with the verb taken from `Get-Verb` and a singular noun. [1][4]
- Never use a synonym of an approved verb (`Remove`, not `Delete`), and avoid the reserved verbs `ForEach`, `Ping`, `Sort`, `Tee` and `Where`. [1]
- Put a short prefix at the start of the noun (`Get-AcmeConfig`) so your names are unlikely to collide with commands that ship or are written later. [4]
- Reuse the standard parameter names and casing (`ComputerName`, not `Computer` or `Server`). [4]

## Language and API usage
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

## Errors, logging and nulls
- Use `-ErrorAction Stop` on cmdlet calls inside `try`/`catch`, because only terminating errors are caught. [3][4]
- For calls that are not cmdlets, such as .NET methods, set `$ErrorActionPreference` to `Stop`, since `-ErrorAction` cannot be passed. [3][4]
- Avoid changing `$ErrorActionPreference` globally; a change made in a local scope reverts when that scope exits. [4][6]
- Do not leave a `catch` block empty. [3]
- Do not use `$?` or a null check as the way to detect failure. [3]
- (7+) On versions that have `$PSNativeCommandUseErrorActionPreference`, a native command's non-zero exit code raises no error by default (the variable defaults to `$false`); set it to `$true` or check `$LASTEXITCODE` after the call. [6]
- Copy `$Error[0]`, the most recent error, into your own variable before handling it. [3]

## Testing
- Write Pester tests in `*.Tests.ps1` files, grouped with `Describe` and `Context`, with each check in an `It` block that uses `Should`. [11]
- Put shared setup in `BeforeAll`, and use Pester's mocking (`Mock`) for dependencies. [11]
- Run the suite with `Invoke-Pester` from the CI build script; Pester can write test-result and code-coverage files for CI reporting. [11]
- Add comment-based help (`.SYNOPSIS`, `.PARAMETER`, `.EXAMPLE`) to every exported function. [3][4]

## Security
- Avoid `Invoke-Expression` on user-supplied input: verify a command is safe before running it, prefer predefined input options, and use the call operator `&` to run commands, which is the safer route. [3][8]
- Take credentials as a `[PSCredential]` parameter rather than separate `-Username` and `-Password` parameters, and avoid plain-text passwords. [3]
- Avoid `ConvertTo-SecureString` on plain-text input, and avoid assigning a password to a variable as a string literal (`$Password = 'string'`). [3]
- Do not initialize variables that hold API keys or credentials in a script, and do not hardcode a `-ComputerName` argument. [3]

## Review checklist
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
