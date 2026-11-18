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
  - https://learn.microsoft.com/en-us/aspnet/core/mvc/models/model-binding
  - https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/guidelines
---

# ASP.NET Core

Conventions for ASP.NET Core web apps and APIs, on top of the `csharp` standards. The built-in analyzers (CA2254 for log templates), the options validator and `dotnet ef` enforce the mechanical parts.

## Tooling and formatting
- Group related registrations in one `Add{Feature}` extension method, placed in the `Microsoft.Extensions.DependencyInjection` namespace. [1]
- Keep integration tests in a project separate from the unit tests. [13]
- Run `dotnet ef migrations has-pending-model-changes` in CI; on EF Core 9 and later `Migrate` throws when the model has drifted from the last migration. [7]
- Read every generated migration before applying it; a rename can be scaffolded as a drop plus add. [7]
- Deploy schema changes with a migration bundle (`dotnet ef migrations bundle`) or a reviewed `dotnet ef migrations script` (add `--idempotent` when target databases may sit at different migrations); use `dotnet ef database update` for local work. [7]
- Prefer one separate migration step in the deployment over migrating from every replica's startup, and never call `EnsureCreatedAsync` before `MigrateAsync`. [7]
- Run the migration step under a schema-changing identity; the app's runtime identity normally needs only data permissions. [7]

## Naming
- Give each options class a constant holding its configuration-section name (not bound itself) and bind with `GetSection`. [2]
- Obtain loggers as `ILogger<T>` so the category is the fully qualified class name. [4]

## Language and API usage
- Request dependencies as constructor parameters, and avoid calling `GetService` to look them up (service locator); prefer constructor injection over `RequestServices`. [1]
- Avoid static access to `IHttpContextAccessor.HttpContext`; avoid stateful static classes and use singleton services instead. [1]
- Never let a longer-lived service hold a shorter-lived one (a singleton must not capture a scoped service), and enable scope validation to catch it. [16]
- Inject scoped services into middleware through `InvokeAsync` parameters, not the constructor, or use factory-based middleware. [1]
- Keep the default scoped lifetime of `AddDbContext`, and do not inject a `DbContext` into a service that outlives a request. [1]
- Leave disposal of container-created services to the container; dispose only objects you created yourself and registered pre-built. [1]
- Bind configuration to typed options classes and inject `IOptions<T>` (fixed), `IOptionsSnapshot<T>` (scoped, per-request reload) or `IOptionsMonitor<T>` (singleton, change events). [2]
- Do not inject `IOptionsSnapshot<T>` into a singleton, and do not use `IOptions<T>` or `IOptionsMonitor<T>` in `Startup.ConfigureServices`. [2]
- Add validation (`DataAnnotations` or `IValidateOptions<T>`) and call `ValidateOnStart()` so options are validated when the app starts. [2]
- Avoid lazy loading, which makes N+1 queries easy to trigger; load related data with `Include` or a `Select` projection. [6]
- Project only the columns you need, and use `AsNoTracking()` for read-only queries. [6]
- Limit how many rows a list query returns with `Take` or pagination; for large tables consider keyset pagination, since `Skip`/`Take` is inefficient. [6]
- Use `ToListAsync`, `SaveChangesAsync` and the other async EF APIs, and do not mix sync and async calls. [6]
- Do not call `ToList()` or `ToArray()` only to apply further LINQ operators, which buffers every row; use `AsEnumerable()`. [6]
- Reach for raw SQL last: only when EF cannot produce the query you need and the gain outweighs the maintenance cost. [6]
- Write raw SQL with `FromSql`, `FromSqlInterpolated`, `SqlQuery` or `ExecuteSql`, which send interpolated values as parameters. [5]
- Never concatenate untrusted values into text passed to `FromSqlRaw` or `ExecuteSqlRaw`; parameters cannot stand for column or table names, so map any dynamic identifier to a fixed allowlist. [5][14]
- Call `UseHsts` before `UseHttpsRedirection`, and add `UseAntiforgery` after authentication and authorization. [10][11]
- Behind a reverse proxy, run forwarded-headers middleware before HTTPS redirection to avoid redirect loops. [11]
- Guard against overposting by binding to a dedicated view or input model; `[Bind]` suits create scenarios but works poorly for edits. [15]

## Errors, logging and nulls
- Prefer named message templates (`"Order {OrderId} failed"`) to string interpolation, which can hurt performance; CA2254 flags non-static templates. [4]
- Pass template arguments in placeholder order (matching is positional, not by name). [4]
- Log a caught exception through the logger overloads that take an exception parameter. [4]
- Prefer `[LoggerMessage]` source-generated methods to the `LogInformation`-style extension methods; they perform better and are strongly typed. [4]
- Use `Information` for the general flow, `Warning` for abnormal or unexpected events, and `Error` for a failed operation or request; keep `Trace` off in production and use `Debug` there with caution. [4]
- Treat `Trace` output as possibly containing sensitive application data. [4]
- Enable the Developer Exception Page only in `Development`; use `UseExceptionHandler` elsewhere. [12]
- Return structured errors with `AddProblemDetails()` plus `UseExceptionHandler()`; map known exception types in an `IExceptionHandler`. [12]
- Return `true` from `IExceptionHandler.TryHandleAsync` only once the handler has set the status code and written the whole response; otherwise the client gets a 404. [12]
- On `[ApiController]` types rely on the automatic 400; elsewhere check `ModelState.IsValid` before acting on input. [8]
- Always validate on the server with attributes on input models; client-side checks do not run when JavaScript is disabled. [8]
- Mark optional input `string?`; with nullable enabled a non-nullable reference property is treated as required. [8]

## Testing
- Host the app with `WebApplicationFactory<Program>` from `Microsoft.AspNetCore.Mvc.Testing`, shared per class through `IClassFixture`. [13]
- Replace services per test with `WithWebHostBuilder` and `ConfigureTestServices`, so overrides do not leak between tests. [13]
- Fake authentication with a test `AuthenticationHandler` whose scheme name matches the app's scheme. [13]
- Use SQLite in-memory (connection kept open) instead of the EF in-memory provider, and reseed data in a test that needs specific rows, since another test may already have deleted them. [13]
- Set `AllowAutoRedirect = false` on the client when asserting redirects such as an unauthenticated challenge. [13]
- Cover key infrastructure scenarios with integration tests; leave per-permutation logic to unit tests. [13]

## Security
- Never put secrets in source or `appsettings.json`; use `dotnet user-secrets` in development and a managed secret store in production. [3][14]
- User secrets are stored unencrypted and are for development only; do not write code that depends on where or how the secrets file keeps them. [3]
- Do not embed a password in a connection string in config; inject it from a secret at runtime. [3]
- Use `__` (double underscore) as the hierarchy separator in environment-variable names so it works on every platform. [3]
- Protect controllers and pages with `[Authorize]`, opt out per action with `[AllowAnonymous]`, and use `Roles` or `Policy` for finer rules. [9]
- Endpoints without authorization metadata are open; set a fallback policy when most of the app should require sign-in. [9]
- Protect cookie-authenticated, state-changing endpoints with antiforgery; in views-based apps use a global `[AutoValidateAntiforgeryToken]` filter (`AddControllersWithViews`, not `AddControllers`). [10]
- In Minimal APIs call `AddAntiforgery()` and `UseAntiforgery()` after auth; the middleware covers only POST, PUT and PATCH, so validate DELETE explicitly. [10]
- Call `.DisableAntiforgery()` only on endpoints that are not browser-reachable or use non-cookie auth; never change state on GET. [10]
- Set `SameSite` on auth cookies as defense in depth next to antiforgery, and set `Cookie.SecurePolicy = Always`. [10][14]
- Call `UseHttpsRedirection`, and `UseHsts` only outside `Development`, unless a reverse proxy already does both; web APIs should either not listen on HTTP or reject plain-HTTP requests with a 400 rather than redirect. [11]
- Start HSTS with a small `MaxAge` (hours to a day) and raise it once HTTPS is proven stable; `IncludeSubDomains` applies the policy to every subdomain. [11]
- Do not pass untrusted content to `Html.Raw` or `HtmlString`; HTML encoding does not protect JavaScript, CSS or URL contexts. [14]
- Hash passwords with `PasswordHasher<TUser>` rather than calling key-derivation functions directly. [14]

## Review checklist
- [ ] No secret, key or password literal in the diff, `appsettings*.json` or a connection string.
- [ ] No scoped service captured by a singleton, no `GetService` lookups, no static `HttpContext`.
- [ ] New settings are typed options with validation and `ValidateOnStart()`.
- [ ] Log calls use named templates, log caught exceptions through the exception overload, and nothing turns on `Trace` in production.
- [ ] No untrusted value is concatenated into `FromSqlRaw`/`ExecuteSqlRaw` text; dynamic identifiers come from a fixed allowlist.
- [ ] New EF queries project or `Include` what they need, limit the rows returned, and avoid lazy loading and N+1.
- [ ] Schema changes include a reviewed migration, and `has-pending-model-changes` is clean.
- [ ] New endpoints carry `[Authorize]` or an explicit `[AllowAnonymous]`; input is validated server-side and bound to an input model.
- [ ] State-changing cookie-authenticated endpoints validate antiforgery tokens and never use GET.
- [ ] `UseHsts` precedes `UseHttpsRedirection`, `UseAntiforgery` follows authentication and authorization, and the Developer Exception Page is Development-only.
- [ ] New behavior has a `WebApplicationFactory` test that replaces services through `ConfigureTestServices`.
