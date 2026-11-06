package life

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/google/uuid"
)

func TestModelDecisionRejectsInventedKnowledgeAndInvalidPlans(t *testing.T) {
	input := modelContext{Kind: "dialogue", Memories: []Memory{{ID: uuid.NewString()}}, KnownActivities: []Activity{{ID: uuid.NewString()}}}
	for _, d := range []modelDecision{
		{Reply: "Hello", ShareActivityIDs: []string{uuid.NewString()}},
		{Reply: "Hello", Reflection: "I remember", Evidence: []string{uuid.NewString()}},
		{Reply: "Hello", Reflection: "I learned something"},
		{Reply: strings.Repeat("a", 401)},
	} {
		if validateDecision(d, input) == nil {
			t.Fatal("accepted invented knowledge or unbounded output")
		}
	}
	input.Kind = "plan"
	if validateDecision(modelDecision{Slots: []PlanSlot{{Start: 100, End: 200, Place: "library", Purpose: "read"}}}, input) == nil {
		t.Fatal("accepted a closed venue")
	}
	if validateDecision(modelDecision{Slots: []PlanSlot{{Start: 480, End: 600, Place: "library", Purpose: "read"}, {Start: 550, End: 700, Place: "cafe", Purpose: "rest"}}}, input) == nil {
		t.Fatal("accepted overlapping plans")
	}
	if err := validateDecision(modelDecision{Slots: []PlanSlot{{Start: 480, End: 600, Place: "library", Purpose: "read"}}, Reflection: "I enjoy meeting neighbors", Evidence: []string{input.Memories[0].ID}}, input); err != nil {
		t.Fatal(err)
	}
}
func TestDBTownCommandsRetryFencesAndPersistentInvitations(t *testing.T) {
	repo, fx, workspace, runtime := lifeDatabase(t)
	ctx := context.Background()
	user := fx.User(t, "Town member", "town-member@example.test")
	fx.Member(t, workspace, user, "member")
	service := NewService(repo, runtime, nil)
	if err := service.Prepare(ctx, workspace); err != nil {
		t.Fatal(err)
	}
	fx.Exec(t, "UPDATE life_world SET tick=540,next_tick_at=clock_timestamp()-interval '1 second'")
	if _, err := service.Step(ctx); err != nil {
		t.Fatal(err)
	}
	binding, _ := repo.Binding(ctx)
	before, err := repo.Load(ctx, binding)
	if err != nil {
		t.Fatal(err)
	}
	command := TownCommand{RequestID: uuid.NewString(), Kind: "activity", ResidentID: before.Agents[0].ID, Title: "Reading together", Interest: "reading", Place: "cafe", StartsIn: 60, Duration: 60}
	var wg sync.WaitGroup
	ids := make(chan string, 4)
	for range 4 {
		wg.Go(func() {
			result, e := repo.Command(ctx, workspace, user, command, false)
			if e != nil {
				t.Error(e)
				return
			}
			ids <- result.ID
		})
	}
	wg.Wait()
	close(ids)
	var id string
	for v := range ids {
		if id != "" && id != v {
			t.Fatal("retry duplicated activity")
		}
		id = v
	}
	if fx.Count(t, "SELECT count(*) FROM life_request") != 1 {
		t.Fatal("duplicate retry receipts")
	}
	modified := command
	modified.Title = "Different activity"
	_, err = repo.Command(ctx, workspace, user, modified, false)
	var conflict *TownError
	if !errors.As(err, &conflict) || conflict.Code != "idempotency_key_reused" {
		t.Fatalf("retry conflict: %v", err)
	}
	state, err := repo.Load(ctx, binding)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Town.Activities) != 1 || state.Town.Activities[0].Status != "scheduled" {
		t.Fatal("activity was lost or not accepted")
	}
	if !knows(state.Town, command.ResidentID, id) || knows(state.Town, state.Agents[1].ID, id) {
		t.Fatal("activity leaked to uninformed resident")
	}
	// A command changes the revision while preserving the committed simulation clock.
	stale, err := runtime.Advance(ctx, before)
	if err != nil {
		t.Fatal(err)
	}
	fx.Exec(t, "UPDATE life_world SET next_tick_at=clock_timestamp()-interval '1 second'")
	if err = repo.Commit(ctx, binding, before, stale); !errors.Is(err, ErrStaleTick) {
		t.Fatalf("command overwritten by old Tick: %v", err)
	}
	cursor := fx.Count(t, "SELECT COALESCE(max(sequence),0) FROM life_event")
	resident, err := repo.Command(ctx, workspace, user, TownCommand{RequestID: uuid.NewString(), Kind: "resident", Name: "Test visitor", Occupation: "artist", Interests: []string{"reading"}}, false)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := repo.Load(ctx, binding)
	if err != nil {
		t.Fatal(err)
	}
	if len(restored.Agents) != 21 || restored.Agents[20].ID != resident.ID && restored.Agents[0].ID != resident.ID {
		found := false
		for _, a := range restored.Agents {
			found = found || a.ID == resident.ID
		}
		if !found {
			t.Fatal("resident identity not persisted")
		}
	}
	if len(restored.Resources) != 65 || len(restored.Town.Profiles) != 21 || restored.Tick != before.Tick {
		t.Fatal("resident command corrupted existing state")
	}
	historyRaw, historyErr := db.New(repo.Pool).GetLifeHistory(ctx, db.GetLifeHistoryParams{WorkspaceID: binding.WorkspaceID, SinceSequence: int64(cursor)})
	if historyErr != nil {
		t.Fatal(historyErr)
	}
	var history struct {
		Total  int `json:"total"`
		Events []struct {
			Tick int64 `json:"tick"`
		} `json:"events"`
	}
	if err = json.Unmarshal(historyRaw, &history); err != nil || history.Total != 1 || len(history.Events) != 1 || history.Events[0].Tick != before.Tick {
		t.Fatalf("same-Tick history was lost: %s %v", historyRaw, err)
	}
	fx.Exec(t, `CREATE FUNCTION reject_town_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'reject_town_event'; END $$`)
	fx.Exec(t, `CREATE TRIGGER reject_town_event BEFORE INSERT ON life_event FOR EACH ROW EXECUTE FUNCTION reject_town_event()`)
	failed := TownCommand{RequestID: uuid.NewString(), Kind: "resident", Name: "Rollback", Occupation: "artist", Interests: []string{"art"}}
	if _, err = repo.Command(ctx, workspace, user, failed, false); err == nil {
		t.Fatal("expected atomic rollback")
	}
	if fx.Count(t, "SELECT count(*) FROM life_agent") != 21 || fx.Count(t, "SELECT count(*) FROM life_request") != 2 {
		t.Fatal("failed command partially committed")
	}
	fx.Exec(t, "DROP TRIGGER reject_town_event ON life_event")
	if _, err = service.Step(ctx); err != nil {
		t.Fatal(err)
	}
}

type fixtureTownModel struct{ calls atomic.Int32 }

func (*fixtureTownModel) Enabled() bool { return true }
func (f *fixtureTownModel) GenerateJSON(_ context.Context, _ string, _ string, input string, _ float64, _ int64) (string, error) {
	f.calls.Add(1)
	return `{"reply":"I remember your reading suggestion.","answer":"","slots":[],"reflection":"","evidence":[],"shareActivityIds":[],"accept":false}`, nil
}
func TestDBModelJobsAreBoundedAndCannotOverwriteLaterState(t *testing.T) {
	repo, fx, workspace, runtime := lifeDatabase(t)
	ctx := context.Background()
	user := fx.User(t, "Town member", "town-model@example.test")
	fx.Member(t, workspace, user, "member")
	service := NewService(repo, runtime, nil)
	if err := service.Prepare(ctx, workspace); err != nil {
		t.Fatal(err)
	}
	binding, _ := repo.Binding(ctx)
	state, err := repo.Load(ctx, binding)
	if err != nil {
		t.Fatal(err)
	}
	model := &fixtureTownModel{}
	coordinator := &Coordinator{Repository: repo, Client: model, Mode: "llm", ResidentLimit: 3, DailyLimit: 1}
	cmd := TownCommand{RequestID: uuid.NewString(), Kind: "message", ResidentID: state.Agents[0].ID, Text: "Could we read together?"}
	result, err := repo.Command(ctx, workspace, user, cmd, true)
	if err != nil {
		t.Fatal(err)
	}
	if err = coordinator.Step(ctx); err != nil {
		t.Fatal(err)
	}
	state, err = repo.Load(ctx, binding)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Town.Conversations) != 1 || state.Town.Conversations[0].Lines[0].Text != cmd.Text || len(state.Town.Memories) != 1 || state.Town.Jobs[0].ID != result.ID || state.Town.Jobs[0].Status != "done" {
		t.Fatal("model result was not persisted")
	}
	cmd.RequestID = uuid.NewString()
	if _, err = repo.Command(ctx, workspace, user, cmd, true); err != nil {
		t.Fatal(err)
	}
	if err = coordinator.Step(ctx); err != nil {
		t.Fatal(err)
	}
	state, _ = repo.Load(ctx, binding)
	if model.calls.Load() != 1 || state.Town.Model.State != "budget" || state.Town.Jobs[len(state.Town.Jobs)-1].Error != "daily_budget" {
		t.Fatal("model budget was not enforced")
	}
	if err = coordinator.Step(ctx); err != nil {
		t.Fatal(err)
	}
	if model.calls.Load() != 1 {
		t.Fatal("finished job called model again")
	}
	rows, err := db.New(repo.Pool).GetLifeHistory(ctx, db.GetLifeHistoryParams{WorkspaceID: binding.WorkspaceID, SinceSequence: 0})
	if err != nil || len(rows) == 0 {
		t.Fatalf("history: %s %v", rows, err)
	}
}

func TestResidentContextDoesNotExposeUnobservedMemoriesOrActivities(t *testing.T) {
	residents := []Resident{{ID: uuid.NewString(), Position: Position{1, 1}}, {ID: uuid.NewString(), Position: Position{11, 7}}}
	state := Simulation{Tick: 600, Agents: residents}
	town := ensureTown(&state)
	town.Memories = append(town.Memories, Memory{ID: uuid.NewString(), ResidentID: residents[1].ID, Text: "Not my memory"})
	town.Activities = append(town.Activities, Activity{ID: uuid.NewString(), OrganizerID: residents[1].ID, Status: "scheduled", StartTick: 700})
	input := contextFor(state, ModelJob{ResidentID: residents[0].ID, Kind: "plan"})
	if len(input.Memories) != 0 || len(input.Nearby) != 0 || len(input.KnownActivities) != 0 {
		t.Fatal("resident received unobserved knowledge")
	}
	state.Agents[1].Position = Position{1, 2}
	nearby := contextFor(state, ModelJob{ResidentID: residents[0].ID, Kind: "plan"})
	var wire map[string]any
	if err := json.Unmarshal(rawJSON(nearby), &wire); err != nil {
		t.Fatal(err)
	}
	contacts := wire["nearby"].([]any)
	if len(contacts) != 1 {
		t.Fatal("missing observed neighbor")
	}
	contact := contacts[0].(map[string]any)
	for _, key := range []string{"goal", "energy", "fullness", "social", "personality"} {
		if _, ok := contact[key]; ok {
			t.Fatalf("unobserved neighbor state exposed: %s", key)
		}
	}
	if !commandKeys([]byte(`{"kind":"message","requestId":"id","residentId":"id","text":"hi"}`), "message") || commandKeys([]byte(`{"kind":"message","title":"not allowed"}`), "message") {
		t.Fatal("command fields are not kind-specific")
	}
}
