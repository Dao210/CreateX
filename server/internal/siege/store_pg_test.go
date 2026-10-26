package siege

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"

	"github.com/auro-ai/auro/server/internal/testutil"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPGStoreConcurrentCreatesRespectMemberQuota(t *testing.T) {
	pool, owner := openTestPG(t)
	store := OpenPGStore(pool)
	var workers sync.WaitGroup
	errorsCh := make(chan error, 12)
	for range 12 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			request := uuid.NewString()
			_, err := store.CreateSession(owner, request, func() *Session {
				return &Session{ID: uuid.NewString(), Version: 1, CreateRequest: request}
			})
			errorsCh <- err
		}()
	}
	workers.Wait()
	close(errorsCh)
	accepted := 0
	for err := range errorsCh {
		if err == nil {
			accepted++
			continue
		}
		var p *Problem
		if !errors.As(err, &p) || p.Code != "capacity_reached" {
			t.Fatalf("concurrent create: %v", err)
		}
	}
	if accepted != maxSessionsPerOwner {
		t.Fatalf("accepted %d sessions, want %d", accepted, maxSessionsPerOwner)
	}
}

// PostgreSQL tests share the migrated test database and clean only their fixture rows.
func openTestPG(t *testing.T) (*pgxpool.Pool, Owner) {
	t.Helper()
	dsn := os.Getenv("SIEGE_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("SIEGE_TEST_DATABASE_URL not set")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	fx := testutil.New(pool, "", "")
	suffix := uuid.NewString()
	fx.UserID = fx.User(t, "Siege test", "siege-"+suffix+"@example.invalid")
	fx.WorkspaceID = fx.Workspace(t, "Siege test", "siege-"+suffix)
	fx.Member(t, fx.WorkspaceID, fx.UserID, "owner")
	for _, table := range []string{"siege_session", "siege_recognition_budget"} {
		fx.Cleanup(t, "DELETE FROM "+table+" WHERE workspace_id=$1::uuid", fx.WorkspaceID)
	}
	return pool, Owner{WorkspaceID: fx.WorkspaceID, UserID: fx.UserID}
}

func TestPGStoreCreateIsIdempotent(t *testing.T) {
	pool, owner := openTestPG(t)
	store := OpenPGStore(pool)

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
	if err := pool.QueryRow(context.Background(), `select count(*) from siege_session where workspace_id=$1::uuid`, owner.WorkspaceID).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Errorf("rows = %d, want 1", rows)
	}
}

func TestPGStoreIsolatesOwners(t *testing.T) {
	pool, owner := openTestPG(t)
	store := OpenPGStore(pool)
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
	pool, owner := openTestPG(t)
	store := OpenPGStore(pool)
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
	pool, owner := openTestPG(t)
	store := OpenPGStore(pool)
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

func TestPGStoreReserveBudget(t *testing.T) {
	pool, owner := openTestPG(t)
	store := OpenPGStore(pool)

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
	fx := testutil.New(pool, owner.WorkspaceID, "")
	other := fx.User(t, "Other member", "other-"+uuid.NewString()+"@example.invalid")
	fx.Member(t, owner.WorkspaceID, other, "member")
	if err := store.ReserveBudget(Owner{WorkspaceID: owner.WorkspaceID, UserID: other}, 2); err != nil {
		t.Errorf("other member: %v", err)
	}
}
