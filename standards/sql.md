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
- Never edit a migration that has already been applied to a shared or permanent environment; ship a new, higher-numbered migration instead. The tool records a checksum per applied script to detect such edits. [8]
- Give each migration a unique version; do not reuse or renumber versions that other branches may already have taken. [8]
- Keep migrations forward-only. Do not rely on a down/undo script as the way to fix a bad release; fix forward with a new migration. [8]

## Naming
- (T-SQL) Schema-qualify every table, view and procedure reference (`dbo.Orders`, not `Orders`), in both DDL and queries. It removes the lookup across schemas and avoids permission problems tied to a user's default schema. [2]

## Language and API usage
- Do not use `SELECT *` in application code, views or procedures; list the columns needed. Added or reordered columns can break dependent code and inserts. [2]
- Return only the columns and rows the caller needs; filter as early as possible. [2]
- Give every `INSERT` an explicit column list. Without one, values are matched to columns by table order, which breaks when the table changes. [10]
- Prefer one set-based statement that modifies many rows over a loop or cursor that touches one row at a time; this also cuts index-maintenance overhead. [3]
- Do not call scalar functions per row in queries that return many rows; the cost behaves like row-by-row processing. [2]
- Write sargable predicates: do not wrap an indexed column in a function or expression in `WHERE` or `JOIN` (`WHERE YEAR(d) = 2025`); compare the bare column against a computed range instead. [2]
- Create an index on every foreign key column used in joins or cascade checks. The engine does not create one automatically. [4]
- Index columns that appear often in predicates and joins, and keep keys narrow; every extra index slows writes, so avoid over-indexing heavily updated tables. [3]
- Put columns that are only returned (not filtered or sorted on) in `INCLUDE`, not in the index key. [3]
- Prefer extending an existing index over adding a near-duplicate one. [3]
- Chunk large `UPDATE`/`DELETE` batches (for example with `TOP (n)` in a loop) so each transaction takes fewer locks. [6]
- (T-SQL) Start stored procedures and triggers with `SET NOCOUNT ON` to suppress per-statement row-count messages. [2][9]
- (T-SQL) Do not use `NOLOCK` or `READ UNCOMMITTED` as a default read mode; it permits dirty reads and rows read twice or missed. Use `READ_COMMITTED_SNAPSHOT` or `SNAPSHOT` to reduce read blocking. [5][6]
- (T-SQL) Avoid `PAGLOCK` and `TABLOCK` hints in multi-user systems; they raise blocking. [6]
- (T-SQL) When a procedure uses dynamic SQL, execute it with `sp_executesql` and typed parameters, not string concatenation. [11]

## Errors, logging and nulls
- Wrap data-changing work in an explicit transaction with a clear commit and rollback path. [2]
- Keep transactions as short as possible: gather input and do analysis before `BEGIN TRANSACTION`, then modify and commit immediately. [6]
- Never wait for user input or browse data while a transaction is open. [6]
- Use the lowest isolation level that meets the integrity need; `READ COMMITTED` suffices for most work, and `REPEATABLE READ` or `SERIALIZABLE` need a stated reason. [5][6]
- (T-SQL) Use `TRY...CATCH` for error handling in procedures, and set `SET XACT_ABORT ON` so a run-time error rolls back the whole transaction. [2][7]
- (T-SQL) Raise errors with `THROW`, not `RAISERROR`; `THROW` honors `XACT_ABORT`. [7]

## Testing
- Review non-parameterized query shapes in the query-performance tooling; many one-off query texts defeat plan reuse. [11]

## Security
- Send values to the database only through bound parameters (prepared statements, `sp_executesql`, driver parameter objects); never build SQL by concatenating or formatting user input. [1]
- For parts that cannot be parameterized (table, column, sort direction), map the user's choice to a fixed allow-list of names in code and reject anything else. [1]
- Do not rely on manual escaping or quoting as the defense; it varies by dialect and settings. [1]
- A stored procedure is not safe by default: bound arguments at the call site do not protect dynamic SQL built inside it. [1]
- Give each application its own database account with only the permissions it needs; never use an admin or owner login from application code. [1]
- Restrict accounts to the specific tables, columns or procedures required (use views or `EXECUTE`-only rights), and rarely grant create or drop rights. [1]

## Review checklist
- [ ] No SQL is built by string concatenation or interpolation of user-controlled values; all values are bound parameters. [1]
- [ ] Any dynamic identifier comes from a fixed allow-list, not from input. [1]
- [ ] No `SELECT *` and no `INSERT` without an explicit column list. [2][10]
- [ ] A migration already applied elsewhere was not edited; new changes are new, uniquely versioned files. [8]
- [ ] New foreign keys have a supporting index, and new indexes are justified by a predicate or join. [3][4]
- [ ] Predicates are sargable; no function wraps an indexed column in `WHERE`/`JOIN`. [2]
- [ ] Row-by-row cursors or loops are replaced by set-based statements, or the reason is stated. [3]
- [ ] Transactions are short, wrap only the modification, and roll back on error. [2][6][7]
- [ ] (T-SQL) Objects are schema-qualified, procedures set `NOCOUNT ON`, and `NOLOCK` is not used as a blanket fix. [2][5][9]
- [ ] The application login gets least privilege, with no admin rights added. [1]
