---
id: csharp
title: C# and .NET
kind: language
detect:
  - "*.csproj"
  - "*.sln"
  - "*.slnx"
  - "global.json"
  - "Directory.Build.props"
requires: []
reviewed: 2026-11-18
sources:
  - https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/coding-style/coding-conventions
  - https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/capitalization-conventions
  - https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/names-of-classes-structs-and-interfaces
  - https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/null-safety/nullable-reference-types
  - https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/async-scenarios
  - https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/overview
  - https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-format
  - https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions
  - https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/implementing-dispose
  - https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-best-practices
  - https://learn.microsoft.com/en-us/dotnet/standard/security/secure-coding-guidelines
  - https://cheatsheetseries.owasp.org/cheatsheets/DotNet_Security_Cheat_Sheet.html
  - https://learn.microsoft.com/en-us/dotnet/core/project-sdk/msbuild-props
---

# C# and .NET

Conventions for C# on current .NET. The compiler, the built-in Roslyn analyzers and `dotnet format` (driven by `.editorconfig`) enforce the mechanical parts.

## Tooling and formatting
- Keep one `.editorconfig` at the repo root as the single source of style, and let tools apply it instead of formatting by hand. [1][7]
- Run `dotnet format --verify-no-changes` in CI; it exits non-zero when any file would be reformatted. [7]
- Limit a format run with the `whitespace`, `style` or `analyzers` subcommand when only one kind of change is wanted. [7]
- Layout default, unless the repo's `.editorconfig` says otherwise: 4-space indent (no tabs), Allman braces, one statement and one declaration per line. [1]
- Set `<EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>` and give each `IDExxxx` rule a severity in `.editorconfig`; otherwise style rules do not run on command-line builds. [6][13]
- Raise analysis with `<AnalysisMode>Recommended</AnalysisMode>`, and pin `AnalysisLevel` to a version when a new SDK must not enable new rules by surprise. [6][13]
- Build in CI with `-warnaserror` so analyzer warnings fail the build. [6]
- Change a rule's severity in `.editorconfig` (`dotnet_diagnostic.<ID>.severity`) rather than switching analyzers off wholesale. [6]
- Put `using` directives outside the namespace and use file-scoped namespaces (`namespace X;`). [1]
- Centralize NuGet versions in `Directory.Packages.props` with `ManagePackageVersionsCentrally`, so projects omit `Version`. [13]

## Naming
- Use `PascalCase` for namespaces, types, methods, properties, events, fields and enum values; `camelCase` for parameters. [2]
- Do not use underscores to separate words in public identifiers, and do not make two names differ by case alone. [2]
- Prefix interfaces with `I`, never prefix classes, and name classes and structs with nouns. [3]
- Suffix exceptions with `Exception`, attributes with `Attribute` and event args with `EventArgs`; never suffix enums with `Enum` or `Flags`. [3]
- Name enums in the singular, except bit-flag enums, which are plural. [3]
- Prefix descriptive generic parameters with `T` (`TSession`); a lone `T` is fine for one self-evident parameter. [3]
- Give task-returning methods an `Async` suffix, except event handlers and controller actions. [5]
- Use `PascalCase` for primary-constructor parameters on records, `camelCase` on classes and structs. [1]

## Language and API usage
- Use language keywords (`string`, `int`) instead of runtime type names, and `int` instead of unsigned types. [1]
- Use `var` only when the type is evident on the right (`new`, a cast, a literal), and give `foreach` variables explicit types. [1]
- Use target-typed `new()`, object initializers, collection expressions (`[1, 2]`) and `required` members rather than assigning properties one by one. [1]
- Prefer interpolation to concatenation, `StringBuilder` for appends in loops, and raw string literals over escape-heavy strings. [1]
- Use `&&` and `||`, not `&` and `|`, for boolean conditions. [1]
- Use `Func<>` and `Action<>` instead of declaring new delegate types. [1]
- Put `where` first in a LINQ query, give query variables meaningful names, and rename ambiguous anonymous-type members. [1]
- Call `ToArray()` or `ToList()` on LINQ-created tasks before awaiting them, so they all start now rather than lazily. [5]
- Await I/O-bound work directly and reserve `Task.Run` for CPU-bound work; wait on several tasks with `await Task.WhenAll`. [5]
- Do not block on tasks with `.Result` or `.Wait()`; use `await`, `Task.WhenAll`/`WhenAny` and `Task.Delay` instead. [5]
- Block synchronously only where `await` is unavailable, and then prefer `GetAwaiter().GetResult()`. [5]
- Return `async void` only from event handlers; every other async method returns `Task`, `Task<T>` or `ValueTask`. [5]
- Prefer `using var x = ...;` over a `try/finally` whose only job is calling `Dispose`. [1][8]
- A class that creates and stores an `IDisposable` owns it and implements `IDisposable`; one that merely receives it does not. [9]
- Make `Dispose` safe to call twice, seal disposable classes not meant as bases, and wrap raw handles in `SafeHandle` instead of writing finalizers. [9]
- Call static members through their declaring type name. [1]

## Errors, logging and nulls
- Enable nullable reference types with `<Nullable>enable</Nullable>`; fix the warnings rather than suppress them. [4]
- Declare optional values `T?`, and make required ones non-nullable, set through a constructor or `required`. [4]
- Treat each `!` (null-forgiving) as needing a reason; prefer a null check, restructuring or a `[NotNullWhen]` annotation. [4]
- Check public-API arguments with `ArgumentNullException.ThrowIfNull` and the other `ThrowIf*` helpers (`CA1510` to `CA1513`). [8]
- Catch only exceptions you can handle, most-derived first; never catch bare `Exception` without a filter. [1][8]
- Rethrow with `throw;`, never `throw ex;`, to keep the stack trace (`CA2200`); to add context, wrap and pass the inner exception. [8]
- Throw predefined types (`ArgumentException`, `InvalidOperationException`); never throw `NullReferenceException` or `IndexOutOfRangeException`. [8]
- Use `Try*` methods (`TryParse`, `TryGetValue`) for expected failures instead of catching exceptions as control flow. [8]
- Catch `OperationCanceledException`, not `TaskCanceledException`, around async calls. [8]
- In a task-returning method, validate arguments before the first `await` so errors throw synchronously; never throw inside `finally`. [8]
- Custom exceptions end in `Exception` and provide the parameterless, message, and message-plus-inner constructors. [8]

## Testing
- Name tests `Method_Scenario_ExpectedBehavior` and structure each as Arrange, Act, Assert with a single Act. [10]
- Keep logic (`if`, loops, string building) out of tests; use `[Theory]` with `[InlineData]` for multiple inputs. [10]
- Keep unit tests off the file system, network and database; put such tests in a separate integration project. [10]
- Test private behavior through the public method, and replace statics such as `DateTime.Now` with an injected seam. [10]
- Use the simplest input that proves the behavior, and name constants rather than leaving magic values inline. [10]
- Prefer per-test helper methods over shared setup unless every test in the class needs identical initialization. [10]

## Security
- Do not use `BinaryFormatter`, Code Access Security, partial trust, `AllowPartiallyTrustedCaller` or .NET Remoting. [11][12]
- Deserialize untrusted data with `System.Text.Json` into your own types, then validate it. [12]
- Never concatenate user input into SQL; use parameterized APIs and map dynamic identifiers to an allowlist. [12]
- Keep secrets out of source and checked-in config; use a managed secret store outside development. [12]
- Hash passwords with the framework `PasswordHasher<TUser>`, not hand-rolled key derivation; never reuse an `AesGcm` nonce under one key. [12]
- Treat input from outside the process as hostile and validate it before use. [11]

## Review checklist
- [ ] `dotnet build -warnaserror` and `dotnet format --verify-no-changes` would pass; no new rule suppressions without a reason. [6][7]
- [ ] Nullable reference types stay enabled; any new `!` or `#pragma warning disable` is justified. [4]
- [ ] No new `.Result` or `.Wait()` on tasks and no `async void` outside event handlers. [5]
- [ ] Every `IDisposable` created is in `using` or owned by a disposable type. [9]
- [ ] No `catch (Exception)` without a filter or rethrow, and no `throw ex;`. [8]
- [ ] Public identifiers are `PascalCase`, new interfaces start with `I`, async methods end in `Async`. [2][3][5]
- [ ] New or changed behavior has a test named `Method_Scenario_Expected` with no logic and no real I/O. [10]
- [ ] No SQL built by concatenation, no `BinaryFormatter`, no secret literals in the diff. [12]
- [ ] Task collections built with LINQ are materialized before `Task.WhenAll`. [5]
- [ ] Argument checks use the `ThrowIf*` helpers and run before any `await`. [8]
