package worldinbox_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/auro-ai/auro/server/internal/tanks"
	"github.com/auro-ai/auro/server/internal/testutil"
	"github.com/auro-ai/auro/server/internal/worldinbox"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func database(t *testing.T) (*pgxpool.Pool, *testutil.Fixture, tanks.Actor) {
	t.Helper()
	dsn := os.Getenv("WORLD_INBOX_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("WORLD_INBOX_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := "world_inbox_test_" + uuid.NewString()[:8]
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(ctx, "DROP SCHEMA "+quoted+" CASCADE"); err != nil {
			t.Error(err)
		}
	})
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	for _, table := range []string{"user", "workspace", "member", "inbox_item", "notification_preference", "game_policy", "game_world_override", "life_world"} {
		name := pgx.Identifier{table}.Sanitize()
		if _, err = pool.Exec(ctx, "CREATE TABLE "+name+" (LIKE public."+name+" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)"); err != nil {
			t.Fatal(err)
		}
	}
	files := []string{"../../migrations/566_tank_characters.up.sql"}
	for _, pattern := range []string{"../../migrations/58[5-8]_*.up.sql", "../../migrations/59[4-8]_*.up.sql"} {
		found, e := filepath.Glob(pattern)
		if e != nil {
			t.Fatal(e)
		}
		files = append(files, found...)
	}
	for _, file := range files {
		raw, e := os.ReadFile(file)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = pool.Exec(ctx, string(raw)); e != nil {
			t.Fatalf("%s: %v", file, e)
		}
	}
	fx := testutil.New(pool, "", "")
	u := fx.User(t, "Creator", "creator@example.invalid")
	w := fx.Workspace(t, "World", "world")
	fx.Member(t, w, u, "owner")
	return pool, fx, tanks.Actor{WorkspaceID: w, UserID: u}
}

func save(t *testing.T, s *tanks.Service, a tanks.Actor, origin string) tanks.Character {
	t.Helper()
	c, err := s.Save(context.Background(), a, tanks.SaveInput{RequestID: uuid.NewString(), Origin: origin, Draft: tanks.Draft{Profile: tanks.Rules.Profile, Name: "Forest scout", Parts: tanks.Parts{Chassis: "light", Armor: "light", Cannon: "rapid"}, Appearance: tanks.Appearance{Body: "#26834a", Accent: "#d6ef91", Pattern: "stripe"}}})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestDBDurableDeliveryHourlyDigestRetriesAndIsolation(t *testing.T) {
	pool, fx, a := database(t)
	ctx := context.Background()
	s := &tanks.Service{Pool: pool, AppURL: "http://localhost"}
	c := save(t, s, a, tanks.OriginMCP)
	other := fx.User(t, "Neighbor", "neighbor@example.invalid")
	fx.Member(t, a.WorkspaceID, other, "member")
	w2 := fx.Workspace(t, "Other", "other")
	fx.Member(t, w2, other, "owner")
	// Manual saves contribute world facts without a redundant personal notice.
	save(t, s, tanks.Actor{WorkspaceID: a.WorkspaceID, UserID: other}, tanks.OriginManual)
	in := tanks.SaveInput{RequestID: uuid.NewString(), Origin: tanks.OriginMCP, CharacterID: c.ID, ExpectedRevision: 1, Draft: c.Draft}
	in.Draft.Name = "Revised scout"
	for range 3 {
		if _, err := s.Save(ctx, a, in); err != nil {
			t.Fatal(err)
		}
	}
	if got := fx.Count(t, "SELECT count(*) FROM world_inbox_event"); got != 3 {
		t.Fatalf("retries created %d facts, want 3", got)
	}
	start := time.Now().UTC().Truncate(time.Hour).Add(-time.Hour)
	fx.Exec(t, "UPDATE member SET created_at=$1", start.Add(-time.Hour))
	fx.Exec(t, "UPDATE world_inbox_event SET occurred_at=$1", start.Add(10*time.Minute))
	worker := &worldinbox.Service{Pool: pool}
	// An insert failure rolls back personal delivery, digest rows and both markers.
	fx.Exec(t, `CREATE FUNCTION reject_digest() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='world_digest' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$`)
	fx.Exec(t, `CREATE TRIGGER reject_digest BEFORE INSERT ON inbox_item FOR EACH ROW EXECUTE FUNCTION reject_digest()`)
	if err := worker.Process(ctx, start.Add(time.Hour)); err == nil {
		t.Fatal("expected injected failure")
	}
	if got := fx.Count(t, "SELECT count(*) FROM inbox_item"); got != 0 {
		t.Fatalf("rollback left %d messages", got)
	}
	if got := fx.Count(t, "SELECT count(*) FROM world_inbox_event WHERE delivered_at IS NOT NULL OR summarized_at IS NOT NULL"); got != 0 {
		t.Fatalf("rollback advanced %d markers", got)
	}
	fx.Exec(t, "DROP TRIGGER reject_digest ON inbox_item")
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			if err := worker.Process(ctx, start.Add(time.Hour)); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if err := worker.Process(ctx, start.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if got := fx.Count(t, "SELECT count(*) FROM inbox_item WHERE type='creation_ready' AND recipient_id=$1::uuid", a.UserID); got != 1 {
		t.Fatalf("coalesced personal messages=%d want 1", got)
	}
	if got := fx.Count(t, "SELECT count(*) FROM inbox_item WHERE type='world_digest'"); got != 2 {
		t.Fatalf("world digests=%d want 2", got)
	}
	if got := fx.Count(t, "SELECT count(*) FROM inbox_item WHERE workspace_id=$1::uuid", w2); got != 0 {
		t.Fatalf("cross-world messages=%d", got)
	}
	var raw []byte
	if err := pool.QueryRow(ctx, "SELECT content FROM inbox_item WHERE type='world_digest' LIMIT 1").Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var content worldinbox.Content
	if err := json.Unmarshal(raw, &content); err != nil {
		t.Fatal(err)
	}
	if content.Totals.Created != 2 || content.Totals.Updated != 1 || len(content.Entries) != 3 {
		t.Fatalf("digest=%s", raw)
	}
	// Once read/archived, retries neither reopen the message nor change its content.
	fx.Exec(t, "UPDATE inbox_item SET read=true,archived=true")
	if err := worker.Process(ctx, start.Add(2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if got := fx.Count(t, "SELECT count(*) FROM inbox_item WHERE NOT read OR NOT archived"); got != 0 {
		t.Fatalf("retries resurrected %d messages", got)
	}
	var after []byte
	if err := pool.QueryRow(ctx, "SELECT content FROM inbox_item WHERE type='world_digest' LIMIT 1").Scan(&after); err != nil {
		t.Fatal(err)
	}
	if string(raw) != string(after) {
		t.Fatal("published digest was rewritten")
	}
}

func TestDBGrowthIsAtomicAndDepartedMembersReceiveNoMessages(t *testing.T) {
	pool, fx, a := database(t)
	ctx := context.Background()
	s := &tanks.Service{Pool: pool, AppURL: "http://localhost"}
	c := save(t, s, a, tanks.OriginManual)
	session, err := s.CreateSession(ctx, a, tanks.SessionInput{RequestID: uuid.NewString(), CharacterID: c.ID, Revision: c.Revision, ContentHash: c.ContentHash, MapID: "frontline", Mode: "campaign"})
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.StartTraining(ctx, a, session.ID, tanks.TrainingStart{RequestID: uuid.NewString(), LevelID: 1})
	if err != nil {
		t.Fatal(err)
	}
	fx.Exec(t, "UPDATE tank_training_run SET started_at=now()-interval '1 minute'")
	in := tanks.TrainingSummary{Ticks: 3600, Kills: 12, Outcome: "cleared"}
	for range 3 {
		if _, err = s.SettleTraining(ctx, a, session.ID, run.ID, in); err != nil {
			t.Fatal(err)
		}
	}
	if got := fx.Count(t, "SELECT count(*) FROM world_inbox_event WHERE kind='tank_level_up'"); got != 1 {
		t.Fatalf("milestone facts=%d want 1", got)
	}
	fx.Exec(t, "DELETE FROM member WHERE user_id=$1::uuid", a.UserID)
	if err = (&worldinbox.Service{Pool: pool}).Process(ctx, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if got := fx.Count(t, "SELECT count(*) FROM inbox_item"); got != 0 {
		t.Fatalf("departed member received %d messages", got)
	}
}

func TestDBSubscriptionsAreIndependentAndDefaultToWholeWorld(t *testing.T) {
	pool, fx, a := database(t)
	ctx := context.Background()
	other := fx.User(t, "Neighbor", "neighbor@example.invalid")
	fx.Member(t, a.WorkspaceID, other, "member")
	fx.Insert(t, "notification_preference", testutil.Cols{"workspace_id": a.WorkspaceID, "user_id": a.UserID, "preferences": []byte(`{"creation_updates":"muted"}`)})
	fx.Insert(t, "notification_preference", testutil.Cols{"workspace_id": a.WorkspaceID, "user_id": other, "preferences": []byte(`{"world_digests":"muted"}`)})
	save(t, &tanks.Service{Pool: pool}, a, tanks.OriginMCP)
	start := time.Now().UTC().Truncate(time.Hour).Add(-time.Hour)
	fx.Exec(t, "UPDATE member SET created_at=$1", start.Add(-time.Hour))
	fx.Exec(t, "UPDATE world_inbox_event SET occurred_at=$1", start.Add(time.Minute))
	if err := (&worldinbox.Service{Pool: pool}).Process(ctx, start.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if got := fx.Count(t, "SELECT count(*) FROM inbox_item WHERE recipient_id=$1::uuid AND type='world_digest'", a.UserID); got != 1 {
		t.Fatalf("default world subscription delivered %d digests", got)
	}
	if got := fx.Count(t, "SELECT count(*) FROM inbox_item WHERE type='creation_ready' OR recipient_id=$1::uuid", other); got != 0 {
		t.Fatalf("muted subscriptions delivered %d messages", got)
	}
}

func TestDBClosedGamesSuppressNewDeliveryAndHiddenGamesRemainAvailable(t *testing.T) {
	pool, fx, a := database(t)
	ctx := context.Background()
	s := &tanks.Service{Pool: pool}
	start := time.Now().UTC().Truncate(time.Hour).Add(-time.Hour)
	save(t, s, a, tanks.OriginMCP)
	fx.Exec(t, "UPDATE member SET created_at=$1", start.Add(-time.Hour))
	fx.Exec(t, "UPDATE world_inbox_event SET occurred_at=$1", start.Add(time.Minute))
	fx.Exec(t, "INSERT INTO game_policy(game_id,scope,default_visible,revision,updated_by) VALUES('tanks','disabled',false,1,$1::uuid)", a.UserID)
	worker := &worldinbox.Service{Pool: pool}
	if err := worker.Process(ctx, start.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if got := fx.Count(t, "SELECT count(*) FROM inbox_item"); got != 0 {
		t.Fatalf("closed game leaked %d messages", got)
	}
	fx.Exec(t, "UPDATE game_policy SET scope='all'")
	save(t, s, a, tanks.OriginMCP)
	fx.Exec(t, "UPDATE world_inbox_event SET occurred_at=$1 WHERE summarized_at IS NULL", start.Add(61*time.Minute))
	if err := worker.Process(ctx, start.Add(2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if got := fx.Count(t, "SELECT count(*) FROM inbox_item"); got != 2 {
		t.Fatalf("hidden available game delivered %d messages, want personal and digest", got)
	}
	fx.Exec(t, "UPDATE game_policy SET scope='disabled'")
	if err := worker.Process(ctx, start.Add(3*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if got := fx.Count(t, "SELECT count(*) FROM inbox_item"); got != 2 {
		t.Fatalf("closing game changed %d historical messages", got)
	}
}
