---
id: rust
title: Rust
kind: language
detect:
  - "Cargo.toml"
requires: []
reviewed: 2026-11-18
sources:
  - https://doc.rust-lang.org/style-guide/
  - https://doc.rust-lang.org/clippy/usage.html
  - https://rust-lang.github.io/api-guidelines/checklist.html
  - https://rust-lang.github.io/api-guidelines/naming.html
  - https://rust-lang.github.io/api-guidelines/documentation.html
  - https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html
  - https://doc.rust-lang.org/book/ch09-02-recoverable-errors-with-result.html
  - https://doc.rust-lang.org/book/ch20-01-unsafe-rust.html
  - https://doc.rust-lang.org/rustdoc/write-documentation/documentation-tests.html
  - https://doc.rust-lang.org/book/ch11-03-test-organization.html
  - https://doc.rust-lang.org/book/ch11-01-writing-tests.html
  - https://github.com/rustsec/rustsec/tree/main/cargo-audit
  - https://rust-lang.github.io/api-guidelines/interoperability.html
  - https://rust-lang.github.io/api-guidelines/predictability.html
  - https://rust-lang.github.io/api-guidelines/future-proofing.html
---

# Rust

Formatting follows the Rust style guide and is enforced by rustfmt (`cargo fmt`). Clippy enforces lints, naming follows the Rust API Guidelines, and `cargo test` runs unit tests, integration tests and doctests.

## Tooling and formatting
- Format with rustfmt using its defaults (4-space indent, 100-column width) unless the repo's `rustfmt.toml` says otherwise. [1]
- Prefer block indentation over aligning arguments to an opening bracket, and end multi-line comma lists with a trailing comma. [1]
- Leave no trailing whitespace and at most one blank line between items. [1]
- Run `cargo clippy` with its default `clippy::all` lints and fail the build on warnings in CI. [2]
- Deny warnings with `CARGO_BUILD_WARNINGS=deny` (or `[build] warnings = "deny"`) on Cargo 1.97+, otherwise `cargo clippy -- -D warnings`. [2]
- Put an `#[allow(clippy::...)]` where a lint does not fit the code; Clippy expects some. [2]
- Cherry-pick individual `clippy::restriction` lints rather than enabling the whole group, and treat `clippy::pedantic` as opt-in. [2]
- Run `cargo audit` in CI to check `Cargo.lock` against the RustSec advisory database. [12]
- Do not run `cargo audit` on an untrusted project without `--file` pointing at its lockfile, since generating one can run project code. [12]

## Naming
- Use `UpperCamelCase` for types, traits and enum variants; `snake_case` for modules, functions, methods and locals; `SCREAMING_SNAKE_CASE` for constants and statics. [4]
- Treat acronyms as one word (`Uuid`, `uuid_parse`), and use short names such as `T` for type parameters and `'a` for lifetimes. [4]
- Do not put `-rs` or `-rust` in crate names. [4]
- Name cheap borrowed views `as_*`, costly conversions `to_*`, and consuming conversions `into_*`. [3][4]
- Name a getter after its field with no `get_` prefix (`first`, `first_mut`); reserve `get` for the one obvious lookup. [4]
- Name collection iterator methods `iter`, `iter_mut` and `into_iter`, and name the iterator type after the method (`IntoIter`). [4]
- Name Cargo features without filler (`abc`, not `use-abc`), never negatively (`no-abc`), and use `std` for optional std support. [4]
- Keep word order consistent across related names, such as error types. [4]

## Language and API usage
- Keep struct fields private unless the type is a plain, passive data carrier; a public field fixes the representation and blocks validation. [15]
- Make constructors associated functions (`Type::new`), and turn operations with a clear receiver into methods. [14]
- Implement the applicable common traits eagerly (`Clone`, `PartialEq`, `Hash`, `Debug`, `Display`, `Default` and friends), because downstream crates cannot add them later. [13]
- Implement `From`, `TryFrom`, `AsRef` and `AsMut` for conversions where they fit, and implement `From` rather than `Into`. [13]
- Check that types holding raw pointers report `Send` and `Sync` accurately, and add a test asserting the traits you rely on. [13]
- Seal traits that only the defining crate should implement. [15]
- Implement `Deref` / `DerefMut` only for smart pointers. [3]
- Encode invariants in types (a validating newtype with a private field, a non-`Option` parameter, an unsigned integer) instead of repeating runtime checks. [6]
- Keep `unsafe` blocks as small as possible and wrap them in a safe function so callers need no `unsafe`. [8]
- Put a `// SAFETY:` comment on each unsafe operation saying why the safety rules hold, and on each `unsafe fn` say what the caller must guarantee. [8]
- Remember `unsafe` does not switch off the borrow checker; check unsafe code with Miri (`cargo +nightly miri test`) where practical. [8]
- Give public items a rustdoc example, within reason, that shows why someone would use the item rather than only how to call it. [5]
- Write examples with `?` rather than `unwrap`, ending doctests with `Ok::<(), E>(())` or a hidden `fn main() -> Result<...>`. [5][9]
- Add `# Errors`, `# Panics` and `# Safety` sections to public functions that can fail, panic or are `unsafe`. [5]
- Link related items in doc prose, and keep internal items `pub(crate)` or `#[doc(hidden)]`. [5]
- Fill in `description`, `license`, `repository`, `keywords` and `categories` in `Cargo.toml` for published crates. [5]

## Errors, logging and nulls
- Return `Result` when failure is an expected possibility (malformed input, a rate-limited response); that leaves recovery to the caller. [6]
- Panic when a contract or invariant is broken and continuing would be harmful or insecure, and explain the contract in the API docs. [6]
- Treat `unwrap` and `expect` as placeholders: fine in tests, examples and prototypes, and elsewhere only where failure is provably impossible. [6]
- Use `expect` only where you can show the failure is impossible, and write a message that states why. [6]
- Propagate errors with `?`, using `From` impls so one error type covers several sources. [7]
- Use `?` only in functions whose return type is compatible with the value it is applied to (`Result` with `Result`, `Option` with `Option`). [7]
- Implement `std::error::Error`, `Send` and `Sync` on every error type a public function returns. [13]

## Testing
- Put unit tests in a `#[cfg(test)] mod tests` in the same file, using `use super::*;` to reach private items. [10]
- Put integration tests in a top-level `tests/` directory; they see only the public API. [10]
- Put shared test helpers in `tests/common/mod.rs`, not `tests/common.rs`, so it does not show up as its own test file in the output. [10]
- Prefer `assert_eq!` / `assert_ne!` (which print both sides) over `assert!(a == b)`, and add a message with context for non-obvious asserts. [11]
- Give `#[should_panic]` an `expected = "..."` substring so unrelated panics do not pass. [11]
- Have a test return `Result<(), E>` to use `?`, and assert an expected error with `is_err()`, since `#[should_panic]` cannot be combined with `Result` tests. [11]
- Keep doctests compiling and passing (`cargo test --doc`); use `no_run` for code that must not execute and `text` for non-code blocks. [9]

## Security
- Treat every `unsafe` block and `unsafe fn` as a place to review closely, since memory-safety errors can only come from unsafe code, and require a `// SAFETY:` comment on each. [8]
- Fix a flagged advisory by upgrading the crate; ignore it (`--ignore` or `audit.toml`) only when no upgrade exists and the advisory does not affect the code. [12]

## Review checklist
- [ ] `cargo fmt` leaves the diff unchanged, and `cargo clippy` passes with warnings denied.
- [ ] No new `unwrap()` / `expect()` outside tests, examples and prototypes, except an `expect` whose message explains why failure is impossible.
- [ ] Fallible public functions return `Result`, errors propagate with `?`, and docs have `# Errors` where relevant.
- [ ] Each `unsafe` block is minimal, wrapped in a safe API, and carries a `// SAFETY:` comment.
- [ ] Panic conditions are documented under `# Panics`.
- [ ] Names follow casing rules, `as_` / `to_` / `into_` conversions, no `get_` prefix, and `iter` / `iter_mut` / `into_iter`.
- [ ] New public items have rustdoc with an example that uses `?` and compiles as a doctest.
- [ ] Struct fields are private unless intentionally public, and new types implement the common traits.
- [ ] New behavior has unit tests (in `#[cfg(test)]`) or integration tests in `tests/`, and `should_panic` tests set `expected`.
- [ ] `cargo audit` shows no new unaddressed advisories for added or bumped dependencies.
