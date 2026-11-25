package fish

import (
	"context"
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/auro-ai/auro/server/internal/testutil"
	"github.com/auro-ai/auro/server/internal/worldinbox"
	"github.com/google/uuid"
)

func testExplorer(id string, position [3]float64) *explorer {
	r := Resident{ID: id, Revision: 1, Seed: 17, Fish: Character{Draft: Rules.Examples[0]}}
	s := newExploration(r)
	s.Position = position
	return &explorer{Resident: r, State: s}
}

func TestExplorationRecordsOnlyNearbyPublicSwimmersAndNewPlaces(t *testing.T) {
	now := time.Date(2026, 11, 11, 4, 0, 0, 0, time.UTC)
	a, b := testExplorer(uuid.NewString(), [3]float64{-5, 3, -2}), testExplorer(uuid.NewString(), [3]float64{8, 3, 7})
	observeExplorers([]*explorer{a, b}, now)
	if len(a.State.Pending) != 1 || a.State.Pending[0].Place != "west_reef" {
		t.Fatalf("unexpected sightings: %+v", a.State.Pending)
	}
	b.State.Position = [3]float64{-4, 3, -2}
	b.Resident.Fish.Draft.Name = "Public striped neighbor"
	observeExplorers([]*explorer{a, b}, now.Add(time.Second))
	if len(a.State.Pending) != 2 || a.State.Pending[1].PeerName != b.Resident.Fish.Draft.Name || a.State.Pending[1].PeerID != b.Resident.ID {
		t.Fatalf("missing real encounter: %+v", a.State.Pending)
	}
	for i := 0; i < 20; i++ {
		observeExplorers([]*explorer{a, b}, now.Add(time.Duration(i+2)*time.Second))
	}
	if len(a.State.Pending) != 2 {
		t.Fatal("nearby frames repeated a discovery or encounter")
	}
	a.State.Pending = nil
	observeExplorers([]*explorer{a, b}, now.Add(24*time.Hour))
	if len(a.State.Pending) != 0 {
		t.Fatal("repeated yesterday's known encounter")
	}
	observeExplorers([]*explorer{a, b}, now.Add(8*24*time.Hour))
	if len(a.State.Pending) != 1 || a.State.Pending[0].Kind != "encounter" {
		t.Fatal("did not record a later actual reunion")
	}
}

func TestExplorationIsRepeatableBoundedAndMemoryIsCapped(t *testing.T) {
	now := time.Date(2026, 11, 11, 4, 0, 0, 0, time.UTC)
	a, b := testExplorer("fish", [3]float64{0, 3, 0}), testExplorer("fish", [3]float64{0, 3, 0})
	for i := int64(1); i <= 600; i++ {
		advanceExplorers([]*explorer{a}, i, now.Add(time.Duration(i)*time.Second))
		advanceExplorers([]*explorer{b}, i, now.Add(time.Duration(i)*time.Second))
		if !validExploration(a.State) {
			t.Fatalf("invalid state at %d: %+v", i, a.State)
		}
	}
	if !reflect.DeepEqual(a.State, b.State) {
		t.Fatal("simulation is not repeatable")
	}
	for i := 0; i < 200; i++ {
		a.State.Pending = nil
		remember(a, "peer/"+uuid.NewString(), worldinbox.FishSighting{Kind: "encounter", OccurredAt: now.Add(time.Duration(i) * time.Second)})
	}
	if len(a.State.Known) > explorationMemoryLimit {
		t.Fatal("unbounded encounter memory")
	}
	a.State.Position[0] = math.NaN()
	if validExploration(a.State) {
		t.Fatal("accepted non-finite state")
	}
}

func publishExplorer(t *testing.T, s *Service, a Actor, name string) ReleaseResult {
	t.Helper()
	draft := Rules.Examples[0]
	draft.Name = name
	character, err := s.Save(context.Background(), a, SaveInput{RequestID: uuid.NewString(), Draft: draft})
	if err != nil {
		t.Fatal(err)
	}
	out, err := s.Release(context.Background(), a, ReleaseInput{RequestID: uuid.NewString(), FishID: character.ID, Revision: character.Revision, ContentHash: character.ContentHash, Destination: "public"})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func placeExplorer(t *testing.T, fx *testutil.Fixture, r Resident, p [3]float64) {
	t.Helper()
	s := newExploration(r)
	s.Position = p
	s.Velocity = [3]float64{0.1, 0, 0}
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	fx.Exec(t, "UPDATE fish_exploration_state SET state=$1::jsonb WHERE resident_id=$2::uuid", string(raw), r.ID)
}

func TestFishDBExplorationPersistsRealEncountersAndDeliversOnePrivateLetterPerDay(t *testing.T) {
	s, fx, a := fishDB(t)
	ctx := context.Background()
	now := time.Now().UTC()
	first := publishExplorer(t, s, a, "Blue explorer")
	second := publishExplorer(t, s, a, "Second explorer")
	b := Actor{WorkspaceID: fx.Workspace(t, "Other world", "other-ocean"), UserID: fx.User(t, "Neighbor owner", "neighbor-owner@example.invalid")}
	fx.Member(t, b.WorkspaceID, b.UserID, "owner")
	peer := publishExplorer(t, s, b, "Public longtail")
	if err := s.Explore(ctx, now); err != nil {
		t.Fatal(err)
	}
	if fx.Count(t, "SELECT count(*) FROM world_inbox_event") != 0 {
		t.Fatal("invented pre-initialization history")
	}
	placeExplorer(t, fx, first.Resident, [3]float64{-5, 3, -2})
	placeExplorer(t, fx, second.Resident, [3]float64{0, 3, 7})
	placeExplorer(t, fx, peer.Resident, [3]float64{-4.5, 3, -2})
	if err := s.Explore(ctx, now.Add(5*time.Second)); err != nil {
		t.Fatal(err)
	}
	worker := &worldinbox.Service{Pool: s.Pool}
	if err := worker.Process(ctx, now.Add(5*time.Second)); err != nil {
		t.Fatal(err)
	}
	if fx.Count(t, "SELECT count(*) FROM inbox_item WHERE type='fish_letter' AND recipient_id=$1::uuid", a.UserID) != 1 {
		t.Fatal("owner did not get one letter")
	}
	var raw []byte
	if err := s.Pool.QueryRow(ctx, "SELECT content FROM inbox_item WHERE type='fish_letter' AND recipient_id=$1::uuid", a.UserID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), b.WorkspaceID) || strings.Contains(string(raw), b.UserID) {
		t.Fatal("private source identity leaked into observation")
	}
	var content worldinbox.Content
	if err := json.Unmarshal(raw, &content); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, sighting := range content.Entries[0].Sightings {
		if sighting.Kind == "encounter" && sighting.PeerID == peer.Resident.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing encounter: %s", raw)
	}
	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() {
			if err := s.Explore(ctx, now.Add(10*time.Second)); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if err := worker.Process(ctx, now.Add(10*time.Second)); err != nil {
		t.Fatal(err)
	}
	if fx.Count(t, "SELECT count(*) FROM inbox_item WHERE type='fish_letter' AND workspace_id=$1::uuid", a.WorkspaceID) != 1 {
		t.Fatal("multiple fish or retries exceeded the daily limit")
	}
	// A new process continues the saved clock and position without a browser.
	var before []byte
	if err := s.Pool.QueryRow(ctx, "SELECT state FROM fish_exploration_state WHERE resident_id=$1::uuid", first.Resident.ID).Scan(&before); err != nil {
		t.Fatal(err)
	}
	restarted := &Service{Pool: s.Pool}
	if err := restarted.Explore(ctx, now.Add(15*time.Second)); err != nil {
		t.Fatal(err)
	}
	var after []byte
	if err := s.Pool.QueryRow(ctx, "SELECT state FROM fish_exploration_state WHERE resident_id=$1::uuid", first.Resident.ID).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if string(before) == string(after) {
		t.Fatal("saved explorer did not continue")
	}
	// Daily letters are private and never enter the hourly world digest.
	fx.Exec(t, "UPDATE world_inbox_event SET occurred_at=$1", now.Add(-2*time.Hour))
	if err := worker.Process(ctx, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if fx.Count(t, "SELECT count(*) FROM inbox_item WHERE type='world_digest'") != 0 {
		t.Fatal("private sightings entered a world digest")
	}
}

func TestFishDBExplorationRollbackRecallAndOutage(t *testing.T) {
	s, fx, a := fishDB(t)
	ctx := context.Background()
	now := time.Now().UTC()
	r := publishExplorer(t, s, a, "Atomic explorer")
	if err := s.Explore(ctx, now); err != nil {
		t.Fatal(err)
	}
	placeExplorer(t, fx, r.Resident, [3]float64{-5, 3, -2})
	var before []byte
	if err := s.Pool.QueryRow(ctx, "SELECT state FROM fish_exploration_state WHERE resident_id=$1::uuid", r.Resident.ID).Scan(&before); err != nil {
		t.Fatal(err)
	}
	fx.Exec(t, `CREATE FUNCTION reject_letter() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$`)
	fx.Exec(t, `CREATE TRIGGER reject_letter BEFORE INSERT ON world_inbox_event FOR EACH ROW EXECUTE FUNCTION reject_letter()`)
	if err := s.Explore(ctx, now.Add(5*time.Second)); err == nil {
		t.Fatal("expected rollback")
	}
	var after []byte
	if err := s.Pool.QueryRow(ctx, "SELECT state FROM fish_exploration_state WHERE resident_id=$1::uuid", r.Resident.ID).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("failed fact advanced the simulation")
	}
	fx.Exec(t, "DROP TRIGGER reject_letter ON world_inbox_event")
	if err := s.Explore(ctx, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if fx.Count(t, "SELECT count(*) FROM world_inbox_event") != 0 {
		t.Fatal("invented encounters during an outage")
	}
	if err := s.Explore(ctx, now.Add(time.Hour+5*time.Second)); err != nil {
		t.Fatal(err)
	}
	if fx.Count(t, "SELECT count(*) FROM world_inbox_event") != 1 {
		t.Fatal("did not resume after outage")
	}
	if _, err := s.Recall(ctx, a, RecallInput{RequestID: uuid.NewString(), ResidentID: r.Resident.ID, ExpectedResidentRevision: r.Resident.Revision, Destination: "public"}); err != nil {
		t.Fatal(err)
	}
	if fx.Count(t, "SELECT count(*) FROM fish_exploration_state") != 0 {
		t.Fatal("recalled explorer retained active state")
	}
	if err := (&worldinbox.Service{Pool: s.Pool}).Process(ctx, now.Add(time.Hour+10*time.Second)); err != nil {
		t.Fatal(err)
	}
	if fx.Count(t, "SELECT count(*) FROM inbox_item") != 0 {
		t.Fatal("delivered a delayed letter after recall")
	}
}

func TestFishDBLetterDeliveryCapsBacklogsAndRespectsMuteAndMembership(t *testing.T) {
	s, fx, a := fishDB(t)
	ctx := context.Background()
	now := time.Date(2026, 11, 11, 4, 0, 0, 0, time.UTC)
	r := publishExplorer(t, s, a, "Daily explorer")
	add := func(at time.Time) {
		id := uuid.NewString()
		entry := worldinbox.Entry{ID: id, Kind: "fish_letter", SubjectID: r.Resident.ID, Name: r.Resident.Fish.Draft.Name, Revision: r.Resident.Revision, Sightings: []worldinbox.FishSighting{{Kind: "discovery", Place: "west_reef", Position: [3]float64{-5, 3, -2}, OccurredAt: at}}}
		raw, err := json.Marshal(entry)
		if err != nil {
			t.Fatal(err)
		}
		fx.Insert(t, "world_inbox_event", testutil.Cols{"id": id, "workspace_id": a.WorkspaceID, "actor_id": a.UserID, "subject_id": r.Resident.ID, "kind": "fish_letter", "content": raw, "occurred_at": at})
	}
	worker := &worldinbox.Service{Pool: s.Pool}
	add(now.Add(-48 * time.Hour))
	add(now.Add(-24 * time.Hour))
	if err := worker.Process(ctx, now); err != nil {
		t.Fatal(err)
	}
	add(now)
	if err := worker.Process(ctx, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if fx.Count(t, "SELECT count(*) FROM inbox_item") != 1 {
		t.Fatal("a backlog exceeded the daily delivery cap")
	}
	fx.Exec(t, "UPDATE inbox_item SET read=true,archived=true")
	add(now.Add(24 * time.Hour))
	if err := worker.Process(ctx, now.Add(24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if fx.Count(t, "SELECT count(*) FROM inbox_item") != 2 || fx.Count(t, "SELECT count(*) FROM inbox_item WHERE read AND archived") != 1 {
		t.Fatal("next-day delivery rewrote old history")
	}
	fx.Exec(t, `INSERT INTO notification_preference(user_id,workspace_id,preferences) VALUES($1::uuid,$2::uuid,'{"creation_updates":"muted"}')`, a.UserID, a.WorkspaceID)
	add(now.Add(48 * time.Hour))
	if err := worker.Process(ctx, now.Add(48*time.Hour)); err != nil {
		t.Fatal(err)
	}
	fx.Exec(t, "DELETE FROM notification_preference")
	if err := worker.Process(ctx, now.Add(48*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if fx.Count(t, "SELECT count(*) FROM inbox_item") != 2 {
		t.Fatal("muted letter was delivered or backfilled")
	}
	fx.Exec(t, "DELETE FROM member WHERE workspace_id=$1::uuid AND user_id=$2::uuid", a.WorkspaceID, a.UserID)
	add(now.Add(72 * time.Hour))
	if err := worker.Process(ctx, now.Add(72*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if fx.Count(t, "SELECT count(*) FROM inbox_item") != 2 {
		t.Fatal("departed owner received a delayed letter")
	}
}

func TestFishDBExplorationDoesNotBackfillMutedOrClosedSightings(t *testing.T) {
	s, fx, a := fishDB(t)
	ctx := context.Background()
	now := time.Now().UTC()
	r := publishExplorer(t, s, a, "Quiet explorer")
	if err := s.Explore(ctx, now); err != nil {
		t.Fatal(err)
	}
	placeExplorer(t, fx, r.Resident, [3]float64{-5, 3, -2})
	fx.Exec(t, `INSERT INTO notification_preference(user_id,workspace_id,preferences) VALUES($1::uuid,$2::uuid,'{"creation_updates":"muted"}')`, a.UserID, a.WorkspaceID)
	if err := s.Explore(ctx, now.Add(5*time.Second)); err != nil {
		t.Fatal(err)
	}
	if fx.Count(t, "SELECT count(*) FROM world_inbox_event") != 0 {
		t.Fatal("generated a muted letter")
	}
	fx.Exec(t, "DELETE FROM notification_preference")
	if err := s.Explore(ctx, now.Add(6*time.Second)); err != nil {
		t.Fatal(err)
	}
	if fx.Count(t, "SELECT count(*) FROM world_inbox_event") != 0 {
		t.Fatal("backfilled muted observations")
	}
	fx.Exec(t, `INSERT INTO game_policy(game_id,scope,default_visible,revision,updated_by) VALUES('fish','disabled',true,1,$1::uuid)`, a.UserID)
	fx.Exec(t, `UPDATE fish_exploration_state SET state=jsonb_set(jsonb_set(state,'{position}','[5,2,-4]'),'{velocity}','[0.1,0,0]') WHERE resident_id=$1::uuid`, r.Resident.ID)
	if err := s.Explore(ctx, now.Add(7*time.Second)); err != nil {
		t.Fatal(err)
	}
	fx.Exec(t, `UPDATE game_policy SET scope='all' WHERE game_id='fish'`)
	if err := s.Explore(ctx, now.Add(8*time.Second)); err != nil {
		t.Fatal(err)
	}
	if fx.Count(t, "SELECT count(*) FROM world_inbox_event") != 0 {
		t.Fatal("backfilled observations from a closed game")
	}
}
