package life

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/google/uuid"
)

func TestDBSharedLifeInitializesOnceAndMembersOperateFromAnyWorld(t *testing.T) {
	repo, fx, source, runtime := lifeDatabase(t)
	ctx := context.Background()
	other := fx.Workspace(t, "Other entry", "other-entry")
	member := fx.User(t, "World member", "shared-life-member@example.test")
	fx.Member(t, other, member, "member")
	service := NewService(repo, runtime, nil)
	var group sync.WaitGroup
	for _, route := range []string{source, other, source, other} {
		group.Go(func() {
			id, _ := util.ParseUUID(route)
			if _, err := service.GetLifeSnapshot(ctx, id); err != nil {
				t.Error(err)
			}
		})
	}
	group.Wait()
	if fx.Count(t, "SELECT count(*) FROM life_world") != 1 || fx.Count(t, "SELECT count(*) FROM life_agent") != 20 {
		t.Fatal("entry created separate simulations")
	}
	sourceID, _ := util.ParseUUID(source)
	otherID, _ := util.ParseUUID(other)
	first, err := service.GetLifeSnapshot(ctx, sourceID)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.GetLifeSnapshot(ctx, otherID)
	if err != nil {
		t.Fatal(err)
	}
	var a, b struct {
		World struct {
			ID          string `json:"id"`
			WorkspaceID string `json:"workspaceId"`
		} `json:"world"`
		Agents []Resident `json:"agents"`
	}
	if json.Unmarshal(first, &a) != nil || json.Unmarshal(second, &b) != nil {
		t.Fatal("invalid snapshot")
	}
	if a.World.ID != b.World.ID || b.World.WorkspaceID != other || len(b.Agents) != 20 {
		t.Fatal("entry did not expose the shared simulation")
	}
	command := TownCommand{RequestID: uuid.NewString(), Kind: "resident", Name: "Shared resident", Occupation: "artist", Interests: []string{"community"}}
	created, err := service.Command(ctx, other, member, command, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Command(ctx, source, member, command, false); err == nil {
		t.Fatal("crossed the ordinary route membership boundary")
	}
	fx.Member(t, source, member, "member")
	retry, err := service.Command(ctx, source, member, command, false)
	if err != nil || retry != created {
		t.Fatalf("cross-route retry duplicated creation: %+v %v", retry, err)
	}
	if fx.Count(t, "SELECT count(*) FROM life_agent") != 21 {
		t.Fatal("resident not shared exactly once")
	}
	prototype, err := service.Command(ctx, other, member, TownCommand{RequestID: uuid.NewString(), Kind: "prototype", Name: "Shared storage", Variant: "light"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Command(ctx, other, member, TownCommand{RequestID: uuid.NewString(), Kind: "suggest_project", ResidentID: created.ID, PrototypeID: prototype.ID}, false); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Command(ctx, other, member, TownCommand{RequestID: uuid.NewString(), Kind: "activity", ResidentID: created.ID, Title: "Shared meal", Interest: "community", Place: "square", StartsIn: 480, Duration: 60}, false); err != nil {
		t.Fatal(err)
	}
	history, err := service.GetLifeHistory(ctx, db.GetLifeHistoryParams{WorkspaceID: sourceID, SinceSequence: 0})
	if err != nil {
		t.Fatal(err)
	}
	var events struct {
		Total int `json:"total"`
	}
	if json.Unmarshal(history, &events) != nil || events.Total < 4 {
		t.Fatal("another route cannot read shared commands")
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
	if _, err = service.Command(ctx, other, member, TownCommand{RequestID: uuid.NewString(), Kind: "prototype", Name: "A later design", Variant: "sturdy"}, false); err != nil {
		t.Fatal(err)
	}
	fx.Exec(t, "UPDATE life_world SET next_tick_at=clock_timestamp()-interval '1 second'")
	if err = repo.Commit(ctx, binding, before, stale); !errors.Is(err, ErrStaleTick) {
		t.Fatalf("shared command lost its revision fence: %v", err)
	}
}
