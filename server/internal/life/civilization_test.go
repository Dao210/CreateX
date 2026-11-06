package life

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestDBCivilizationDesignsAreIdempotentAndFenceTickResults(t *testing.T) {
	repo, fx, workspace, runtime := lifeDatabase(t)
	ctx := context.Background()
	user := fx.User(t, "Creator", "civic-creator@example.test")
	fx.Member(t, workspace, user, "member")
	service := NewService(repo, runtime, nil)
	if err := service.Prepare(ctx, workspace); err != nil {
		t.Fatal(err)
	}
	fx.Exec(t, "UPDATE life_world SET tick=600,next_tick_at=clock_timestamp()-interval '1 second'")
	if _, err := service.Step(ctx); err != nil {
		t.Fatal(err)
	}
	binding, err := repo.Binding(ctx)
	if err != nil {
		t.Fatal(err)
	}
	before, err := repo.Load(ctx, binding)
	if err != nil {
		t.Fatal(err)
	}
	stale, err := runtime.Advance(ctx, before)
	if err != nil {
		t.Fatal(err)
	}
	command := TownCommand{RequestID: uuid.NewString(), Kind: "prototype", Name: "Our store", Variant: "sturdy"}
	first, err := repo.Command(ctx, workspace, user, command, false)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := repo.Command(ctx, workspace, user, command, false)
	if err != nil {
		t.Fatal(err)
	}
	if first != retry {
		t.Fatal("retry created another design")
	}
	state, err := repo.Load(ctx, binding)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Town.Civilization.Prototypes) != 1 || state.Town.Civilization.Prototypes[0].ID != first.ID {
		t.Fatal("design not persisted exactly once")
	}
	if len(state.Town.Civilization.Projects) != 0 {
		t.Fatal("saving a design built a facility")
	}
	if err := repo.Commit(ctx, binding, before, stale); !errors.Is(err, ErrStaleTick) {
		t.Fatalf("old Tick overwrote design: %v", err)
	}
	suggestion := TownCommand{RequestID: uuid.NewString(), Kind: "suggest_project", ResidentID: state.Agents[0].ID, PrototypeID: first.ID}
	if _, err := repo.Command(ctx, workspace, user, suggestion, false); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Command(ctx, workspace, user, suggestion, false); err != nil {
		t.Fatal(err)
	}
	suggestion.RequestID = uuid.NewString()
	suggestion.PrototypeID = uuid.NewString()
	if _, err := repo.Command(ctx, workspace, user, suggestion, false); err == nil {
		t.Fatal("accepted a foreign design")
	}
	persisted, err := repo.Load(ctx, binding)
	if err != nil {
		t.Fatal(err)
	}
	if len(persisted.Town.Civilization.Suggestions) != 1 || persisted.Town.Civilization.Suggestions[0].Status != "pending" {
		t.Fatal("suggestion was duplicated or decided by the API")
	}
	if persisted.Tick != before.Tick || len(persisted.Agents) != len(before.Agents) {
		t.Fatal("creator command changed the simulation clock or residents")
	}
	if _, err := runtime.Advance(ctx, persisted); err != nil {
		t.Fatal(err)
	}
}

func TestDBCivicMaterialDeliverySurvivesActionPersistence(t *testing.T) {
	repo, fx, workspace, runtime := lifeDatabase(t)
	ctx := context.Background()
	service := NewService(repo, runtime, nil)
	if err := service.Prepare(ctx, workspace); err != nil {
		t.Fatal(err)
	}
	binding, err := repo.Binding(ctx)
	if err != nil {
		t.Fatal(err)
	}
	state, err := repo.Load(ctx, binding)
	if err != nil {
		t.Fatal(err)
	}
	town := ensureTown(&state)
	for i := range town.Profiles {
		town.Profiles[i].Interests = []string{"community"}
	}
	c := ensureCivilization(town)
	prototypeID, projectID := uuid.NewString(), uuid.NewString()
	a, b := state.Agents[0].ID, state.Agents[1].ID
	c.Prototypes = append(c.Prototypes, StoragePrototype{ID: prototypeID, Variant: "light", CreatedTick: 600})
	c.Projects = append(c.Projects, CivicProject{ID: projectID, OrganizerID: a, PrototypeID: prototypeID, Variant: "light", Position: Position{8, 5}, Status: "gathering", CreatedTick: 600, KnownBy: []string{a, b}, Members: []ProjectMember{{ResidentID: a, JoinedTick: 600}, {ResidentID: b, JoinedTick: 600}}, Condition: 100, Rule: CivicRule{Revision: 1, Distribution: "equal", Maintenance: "volunteer", EnactedTick: 600, Supporters: []string{a, b}}, LastReviewTick: 600, LastGatheringDay: -1, GatheringIDs: []string{}})
	fx.Exec(t, "UPDATE life_world SET tick=600,town=$1,next_tick_at=clock_timestamp()-interval '1 second'", rawJSON(town))
	fx.Exec(t, "UPDATE life_agent SET x=8,y=5,energy=100,fullness=100 WHERE id=$1 OR id=$2", a, b)
	fx.Exec(t, "UPDATE life_resource SET amount=3 WHERE owner=$1 AND kind='wood'", a)
	for range 3 {
		fx.Exec(t, "UPDATE life_world SET next_tick_at=clock_timestamp()-interval '1 second'")
		if _, err := service.Step(ctx); err != nil {
			t.Fatal(err)
		}
	}
	binding, err = repo.Binding(ctx)
	if err != nil {
		t.Fatal(err)
	}
	after, err := repo.Load(ctx, binding)
	if err != nil {
		t.Fatal(err)
	}
	if after.Town.Civilization.Projects[0].Wood != 3 {
		t.Fatal("material delivery was not persisted")
	}
	if fx.Count(t, "SELECT amount FROM life_resource WHERE owner=$1 AND kind='wood'", a) != 0 {
		t.Fatal("delivery duplicated wood")
	}
	if fx.Count(t, "SELECT count(*) FROM life_action WHERE intent->>'kind'='DELIVER_WOOD' AND status='completed'") != 1 {
		t.Fatal("civic action did not settle once")
	}
	if fx.Count(t, "SELECT count(*) FROM life_action a LEFT JOIN life_event e ON a.id=e.action_id WHERE a.status<>'running' AND e.id IS NULL") != 0 {
		t.Fatal("civic settlement lacks its terminal event")
	}
}
