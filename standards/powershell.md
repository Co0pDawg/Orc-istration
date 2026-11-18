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
---

# PowerShell

Rules for PowerShell scripts, modules and manifests. PSScriptAnalyzer enforces most of the mechanical rules; Pester covers behavior. Notes marked "(5.1)" or "(7+)" concern Windows PowerShell 5.1 versus PowerShell 7.

## Tooling and formatting
- Run `Invoke-ScriptAnalyzer -Path . -Recurse` in CI and fix every Error and Warning finding. [2][9]
- Keep rule choices in a `PSScriptAnalyzerSettings.psd1` at the repo root, which the analyzer finds when given the project root. [9]
- Suppress a finding only with `SuppressMessageAttribute` on the smallest scope, with a `Justification`. [9]
- Run the compatibility rules (`PSUseCompatibleSyntax`, `PSUseCompatibleCommands`) when a script must run on more than one PowerShell version. [9]
- Indent code consistently and avoid backtick line continuation. [3]
- Document the PowerShell version a script was written for, in its help or header. [3]

## Naming
- Name functions and cmdlets `Verb-Noun` in PascalCase with an approved verb from `Get-Verb`, and a singular noun. [1][4]
- Do not use a synonym of an approved verb (use `Remove`, not `Delete`) or the reserved verbs `ForEach`, `Ping`, `Sort`, `Tee`, `Where`. [1]
- Prefix the noun (`Get-AcmeConfig`) in shared modules to avoid clashes with commands added later. [4]
- Reuse the standard parameter names and casing (`ComputerName`, not `Computer` or `Server`). [4]

## Language and API usage
- Start every script with `Set-StrictMode -Version 3.0` (or the newest version you have tested); it turns uninitialized variables, missing properties and bad indexes into errors. [5]
- Prefer a pinned version over `-Version Latest`, whose rules can tighten in newer releases. [5]
- Write functions as advanced functions: add `[CmdletBinding()]` and a `param()` block. [4][7]
- Give every parameter a type, mark required ones `[Parameter(Mandatory)]`, and validate with attributes such as `[ValidateNotNullOrEmpty()]`. [4]
- Do not give a mandatory parameter a default value; use a validation attribute with a default for optional ones. [4]
- Do not hardcode values that belong in parameters, such as host names or paths. [4]
- Do not use aliases (`gci`, `%`, `?`, `iex`) or positional parameters in saved code; spell out cmdlets and name parameters. [3][4]
- Any function that changes state (verbs `Set`, `New`, `Remove`, `Update` and similar) needs `[CmdletBinding(SupportsShouldProcess)]` and a `$PSCmdlet.ShouldProcess(...)` guard before the change. [3][7]
- Set `ConfirmImpact` only together with `SupportsShouldProcess`; it decides whether the prompt appears. [7]
- Do not default a `[switch]` parameter to `$true`. [3]
- Avoid global variables and unused assigned variables. [3]
- Return objects, not formatted text; use `Write-Output` or plain output for data and `Write-Verbose` for diagnostics instead of inline comments about progress. [4]
- Do not use `Write-Host` for data or logging; reserve it for output meant only for a person. [3]
- Accept pipeline input with `ValueFromPipeline` and process it in a `process` block. [4]
- (5.1 vs 7+) Do not use `??`, `??=`, `?.` or ternary syntax in scripts that must still run on Windows PowerShell 5.1. [10]
- (5.1 vs 7+) Do not rely on modules or cmdlets absent from PowerShell 7 (for example the `*-Transaction` and `*-EventLog` cmdlets) in cross-version scripts. [10]
- (5.1 vs 7+) Call `pwsh` for PowerShell 7 and `powershell.exe` for 5.1; the two can be installed side by side. [10]
- (5.1 vs 7+) Set text encoding explicitly on `Out-File`, `Set-Content` and similar; the defaults differ between versions. [10]

## Errors, logging and nulls
- Use `-ErrorAction Stop` on cmdlet calls inside `try`/`catch`, because only terminating errors are caught. [4]
- Set `$ErrorActionPreference = 'Stop'` for calls that are not cmdlets, such as .NET methods, where `-ErrorAction` cannot be passed. [3][4]
- Change `$ErrorActionPreference` only in the script or function scope, never globally; a local change reverts when the scope exits. [4]
- Do not leave a `catch` block empty. [3]
- Do not use `$?` or null checks as the way to detect failure. [3]
- (7+) A native command's non-zero exit code raises no error by default; set `$PSNativeCommandUseErrorActionPreference = $true` (7.4 and later) or check `$LASTEXITCODE` after each call. [6]
- Copy the most recent entry of `$Error` into your own variable before handling it. [3]

## Testing
- Write Pester tests in `*.Tests.ps1` files, grouped with `Describe` and `Context`, with each check in an `It` block that uses `Should`. [11]
- Use `BeforeAll` to load the code under test, and `Mock` to replace commands that touch the system. [11]
- Run `Invoke-Pester` in CI alongside the analyzer, and fail the build on either. [2][11]
- Add comment-based help (`.SYNOPSIS`, `.PARAMETER`, `.EXAMPLE`) to every exported function. [3][4]

## Security
- Never pass untrusted input to `Invoke-Expression`; design scripts around predefined options, and use the call operator `&` when you need to run a command. [3][8]
- Accept credentials as `[PSCredential]` and secrets as `[SecureString]`; do not take `-Username` and `-Password` string parameters. [3]
- Do not use `ConvertTo-SecureString -AsPlainText` on literals, or assign a password to a plain string variable. [3]
- Do not hardcode API keys or credentials in a script, and do not hardcode `-ComputerName` values. [3]

## Review checklist
- [ ] `Invoke-ScriptAnalyzer` reports no Error or Warning findings for the changed files, and any suppression has a justification. [2][9]
- [ ] Every function is named `Verb-Noun` with an approved verb and a singular noun. [1]
- [ ] Scripts call `Set-StrictMode` and set `$ErrorActionPreference = 'Stop'` (or use `-ErrorAction Stop`). [4][5]
- [ ] Functions use `[CmdletBinding()]`, typed and validated parameters, and no aliases or positional arguments. [3][4]
- [ ] State-changing functions declare `SupportsShouldProcess` and call `ShouldProcess` before acting. [7]
- [ ] No `Invoke-Expression` on input, and no plain-text passwords or `-Password` string parameters. [3][8]
- [ ] No empty `catch` blocks and no `Write-Host` used for data. [3]
- [ ] New logic has a Pester test, and tests pass. [11]
- [ ] Syntax and cmdlets suit every PowerShell version the script claims to support. [10]
- [ ] Exported functions have comment-based help with at least one example. [3][4]
