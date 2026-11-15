package ctf

import (
	"context"
	"encoding/json"
	"github.com/auro-ai/auro/server/internal/testutil"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func fixture(t *testing.T) (*Service, *testutil.Fixture, Actor) {
	t.Helper()
	dsn := os.Getenv("CTF_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("CTF_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	admin, e := pgxpool.New(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(admin.Close)
	schema := "ctf_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	for _, table := range []string{"user", "workspace", "member", "game_policy", "game_world_override"} {
		name := pgx.Identifier{table}.Sanitize()
		if _, e = pool.Exec(ctx, "CREATE TABLE "+name+" (LIKE public."+name+" INCLUDING ALL)"); e != nil {
			t.Fatal(e)
		}
	}
	_, source, _, _ := runtime.Caller(0)
	base := filepath.Join(filepath.Dir(source), "..", "..", "migrations")
	files, e := filepath.Glob(filepath.Join(base, "*_ctf*.up.sql"))
	if e != nil {
		t.Fatal(e)
	}
	for _, file := range files {
		raw, e := os.ReadFile(file)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = pool.Exec(ctx, strings.ReplaceAll(string(raw), "CONCURRENTLY ", "")); e != nil {
			t.Fatalf("%s: %v", filepath.Base(file), e)
		}
	}
	fx := testutil.New(pool, "", "")
	fx.UserID = fx.User(t, "CTF author", "ctf-owner@example.invalid")
	fx.WorkspaceID = fx.Workspace(t, "CTF world", "ctf-"+uuid.NewString()[:8])
	fx.Member(t, fx.WorkspaceID, fx.UserID, "owner")
	return &Service{Pool: pool, Engine: &NodeEngine{Path: os.Getenv("CTF_ENGINE_PATH")}}, fx, Actor{fx.WorkspaceID, fx.UserID}
}
func example(t *testing.T, name string) json.RawMessage {
	t.Helper()
	var files map[string]string
	if e := json.Unmarshal(ruleKit, &files); e != nil {
		t.Fatal(e)
	}
	return json.RawMessage(files["examples/"+name+".json"])
}
func saved(t *testing.T, s *Service, a Actor, name string) Strategy {
	t.Helper()
	out, e := s.Save(context.Background(), a, SaveInput{RequestID: uuid.NewString(), Name: name, Strategy: example(t, "ZS01")})
	if e != nil {
		t.Fatal(e)
	}
	var c Strategy
	if e = json.Unmarshal(encode(out), &c); e != nil {
		t.Fatal(e)
	}
	return c
}
func enroll(t *testing.T, s *Service, a Actor, c Strategy) {
	t.Helper()
	if _, e := s.Enroll(context.Background(), a, EnrollInput{RequestID: uuid.NewString(), ID: c.ID, Revision: c.Revision, Hash: c.Hash, Publish: true}); e != nil {
		t.Fatal(e)
	}
}
func wantProblem(t *testing.T, e error, code string) {
	t.Helper()
	p, ok := e.(*Problem)
	if !ok || p.Code != code {
		t.Fatalf("error=%v want=%s", e, code)
	}
}
func TestCTFPrivacyFrozenVersionsAndRetries(t *testing.T) {
	s, fx, a := fixture(t)
	ctx := context.Background()
	b := Actor{a.WorkspaceID, fx.User(t, "Other member", "ctf-member@example.invalid")}
	fx.Member(t, b.WorkspaceID, b.UserID, "member")
	in := SaveInput{RequestID: uuid.NewString(), Name: "First", Strategy: example(t, "ZS01")}
	out, e := s.Save(ctx, a, in)
	if e != nil {
		t.Fatal(e)
	}
	var first Strategy
	_ = json.Unmarshal(encode(out), &first)
	retry, e := s.Save(ctx, a, in)
	var retried Strategy
	_ = json.Unmarshal(encode(retry), &retried)
	if e != nil || retried.ID != first.ID || retried.Revision != first.Revision || retried.Hash != first.Hash {
		t.Fatal("retry changed saved version", e)
	}
	in.Name = "Different"
	_, e = s.Save(ctx, a, in)
	wantProblem(t, e, "idempotency_key_reused")
	_, privateErr := s.ReadStrategy(ctx, b, first.ID, 1)
	wantProblem(t, privateErr, "not_found")
	state, e := s.State(ctx, b)
	if e != nil || len(state.Mine) != 0 || len(state.Library) != 0 {
		t.Fatalf("private draft leaked %+v %v", state, e)
	}
	_, e = s.Enroll(ctx, a, EnrollInput{RequestID: uuid.NewString(), ID: first.ID, Revision: 1, Hash: first.Hash})
	wantProblem(t, e, "publication_required")
	enroll(t, s, a, first)
	own, readErr := s.State(ctx, a)
	if readErr != nil || len(own.Mine) != 1 || !own.Mine[0].Published {
		t.Fatal("published source was labeled private", readErr)
	}
	_, e = s.Save(ctx, a, SaveInput{RequestID: uuid.NewString(), ID: first.ID, ExpectedRevision: 1, Name: "Private revision", Strategy: example(t, "ZS02")})
	if e != nil {
		t.Fatal(e)
	}
	state, e = s.State(ctx, b)
	if e != nil || len(state.Library) != 1 || state.Library[0].Revision != 1 || state.Entries[0].Revision != 1 {
		t.Fatalf("editing changed public frozen revision %+v %v", state, e)
	}
	if _, e = s.ReadStrategy(ctx, b, first.ID, 1); e != nil {
		t.Fatal("public source unavailable", e)
	}
	_, e = s.ReadStrategy(ctx, b, first.ID, 2)
	wantProblem(t, e, "not_found")
	_, e = s.Save(ctx, b, SaveInput{RequestID: uuid.NewString(), ID: first.ID, ExpectedRevision: 2, Name: "Stolen", Strategy: example(t, "ZS01")})
	wantProblem(t, e, "not_found")
	_, e = s.Save(ctx, a, SaveInput{RequestID: uuid.NewString(), ID: first.ID, ExpectedRevision: 1, Name: "Stale", Strategy: example(t, "ZS01")})
	wantProblem(t, e, "revision_conflict")
	otherWorld := Actor{fx.Workspace(t, "Other world", "ctf-other-"+uuid.NewString()[:8]), b.UserID}
	fx.Member(t, otherWorld.WorkspaceID, b.UserID, "member")
	state, e = s.State(ctx, otherWorld)
	if e != nil || len(state.Library) != 0 || len(state.Entries) != 0 {
		t.Fatal("cross world data leak", e)
	}
}
func TestCTFOfficialBatchAuthorityRecoveryAndIdempotentScore(t *testing.T) {
	s, fx, a := fixture(t)
	ctx := context.Background()
	b := Actor{a.WorkspaceID, fx.User(t, "Challenger", "ctf-challenger@example.invalid")}
	fx.Member(t, b.WorkspaceID, b.UserID, "member")
	first := saved(t, s, a, "Red")
	second := saved(t, s, b, "Blue")
	enroll(t, s, a, first)
	enroll(t, s, b, second)
	_, e := s.Start(ctx, b, uuid.NewString())
	wantProblem(t, e, "forbidden")
	request := uuid.NewString()
	out, e := s.Start(ctx, a, request)
	if e != nil {
		t.Fatal(e)
	}
	again, e := s.Start(ctx, a, request)
	var originalBatch, retryBatch Batch
	_ = json.Unmarshal(encode(out), &originalBatch)
	_ = json.Unmarshal(encode(again), &retryBatch)
	if e != nil || originalBatch != retryBatch {
		t.Fatal("batch retry was not stable", e)
	}
	var batch Batch
	_ = json.Unmarshal(encode(out), &batch)
	q := db.New(s.Pool)
	lease, _ := id(uuid.NewString())
	job, e := q.ClaimCTFMatch(ctx, lease)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Pool.Exec(ctx, "UPDATE ctf_match SET lease_until=now()-interval '1 second' WHERE id=$1", job.ID); e != nil {
		t.Fatal(e)
	}
	if e = s.Step(ctx); e != nil {
		t.Fatal(e)
	}
	state, e := s.State(ctx, a)
	if e != nil {
		t.Fatal(e)
	}
	if len(state.Matches) != 1 || state.Matches[0].Result == nil || state.Batches[0].Status != "completed" {
		t.Fatalf("batch did not recover %+v", state)
	}
	var board []struct {
		Games int `json:"games"`
	}
	if e = json.Unmarshal(state.Leaderboard, &board); e != nil || len(board) != 2 || board[0].Games != 1 {
		t.Fatalf("rating %+v %v", board, e)
	}
	if e = s.Step(ctx); e != nil {
		t.Fatal(e)
	}
	_, e = s.Start(ctx, a, uuid.NewString())
	wantProblem(t, e, "no_new_pairs")
	state2, _ := s.State(ctx, a)
	if string(state2.Leaderboard) != string(state.Leaderboard) {
		t.Fatal("completed job scored twice")
	}
	detail, e := s.GetMatch(ctx, a, state.Matches[0].ID)
	if e != nil || len(detail.Frames) < 2 {
		t.Fatal("missing replay", e)
	}
	foreign := Actor{fx.Workspace(t, "Foreign", "ctf-foreign-"+uuid.NewString()[:8]), a.UserID}
	fx.Member(t, foreign.WorkspaceID, a.UserID, "owner")
	_, e = s.GetMatch(ctx, foreign, detail.ID)
	wantProblem(t, e, "not_found")
	if _, e = q.FinishCTFMatch(ctx, db.FinishCTFMatchParams{WorkspaceID: job.WorkspaceID, ID: job.ID, LeaseID: lease, Result: encode(Outcome{Result: &Result{Winner: "red"}})}); e != nil {
		t.Fatal(e)
	}
	detail2, _ := s.GetMatch(ctx, a, detail.ID)
	if detail2.Result.Winner != detail.Result.Winner || len(detail2.Frames) != len(detail.Frames) {
		t.Fatal("stale lease replaced the result")
	}
}
func TestCTFPausedAndClosedGamesDoNotStartJobs(t *testing.T) {
	s, fx, a := fixture(t)
	ctx := context.Background()
	b := Actor{a.WorkspaceID, fx.User(t, "Opponent", "ctf-opponent@example.invalid")}
	fx.Member(t, b.WorkspaceID, b.UserID, "member")
	enroll(t, s, a, saved(t, s, a, "A"))
	enroll(t, s, b, saved(t, s, b, "B"))
	out, e := s.Start(ctx, a, uuid.NewString())
	if e != nil {
		t.Fatal(e)
	}
	var batch Batch
	_ = json.Unmarshal(encode(out), &batch)
	if _, e = s.Control(ctx, a, batch.ID, "pause"); e != nil {
		t.Fatal(e)
	}
	if e = s.Step(ctx); e != nil {
		t.Fatal(e)
	}
	state, _ := s.State(ctx, a)
	if state.Matches[0].Status != "queued" {
		t.Fatal("paused game ran")
	}
	if _, e = s.Control(ctx, a, batch.ID, "resume"); e != nil {
		t.Fatal(e)
	}
	fx.InsertNoID(t, "game_policy", testutil.Cols{"game_id": "ctf", "scope": "disabled", "default_visible": false, "revision": 1, "updated_by": a.UserID}, "game_id=$1", "ctf")
	if e = s.Step(ctx); e != nil {
		t.Fatal(e)
	}
	state, _ = s.State(ctx, a)
	if state.Matches[0].Status != "queued" {
		t.Fatal("closed game consumed a job")
	}
}

func TestCTFNextEntryDoesNotReplaceFrozenRanking(t *testing.T) {
	s, fx, a := fixture(t)
	ctx := context.Background()
	b := Actor{a.WorkspaceID, fx.User(t, "Rival", "next-entry@example.invalid")}
	fx.Member(t, b.WorkspaceID, b.UserID, "member")
	first := saved(t, s, a, "First version")
	enroll(t, s, a, first)
	enroll(t, s, b, saved(t, s, b, "Opponent"))
	if _, e := s.Start(ctx, a, uuid.NewString()); e != nil {
		t.Fatal(e)
	}
	next, e := s.Save(ctx, a, SaveInput{RequestID: uuid.NewString(), ID: first.ID, ExpectedRevision: 1, Name: "Next batch", Strategy: example(t, "ZS02")})
	if e != nil {
		t.Fatal(e)
	}
	var newer Strategy
	_ = json.Unmarshal(encode(next), &newer)
	enroll(t, s, a, newer)
	if e = s.Step(ctx); e != nil {
		t.Fatal(e)
	}
	state, e := s.State(ctx, a)
	if e != nil {
		t.Fatal(e)
	}
	var board []struct {
		ID string `json:"strategy_id"`
	}
	if e = json.Unmarshal(state.Leaderboard, &board); e != nil {
		t.Fatal(e)
	}
	found := false
	for _, row := range board {
		if row.ID == revisionKey(first) {
			found = true
		}
		if row.ID == revisionKey(newer) {
			t.Fatal("unplayed future version appeared in completed batch ranking")
		}
	}
	if !found {
		t.Fatal("changing the next entry removed the frozen participant's official ranking")
	}
	w, _ := id(a.WorkspaceID)
	firstBatch, _ := id(state.Batches[0].ID)
	q := db.New(s.Pool)
	snapshot, e := q.GetCTFBatchBoard(ctx, db.GetCTFBatchBoardParams{WorkspaceID: w, ID: firstBatch})
	if e != nil || len(snapshot) == 0 {
		t.Fatal("missing first published snapshot", e)
	}
	if _, e = s.Start(ctx, a, uuid.NewString()); e != nil {
		t.Fatal(e)
	}
	if e = s.Step(ctx); e != nil {
		t.Fatal(e)
	}
	retained, e := q.GetCTFBatchBoard(ctx, db.GetCTFBatchBoardParams{WorkspaceID: w, ID: firstBatch})
	if e != nil || string(retained) != string(snapshot) {
		t.Fatal("a later batch changed its predecessor's ranking snapshot", e)
	}
}
