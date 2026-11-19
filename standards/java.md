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
- Format with google-java-format, an opinionated formatter for Google Java Style with very little configuration; it is reached from the build through third-party Maven and Gradle plugins, and its command line has a `--dry-run` option. [2]
- Enable Error Prone as a compiler plugin in the build (for Maven, follow the page's setup: `-XDcompilePolicy=simple`, `--should-stop=ifError=FLOW` and `-Xplugin:ErrorProne` in the compiler arguments); the current release must run on JDK 21 or newer. [10]
- Run SpotBugs, which looks for bug patterns by scanning compiled bytecode. [11]
- Use UTF-8 source files, and do not use tabs for indentation. [1]
- Indent by two spaces and wrap lines at 100 characters unless the repo's formatter config says otherwise. [1]
- Put braces on every `if`, `else`, `for`, `do` and `while`, even for one statement. [1]
- Write one statement per line and one variable per declaration. [1]
- Put one top-level class in each file, named after the file. [1]
- Do not use wildcard imports. List static imports first, then other imports, each block sorted, with a blank line between. [1]
- Declare local variables near their first use, and put array brackets on the type (`String[] args`). [1]
- Give every visible class and member Javadoc that opens with a summary fragment, except simple, obvious members and overrides. [1]

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
- Use `Optional` mainly as a method return type where "no result" is a normal outcome. [3]
- Never assign `null` to an `Optional` variable, and never synchronize on one (it is a value-based class). [3]
- Close resources (objects implementing `AutoCloseable`, such as readers and streams) with try-with-resources rather than a `finally` block. [4]
- Model plain data carriers as `record` types; their fields are final and `equals`, `hashCode` and `toString` are generated. [6]
- Validate record components in a compact constructor. [6]
- When you override `equals`, override `hashCode` in the same class; equal objects must return equal hash codes. [7]
- Keep `equals` reflexive, symmetric, transitive, consistent and false for `null`. [7]
- Make every `switch` exhaustive, and mark an intentional fall-through with a comment. [1]

## Errors, logging and nulls
- Throw a checked exception only when a caller can reasonably recover; otherwise throw an unchecked one. [5]
- Do not choose an unchecked exception just to avoid declaring or handling a checked one. [5]
- Respond to a caught exception; doing nothing is very rarely correct, and when it is, explain why in a comment. [1]
- Let try-with-resources manage closing; exceptions from closing are attached as suppressed exceptions on the primary one. [4]
- Do not return `null` where an `Optional` result fits the method's contract. [3]

## Testing
- Mark test methods `@Test`, and use `@BeforeEach` for setup that must run before each test method. [8]
- Use `@DisplayName` to give a test class or method a custom display name. [8]
- Mark a test that runs with several argument sets as `@ParameterizedTest`. [8]
- Assert a failure with `assertThrows` and inspect the returned exception. [9]
- Use `assertAll` to report several related assertions together, and follow the docs' `assertEquals` examples, which pass the expected value first. [9]

## Security
- Build SQL with `PreparedStatement` and `?` placeholders bound through setters; never concatenate input into a query string. [12]
- Avoid native Java serialization for untrusted data; a pure data format such as JSON or XML reduces the risk. [13]
- If native deserialization is unavoidable, apply an `ObjectInputFilter` with an allow-list of classes plus limits on depth, references and array size. [14][13]
- Bound the size of serialized input separately, because filters are not called for strings or primitives. [13]
- Do not enable polymorphic typing in the JSON mapper used for untrusted input; the cheat sheet treats such mapping as safe only without polymorphism. [13]

## Review checklist
- [ ] The diff is formatted by google-java-format.
- [ ] No tabs for indentation, wildcard imports, missing braces, or lines over the limit.
- [ ] Names follow the case rules for packages, types, methods and constants.
- [ ] Every override has `@Override`; every `equals` override has a matching `hashCode`.
- [ ] `Optional` is used for return values where absence is normal and is never `null`.
- [ ] Resources are opened in try-with-resources, and no caught exception is ignored without a comment saying why.
- [ ] Checked versus unchecked exceptions follow the recoverability rule.
- [ ] Error Prone and SpotBugs are enabled in the build.
- [ ] Plain data-carrier types are records, not hand-written classes with boilerplate.
- [ ] Queries use `PreparedStatement` parameters, with no string-built SQL.
- [ ] No native Java deserialization of untrusted input without an `ObjectInputFilter` allow-list.
- [ ] New behavior has a JUnit Jupiter test.
