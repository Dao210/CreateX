package tanks

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/auro-ai/auro/server/internal/testutil"
	"github.com/google/uuid"
)

func TestTrainingRewardBounds(t *testing.T) {
	for _, tc := range []struct {
		name        string
		in          TrainingSummary
		elapsed     time.Duration
		mode        string
		level, want int
		invalid     bool
	}{
		{"defeat retains earned experience", TrainingSummary{Ticks: 3600, Kills: 8, Outcome: "defeat"}, time.Minute, "campaign", 1, 80, false},
		{"quick completion remains valid", TrainingSummary{Ticks: 300, Kills: 2, Outcome: "cleared"}, 5 * time.Second, "campaign", 1, 60, false},
		{"completion bonus", TrainingSummary{Ticks: 3600, Kills: 12, Outcome: "cleared"}, time.Minute, "campaign", 1, 160, false},
		{"bounded survival", TrainingSummary{Ticks: 3600, Kills: 100, Outcome: "defeat"}, time.Minute, "survival", 1, 300, false},
		{"abandon keeps kills", TrainingSummary{Ticks: 3600, Kills: 4, Outcome: "abandoned"}, time.Minute, "campaign", 1, 40, false},
		{"fabricated elapsed", TrainingSummary{Ticks: 3600, Kills: 8, Outcome: "defeat"}, time.Second, "campaign", 1, 0, true},
		{"negative kills", TrainingSummary{Ticks: 3600, Kills: -1, Outcome: "defeat"}, time.Minute, "campaign", 1, 0, true},
		{"impossible kills", TrainingSummary{Ticks: 30, Kills: 8, Outcome: "defeat"}, time.Minute, "campaign", 1, 0, true},
		{"empty victory", TrainingSummary{Ticks: 3600, Outcome: "victory"}, time.Minute, "campaign", 6, 0, true},
		{"wrong stage outcome", TrainingSummary{Ticks: 3600, Kills: 12, Outcome: "victory"}, time.Minute, "campaign", 1, 0, true},
		{"unknown outcome", TrainingSummary{Ticks: 3600, Kills: 12, Outcome: "future"}, time.Minute, "campaign", 1, 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, e := trainingAward(tc.in, tc.elapsed, tc.mode, tc.level)
			if (e != nil) != tc.invalid || got != tc.want {
				t.Fatalf("award=%d error=%v", got, e)
			}
		})
	}
}

func TestTrainingHTTPRejectsClientRewards(t *testing.T) {
	h := (&HTTP{}).Handler()
	r, _ := http.NewRequest(http.MethodPost, "/api/tanks/v1/sessions/"+uuid.NewString()+"/runs/"+uuid.NewString()+"/settle", strings.NewReader(`{"ticks":1000,"kills":1,"outcome":"defeat","xp":999}`))
	r.Header.Set("Content-Type", "application/json")
	r = r.WithContext(WithActor(r.Context(), Actor{WorkspaceID: uuid.NewString(), UserID: uuid.NewString()}))
	testutil.Call(t, h.ServeHTTP, r).Want(400)
}

func TestTankDBPermanentGrowthExactlyOnceAndFrozen(t *testing.T) {
	s, fx, a := tankDB(t)
	ctx := context.Background()
	c, e := s.Save(ctx, a, SaveInput{RequestID: uuid.NewString(), Draft: testDraft()})
	if e != nil {
		t.Fatal(e)
	}
	other, e := s.Save(ctx, a, SaveInput{RequestID: uuid.NewString(), Draft: testDraft()})
	if e != nil {
		t.Fatal(e)
	}
	launch := SessionInput{RequestID: uuid.NewString(), CharacterID: c.ID, Revision: 1, ContentHash: c.ContentHash, MapID: "frontline", Mode: "campaign"}
	session, e := s.CreateSession(ctx, a, launch)
	if e != nil {
		t.Fatal(e)
	}
	start := TrainingStart{RequestID: uuid.NewString(), LevelID: 1}
	run, e := s.StartTraining(ctx, a, session.ID, start)
	if e != nil {
		t.Fatal(e)
	}
	again, e := s.StartTraining(ctx, a, session.ID, start)
	if e != nil || again != run {
		t.Fatalf("retry=%+v error=%v", again, e)
	}
	changed := start
	changed.LevelID = 2
	_, e = s.StartTraining(ctx, a, session.ID, changed)
	wantCode(t, e, "idempotency_key_reused")
	fx.Exec(t, `UPDATE tank_training_run SET started_at=now()-interval '1 minute' WHERE id=$1::uuid`, run.ID)
	summary := TrainingSummary{Ticks: 3600, Kills: 12, Outcome: "cleared"}
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			result, e := s.SettleTraining(ctx, a, session.ID, run.ID, summary)
			if e != nil || result.Progression.XP != 160 || result.AwardedXP != 160 {
				t.Errorf("settlement=%+v error=%v", result, e)
			}
		})
	}
	wg.Wait()
	summary.Kills++
	_, e = s.SettleTraining(ctx, a, session.ID, run.ID, summary)
	wantCode(t, e, "idempotency_key_reused")
	current, e := s.GetCharacter(ctx, a, c.ID, 0)
	if e != nil || current.Progression.XP != 160 {
		t.Fatalf("current=%+v error=%v", current, e)
	}
	untouched, e := s.GetCharacter(ctx, a, other.ID, 0)
	if e != nil || untouched.Progression.XP != 0 {
		t.Fatalf("other=%+v error=%v", untouched, e)
	}
	update := SaveInput{RequestID: uuid.NewString(), CharacterID: c.ID, ExpectedRevision: 1, Draft: c.Draft}
	update.Draft.Name = "New name"
	updated, e := s.Save(ctx, a, update)
	if e != nil {
		t.Fatal(e)
	}
	current, e = s.GetCharacter(ctx, a, c.ID, 0)
	if e != nil || current.Progression.XP != 160 || current.Revision != 2 {
		t.Fatalf("revised=%+v error=%v", current, e)
	}
	frozen, e := s.GetSession(ctx, a, session.ID)
	if e != nil || frozen.Progression.XP != 0 || frozen.Character.Revision != 1 {
		t.Fatalf("frozen=%+v error=%v", frozen, e)
	}
	launch.RequestID = uuid.NewString()
	launch.Revision = updated.Revision
	launch.ContentHash = updated.ContentHash
	next, e := s.CreateSession(ctx, a, launch)
	if e != nil || next.Progression.XP != 160 || next.Loadout.Speed != 108 {
		t.Fatalf("next=%+v error=%v", next, e)
	}
	// Cap only the actual award, with no reset on a new run or design revision.
	fx.Exec(t, `UPDATE tank_character SET experience=2695 WHERE id=$1::uuid`, c.ID)
	run, e = s.StartTraining(ctx, a, next.ID, TrainingStart{RequestID: uuid.NewString(), LevelID: 1})
	if e != nil {
		t.Fatal(e)
	}
	fx.Exec(t, `UPDATE tank_training_run SET started_at=now()-interval '1 minute' WHERE id=$1::uuid`, run.ID)
	result, e := s.SettleTraining(ctx, a, next.ID, run.ID, TrainingSummary{Ticks: 3600, Kills: 1, Outcome: "defeat"})
	if e != nil || result.AwardedXP != 5 || result.Progression.XP != 2700 {
		t.Fatalf("capped=%+v error=%v", result, e)
	}
	firstActive, e := s.StartTraining(ctx, a, next.ID, TrainingStart{RequestID: uuid.NewString(), LevelID: 1})
	if e != nil {
		t.Fatal(e)
	}
	secondActive, e := s.StartTraining(ctx, a, next.ID, TrainingStart{RequestID: uuid.NewString(), LevelID: 1})
	if e != nil {
		t.Fatal(e)
	}
	_, e = s.SettleTraining(ctx, a, next.ID, firstActive.ID, TrainingSummary{Outcome: "abandoned"})
	wantCode(t, e, "training_superseded")
	atCap, e := s.SettleTraining(ctx, a, next.ID, secondActive.ID, TrainingSummary{Outcome: "abandoned"})
	if e != nil || atCap.AwardedXP != 0 || atCap.Progression.XP != 2700 {
		t.Fatalf("cap replay=%+v error=%v", atCap, e)
	}
	otherWorld := fx.Workspace(t, "Other world", "growth-other-"+uuid.NewString())
	fx.Member(t, otherWorld, a.UserID, "owner")
	_, e = s.SettleTraining(ctx, Actor{WorkspaceID: otherWorld, UserID: a.UserID}, next.ID, secondActive.ID, TrainingSummary{Outcome: "abandoned"})
	wantCode(t, e, "not_found")
	member := fx.User(t, "Other trainer", "other-"+uuid.NewString()+"@example.invalid")
	fx.Member(t, a.WorkspaceID, member, "member")
	b := Actor{WorkspaceID: a.WorkspaceID, UserID: member}
	_, e = s.SettleTraining(ctx, b, session.ID, run.ID, summary)
	wantCode(t, e, "not_found")
	launch.RequestID = uuid.NewString()
	borrowed, e := s.CreateSession(ctx, b, launch)
	if e != nil {
		t.Fatal(e)
	}
	_, e = s.StartTraining(ctx, b, borrowed.ID, TrainingStart{RequestID: uuid.NewString(), LevelID: 1})
	wantCode(t, e, "training_owner_required")
}

func TestFrozenGrowthCompiler(t *testing.T) {
	base := Blueprint{Speed: 98, Armor: 2, FireInterval: 15}
	for _, tc := range []struct{ xp, speed, armor, interval, evolution int }{{0, 98, 2, 15, 0}, {700, 104, 2, 14, 1}, {2700, 110, 3, 12, 2}} {
		got := applyGrowth(base, tc.xp)
		if got.Speed != tc.speed || got.Armor != tc.armor || got.FireInterval != tc.interval || got.Evolution != tc.evolution {
			t.Fatalf("xp=%d got=%+v", tc.xp, got)
		}
	}
	if base.Speed != 98 || base.Armor != 2 || base.FireInterval != 15 {
		t.Fatal("mutated base design")
	}
}
