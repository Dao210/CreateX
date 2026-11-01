package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/auro-ai/auro/server/internal/migrations"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestBaselineInitializesAndRollsBack(t *testing.T) {
	admin := openTestPool(t)
	ctx := context.Background()
	f := newFixture(t)
	// Use a disposable schema; no existing account, world or game data is touched.
	cfg := admin.Config().Copy()
	cfg.ConnConfig.RuntimeParams["search_path"] = f.schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	up, err := migrations.Files("up")
	if err != nil {
		t.Fatal(err)
	}
	opts := runOptions{Direction: "up", Files: up, SchemaMigrationsTable: f.schema + ".schema_migrations", AdvisoryLockKey: f.lockKey, RejectUnknownVersions: true}
	if err := runMigrations(ctx, pool, opts); err != nil {
		t.Fatal(err)
	}
	var retired, foreignKeys, invalid int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_tables WHERE schemaname=$1 AND tablename ~ '^(issue|project|squad|comment|source_context|search_index|pinned_item)'`, f.schema).Scan(&retired); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 AND c.contype='f'`, f.schema).Scan(&foreignKeys); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT i.indisvalid`, f.schema).Scan(&invalid); err != nil {
		t.Fatal(err)
	}
	if retired != 0 || foreignKeys != 0 || invalid != 0 {
		t.Fatalf("retired=%d foreignKeys=%d invalidIndexes=%d", retired, foreignKeys, invalid)
	}
	// Repeated startup does not reapply tables or constraints.
	if err := runMigrations(ctx, pool, opts); err != nil {
		t.Fatal(err)
	}
	down, err := migrations.Files("down")
	if err != nil {
		t.Fatal(err)
	}
	opts.Direction = "down"
	opts.Files = down
	if err := runMigrations(ctx, pool, opts); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_tables WHERE schemaname=$1 AND tablename<>'schema_migrations'`, f.schema).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("rollback left %d tables", count)
	}
	opts.Direction = "up"
	opts.Files = up
	if err := runMigrations(ctx, pool, opts); err != nil {
		t.Fatal(err)
	}
	// A historical ledger must fail before touching current tables.
	if _, err := pool.Exec(ctx, "INSERT INTO "+pgx.Identifier{f.schema, "schema_migrations"}.Sanitize()+"(version) VALUES('598_world_inbox_residents')"); err != nil {
		t.Fatal(err)
	}
	if err := runMigrations(ctx, pool, opts); err == nil || !strings.Contains(err.Error(), "retired migration") {
		t.Fatalf("legacy ledger: %v", err)
	}
}

func TestBaselineIndexPolicy(t *testing.T) {
	files, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		body, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		sql := string(body)
		if strings.Contains(sql, "FOREIGN KEY") || strings.Contains(sql, "ON DELETE CASCADE") {
			t.Errorf("%s creates a foreign key", file)
		}
		if strings.HasPrefix(sql, "CREATE ") && strings.Contains(strings.SplitN(sql, "\n", 2)[0], "INDEX") {
			if !strings.Contains(sql, "INDEX CONCURRENTLY IF NOT EXISTS") || strings.Count(sql, ";") != 1 {
				t.Errorf("%s violates concurrent single-statement index policy", file)
			}
		}
	}
}
