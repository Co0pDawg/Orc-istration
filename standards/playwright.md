---
id: playwright
title: Playwright end-to-end tests
kind: tool
detect:
  - "playwright.config.ts"
  - "playwright.config.js"
  - "playwright.config.mjs"
requires: []
reviewed: 2026-11-18
sources:
  - https://playwright.dev/docs/best-practices
  - https://playwright.dev/docs/locators
  - https://playwright.dev/docs/test-assertions
  - https://playwright.dev/docs/auth
  - https://playwright.dev/docs/trace-viewer-intro
  - https://playwright.dev/docs/test-parallel
  - https://playwright.dev/docs/ci
  - https://playwright.dev/docs/api/class-page
  - https://playwright.dev/docs/test-retries
  - https://playwright.dev/docs/api/class-testconfig
  - https://playwright.dev/dotnet/docs/test-runners
  - https://playwright.dev/dotnet/docs/trace-viewer-intro
  - https://playwright.dev/dotnet/docs/auth
  - https://playwright.dev/dotnet/docs/test-assertions
  - https://playwright.dev/dotnet/docs/locators
  - https://playwright.dev/dotnet/docs/writing-tests
  - https://playwright.dev/dotnet/docs/ci
  - https://playwright.dev/docs/actionability
---

# Playwright end-to-end tests

Rules for browser tests written with Playwright. Items marked (Node) apply to the `@playwright/test` runner configured in `playwright.config.*`; items marked (.NET) apply to Playwright for .NET, which runs inside NUnit, MSTest or xUnit; unmarked rules apply to both.

## Tooling and formatting
- (Node) Configure the suite in `playwright.config.ts`: `testDir`, `projects` per browser, `use`, `retries`, `workers`, `reporter`, `webServer`. [10]
- (Node) Lint tests with ESLint `no-floating-promises` so a missing `await` fails the lint, and run `tsc --noEmit` in CI. [1]
- (Node) Keep `@playwright/test` current, and define Chromium, Firefox and WebKit as projects when cross-browser coverage matters. [1]
- (.NET) Derive test classes from `PageTest`, or from `ContextTest` for multi-page tests; each supplies a fresh page or context per test. [11]
- (.NET) Write every test as `async Task`, and `await` every Playwright call and `Expect`. [16]

## Language and API usage
- Prefer user-facing locators, starting with `getByRole` and its accessible name; the others are `getByText`, `getByLabel`, `getByPlaceholder`, `getByAltText` and `getByTitle`. [2]
- Use `getByTestId` for elements you cannot reach by role or text, or when the project deliberately adopts test ids; (Node) it reads `data-testid` unless `testIdAttribute` is set in the config. [2]
- (.NET) The same locators exist as `GetByRole(AriaRole.Button, new() { Name = "..." })`, `GetByLabel`, `GetByTestId`; change the test-id attribute once with `Selectors.SetTestIdAttribute`. [15]
- Avoid CSS and XPath locators and long chains tied to DOM structure; narrow with `filter`, chaining, `and` / `or` instead. [2]
- Do not use `first()`, `last()` or `nth()` to dodge a strictness error; make the locator unique. [2]
- Assert with web-first matchers that retry (`toBeVisible`, `toHaveText`, `toHaveURL`, `toHaveCount`) and `await` them. [3]
- (.NET) Use `await Expect(locator).ToBeVisibleAsync()` and the other `Expect(...)` matchers; they retry up to the 5 s default. [14]
- Do not assert on a one-off boolean such as `expect(await locator.isVisible()).toBe(true)`; it checks once and does not wait. [1]
- Use non-retrying matchers (`toBe`, `toEqual`) only for plain values; for a condition that needs polling, use `expect.poll`, or `expect.toPass` with its own `timeout` (its default is 0 and it ignores the global expect timeout). [3]
- Rely on auto-waiting: actions wait for the element to be visible, stable, enabled and receiving events, so tests need no explicit waits. [18][16]
- Do not use `waitForTimeout`; it is meant for debugging only and makes tests flaky. [8]
- Do not wait for `networkidle` to decide the page is ready; assert on the visible outcome instead. [8]
- Set the global expect timeout in config (Node: `expect.timeout`; .NET: `SetDefaultExpectTimeout` in setup or `ExpectTimeout` in `.runsettings`); override per assertion with `timeout`. [3][10][14][11]
- Use `expect.soft` (Node) when later checks should still run after a failure; it marks the test failed without stopping it. [3]

## Errors, logging and nulls
- Stub third-party sites and services through the Network API instead of calling them. [1]
- Run tests against a stable environment with controlled data, not a shared mutable one. [1]
- Expect a failed test to discard its worker and browser; do not rely on state left behind by a failed test. [9]
- (Node) Use `testInfo.retry` in hooks or fixtures to clean state before a retried attempt. [9]
- Use `test.describe.serial` (Node) only for genuinely dependent steps; prefer independent tests. [6]

## Testing
- Make each test independent: it must not rely on another test's data or order, and it gets its own storage, cookies and data. [1]
- Put shared setup in `beforeEach` (Node) or the runner's setup hook (`[SetUp]`, `[TestInitialize]`, `InitializeAsync`) in .NET, not in a previous test. [1][16]
- (.NET) Rely on one fresh `BrowserContext` per test; Playwright and browser instances are reused but contexts are not. [11]
- Make backend data unique per test (for example from `testInfo.testId`) so parallel tests cannot collide. [6]
- Reuse login state instead of logging in through the UI each test: (Node) a `*.setup.ts` project plus `dependencies: ['setup']` and `storageState` on each project. [4]
- (.NET) Save state with `context.StorageStateAsync(new() { Path = ... })` and load it with `StorageStatePath` in `NewContextAsync`. [13]
- When tests mutate shared server-side state, authenticate once per worker with separate accounts (Node: a worker-scoped fixture keyed on `testInfo.parallelIndex`). [4]
- Record traces with `use: { trace: 'on-first-retry' }` and `retries: process.env.CI ? 2 : 0` (Node); do not leave always-on tracing in the committed config. [5][1]
- (.NET) There is no config switch in the guide: start `Context.Tracing.StartAsync` in setup and call `StopAsync` with a `Path` in teardown, saving one zip per test. [12]
- Debug CI failures with the trace viewer rather than only screenshots and video. [1]
- Files run in parallel by default and tests within a file run in order; opt into more with `fullyParallel: true` or `test.describe.configure({ mode: 'parallel' })` (Node). [6]
- (.NET) Parallelism comes from the runner: NUnit parallelizes files (`NUnit.NumberOfTestWorkers`), MSTest and xUnit parallelize classes. [11]
- Write each test's output to a per-test path (`testInfo.outputPath()`), never a shared file. [6]
- On CI (Node), set `workers: process.env.CI ? 1 : undefined` for stability, enable `forbidOnly`, install with `npm ci`, then run `npx playwright install --with-deps`. [7][10]
- (.NET) In CI run `dotnet build`, then `pwsh bin/<Configuration>/<tfm>/playwright.ps1 install --with-deps`, then `dotnet test`. [17]
- Do not set more workers than the agent has cores; it causes timeouts. [17]
- Set `globalTimeout` so a hung run stops and still writes a report, and upload the report as an artifact even on failure. [7]
- Split large suites across CI jobs with `--shard=<n>/<total>` (Node). [7]
- Do not commit a `.only` test; `forbidOnly` makes the run fail if one is present. [10]

## Security
- Keep saved authentication state out of version control: put it in `playwright/.auth` and list that folder in `.gitignore`. [4][13]
- Treat a storage-state file as a credential: it can hold sensitive cookies and headers, so delete expired files and do not commit it. [4][13]

## Review checklist
- [ ] Locators are role/label/text based; any `getByTestId`, CSS or XPath use is justified.
- [ ] No `waitForTimeout` and no `networkidle` waits.
- [ ] Assertions are web-first and awaited; no `expect(await x.isVisible())` style checks.
- [ ] Every Playwright call is awaited (lint `no-floating-promises` clean, or `async Task` in .NET).
- [ ] Each test runs alone and in any order; no shared mutable data between tests.
- [ ] Login state is reused through storage state, and the state file path is git-ignored.
- [ ] No `.only`; no new `first()` / `nth()` used to silence strictness errors.
- [ ] Trace config is `on-first-retry` (Node) or a per-test start/stop (.NET); no always-on tracing committed.
- [ ] CI config uses the repo's worker count, `forbidOnly` (Node), browser install with deps, and uploads the report.
- [ ] Third-party services are stubbed, not hit live.
