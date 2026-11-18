---
id: sql
title: SQL (with SQL Server / T-SQL notes)
kind: language
detect:
  - "*.sql"
  - "*.sqlproj"
requires: []
reviewed: 2026-11-18
sources:
  - https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
  - https://learn.microsoft.com/en-us/sql/t-sql/statements/create-procedure-transact-sql
  - https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-index-design-guide
  - https://learn.microsoft.com/en-us/sql/relational-databases/tables/primary-and-foreign-key-constraints
  - https://learn.microsoft.com/en-us/sql/t-sql/statements/set-transaction-isolation-level-transact-sql
  - https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide
  - https://learn.microsoft.com/en-us/sql/t-sql/statements/set-xact-abort-transact-sql
  - https://documentation.red-gate.com/flyway/flyway-concepts/migrations/versioned-migrations
  - https://learn.microsoft.com/en-us/sql/t-sql/statements/set-nocount-transact-sql
  - https://learn.microsoft.com/en-us/sql/t-sql/statements/insert-transact-sql
  - https://learn.microsoft.com/en-us/sql/relational-databases/performance/best-practice-with-the-query-store
---

# SQL (with SQL Server / T-SQL notes)

Rules for SQL that ships in application code, migrations and stored routines. Items marked "(T-SQL)" apply to SQL Server and Azure SQL only; the rest are portable. Migration tools enforce version order and checksums; the other rules are checked by reading the diff.

## Tooling and formatting
- Keep every schema change in a versioned migration file, applied in version order by the repo's migration tool (a `V<version>__<description>.sql` naming layout is typical). [8]
- Do not edit a migration that has already been applied to a shared or permanent environment; ship a new, higher-numbered migration instead. The tool records a checksum per applied script to detect such edits. [8]
- Give each migration a unique version. [8]

## Naming
- (T-SQL) Write object names with their schema (`dbo.Orders`, not `Orders`) when a procedure creates or references objects, so the engine need not search several schemas and a default schema does not cause permission or access problems. [2]

## Language and API usage
- (T-SQL) Do not use `SELECT *` in stored procedures; list the columns needed. A change in column count or order can break statements that depend on the result. [2]
- Return only the columns and rows the caller needs; filter as early as possible. [2]
- Name the columns in `INSERT ... SELECT` instead of using `SELECT *`: a `SELECT *` insert works only while both tables keep the same column count and order, and a column list is what lets values arrive in a different order. [2][10]
- Fold row changes into one statement that touches many rows instead of issuing repeated statements against the same rows; the engine then does less index maintenance. [3]
- Keep scalar function calls out of queries that return many rows: each row triggers a call, so the query degrades toward row-at-a-time processing. [2]
- Do not wrap an indexed column in a function in `WHERE` or `JOIN` (`WHERE YEAR(d) = 2025`); that stops the optimizer from using the index. [2]
- Add an index on a foreign key column when joins use it or changes to the referenced key must be checked against it; the engine does not create one automatically, and the index is useful but optional. [4]
- Index columns that appear often in predicates and joins, and keep keys narrow; extra indexes and wide keys raise the cost of updates, so avoid over-indexing heavily updated tables. [3]
- A column the query only returns, never filters, groups or sorts on, belongs in `INCLUDE` rather than in the index key. [3]
- Prefer extending an existing index over adding a near-duplicate one. [3]
- Break large `UPDATE` or `DELETE` operations into smaller batches (for example `DELETE TOP (500)` in a loop). [6]
- (T-SQL) Start stored procedures with `SET NOCOUNT ON` to stop the per-statement row-count messages. [2][9]
- (T-SQL) To reduce read blocking, use `READ_COMMITTED_SNAPSHOT` or `SNAPSHOT` instead of `NOLOCK` or `READ UNCOMMITTED`, which allow dirty reads and can miss rows or return them twice. [5][6]
- (T-SQL) Do not use `PAGLOCK` or `TABLOCK` hints in systems with more than a few concurrent users. [6]
- (T-SQL) Where a procedure runs dynamic SQL, pass values through `sp_executesql` parameters instead of concatenating them into the text. [1][11]

## Errors, logging and nulls
- (T-SQL) In a stored procedure, put the modifications between explicit `BEGIN TRANSACTION` and `COMMIT TRANSACTION`, and end every transaction with a commit or a rollback. [2][6]
- Keep transactions short: collect any needed input and do the analysis first, then open the transaction, modify and commit right away. [6]
- Never hold a transaction open while waiting for user input or while a user browses data. [6]
- Use `REPEATABLE READ` or `SERIALIZABLE` only when the workload needs them, because they hold locks longer and lower concurrency. [5]
- (T-SQL) Use `TRY...CATCH` for error handling in procedures, and set `SET XACT_ABORT ON` so a run-time error rolls back the whole transaction. [2][7]
- (T-SQL) Raise errors with `THROW` rather than `RAISERROR` in new code; `THROW` honors `XACT_ABORT`. [7]

## Testing
- (T-SQL) Use Query Store to find non-parameterized queries and parameterize them where applicable; every distinct query text gets its own compiled plan, so plans are not reused. [11]

## Security
- Send values to the database only through bound parameters (prepared statements, `sp_executesql`, driver parameter objects); never build SQL by concatenating or formatting user input. [1]
- For parts that cannot be parameterized (table, column, sort direction), map the user's choice to a fixed allow-list of names in code and reject anything else. [1]
- Do not rely on manual escaping or quoting as the defense; it varies by dialect and settings. [1]
- A stored procedure is not safe by default: bound arguments at the call site do not protect dynamic SQL built inside it. [1]
- Give each application its own database account with only the permissions it needs; never use an admin or owner login from application code. [1]
- Limit each account to the specific data and procedures it needs, exposing data through views where that helps, and rarely grant create or delete rights. [1]

## Review checklist
- [ ] No SQL is built by string concatenation or interpolation of user-controlled values; all values are bound parameters. [1]
- [ ] Any dynamic identifier comes from a fixed allow-list, not from input. [1]
- [ ] No `SELECT *` in procedures, and `INSERT ... SELECT` names its columns. [2][10]
- [ ] A migration already applied elsewhere was not edited; new changes are new, uniquely versioned files. [8]
- [ ] Each new foreign key has a supporting index or a stated reason for none, and new indexes are justified by a predicate or join. [3][4]
- [ ] No function wraps an indexed column in `WHERE`/`JOIN`. [2]
- [ ] Repeated statements that update the same rows are merged into one set-based statement, or the reason is stated. [3]
- [ ] Transactions are short, wrap only the modification, and roll back on error. [2][6][7]
- [ ] (T-SQL) Objects are schema-qualified, procedures set `NOCOUNT ON`, and `NOLOCK` is not used as a blanket fix. [2][5][9]
- [ ] The application login gets least privilege, with no admin rights added. [1]
