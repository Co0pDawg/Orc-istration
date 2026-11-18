---
id: python
title: Python
kind: language
detect:
  - "pyproject.toml"
  - "setup.py"
  - "requirements.txt"
  - "*.py"
requires: []
reviewed: 2026-11-18
sources:
  - https://peps.python.org/pep-0008/
  - https://peps.python.org/pep-0257/
  - https://docs.astral.sh/ruff/configuration/
  - https://docs.astral.sh/ruff/formatter/
  - https://mypy.readthedocs.io/en/stable/command_line.html
  - https://docs.python.org/3/library/typing.html
  - https://packaging.python.org/en/latest/guides/writing-pyproject-toml/
  - https://docs.python.org/3/library/venv.html
  - https://docs.python.org/3/library/pathlib.html
  - https://docs.python.org/3/howto/logging.html
  - https://docs.pytest.org/en/stable/how-to/assert.html
  - https://docs.pytest.org/en/stable/explanation/goodpractices.html
  - https://docs.python.org/3/library/subprocess.html
  - https://docs.python.org/3/library/pickle.html
  - https://docs.python.org/3/library/sqlite3.html
  - https://docs.python.org/3/reference/compound_stmts.html
---

# Python

Style follows PEP 8 and PEP 257. Ruff (lint and format) enforces the mechanical parts, mypy or pyright checks types, and pytest runs the tests.

## Tooling and formatting
- Keep tool settings in `pyproject.toml` (or `ruff.toml`); the closest config file to a source file wins. [3]
- Format with `ruff format` and lint with `ruff check`; CI should use `ruff format --check`. [3][4]
- Sort imports with `ruff check --select I --fix` before formatting, because the formatter does not sort them. [4]
- Use the formatter's line length (88 for Ruff) unless the repo's config says otherwise; PEP 8 itself says 79 for code and 72 for comments and docstrings. [1][3]
- Indent with 4 spaces, never mix tabs and spaces, and leave no trailing whitespace. [1]
- Put imports at the top of the file in three groups (standard library, third party, local) separated by blank lines. [1]
- Import each module on its own line and never use `from x import *`. [1]
- Declare project metadata in `[project]` (`name`, `version`, `requires-python`, `dependencies`) and name the build backend under `[build-system]`. [7]
- Put dev-only dependencies in `[dependency-groups]` or an optional-dependencies extra, not in runtime `dependencies`. [7]
- Use a virtual environment per project and keep it out of version control; recreate it from the requirements instead of copying it. [8]

## Naming
- Use `snake_case` for functions, methods and variables, `CapWords` for classes, and `UPPER_SNAKE_CASE` for constants. [1]
- Keep acronyms fully capitalised inside CapWords names (`HTTPServerError`). [1]
- End exception class names with `Error` when they signal an error. [1]
- Never use `l`, `O` or `I` as a single-character name. [1]
- Name the first parameter `self` for instance methods and `cls` for class methods. [1]
- Prefix non-public names with one underscore; append an underscore to dodge a keyword (`class_`). [1]

## Language and API usage
- Annotate every public function signature and run mypy (`--strict` where feasible) or pyright in CI. [5]
- Write `X | None` instead of `Optional[X]`, and `list[int]` / `dict[str, int]` instead of `typing.List` / `typing.Dict`. [6]
- Do not give a parameter `Optional` just because it has a default; use `arg: int = 0`. [6]
- Accept abstract types (`Sequence`, `Mapping`, `Iterable` from `collections.abc`) in parameters; use a concrete type such as `list` only when callers need it (for example to mutate it). [6]
- Prefer `object` or a `Protocol` over `Any`; use `Any` only as a deliberate escape hatch. [6]
- Model dicts with fixed keys as a `TypedDict` rather than an untyped `dict`. [6]
- Do not add `# type: ignore` without a reason; `--strict` flags unused ignores. [5]
- Compare to `None` with `is` / `is not`, and never compare booleans with `== True`. [1]
- Use `isinstance()` for type checks, and test empty sequences by truthiness rather than `len()`. [1]
- Use `startswith()` / `endswith()` instead of slicing to test prefixes and suffixes. [1]
- If any `return` yields a value, make every `return` (and a reachable function end) return explicitly, using `return None` where needed. [1]
- Open files, locks, connections and other resources with `with`, which guarantees cleanup even when the block raises. [1][16]
- Use `pathlib.Path` and the `/` operator instead of `os.path` string joins; use `read_text(encoding=...)` and `mkdir(parents=True, exist_ok=True)`. [9]
- Give every module and public class, function and method a docstring in triple double quotes. [1][2]
- Start a docstring with a one-line imperative summary ending in a period; in multi-line docstrings put a blank line after it and the closing quotes on their own line. [2]
- Document arguments, return value, side effects and raised exceptions in function docstrings, using the exact parameter names. [2]
- Use inline comments with two spaces before `#` and one after, and wrap long lines in parentheses rather than backslashes. [1]

## Errors, logging and nulls
- Never write a bare `except:`; catch the narrowest exception, and `except Exception:` only at a boundary. [1]
- Keep each `try` body to the minimum code that can raise the handled error. [1]
- Chain with `raise NewError(...) from err` when translating an exception. [1]
- Derive custom exceptions from `Exception`, not `BaseException`. [1]
- Never `return`, `break` or `continue` inside `finally`, since it can swallow an active exception. [1]
- Get a logger with `logging.getLogger(__name__)` in each module instead of logging through the root logger. [10]
- Pass log arguments lazily (`logger.info("loaded %s", name)`), not pre-built f-strings. [10]
- Log caught errors with `logger.exception(...)` and only inside an `except` block. [10]
- Libraries attach only a `NullHandler`; handler and level configuration belongs to the application entry point. [10]

## Testing
- Write tests with pytest and plain `assert`; pytest shows the compared values when one fails. [11]
- Assert exceptions with `with pytest.raises(X, match=...)`, and note it also accepts subclasses of `X`. [11]
- Compare floats with `pytest.approx` rather than hand-written tolerances. [11]
- Name test files `test_*.py` or `*_test.py`, functions `test_*`, and classes `Test*` without an `__init__`. [12]
- Keep tests in a `tests/` directory beside the package, and prefer a `src/` layout so tests hit the installed package. [12]
- Run tests inside the project's virtual environment against an editable or installed copy of the package. [12]

## Security
- Never unpickle data that may come from an untrusted source, because loading can execute arbitrary code; use `json` for untrusted input. [14]
- Call `subprocess.run([...], check=True, timeout=...)` with an argument list and leave `shell=True` off. [13]
- If `shell=True` is unavoidable, quote every interpolated value (`shlex.quote`) and never pass user input unquoted. [13]
- Bind SQL values with placeholders (`?` or `:name`), never with f-strings, `%` or `.format()`. [15]
- Remember a `sqlite3` connection used in `with` commits or rolls back but does not close; close it or wrap it in `contextlib.closing`. [15]

## Review checklist
- [ ] `ruff check` and `ruff format --check` pass with the repo's config, and imports are sorted. [3][4]
- [ ] mypy or pyright passes, and new public functions are fully annotated with no new unexplained `# type: ignore`. [5]
- [ ] No bare `except:`, no swallowed exceptions, and translated exceptions use `raise ... from`. [1]
- [ ] Resources (files, connections, locks) are opened with `with`. [16]
- [ ] Paths use `pathlib`, not string concatenation or `os.path.join`. [9]
- [ ] Logging uses a module logger with lazy arguments rather than the root logger. [10]
- [ ] No `pickle` on untrusted data, no `shell=True` with interpolated input, and SQL uses placeholders. [13][14][15]
- [ ] Public names have docstrings, and `None` is compared with `is`. [1][2]
- [ ] New behavior has pytest tests, and exception paths use `pytest.raises`. [11]
- [ ] New dependencies land in `pyproject.toml` in the right section, and no virtual environment is committed. [7][8]
