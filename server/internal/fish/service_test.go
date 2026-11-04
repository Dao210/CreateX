package fish

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/auro-ai/auro/server/internal/testutil"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
)

func fishDB(t *testing.T) (*Service, *testutil.Fixture, Actor) {
	t.Helper()
	dsn := os.Getenv("FISH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("FISH_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	admin, e := pgxpool.New(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(admin.Close)
	schema := "fish_test_" + uuid.NewString()[:8]
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, e = admin.Exec(ctx, "CREATE SCHEMA "+quoted); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _, _ = admin.Exec(ctx, "DROP SCHEMA "+quoted+" CASCADE") })
	cfg, e := pgxpool.ParseConfig(dsn)
	if e != nil {
		t.Fatal(e)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(pool.Close)
	for _, table := range []string{"user", "workspace", "member", "fish_character", "fish_revision", "fish_ocean", "fish_resident", "fish_request"} {
		name := pgx.Identifier{table}.Sanitize()
		if _, e = pool.Exec(ctx, "CREATE TABLE "+name+" (LIKE public."+name+" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)"); e != nil {
			t.Fatal(e)
		}
	}
	fx := testutil.New(pool, "", "")
	fx.UserID = fx.User(t, "Fish creator", "fish@example.invalid")
	fx.WorkspaceID = fx.Workspace(t, "Fish world", "fish-world")
	fx.Member(t, fx.WorkspaceID, fx.UserID, "owner")
	return &Service{Pool: pool, AppURL: "https://app.example.invalid"}, fx, Actor{fx.WorkspaceID, fx.UserID}
}
func wantCode(t *testing.T, e error, code string) {
	t.Helper()
	var p *Problem
	if !errors.As(e, &p) || p.Code != code {
		t.Fatalf("error=%v want=%s", e, code)
	}
}
func TestFishDBLifecycleRetriesAndPrivacy(t *testing.T) {
	s, fx, a := fishDB(t)
	ctx := context.Background()
	other := Actor{a.WorkspaceID, fx.User(t, "Visitor", "visitor@example.invalid")}
	fx.Member(t, a.WorkspaceID, other.UserID, "member")
	in := SaveInput{RequestID: uuid.NewString(), Draft: Rules.Examples[0], Origin: "mcp"}
	first, e := s.Save(ctx, a, in)
	if e != nil {
		t.Fatal(e)
	}
	replay, e := s.Save(ctx, a, in)
	if e != nil || replay.ID != first.ID {
		t.Fatalf("replay=%+v %v", replay, e)
	}
	in.Draft.Name = "Changed intent"
	_, e = s.Save(ctx, a, in)
	wantCode(t, e, "idempotency_key_reused")
	_, e = s.Get(ctx, other, first.ID, 0)
	wantCode(t, e, "not_found")
	ocean, e := s.EnsureOcean(ctx, a, uuid.NewString())
	if e != nil {
		t.Fatal(e)
	}
	secondOcean, e := s.EnsureOcean(ctx, a, uuid.NewString())
	if e != nil || secondOcean.ID != ocean.ID {
		t.Fatalf("ocean identity %v", e)
	}
	_, e = s.Ocean(ctx, other, ocean.ID)
	wantCode(t, e, "not_found")
	release := ReleaseInput{RequestID: uuid.NewString(), OceanID: optionalOceanID(ocean.ID), FishID: first.ID, Revision: first.Revision, ContentHash: first.ContentHash}
	resident, e := s.Release(ctx, a, release)
	if e != nil {
		t.Fatal(e)
	}
	again, e := s.Release(ctx, a, release)
	if e != nil || again.Resident.ID != resident.Resident.ID {
		t.Fatal("release retry", e)
	}
	release.RequestID = uuid.NewString()
	_, e = s.Release(ctx, a, release)
	wantCode(t, e, "already_released")
	update := SaveInput{RequestID: uuid.NewString(), FishID: first.ID, ExpectedRevision: 1, Draft: first.Draft}
	update.Draft.Name = "Longer tail"
	update.Draft.Tail.Length = 600
	second, e := s.Save(ctx, a, update)
	if e != nil {
		t.Fatal(e)
	}
	o, e := s.Ocean(ctx, a, ocean.ID)
	if e != nil || o.Residents[0].Fish.Revision != 1 {
		t.Fatal("save changed frozen resident", e)
	}
	apply := ApplyInput{ReleaseInput: ReleaseInput{RequestID: uuid.NewString(), OceanID: optionalOceanID(ocean.ID), FishID: first.ID, Revision: 2, ContentHash: second.ContentHash}, ResidentID: resident.Resident.ID, ExpectedResidentRevision: 1}
	withoutTarget := apply
	withoutTarget.OceanID = ""
	_, e = s.Apply(ctx, a, withoutTarget)
	wantCode(t, e, "invalid_request")
	grown, e := s.Apply(ctx, a, apply)
	if e != nil || grown.Resident.ID != resident.Resident.ID || grown.Resident.Fish.Revision != 2 {
		t.Fatal("apply", e)
	}
	apply.RequestID = uuid.NewString()
	_, e = s.Apply(ctx, a, apply)
	wantCode(t, e, "resident_revision_conflict")
	o, _ = s.Ocean(ctx, a, ocean.ID)
	_, e = s.Settings(ctx, a, uuid.NewString(), ocean.ID, "world", o.Revision)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Ocean(ctx, other, ocean.ID); e != nil {
		t.Fatal("world sharing", e)
	}
	visitorFish, e := s.Save(ctx, other, SaveInput{RequestID: uuid.NewString(), Draft: Rules.Examples[0]})
	if e != nil {
		t.Fatal(e)
	}
	_, e = s.Release(ctx, other, ReleaseInput{RequestID: uuid.NewString(), OceanID: optionalOceanID(ocean.ID), FishID: visitorFish.ID, Revision: visitorFish.Revision, ContentHash: visitorFish.ContentHash})
	wantCode(t, e, "not_found")
	if count := fx.Count(t, "SELECT count(*) FROM fish_ocean"); count != 1 {
		t.Fatalf("explicit foreign target created an ocean: count=%d", count)
	}
	recall := RecallInput{RequestID: uuid.NewString(), ResidentID: grown.Resident.ID, ExpectedResidentRevision: grown.Resident.Revision}
	_, e = s.Recall(ctx, other, recall)
	wantCode(t, e, "not_found")
	if _, e = s.Recall(ctx, a, recall); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Recall(ctx, a, recall); e != nil {
		t.Fatal("recall retry", e)
	}
	o, _ = s.Ocean(ctx, a, ocean.ID)
	if len(o.Residents) != 0 {
		t.Fatal("recalled fish survived")
	}
	if _, e = s.Get(ctx, a, first.ID, 1); e != nil {
		t.Fatal("recall deleted creation", e)
	}
	release.RequestID = uuid.NewString()
	restored, e := s.Release(ctx, a, release)
	if e != nil || restored.Resident.ID != resident.Resident.ID || restored.Resident.Revision != 4 {
		t.Fatal("resident restore", e)
	}
	_, e = s.Archive(ctx, a, uuid.NewString(), first.ID, true)
	if e != nil {
		t.Fatal(e)
	}
	list, e := s.List(ctx, a)
	if e != nil || !list[0].Archived {
		t.Fatal("archive", e)
	}
	fx.Exec(t, `DELETE FROM member WHERE workspace_id=$1::uuid AND user_id=$2::uuid`, a.WorkspaceID, a.UserID)
	_, e = s.Ocean(ctx, other, ocean.ID)
	wantCode(t, e, "not_found")
	update.RequestID = uuid.NewString()
	update.ExpectedRevision = 2
	_, e = s.Save(ctx, a, update)
	wantCode(t, e, "workspace_forbidden")
}
func TestFishDBConcurrentRetriesAndCapacity(t *testing.T) {
	s, _, a := fishDB(t)
	ctx := context.Background()
	in := SaveInput{RequestID: uuid.NewString(), Draft: Rules.Examples[0]}
	var wg sync.WaitGroup
	results := make(chan Character, 8)
	errs := make(chan error, 8)
	for range 8 {
		wg.Go(func() { c, e := s.Save(ctx, a, in); results <- c; errs <- e })
	}
	wg.Wait()
	close(results)
	close(errs)
	id := ""
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	for c := range results {
		if id != "" && c.ID != id {
			t.Fatal("duplicate save")
		}
		id = c.ID
	}
	ocean, e := s.EnsureOcean(ctx, a, uuid.NewString())
	if e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 50; i++ {
		c, e := s.Save(ctx, a, SaveInput{RequestID: uuid.NewString(), Draft: Rules.Examples[i%6]})
		if e != nil {
			t.Fatal(e)
		}
		if _, e = s.Release(ctx, a, ReleaseInput{uuid.NewString(), optionalOceanID(ocean.ID), c.ID, c.Revision, c.ContentHash}); e != nil {
			t.Fatal(e)
		}
	}
	c, e := s.Get(ctx, a, id, 0)
	if e != nil {
		t.Fatal(e)
	}
	_, e = s.Release(ctx, a, ReleaseInput{uuid.NewString(), optionalOceanID(ocean.ID), c.ID, c.Revision, c.ContentHash})
	wantCode(t, e, "capacity_reached")
	o, e := s.Ocean(ctx, a, ocean.ID)
	if e != nil || len(o.Residents) != 50 {
		t.Fatal("capacity", e)
	}
	if _, e = s.Pool.Exec(ctx, `UPDATE fish_revision SET payload=jsonb_set(payload,'{compilerVersion}','2') WHERE workspace_id=$1::uuid AND fish_id=$2::uuid`, a.WorkspaceID, id); e != nil {
		t.Fatal(e)
	}
	_, e = s.Release(ctx, a, ReleaseInput{uuid.NewString(), optionalOceanID(ocean.ID), c.ID, c.Revision, c.ContentHash})
	wantCode(t, e, "fish_incompatible")
	// A failed receipt write must roll back the resident mutation.
	if _, e = s.Pool.Exec(ctx, `CREATE FUNCTION reject_fish_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'receipt failure'; END $$; CREATE TRIGGER reject_receipt BEFORE INSERT ON fish_request FOR EACH ROW EXECUTE FUNCTION reject_fish_receipt()`); e != nil {
		t.Fatal(e)
	}
	r := o.Residents[0]
	_, e = s.Recall(ctx, a, RecallInput{uuid.NewString(), r.ID, r.Revision})
	if e == nil {
		t.Fatal("receipt failure was swallowed")
	}
	o, e = s.Ocean(ctx, a, ocean.ID)
	if e != nil || len(o.Residents) != 50 {
		raw, _ := json.Marshal(o)
		t.Fatalf("rollback=%s %v", raw, e)
	}
}

func TestFishDBFirstReleasesShareOneOcean(t *testing.T) {
	s, fx, actor := fishDB(t)
	ctx := context.Background()
	inputs := make([]ReleaseInput, 2)
	for i := range inputs {
		fish, err := s.Save(ctx, actor, SaveInput{RequestID: uuid.NewString(), Draft: Rules.Examples[i]})
		if err != nil {
			t.Fatal(err)
		}
		inputs[i] = ReleaseInput{RequestID: uuid.NewString(), FishID: fish.ID, Revision: fish.Revision, ContentHash: fish.ContentHash}
	}
	var wg sync.WaitGroup
	var results [2]ReleaseResult
	var errs [2]error
	for i, in := range inputs {
		wg.Go(func() { results[i], errs[i] = s.Release(ctx, actor, in) })
	}
	wg.Wait()
	oceanID := results[0].Resident.OceanID
	for i, result := range results {
		if errs[i] != nil || oceanID == "" || result.Resident.OceanID != oceanID {
			t.Fatalf("release %d: ocean=%q error=%v", i, result.Resident.OceanID, errs[i])
		}
		link, err := url.Parse(result.OceanURL)
		if err != nil || link.Query().Get("ocean") != oceanID || link.Query().Get("resident") != result.Resident.ID {
			t.Fatalf("release %d: invalid link %q (%v)", i, result.OceanURL, err)
		}
	}
	ocean, err := s.Ocean(ctx, actor, "")
	if err != nil || ocean.ID != oceanID || ocean.Visibility != "private" || len(ocean.Residents) != 2 {
		t.Fatalf("ocean=%+v error=%v", ocean, err)
	}
	if count := fx.Count(t, "SELECT count(*) FROM fish_ocean"); count != 1 {
		t.Fatalf("created %d oceans", count)
	}
	replay, err := s.Release(ctx, actor, inputs[0])
	if err != nil || replay.Resident.ID != results[0].Resident.ID || replay.OceanURL != results[0].OceanURL {
		t.Fatalf("retry returned a different resident or link: %+v %v", replay, err)
	}
	changed := inputs[0]
	changed.OceanID = optionalOceanID(oceanID)
	_, err = s.Release(ctx, actor, changed)
	wantCode(t, err, "idempotency_key_reused")
}

func TestFishDBFirstReleaseRollsBackOcean(t *testing.T) {
	s, fx, actor := fishDB(t)
	ctx := context.Background()
	fish, err := s.Save(ctx, actor, SaveInput{RequestID: uuid.NewString(), Draft: Rules.Examples[0]})
	if err != nil {
		t.Fatal(err)
	}
	fx.Exec(t, `CREATE FUNCTION reject_release_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN RAISE EXCEPTION 'first release receipt failure'; END
		$$;
		CREATE TRIGGER reject_release_receipt BEFORE INSERT ON fish_request
		FOR EACH ROW EXECUTE FUNCTION reject_release_receipt()`)
	_, err = s.Release(ctx, actor, ReleaseInput{RequestID: uuid.NewString(), FishID: fish.ID, Revision: fish.Revision, ContentHash: fish.ContentHash})
	if err == nil || !strings.Contains(err.Error(), "first release receipt failure") {
		t.Fatalf("release did not reach the receipt write: %v", err)
	}
	if oceans := fx.Count(t, "SELECT count(*) FROM fish_ocean"); oceans != 0 {
		t.Fatalf("failed release left %d oceans", oceans)
	}
	if residents := fx.Count(t, "SELECT count(*) FROM fish_resident"); residents != 0 {
		t.Fatalf("failed release left %d residents", residents)
	}
}
