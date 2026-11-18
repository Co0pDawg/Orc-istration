---
id: java
title: Java
kind: language
detect:
  - "pom.xml"
  - "build.gradle"
  - "build.gradle.kts"
requires: []
reviewed: 2026-11-18
sources:
  - https://google.github.io/styleguide/javaguide.html
  - https://github.com/google/google-java-format
  - https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Optional.html
  - https://docs.oracle.com/javase/tutorial/essential/exceptions/tryResourceClose.html
  - https://docs.oracle.com/javase/tutorial/essential/exceptions/runtime.html
  - https://docs.oracle.com/en/java/javase/21/language/records.html
  - https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Object.html
  - https://docs.junit.org/current/writing-tests/annotations.html
  - https://docs.junit.org/current/writing-tests/assertions.html
  - https://errorprone.info/docs/installation
  - https://spotbugs.readthedocs.io/en/latest/introduction.html
  - https://docs.oracle.com/javase/tutorial/jdbc/basics/prepared.html
  - https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html
  - https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/io/ObjectInputFilter.html
---

# Java

Rules for Java source built with Maven or Gradle. google-java-format enforces layout, Error Prone and SpotBugs catch common bug patterns, and JUnit Jupiter covers tests. Follow the repo's own formatter and analyzer config where it differs.

## Tooling and formatting
- Format with google-java-format, wired into the build (through a Maven or Gradle formatting plugin) or run with `--dry-run` in CI; do not hand-format. [2]
- Enable Error Prone as a compiler plugin in the build (for Maven, `-Xplugin:ErrorProne` in the compiler arguments); it needs JDK 21 or newer to run. [10]
- Run SpotBugs, which scans compiled bytecode for bug patterns, and triage new findings before merging. [11]
- Use UTF-8 source files and spaces, never tabs. [1]
- Indent by two spaces and wrap lines at 100 characters unless the repo's formatter config says otherwise. [1]
- Put braces on every `if`, `else`, `for`, `do` and `while`, even for one statement. [1]
- Write one statement per line and one variable per declaration. [1]
- Put one top-level class in each file, named after the file. [1]
- Do not use wildcard imports. List static imports first, then other imports, each block sorted, with a blank line between. [1]
- Declare local variables near their first use, and put array brackets on the type (`String[] args`). [1]
- Give every visible class and public or protected member Javadoc that opens with a summary fragment. [1]

## Naming
- Use all-lowercase package names without underscores. [1]
- Use `UpperCamelCase` for classes and interfaces. [1]
- Use `lowerCamelCase` for methods, parameters and variables. [1]
- Use `UPPER_SNAKE_CASE` for constants (static final fields that are deeply immutable). [1]
- Do not add `m`, `s_` or similar prefixes or suffixes to field names. [1]

## Language and API usage
- Add `@Override` to every method that overrides or implements another. [1]
- Reach static members through the class name, not through an instance. [1]
- Do not override `finalize`. [1]
- Use `Optional` primarily as a method return type when absence is a normal result; do not use it for fields or parameters. [3]
- Never assign `null` to an `Optional` variable, and never synchronize on one (it is a value-based class). [3]
- Open every `AutoCloseable` (streams, readers, JDBC objects) in a try-with-resources statement, not a manual `finally`. [4]
- Model plain data carriers as `record` types; their fields are final and `equals`, `hashCode` and `toString` are generated. [6]
- Validate record components in a compact constructor. [6]
- When you override `equals`, override `hashCode` in the same class; equal objects must return equal hash codes. [7]
- Keep `equals` reflexive, symmetric, transitive, consistent and false for `null`. [7]
- Make every `switch` exhaustive, and mark an intentional fall-through with a comment. [1]

## Errors, logging and nulls
- Throw a checked exception only when a caller can reasonably recover; otherwise throw an unchecked one. [5]
- Do not choose an unchecked exception just to avoid declaring or handling a checked one. [5]
- Never ignore a caught exception; handle it, rethrow it, or document in a comment why it is safe to drop. [1]
- Let try-with-resources manage closing; exceptions from closing are attached as suppressed exceptions on the primary one. [4]
- Do not return `null` where an `Optional` result fits the method's contract. [3]

## Testing
- Write tests with JUnit Jupiter: mark them `@Test`, and prepare state in `@BeforeEach` rather than in test bodies. [8]
- Give a class or method a readable `@DisplayName` when its method name is not enough. [8]
- Use `@ParameterizedTest` for the same check across several inputs instead of copy-pasted tests. [8]
- Assert a failure with `assertThrows` and inspect the returned exception. [9]
- Use `assertAll` to report several related assertions together, and pass the expected value first in `assertEquals`. [9]

## Security
- Build SQL with `PreparedStatement` and `?` placeholders bound through setters; never concatenate input into a query string. [12]
- Do not deserialize untrusted data with native Java serialization; prefer JSON or XML mapped to plain data-transfer types. [13][14]
- If native deserialization is unavoidable, apply an `ObjectInputFilter` with an allow-list of classes plus limits on depth, references and array size. [14][13]
- Cap the size of serialized input separately, because filters do not cover every primitive or string. [13]
- Turn off polymorphic typing in the JSON or XML mapper used for untrusted input. [13]

## Review checklist
- [ ] The diff is formatted by google-java-format and passes the build's format check. [2]
- [ ] No tabs, wildcard imports, missing braces, or lines over the limit. [1]
- [ ] Names follow the case rules for packages, types, methods and constants. [1]
- [ ] Every override has `@Override`; every `equals` override has a matching `hashCode`. [1][7]
- [ ] `Optional` appears only as a return type and is never `null`. [3]
- [ ] Resources are opened in try-with-resources, and no caught exception is silently swallowed. [4][1]
- [ ] Checked versus unchecked exceptions follow the recoverability rule. [5]
- [ ] Error Prone and SpotBugs report no new findings. [10][11]
- [ ] Plain data-carrier types are records, not hand-written classes with generated-style boilerplate. [6]
- [ ] Queries use `PreparedStatement` parameters, with no string-built SQL. [12]
- [ ] No native Java deserialization of untrusted input without an `ObjectInputFilter` allow-list. [13][14]
- [ ] New behavior has a JUnit Jupiter test that fails without the change. [8][9]
