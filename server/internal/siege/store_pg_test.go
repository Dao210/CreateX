package siege

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// The PostgreSQL store is the backend the hosted game actually runs on, so it
// gets its own integration test rather than riding on the file store's.
//
// It is gated on SIEGE_TEST_PG_DSN instead of the package-wide test database:
// the queries below own their schema (migration 564, applied here so there is
// one source of truth), and a scratch database keeps the assertions about
// capacity counts and daily budgets from colliding with rows other suites left
// behind.
//
//	SIEGE_TEST_PG_DSN='postgres:///siege_probe' go test ./internal/siege -run PGStore
func openTestPG(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("SIEGE_TEST_PG_DSN")
	if dsn == "" {
		t.Skip("SIEGE_TEST_PG_DSN not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	schema, err := os.ReadFile(filepath.Join("..", "..", "migrations", "564_siege_session.up.sql"))
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	if _, err = pool.Exec(ctx, string(schema)); err != nil {
		t.Fatalf("apply migration: %v", err)
	}
	// Each test starts from an empty table: capacity is counted across the whole
	// table, so leftovers from a previous run would change the outcome.
	if _, err = pool.Exec(ctx, `TRUNCATE siege_session, siege_recognition_budget`); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	return pool
}

func TestPGStoreCreateIsIdempotent(t *testing.T) {
	pool := openTestPG(t)
	store := OpenPGStore(pool)
	owner := Owner{WorkspaceID: "0d1f4a8e-9c2b-4a71-8f3d-5b6e7c8d9a01", UserID: "6f1a1f9c-3c4a-4c1a-9b8e-2f1d0b6a7c55"}

	build := func() *Session {
		return &Session{ID: "11111111-1111-1111-1111-111111111111", Version: 1, CreateRequest: "req-1"}
	}
	first, err := store.CreateSession(owner, "req-1", build)
	if err != nil {
		t.Fatalf("first create: %v", err)
	}
	// A retried create carries a fresh session body; the stored one must win.
	second, err := store.CreateSession(owner, "req-1", func() *Session {
		return &Session{ID: "22222222-2222-2222-2222-222222222222", Version: 1, CreateRequest: "req-1"}
	})
	if err != nil {
		t.Fatalf("retried create: %v", err)
	}
	if second.ID != first.ID {
		t.Errorf("retried create returned %s, want the original %s", second.ID, first.ID)
	}
	var rows int
	if err := pool.QueryRow(context.Background(), `select count(*) from siege_session`).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Errorf("rows = %d, want 1", rows)
	}
}

func TestPGStoreIsolatesOwners(t *testing.T) {
	pool := openTestPG(t)
	store := OpenPGStore(pool)
	owner := Owner{WorkspaceID: "0d1f4a8e-9c2b-4a71-8f3d-5b6e7c8d9a01", UserID: "6f1a1f9c-3c4a-4c1a-9b8e-2f1d0b6a7c55"}
	session, err := store.CreateSession(owner, "req-1", func() *Session {
		return &Session{ID: "11111111-1111-1111-1111-111111111111", Version: 1, CreateRequest: "req-1"}
	})
	if err != nil {
		t.Fatal(err)
	}

	// Same workspace, different member: the session must not be reachable.
	_, err = store.ReadSession(session.ID, Owner{WorkspaceID: owner.WorkspaceID, UserID: "99999999-9999-9999-9999-999999999999"})
	var p *Problem
	if !errors.As(err, &p) || p.Code != "not_found" {
		t.Errorf("foreign read error = %v, want not_found", err)
	}
	// Same member, different workspace: likewise.
	_, err = store.ReadSession(session.ID, Owner{WorkspaceID: "0d1f4a8e-9c2b-4a71-8f3d-000000000000", UserID: owner.UserID})
	if !errors.As(err, &p) || p.Code != "not_found" {
		t.Errorf("cross-workspace read error = %v, want not_found", err)
	}
}

func TestPGStoreLockExcludesConcurrentWriters(t *testing.T) {
	pool := openTestPG(t)
	store := OpenPGStore(pool)
	owner := Owner{WorkspaceID: "0d1f4a8e-9c2b-4a71-8f3d-5b6e7c8d9a01", UserID: "6f1a1f9c-3c4a-4c1a-9b8e-2f1d0b6a7c55"}
	session, err := store.CreateSession(owner, "req-1", func() *Session {
		return &Session{ID: "11111111-1111-1111-1111-111111111111", Version: 1, CreateRequest: "req-1"}
	})
	if err != nil {
		t.Fatal(err)
	}

	locked, release, err := store.LockSession(session.ID, owner)
	if err != nil {
		t.Fatalf("lock: %v", err)
	}
	if locked.ID != session.ID {
		t.Errorf("locked %s, want %s", locked.ID, session.ID)
	}

	// A second writer gets service_busy rather than blocking: the handler turns
	// this into a 429 so a client retries instead of piling up connections.
	// pg_try_advisory_lock never waits, so this is safe to call inline.
	var p *Problem
	if _, _, busyErr := store.LockSession(session.ID, owner); !errors.As(busyErr, &p) || p.Code != "service_busy" {
		t.Fatalf("second lock error = %v, want service_busy", busyErr)
	}

	release()
	// After release the lock is available again — this is the assertion that
	// would fail if the unlock closure forgot to return the connection.
	if _, release2, err := store.LockSession(session.ID, owner); err != nil {
		t.Fatalf("relock: %v", err)
	} else {
		release2()
	}
}

func TestPGStoreSavesVersionAndRejectsMissingRows(t *testing.T) {
	pool := openTestPG(t)
	store := OpenPGStore(pool)
	owner := Owner{WorkspaceID: "0d1f4a8e-9c2b-4a71-8f3d-5b6e7c8d9a01", UserID: "6f1a1f9c-3c4a-4c1a-9b8e-2f1d0b6a7c55"}
	session, err := store.CreateSession(owner, "req-1", func() *Session {
		return &Session{ID: "11111111-1111-1111-1111-111111111111", Version: 1, CreateRequest: "req-1"}
	})
	if err != nil {
		t.Fatal(err)
	}

	session.Version = 2
	if err = store.SaveSession(session); err != nil {
		t.Fatalf("save: %v", err)
	}
	reread, err := store.ReadSession(session.ID, owner)
	if err != nil {
		t.Fatal(err)
	}
	if reread.Version != 2 {
		t.Errorf("version = %d, want 2", reread.Version)
	}

	session.ID = "33333333-3333-3333-3333-333333333333"
	var p *Problem
	if err = store.SaveSession(session); !errors.As(err, &p) || p.Code != "not_found" {
		t.Errorf("save of a missing row error = %v, want not_found", err)
	}
}

func TestPGStoreReserveBudgetMatchesFileStore(t *testing.T) {
	pool := openTestPG(t)
	store := OpenPGStore(pool)
	owner := Owner{WorkspaceID: "0d1f4a8e-9c2b-4a71-8f3d-5b6e7c8d9a01", UserID: "6f1a1f9c-3c4a-4c1a-9b8e-2f1d0b6a7c55"}

	// A budget of zero means "no recognitions": the insert branch must not hand
	// out the first one for free.
	var p *Problem
	if err := store.ReserveBudget(owner, 0); !errors.As(err, &p) || p.Code != "recognition_budget" {
		t.Fatalf("budget 0 error = %v, want recognition_budget", err)
	}

	for i := range 2 {
		if err := store.ReserveBudget(owner, 2); err != nil {
			t.Fatalf("call %d: %v", i+1, err)
		}
	}
	if err := store.ReserveBudget(owner, 2); !errors.As(err, &p) || p.Code != "recognition_budget" {
		t.Errorf("third call error = %v, want recognition_budget", err)
	}
	// The budget is per member, so another member still has their own allowance.
	if err := store.ReserveBudget(Owner{WorkspaceID: owner.WorkspaceID, UserID: "99999999-9999-9999-9999-999999999999"}, 2); err != nil {
		t.Errorf("other member: %v", err)
	}
}
