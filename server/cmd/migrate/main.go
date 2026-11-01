package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/auro-ai/auro/server/internal/dbstartup"
	"github.com/auro-ai/auro/server/internal/logger"
	"github.com/auro-ai/auro/server/internal/migrations"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type preMigrationHook func(context.Context, *pgxpool.Pool) error
type migrationCondition func(context.Context, *pgxpool.Conn) (bool, string, error)

const migrationAdvisoryLockKey int64 = 7244554146635925501

// defaultSchemaMigrationsTable is the unqualified name of the bookkeeping
// table that tracks which migrations have been applied. Tests override
// this so a concurrent-race harness can run against the same shared
// Postgres without colliding with the production table.
const defaultSchemaMigrationsTable = "schema_migrations"

// runOptions carries everything runMigrations needs that is not the
// pool itself. Tests use it to inject a hermetic migrations directory,
// a unique per-test bookkeeping table, and a unique advisory-lock key
// that doesn't collide with any other migration runner sharing the same
// Postgres instance.
type runOptions struct {
	// Direction is "up" or "down".
	Direction string
	// Files is the ordered list of .sql files to apply. Production callers
	// pass migrations.Files(direction); tests pass a curated set written
	// to a t.TempDir().
	Files []string
	// SchemaMigrationsTable is the bookkeeping table to read/write.
	// May be schema-qualified (e.g. "migrate_test_xyz.schema_migrations").
	// Empty means defaultSchemaMigrationsTable.
	SchemaMigrationsTable string
	// AdvisoryLockKey is the int64 used with pg_advisory_lock. Zero means
	// migrationAdvisoryLockKey. Tests pass a unique key per run so
	// concurrent test workers do not block on the production migration
	// runner if it happens to share the database.
	AdvisoryLockKey int64
	// Hooks maps migration version → pre-migration hook. The hook
	// receives the pool (not the loop's pinned conn) so it can take
	// its own session-level locks. nil or missing entries mean "no
	// hook" and the migration runs straight through. Production main()
	// passes the direction-specific hook map; tests leave this nil unless they
	// exercise a hook.
	Hooks map[string]preMigrationHook
	// Conditions maps migration version → a read-only gate that decides
	// whether the SQL file should execute. A false result still advances the
	// migration ledger, allowing later migrations to run in environments where
	// this version's DDL is intentionally unnecessary.
	Conditions map[string]migrationCondition
	// RejectUnknownVersions prevents applying the fresh baseline over a retired ledger.
	RejectUnknownVersions bool
}

func main() {
	logger.Init()

	if len(os.Args) < 2 {
		fmt.Println("Usage: go run ./cmd/migrate <up|down>")
		os.Exit(1)
	}

	direction := os.Args[1]
	if direction != "up" && direction != "down" {
		fmt.Println("Usage: go run ./cmd/migrate <up|down>")
		os.Exit(1)
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://auro:auro@localhost:5432/auro?sslmode=disable"
	}

	startupSettings := dbstartup.SettingsFromEnv()
	poolConfig, err := dbstartup.ParsePoolConfig(dbURL, startupSettings.ConnectTimeout)
	if err != nil {
		slog.Error("unable to connect to database", "error", err)
		os.Exit(1)
	}
	poolConfig.ConnConfig.OnNotice = logMigrationNotice
	pool, err := pgxpool.NewWithConfig(context.Background(), poolConfig)
	if err != nil {
		slog.Error("unable to connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	files, err := migrations.Files(direction)
	if err != nil {
		slog.Error("failed to find migration files", "error", err)
		os.Exit(1)
	}

	options := runOptions{
		Direction:             direction,
		Files:                 files,
		RejectUnknownVersions: true,
	}
	startupCtx, stopStartup := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopStartup()
	retryOptions := startupSettings.RetryOptions()
	retryOptions.ShouldRetry = dbstartup.IsTransientDatabaseError
	retryOptions.OnRetry = func(event dbstartup.RetryEvent) {
		slog.Warn("database unavailable before migrations; retrying",
			"attempt", event.Attempt,
			"retry_in", event.Delay,
			"error", event.Err,
		)
	}
	if err := dbstartup.Retry(startupCtx, retryOptions, pool.Ping); err != nil {
		slog.Error("unable to ping database", "error", err)
		os.Exit(1)
	}

	migrationErr := runMigrations(startupCtx, pool, options)
	if migrationErr != nil && startupSettings.StartupTimeout > 0 && dbstartup.IsTransientDatabaseError(migrationErr) {
		slog.Warn("migration interrupted by database unavailability; retrying", "error", migrationErr)
		migrationRetryOptions := startupSettings.RetryOptions()
		migrationRetryOptions.ShouldRetry = dbstartup.IsTransientDatabaseError
		migrationRetryOptions.AllowOperationPastTimeout = true
		migrationRetryOptions.OnRetry = func(event dbstartup.RetryEvent) {
			slog.Warn("database unavailable during migration retry",
				"attempt", event.Attempt,
				"retry_in", event.Delay,
				"error", event.Err,
			)
		}
		migrationErr = dbstartup.Retry(startupCtx, migrationRetryOptions, func(attemptCtx context.Context) error {
			if err := pool.Ping(attemptCtx); err != nil {
				return fmt.Errorf("ping database: %w", err)
			}
			return runMigrations(attemptCtx, pool, options)
		})
	}
	if migrationErr != nil {
		slog.Error("migration run failed", "error", migrationErr)
		os.Exit(1)
	}

	fmt.Println("Done.")
}

// migrationReportPrefix marks a notice a migration raises on purpose to say
// what it changed, e.g.
//
//	RAISE NOTICE 'migration report: renamed % row(s)', n;
//
// Only these reach the migration log. The server's own notices cannot be told
// apart from a deliberate RAISE by condition code — "does not exist, skipping"
// and the rename notice of ADD CONSTRAINT ... USING INDEX both carry SQLSTATE
// 00000 — so the marker is explicit.
const migrationReportPrefix = "migration report: "

// migrationReport returns the text of a notice raised with
// migrationReportPrefix, and false for every other notice.
func migrationReport(notice *pgconn.Notice) (string, bool) {
	return strings.CutPrefix(notice.Message, migrationReportPrefix)
}

// logMigrationNotice forwards migration reports to the migration log. pgx
// drops server notices unless a handler is set, so without it the per-row
// report a data-repair migration prints (e.g. 476) never reached whoever ran
// the deploy.
func logMigrationNotice(_ *pgconn.PgConn, notice *pgconn.Notice) {
	if report, ok := migrationReport(notice); ok {
		slog.Info("migration report", "message", report)
	}
}

// runMigrations applies (direction="up") or rolls back (direction="down")
// the given file list against the supplied pool, serialized through a
// Postgres session-level advisory lock so multiple concurrent runners
// (multi-replica startup, scale-up, manual migrate overlap) take turns
// instead of racing each other.
//
// It is safe to invoke concurrently from multiple goroutines or
// processes against the same database with the same options: every
// caller blocks on pg_advisory_lock, and once it is their turn the
// already-applied EXISTS check turns each finished migration into a
// no-op skip. See GitHub auro-ai/auro#3647 / MUL-2923.
func runMigrations(ctx context.Context, pool *pgxpool.Pool, opts runOptions) error {
	switch opts.Direction {
	case "up", "down":
		// ok
	default:
		return fmt.Errorf("invalid direction %q (want \"up\" or \"down\")", opts.Direction)
	}

	table := opts.SchemaMigrationsTable
	if table == "" {
		table = defaultSchemaMigrationsTable
	}
	tableIdent, err := quoteQualifiedIdentifier(table)
	if err != nil {
		return fmt.Errorf("invalid schema migrations table %q: %w", table, err)
	}
	lockKey := opts.AdvisoryLockKey
	if lockKey == 0 {
		lockKey = migrationAdvisoryLockKey
	}

	// pg_advisory_lock is scoped to a single session, so we must pin one
	// *pgxpool.Conn for the whole run — calling pool.Exec would attach the
	// lock to a random connection that pgxpool could hand back out before
	// the loop finishes, making the lock effectively a no-op. We use the
	// blocking pg_advisory_lock (not pg_try_*) so a late-arriving runner
	// queues behind the current one instead of crash-looping; once it
	// acquires the lock the EXISTS checks below turn finished migrations
	// into no-op skips.
	//
	// We deliberately do NOT wrap the loop in a single transaction: the
	// repo already ships migrations using CREATE INDEX CONCURRENTLY,
	// which Postgres rejects inside a transaction block.
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire migration connection: %w", err)
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock($1)", lockKey); err != nil {
		return fmt.Errorf("acquire migration advisory lock: %w", err)
	}
	// Best-effort explicit unlock on the success path. On error returns
	// the defer still runs; on os.Exit error paths in main() it does not,
	// but session-level advisory locks are released automatically when
	// the connection closes at process exit, so the next runner is never
	// permanently blocked.
	defer func() {
		if _, err := conn.Exec(ctx, "SELECT pg_advisory_unlock($1)", lockKey); err != nil {
			slog.Warn("failed to release migration advisory lock", "error", err)
		}
	}()

	// Create migrations tracking table.
	if _, err := conn.Exec(ctx, fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS %s (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`, tableIdent)); err != nil {
		return fmt.Errorf("create migrations table: %w", err)
	}

	existsSQL := fmt.Sprintf("SELECT EXISTS(SELECT 1 FROM %s WHERE version = $1)", tableIdent)
	insertSQL := fmt.Sprintf("INSERT INTO %s (version) VALUES ($1)", tableIdent)
	deleteSQL := fmt.Sprintf("DELETE FROM %s WHERE version = $1", tableIdent)
	if opts.RejectUnknownVersions {
		versions := make([]string, len(opts.Files))
		for i, file := range opts.Files {
			versions[i] = migrations.ExtractVersion(file)
		}
		var unknown string
		err := conn.QueryRow(ctx, fmt.Sprintf("SELECT version FROM %s WHERE NOT (version = ANY($1::text[])) LIMIT 1", tableIdent), versions).Scan(&unknown)
		if err == nil {
			return fmt.Errorf("database contains retired migration %q; archive it and initialize an empty database with the current baseline", unknown)
		}
		if err != pgx.ErrNoRows {
			return fmt.Errorf("validate migration ledger: %w", err)
		}
	}

	for _, file := range opts.Files {
		version := migrations.ExtractVersion(file)

		var exists bool
		if err := conn.QueryRow(ctx, existsSQL, version).Scan(&exists); err != nil {
			return fmt.Errorf("check migration %q: %w", version, err)
		}

		if opts.Direction == "up" {
			if exists {
				fmt.Printf("  skip  %s (already applied)\n", version)
				continue
			}
		} else {
			if !exists {
				fmt.Printf("  skip  %s (not applied)\n", version)
				continue
			}
		}

		sql, err := os.ReadFile(file)
		if err != nil {
			return fmt.Errorf("read migration %q: %w", file, err)
		}

		// Run any pre-migration hook before the SQL file. Hooks
		// receive the *pgxpool.Pool (not the loop's pinned conn), so
		// they can acquire other session-level locks without
		// colliding with migrationAdvisoryLockKey. Hook failures
		// abort the run before schema_migrations is updated, so the
		// same version retries cleanly on the next invocation.
		if hook, ok := opts.Hooks[version]; ok && hook != nil {
			slog.Info("running pre-migration hook", "version", version, "direction", opts.Direction)
			if err := hook(ctx, pool); err != nil {
				return fmt.Errorf("pre-migration hook for %q (%s): %w", version, opts.Direction, err)
			}
		}

		applySQL := true
		conditionReason := ""
		if condition, ok := opts.Conditions[version]; ok && condition != nil {
			applySQL, conditionReason, err = condition(ctx, conn)
			if err != nil {
				return fmt.Errorf("evaluate migration condition for %q (%s): %w", version, opts.Direction, err)
			}
		}

		if applySQL {
			if _, err := conn.Exec(ctx, string(sql)); err != nil {
				return fmt.Errorf("apply migration %q: %w", file, err)
			}
		}

		if opts.Direction == "up" {
			_, err = conn.Exec(ctx, insertSQL, version)
		} else {
			_, err = conn.Exec(ctx, deleteSQL, version)
		}
		if err != nil {
			return fmt.Errorf("record migration %q: %w", version, err)
		}

		if applySQL {
			fmt.Printf("  %s  %s\n", opts.Direction, version)
		} else {
			fmt.Printf("  %s  %s (SQL skipped: %s)\n", opts.Direction, version, conditionReason)
		}
	}

	return nil
}

// quoteQualifiedIdentifier safely quotes either an unqualified table
// name ("foo") or a schema-qualified name ("schema.foo") for embedding
// into a SQL statement. Postgres does not let parametrized queries
// supply identifiers, so we have to interpolate, but pgx.Identifier
// does the right escaping (double-quotes, embedded-quote handling).
//
// The accepted shape is exactly one or two dot-separated components.
// Names containing more than one dot are rejected outright rather than
// silently sanitized into a "schema"."b.c" reference, which is valid
// SQL but almost certainly not what the caller meant.
func quoteQualifiedIdentifier(name string) (string, error) {
	if name == "" {
		return "", fmt.Errorf("empty identifier")
	}
	parts := strings.Split(name, ".")
	if len(parts) > 2 {
		return "", fmt.Errorf("identifier %q has more than one dot; only schema.table is supported", name)
	}
	for _, p := range parts {
		if p == "" {
			return "", fmt.Errorf("empty component in %q", name)
		}
	}
	return pgx.Identifier(parts).Sanitize(), nil
}
