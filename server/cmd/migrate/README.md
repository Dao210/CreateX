# Migration runner operations

The current migrations initialize an empty database. Each concurrent index has
its own migration file and executes outside an explicit transaction. The runner
serializes work with a PostgreSQL advisory lock and records every applied or
conditionally skipped migration in `schema_migrations`.

The baseline separates tables/functions/triggers, concurrent index builds, and
primary/unique constraint attachment. `PRIMARY KEY USING INDEX` and
`UNIQUE USING INDEX` reuse the existing index; they do not rebuild it. Each
`.down.sql` file reverses its matching upgrade and is not an upgrade-time drop.
Baseline tests reject duplicate index definitions, including a redundant
non-unique index covered by an identical unique index.

```bash
cd server
DATABASE_URL=... go run ./cmd/migrate up
```

An existing current-baseline database can run `up` again safely. Every recorded
version must belong to the shipped migration set. A retired version such as
`001_init` is rejected before application migrations execute.

Do not delete or rewrite the ledger to make a historical database look current.
Do not run the archived migration history. Back up the old database, initialize
a separate empty database, selectively import retained business data, validate
it, and switch the application and database together. Follow the deployment
[baseline rebuild procedure](../../../docs/deploy-auro.md#数据库基线重建).

A failed application activation after a baseline rebuild requires restoring its
matching database as well as its binary. An old release cannot safely use the
new schema. Normal deployments remain forward-only; `down` is an explicit
operation for disposable databases or an independently planned database rollback.

Interrupted concurrent index builds can leave an invalid index. Inspect
`pg_index.indisvalid` and `indisready`, remove the invalid index concurrently,
and rerun `up`. Preserve the migration's exact index definition and execute each
concurrent index statement by itself.

Database tests use disposable schemas/databases. The migration tests cover
initialization, reapplication, concurrency, rollback, and retired-ledger rejection.
