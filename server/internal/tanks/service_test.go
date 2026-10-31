package tanks

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

func tankDB(t *testing.T) (*Service, *testutil.Fixture, Actor) {
	t.Helper()
	dsn := os.Getenv("TANKS_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TANKS_TEST_DATABASE_URL not set")
	}
	pool, e := pgxpool.New(context.Background(), dsn)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(pool.Close)
	fx := testutil.New(pool, "", "")
	suffix := uuid.NewString()
	fx.UserID = fx.User(t, "Tank test", "tank-"+suffix+"@example.invalid")
	fx.WorkspaceID = fx.Workspace(t, "Tank test", "tank-"+suffix)
	fx.Member(t, fx.WorkspaceID, fx.UserID, "owner")
	for _, table := range []string{"tank_training_run", "tank_request", "tank_play_session", "tank_character_revision", "tank_character"} {
		fx.Cleanup(t, "DELETE FROM "+table+" WHERE workspace_id=$1::uuid", fx.WorkspaceID)
	}
	return &Service{Pool: pool, AppURL: "http://localhost:13440"}, fx, Actor{WorkspaceID: fx.WorkspaceID, UserID: fx.UserID}
}
func wantCode(t *testing.T, err error, code string) {
	t.Helper()
	var p *Problem
	if !errors.As(err, &p) || p.Code != code {
		t.Fatalf("error=%v, want %s", err, code)
	}
}
func TestTankDBVersioningAndFrozenSessions(t *testing.T) {
	s, fx, a := tankDB(t)
	ctx := context.Background()
	in := SaveInput{RequestID: uuid.NewString(), Draft: testDraft()}
	first, e := s.Save(ctx, a, in)
	if e != nil {
		t.Fatal(e)
	}
	replay, e := s.Save(ctx, a, in)
	if e != nil || replay.ID != first.ID {
		t.Fatalf("replay=%+v, error=%v", replay, e)
	}
	changed := in
	changed.Draft.Name = "Different intent"
	_, e = s.Save(ctx, a, changed)
	wantCode(t, e, "idempotency_key_reused")
	launch := SessionInput{RequestID: uuid.NewString(), CharacterID: first.ID, Revision: first.Revision, ContentHash: first.ContentHash, MapID: "depot", Mode: "survival"}
	session, e := s.CreateSession(ctx, a, launch)
	if e != nil {
		t.Fatal(e)
	}
	if session.LevelID != 4 || session.Mode != "survival" || session.Character.Blueprint.Speed != 106 {
		t.Fatalf("session=%+v", session)
	}
	if session.PlayURL != "http://localhost:13440"+session.PlayPath {
		t.Fatalf("launch URL=%s", session.PlayURL)
	}
	sessionReplay, e := s.CreateSession(ctx, a, launch)
	if e != nil || sessionReplay.ID != session.ID {
		t.Fatalf("session replay=%+v, error=%v", sessionReplay, e)
	}
	update := SaveInput{RequestID: uuid.NewString(), CharacterID: first.ID, ExpectedRevision: 1, Draft: first.Draft}
	update.Draft.Parts.Chassis = "heavy"
	second, e := s.Save(ctx, a, update)
	if e != nil {
		t.Fatal(e)
	}
	if second.Revision != 2 || second.ContentHash == first.ContentHash {
		t.Fatalf("second=%+v", second)
	}
	update.RequestID = uuid.NewString()
	_, e = s.Save(ctx, a, update)
	wantCode(t, e, "revision_conflict")
	old, e := s.GetCharacter(ctx, a, first.ID, 1)
	if e != nil || old.ContentHash != first.ContentHash {
		t.Fatalf("old=%+v, error=%v", old, e)
	}
	frozen, e := s.GetSession(ctx, a, session.ID)
	if e != nil || frozen.Character.Revision != 1 || frozen.Character.Blueprint.Speed != 106 {
		t.Fatalf("frozen=%+v error=%v", frozen, e)
	}
	bad := launch
	bad.RequestID = uuid.NewString()
	bad.ContentHash = "sha256:wrong"
	_, e = s.CreateSession(ctx, a, bad)
	wantCode(t, e, "character_hash_mismatch")
	bad = launch
	bad.RequestID = uuid.NewString()
	bad.MapID = "unknown"
	_, e = s.CreateSession(ctx, a, bad)
	wantCode(t, e, "character_incompatible")
	otherUser := fx.User(t, "Other member", "tank-other-"+uuid.NewString()+"@example.invalid")
	fx.Member(t, a.WorkspaceID, otherUser, "member")
	_, e = s.GetSession(ctx, Actor{WorkspaceID: a.WorkspaceID, UserID: otherUser}, session.ID)
	wantCode(t, e, "not_found")
	update.RequestID = uuid.NewString()
	update.ExpectedRevision = 2
	_, e = s.Save(ctx, Actor{WorkspaceID: a.WorkspaceID, UserID: otherUser}, update)
	wantCode(t, e, "not_found")
	_, e = s.GetCharacter(ctx, Actor{WorkspaceID: uuid.NewString(), UserID: a.UserID}, first.ID, 1)
	wantCode(t, e, "not_found")
	fx.Exec(t, `UPDATE tank_play_session SET payload=jsonb_set(payload,'{expiresAt}','"2000-01-01T00:00:00Z"') WHERE id=$1::uuid`, session.ID)
	_, e = s.GetSession(ctx, a, session.ID)
	wantCode(t, e, "session_expired")
	if count := fx.Count(t, `SELECT count(*) FROM tank_character WHERE workspace_id=$1::uuid`, a.WorkspaceID); count != 1 {
		t.Fatalf("character rows=%d", count)
	}
}
func TestTankDBConcurrentRetriesAndConflicts(t *testing.T) {
	s, fx, a := tankDB(t)
	ctx := context.Background()
	in := SaveInput{RequestID: uuid.NewString(), Draft: testDraft()}
	var wg sync.WaitGroup
	results := make(chan Character, 8)
	errs := make(chan error, 8)
	for range 8 {
		wg.Go(func() { c, e := s.Save(ctx, a, in); results <- c; errs <- e })
	}
	wg.Wait()
	close(results)
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	var id string
	for c := range results {
		if id == "" {
			id = c.ID
		}
		if id != c.ID {
			t.Fatal("retry created duplicate character")
		}
	}
	if count := fx.Count(t, `SELECT count(*) FROM tank_character WHERE workspace_id=$1::uuid`, a.WorkspaceID); count != 1 {
		t.Fatalf("rows=%d", count)
	}
	updates := make(chan error, 4)
	for range 4 {
		wg.Go(func() {
			_, e := s.Save(ctx, a, SaveInput{RequestID: uuid.NewString(), Draft: testDraft(), CharacterID: id, ExpectedRevision: 1})
			updates <- e
		})
	}
	wg.Wait()
	close(updates)
	success, conflict := 0, 0
	for e := range updates {
		if e == nil {
			success++
		} else {
			wantCode(t, e, "revision_conflict")
			conflict++
		}
	}
	if success != 1 || conflict != 3 {
		t.Fatalf("success=%d conflicts=%d", success, conflict)
	}
}
