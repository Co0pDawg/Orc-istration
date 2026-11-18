---
id: go
title: Go
kind: language
detect:
  - "go.mod"
requires: []
reviewed: 2026-11-18
sources:
  - https://go.dev/doc/effective_go
  - https://go.dev/wiki/CodeReviewComments
  - https://go.dev/blog/go1.13-errors
  - https://go.dev/blog/context
  - https://go.dev/doc/articles/race_detector
  - https://pkg.go.dev/cmd/vet
  - https://staticcheck.dev/docs/
  - https://golangci-lint.run/docs/linters/
  - https://go.dev/wiki/TableDrivenTests
  - https://go.dev/doc/database/sql-injection
  - https://go.dev/blog/pipelines
  - https://go.dev/doc/comment
---

# Go

Style follows Effective Go and the Go code review comments. `gofmt` (or `goimports`) enforces formatting, `go vet` and `staticcheck` (optionally via `golangci-lint`) enforce correctness, and `go test -race` runs the tests.

## Tooling and formatting
- Format all code with `gofmt` or `goimports` and never hand-format around its output. [1][2]
- Do not wrap lines to hit a fixed length; break them by meaning, and shorten names if lines get long. [1][2]
- Run `go vet ./...` in CI; it catches mismatched `Printf` formats, locks copied by value and cancel functions that are never called. [6]
- Run `staticcheck ./...` alongside `go vet ./...`. [7]
- If the repo uses `golangci-lint`, keep the enabled linters in its config file and list them with `golangci-lint linters`. [8]
- Group imports with the standard library first, separated by a blank line from other groups. [2]
- Do not rename imports except to resolve a collision. [2]
- Use blank imports (`_`) only in `main` packages or tests, and dot imports only in tests that would otherwise have an import cycle. [2]

## Naming
- Use `MixedCaps` / `mixedCaps`, never underscores, even for unexported constants. [1][2]
- Name packages with a short, lowercase, single word matching the directory; avoid `util`, `common` and `misc`. [1][2]
- Do not repeat the package name in exported identifiers (`bufio.Reader`, not `bufio.BufReader`). [1][2]
- Keep initialisms uniformly cased (`URL`, `ID`, `ServeHTTP`). [2]
- Name getters without a `Get` prefix (`Owner()`, with `SetOwner()`). [1]
- Name one-method interfaces after the method plus `er` (`Reader`, `Stringer`), and use `String()`, not `ToString()`. [1]
- Use short, consistent receiver names; never `this`, `self` or `me`. [2]
- Use short names for narrow-scope variables and descriptive names for ones used far from their declaration. [2]
- Name result parameters only when they add clarity; allow naked returns only in short functions. [2]

## Language and API usage
- Write a doc comment on every exported name and package; begin it with the name as a full sentence, and with `Package name` for packages. [2][12]
- Say "reports whether" for boolean functions, and mark retired API with a `Deprecated:` paragraph that names the replacement. [12]
- Do not write doc comments that only restate the code. [2]
- Define interfaces in the consuming package, only once a real use exists, and not just to mock; return concrete types from constructors. [2]
- Use pointer receivers when a method mutates state, the type holds a mutex or is large, and do not mix receiver kinds on one type. [2]
- Do not copy values whose methods use pointer receivers, such as `bytes.Buffer`. [2]
- Design types so the zero value is usable. [1]
- Declare empty slices as `var t []T` rather than `[]T{}` unless non-nil matters (such as JSON encoding). [2]
- Use `defer` to release files and locks right after acquiring them. [1]
- Use the comma-ok form to tell a missing map key from a zero value. [1]
- Prefer synchronous functions and let callers add concurrency. [2]
- Accept `context.Context` as the first parameter, named `ctx`, and never store it in a struct. [2][4]
- Call the `cancel` function from `WithCancel` / `WithTimeout` (usually `defer cancel()`). [4][6]
- Use `context.Value` only for request-scoped data. [4]

## Errors, logging and nulls
- Never discard an error with `_`; handle it, return it, or document why it is safe to ignore. [1][2]
- Handle the error first and return early so the success path stays unindented. [1][2]
- Write error strings lowercase with no trailing punctuation. [2]
- Wrap with `fmt.Errorf("...: %w", err)` when callers may inspect the cause, and test with `errors.Is` / `errors.As`, not `==` or type assertions. [3]
- Use `%v` instead of `%w` when the cause is an internal detail you do not want in your API. [3]
- Return a sentinel error wrapped with `%w`, not bare, so callers must use `errors.Is`. [3]
- Prefer an extra `ok` bool or `error` result over in-band sentinel values like `-1` or `""`. [2]
- Do not use `panic` for ordinary errors in library code; reserve it for impossible states, and `recover` only inside deferred functions. [1][2]
- Make every goroutine's exit obvious, or document when and why it ends. [2]
- Prevent goroutine leaks: a goroutine stuck on an unreceived send is never collected, so pair sends with a `ctx.Done()` or `done` case in `select`. [11]
- Close a channel only from its sender after the last send, and when several goroutines send use a `sync.WaitGroup` and a separate closer. [11]

## Testing
- Write table-driven tests and run each case with `t.Run` using the case name. [9]
- Make failure messages show the input, actual value and expected value. [2][9]
- Prefer `t.Errorf` when later checks in the test still matter: it reports the failure and the test keeps running. [9]
- Before Go 1.22 re-declare the loop variable (`tc := tc`) when subtests call `t.Parallel()`. [9]
- Run `go test -race ./...` in CI; it only reports races on code paths that actually run, and costs several times the memory and time. [5]
- Add runnable examples when creating a new package. [2]

## Security
- Pass SQL values as arguments to `database/sql` calls (`?`, or `$1` for some drivers) and never build queries with `fmt.Sprintf`. [10]
- Use `crypto/rand` for keys and secrets, never `math/rand`. [2]
- Fix every data race the race detector reports; races on maps, counters and shared flags are real bugs. [5]

## Review checklist
- [ ] `gofmt` / `goimports` leaves the diff unchanged. [1][2]
- [ ] `go vet ./...` and `staticcheck ./...` (or the repo's `golangci-lint` config) report nothing new. [6][7]
- [ ] No error is discarded with `_`, and error strings are lowercase without punctuation. [2]
- [ ] Wrapped errors use `%w` only where the cause is meant to be inspected, and callers use `errors.Is` / `errors.As`. [3]
- [ ] `context.Context` is the first parameter, is not stored in a struct, and every `cancel` is called. [2][4]
- [ ] Each new goroutine has a clear exit path, with cancellation or a closed channel. [2][11]
- [ ] Exported identifiers have doc comments starting with their name. [12]
- [ ] New behaviour has table-driven tests with informative failure messages, and the suite passes with `-race`. [5][9]
- [ ] SQL uses placeholders, and secrets use `crypto/rand`. [2][10]
- [ ] Package and receiver names are short and consistent, with no `util` or `common` packages and no `Get` prefixes. [1][2]
