---
id: aspnet-core
title: ASP.NET Core
kind: framework
detect:
  - "appsettings.json"
  - "launchSettings.json"
requires:
  - csharp
reviewed: 2026-11-18
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/fundamentals/dependency-injection
  - https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/options
  - https://learn.microsoft.com/en-us/aspnet/core/security/app-secrets
  - https://learn.microsoft.com/en-us/dotnet/core/extensions/logging/overview
  - https://learn.microsoft.com/en-us/ef/core/querying/sql-queries
  - https://learn.microsoft.com/en-us/ef/core/performance/efficient-querying
  - https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/applying
  - https://learn.microsoft.com/en-us/aspnet/core/mvc/models/validation
  - https://learn.microsoft.com/en-us/aspnet/core/security/authorization/simple
  - https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery
  - https://learn.microsoft.com/en-us/aspnet/core/security/enforcing-ssl
  - https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling
  - https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests
  - https://cheatsheetseries.owasp.org/cheatsheets/DotNet_Security_Cheat_Sheet.html
---

# ASP.NET Core

Conventions for ASP.NET Core web apps and APIs, on top of the `csharp` standards. The built-in analyzers (CA2254 for log templates), the options validator and `dotnet ef` enforce the mechanical parts.

## Tooling and formatting
- Group related registrations in one `Add{Feature}` extension method, placed in the `Microsoft.Extensions.DependencyInjection` namespace. [1]
- Keep integration tests in a project separate from unit tests, with its own test configuration; never point them at production resources. [13]
- Run `dotnet ef migrations has-pending-model-changes` in CI; on EF Core 9 and later `Migrate` throws when the model has drifted from the last migration. [7]
- Read every generated migration before applying it; a rename can be scaffolded as a drop plus add. [7]
- Deploy schema changes with a migration bundle (`dotnet ef migrations bundle`) or a reviewed `dotnet ef migrations script --idempotent`; use `dotnet ef database update` for local work only. [7]
- Run migrations as a single deployment step, not from every replica's startup, and never call `EnsureCreatedAsync` before `MigrateAsync`. [7]
- Run the migration step under a schema-changing identity; the app's runtime identity gets only the data permissions it needs. [7]

## Naming
- Give each options class a constant holding its configuration-section name (not bound itself) and bind with `GetSection`. [2]
- Obtain loggers as `ILogger<T>` so the category is the fully qualified class name. [4]

## Language and API usage
- Take dependencies as constructor or method parameters; do not call `GetService` or `RequestServices` in your own code (service locator). [1]
- Do not read `IHttpContextAccessor.HttpContext` statically; avoid stateful static classes and use singleton services instead. [1]
- Choose lifetimes deliberately: a service must not hold a dependency with a shorter lifetime (no scoped service in a singleton). [1]
- Inject scoped services into middleware through `InvokeAsync` parameters, not the constructor, or use factory-based middleware. [1]
- Leave `AddDbContext` at its scoped default unless you have a reason; never keep a `DbContext` in a longer-lived service. [1]
- Never dispose a service the container resolved; you own and dispose only instances you registered pre-built. [1]
- Bind configuration to typed options classes and inject `IOptions<T>` (fixed), `IOptionsSnapshot<T>` (scoped, per-request reload) or `IOptionsMonitor<T>` (singleton, change events). [2]
- Do not inject `IOptionsSnapshot<T>` into a singleton, and do not read options inside `ConfigureServices`. [2]
- Add validation (`DataAnnotations` or `IValidateOptions<T>`) and call `ValidateOnStart()` so invalid configuration fails at startup. [2]
- Load related data with `Include` or a `Select` projection, never by lazy loading, which turns loops into N+1 queries. [6]
- Project only the columns you need, and use `AsNoTracking()` for read-only queries. [6]
- Bound every list query with `Take` or pagination; prefer keyset pagination to `Skip`/`Take` for large tables. [6]
- Use `ToListAsync`, `SaveChangesAsync` and the other async EF APIs, and do not mix sync and async calls. [6]
- Avoid `ToList()` before further LINQ operators; use `AsEnumerable()` to avoid buffering the whole result. [6]
- Treat raw SQL as a last resort, used only when EF cannot generate the query you need and the gain justifies the upkeep. [6]
- Write raw SQL with `FromSql`, `FromSqlInterpolated`, `SqlQuery` or `ExecuteSql`, which send interpolated values as parameters. [5]
- Use `FromSqlRaw` or `ExecuteSqlRaw` only with constant text; map any dynamic column or table name to a fixed allowlist. [5]
- Order the pipeline: `UseExceptionHandler` and `UseHsts` (non-Development), `UseHttpsRedirection`, routing, authentication, authorization, `UseAntiforgery`. [10][11][12]
- Behind a reverse proxy, run forwarded-headers middleware before HTTPS redirection to avoid redirect loops. [11]

## Errors, logging and nulls
- Log with named message templates (`"Order {OrderId} failed"`), never interpolated strings; CA2254 flags non-static templates. [4]
- Pass template arguments in placeholder order (matching is positional, not by name). [4]
- Pass the exception as the first argument (`LogError(ex, "...")`), not inside the message text. [4]
- Prefer `[LoggerMessage]` source-generated methods over `LogInformation` calls on hot paths. [4]
- Use `Information` for normal flow, `Warning` for abnormal-but-handled events, `Error` for failed requests; keep `Trace` and `Debug` off in production. [4]
- Do not log secrets or personal data; `Trace` output can contain sensitive values. [4]
- Enable the Developer Exception Page only in `Development`; use `UseExceptionHandler` elsewhere. [12]
- Return structured errors with `AddProblemDetails()` plus `UseExceptionHandler()`; map known exception types in an `IExceptionHandler`. [12]
- Return `true` from `IExceptionHandler.TryHandleAsync` only after writing a complete response, including the status code. [12]
- On `[ApiController]` types rely on the automatic 400; elsewhere check `ModelState.IsValid` before acting on input. [8]
- Validate on the server with attributes on input models; client-side validation is a convenience, not a control. [8]
- Mark optional input `string?`; with nullable enabled a non-nullable reference property is treated as required. [8]
- Restrict which properties can bind (a dedicated input model or a `[Bind]` allowlist). [8]

## Testing
- Host the app with `WebApplicationFactory<Program>` from `Microsoft.AspNetCore.Mvc.Testing`, shared per class through `IClassFixture`. [13]
- Replace services per test with `WithWebHostBuilder` and `ConfigureTestServices`, so overrides do not leak between tests. [13]
- Fake authentication with a test `AuthenticationHandler` whose scheme name matches the app's scheme. [13]
- Use SQLite in-memory (connection kept open) instead of the EF in-memory provider, and seed data per test, since tests run in any order. [13]
- Set `AllowAutoRedirect = false` on the client when asserting redirects such as an unauthenticated challenge. [13]
- Cover key infrastructure scenarios with integration tests; leave per-permutation logic to unit tests. [13]

## Security
- Never put secrets in source or `appsettings.json`; use `dotnet user-secrets` in development and a managed secret store or environment variables in production. [3][14]
- Treat user secrets as unencrypted and development-only; do not read the secrets file directly. [3]
- Do not embed a password in a connection string in config; inject it from a secret at runtime. [3]
- Use `__` (double underscore) as the hierarchy separator in environment-variable names so it works on every platform. [3]
- Protect controllers and pages with `[Authorize]`, opt out per action with `[AllowAnonymous]`, and use `Roles` or `Policy` for finer rules. [9]
- Endpoints without authorization metadata are open; set a fallback policy when most of the app should require sign-in. [9]
- Protect cookie-authenticated, state-changing endpoints with antiforgery: a global `[AutoValidateAntiforgeryToken]` filter (`AddControllersWithViews`, not `AddControllers`). [10]
- In Minimal APIs call `AddAntiforgery()` and `UseAntiforgery()` after auth; the middleware covers only POST, PUT and PATCH, so validate DELETE explicitly. [10]
- Call `.DisableAntiforgery()` only on endpoints that are not browser-reachable or use non-cookie auth; never change state on GET. [10]
- Set `SameSite` on auth cookies as defense in depth, and `Cookie.SecurePolicy = Always`. [10][14]
- Call `UseHttpsRedirection`, and `UseHsts` only outside `Development`; web APIs should not listen on HTTP or should answer 400 rather than redirect. [11]
- Start HSTS with a short `MaxAge`, add `IncludeSubDomains` only once every subdomain serves HTTPS, and treat `Preload` as hard to reverse. [11]
- Do not pass untrusted content to `Html.Raw` or `HtmlString`; HTML encoding does not protect JavaScript, CSS or URL contexts. [14]
- Hash passwords with `PasswordHasher<TUser>` rather than calling key-derivation functions directly. [14]

## Review checklist
- [ ] No secret, key or password literal in the diff, `appsettings*.json` or a connection string. [3]
- [ ] No scoped service captured by a singleton, no `GetService` or `RequestServices` lookups, no static `HttpContext`. [1]
- [ ] New settings are typed options with validation and `ValidateOnStart()`. [2]
- [ ] Log calls use named templates, pass the exception as the exception argument, and omit sensitive values. [4]
- [ ] No raw SQL built from user input; `FromSqlRaw`/`ExecuteSqlRaw` take constant text only. [5]
- [ ] New EF queries project or `Include` what they need, have a result bound, and avoid lazy loading and N+1. [6]
- [ ] Schema changes include a reviewed migration, and `has-pending-model-changes` is clean. [7]
- [ ] New endpoints carry `[Authorize]` or an explicit `[AllowAnonymous]`; input is validated server-side. [8][9]
- [ ] State-changing cookie-authenticated endpoints validate antiforgery tokens and never use GET. [10]
- [ ] Pipeline order keeps exception handling, HTTPS, authentication, authorization and antiforgery in sequence; Developer Exception Page is Development-only. [11][12]
- [ ] New behavior has a `WebApplicationFactory` test using test services, not production resources. [13]
