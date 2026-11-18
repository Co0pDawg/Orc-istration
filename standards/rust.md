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
---

# Rust

Formatting follows the Rust style guide and is enforced by rustfmt (`cargo fmt`). Clippy enforces lints, naming follows the Rust API Guidelines, and `cargo test` runs unit tests, integration tests and doctests.

## Tooling and formatting
- Format with rustfmt using its defaults (4-space indent, 100-column width) unless the repo's `rustfmt.toml` says otherwise. [1]
- Prefer block indentation over aligning arguments to an opening bracket, and end multi-line comma lists with a trailing comma. [1]
- Leave no trailing whitespace and at most one blank line between items. [1]
- Run `cargo clippy` with its default `clippy::all` lints and fail the build on warnings in CI. [2]
- Deny warnings with `CARGO_BUILD_WARNINGS=deny` (or `[build] warnings = "deny"`) on Cargo 1.97+, otherwise `cargo clippy -- -D warnings`. [2]
- Scope an `#[allow(clippy::...)]` to the smallest item that needs it, since Clippy expects allows where a lint does not fit. [2]
- Enable `clippy::restriction` lints one at a time, never as a group, and treat `clippy::pedantic` as opt-in. [2]
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
- Keep struct fields private unless the type is a plain data carrier, so invariants can change later. [3]
- Make constructors associated functions (`Type::new`), and turn functions with an obvious receiver into methods. [3]
- Derive or implement the common traits eagerly where they make sense (`Debug`, `Clone`, `PartialEq`, `Hash`, `Default`) and implement `Display` on user-facing types. [3]
- Implement `From`, `AsRef` and `AsMut` for conversions instead of ad-hoc functions. [3]
- Make types `Send` and `Sync` where possible. [3]
- Seal traits that downstream crates must not implement. [3]
- Implement `Deref` / `DerefMut` only for smart pointers. [3]
- Encode invariants in types (a validating newtype with a private field, a non-`Option` parameter, an unsigned integer) instead of repeating runtime checks. [6]
- Keep `unsafe` blocks as small as possible and wrap them in a safe function so callers need no `unsafe`. [8]
- Put a `// SAFETY:` comment on each unsafe operation saying why the safety rules hold, and on each `unsafe fn` say what the caller must guarantee. [8]
- Remember `unsafe` does not switch off the borrow checker; check unsafe code with Miri (`cargo +nightly miri test`) where practical. [8]
- Give every public item a rustdoc example that shows why to use it, not only how to call it. [3][5]
- Write examples with `?` rather than `unwrap`, ending doctests with `Ok::<(), E>(())` or a hidden `fn main() -> Result<...>`. [5][9]
- Add `# Errors`, `# Panics` and `# Safety` sections to public functions that can fail, panic or are `unsafe`. [5]
- Link related items in doc prose, and keep internal items `pub(crate)` or `#[doc(hidden)]`. [5]
- Fill in `description`, `license`, `repository`, `keywords` and `categories` in `Cargo.toml` for published crates. [5]

## Errors, logging and nulls
- Return `Result` for expected failures (bad input, I/O, parse errors) in library code; the caller decides how to react. [6]
- Panic only when continuing is unsafe or meaningless: a broken contract or invariant, and document the panic condition. [6]
- Do not call `unwrap` or `expect` in library code; reserve them for tests, examples and prototypes. [6]
- Use `expect` only where you can show the failure is impossible, and write a message that states why. [6]
- Propagate errors with `?`, using `From` impls so one error type covers several sources. [7]
- Use `?` only in functions returning a compatible `Result` or `Option`, and convert between the two with `ok()` or `ok_or`. [7]
- Make error types meaningful and well-behaved. [3]

## Testing
- Put unit tests in a `#[cfg(test)] mod tests` in the same file, using `use super::*;` to reach private items. [10]
- Put integration tests in a top-level `tests/` directory; they see only the public API. [10]
- Put shared test helpers in `tests/common/mod.rs`, not `tests/common.rs`, so it is not run as its own test crate. [10]
- Prefer `assert_eq!` / `assert_ne!` (which print both sides) over `assert!(a == b)`, and add a message with context for non-obvious asserts. [11]
- Give `#[should_panic]` an `expected = "..."` substring so unrelated panics do not pass. [11]
- Have a test return `Result<(), E>` to use `?`, and check for expected errors with `is_err()`, not `#[should_panic]`. [11]
- Keep doctests compiling and passing (`cargo test --doc`); use `no_run` for code that must not execute and `text` for non-code blocks. [9]

## Security
- Treat every `unsafe` block, `unsafe fn` and `unsafe impl` as a review hot spot and require a `// SAFETY:` justification for it. [8]
- Do not add a dependency that `cargo audit` flags; ignore an advisory (`--ignore` or `audit.toml`) only when no fix exists and it does not affect the code. [12]

## Review checklist
- [ ] `cargo fmt` leaves the diff unchanged, and `cargo clippy` passes with warnings denied. [1][2]
- [ ] No new `unwrap()` / `expect()` in non-test library code, and any `expect` message explains why failure is impossible. [6]
- [ ] Fallible public functions return `Result`, errors propagate with `?`, and docs have `# Errors` where relevant. [5][7]
- [ ] Each `unsafe` block is minimal, wrapped in a safe API, and carries a `// SAFETY:` comment. [8]
- [ ] Panic conditions are documented under `# Panics`. [5][6]
- [ ] Names follow casing rules, `as_` / `to_` / `into_` conversions, no `get_` prefix, and `iter` / `iter_mut` / `into_iter`. [3][4]
- [ ] New public items have rustdoc with an example that uses `?` and compiles as a doctest. [5][9]
- [ ] Struct fields are private unless intentionally public, and new types implement the common traits. [3]
- [ ] New behavior has unit tests (in `#[cfg(test)]`) or integration tests in `tests/`, and `should_panic` tests set `expected`. [10][11]
- [ ] `cargo audit` shows no new advisories for added or bumped dependencies. [12]
