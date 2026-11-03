package gameadmin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"

	"github.com/auro-ai/auro/server/internal/adminauth"
	"github.com/auro-ai/auro/server/internal/life"
	"github.com/auro-ai/auro/server/internal/middleware"
	"github.com/auro-ai/auro/server/internal/testutil"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Every test owns shadow tables in a disposable schema; global policies in the
// checkout's database must never be changed by an integration test.
func testDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("GAME_ADMIN_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("GAME_ADMIN_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := "game_admin_test_" + uuid.NewString()[:8]
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = admin.Exec(ctx, "DROP SCHEMA "+quoted+" CASCADE") })
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
	for _, table := range []string{"user", "workspace", "member", "life_world", "life_agent", "life_resource", "life_action", "life_event", "game_policy", "game_world_override", "game_policy_audit"} {
		name := pgx.Identifier{table}.Sanitize()
		if _, err = pool.Exec(ctx, "CREATE TABLE "+name+" (LIKE public."+name+" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)"); err != nil {
			t.Fatal(err)
		}
	}
	return pool
}

func TestDBPoliciesAuditIsolationAndGuards(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	fx := testutil.New(pool, "", "")
	actor := fx.User(t, "Platform admin", "platform-admin@example.invalid")
	other := fx.User(t, "World owner", "world-owner@example.invalid")
	w1 := fx.Workspace(t, "Alpha", "alpha")
	w2 := fx.Workspace(t, "Beta", "beta")
	fx.Member(t, w1, other, "owner")
	gate, err := adminauth.New(pool, "platform-admin@example.invalid")
	if err != nil {
		t.Fatal(err)
	}
	s := &Service{Pool: pool, Auth: gate}
	visible := true
	in := PolicyInput{Scope: "selected", DefaultVisible: &visible, Overrides: []Override{{w1, "allow", "hide"}}}
	preview, err := s.Preview(ctx, "siege", in)
	if err != nil || preview.Total != 2 || preview.Available != 1 || preview.Visible != 0 {
		t.Fatalf("preview=%+v err=%v", preview, err)
	}
	if _, err = s.Update(ctx, other, "siege", in); !errors.Is(err, adminauth.ErrForbidden) {
		t.Fatalf("world owner update=%v", err)
	}
	policy, err := s.Update(ctx, actor, "siege", in)
	if err != nil || policy.Revision != 1 {
		t.Fatalf("update=%+v err=%v", policy, err)
	}
	if _, err = s.Update(ctx, actor, "siege", in); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale save=%v", err)
	}
	for _, tc := range []struct {
		id                 string
		available, visible bool
	}{{w1, true, false}, {w2, false, false}} {
		out, err := s.Effective(ctx, tc.id, "siege")
		if err != nil || out.Available != tc.available || out.Visible != tc.visible {
			t.Fatalf("effective=%+v err=%v", out, err)
		}
	}
	w3 := fx.Workspace(t, "Created later", "later")
	if out, err := s.Effective(ctx, w3, "siege"); err != nil || out.Available {
		t.Fatalf("new selected world=%+v %v", out, err)
	}
	if out, err := s.Effective(ctx, w3, "tanks"); err != nil || !out.Available || !out.Visible {
		t.Fatalf("new inherited world=%+v %v", out, err)
	}
	page, err := s.Activity(ctx, "siege", "")
	if err != nil || len(page.Items) != 1 || page.Items[0].ActorID != actor {
		t.Fatalf("audit=%+v err=%v", page, err)
	}
	var previous Policy
	if json.Unmarshal(page.Items[0].Previous, &previous) != nil || previous.Scope != "all" || previous.Revision != 0 {
		t.Fatalf("previous=%s", page.Items[0].Previous)
	}
	overview, err := s.Overview(ctx)
	if err != nil || len(overview) != 3 || overview[0].Impact.Available != 1 {
		t.Fatalf("overview=%+v err=%v", overview, err)
	}
	admin := s.AdminHandler()
	for _, tc := range []struct {
		actor, source string
		status        int
	}{{"", "", 401}, {other, "", 403}, {actor, "task_token", 403}, {actor, "", 200}} {
		r := testutil.JSONRequest("GET", "/api/admin/games", "")
		r.Header.Set("X-User-ID", tc.actor)
		r.Header.Set("X-Actor-Source", tc.source)
		testutil.Call(t, admin.ServeHTTP, r).Want(tc.status)
	}
	uid, _ := util.ParseUUID(other)
	called := false
	guard := s.Guard("siege", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true; w.WriteHeader(204) }))
	for _, tc := range []struct {
		id     string
		status int
	}{{w1, 204}, {w2, 403}} {
		r := httptest.NewRequest("GET", "/api/siege/library", nil)
		r = r.WithContext(middleware.SetMemberContext(r.Context(), tc.id, db.Member{UserID: uid}))
		testutil.Call(t, guard.ServeHTTP, r).Want(tc.status)
	}
	if !called {
		t.Fatal("allowed world did not reach game")
	}
	guard = s.Guard("tanks", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	in = PolicyInput{ExpectedRevision: 0, Scope: "disabled", DefaultVisible: &visible, Overrides: []Override{}}
	if _, err = s.Update(ctx, actor, "tanks", in); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/tanks/v1/catalog", "/api/tanks/mcp"} {
		r := httptest.NewRequest("GET", path, nil)
		r = r.WithContext(middleware.SetMemberContext(r.Context(), w1, db.Member{UserID: uid}))
		testutil.Call(t, guard.ServeHTTP, r).Want(403)
	}
	progress := s.ProgressGuard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if ProgressAllowed(r.Context(), "tanks") || !ProgressAllowed(r.Context(), "siege") {
			t.Error("aggregate received the wrong allowed games")
		}
		w.WriteHeader(204)
	}))
	for _, tc := range []struct {
		method, path string
		status       int
	}{
		{"GET", "/api/game-progress", 204}, {"PUT", "/api/game-progress/tanks", 403}, {"PUT", "/api/game-progress/siege", 204},
	} {
		r := httptest.NewRequest(tc.method, tc.path, nil)
		r = r.WithContext(middleware.SetMemberContext(r.Context(), w1, db.Member{UserID: uid}))
		testutil.Call(t, progress.ServeHTTP, r).Want(tc.status)
	}
	memberHandler := middleware.RequireWorkspaceMember(db.New(pool))(http.HandlerFunc(s.MemberHandler))
	for _, tc := range []struct {
		user, world string
		status      int
	}{{other, w1, 200}, {other, w2, 404}} {
		r := testutil.JSONRequest("GET", "/api/games", "")
		r.Header.Set("X-User-ID", tc.user)
		r.Header.Set("X-Workspace-ID", tc.world)
		testutil.Call(t, memberHandler.ServeHTTP, r).Want(tc.status)
	}
	search, err := s.Worlds(ctx, "Alpha", "")
	if err != nil || len(search.Items) != 1 || search.Items[0].ID != w1 {
		t.Fatalf("search=%+v %v", search, err)
	}
}

func TestDBConcurrentPolicySaveAndAuditRollback(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	fx := testutil.New(pool, "", "")
	actor := fx.User(t, "Admin", "admin@example.invalid")
	gate, _ := adminauth.New(pool, "admin@example.invalid")
	s := &Service{Pool: pool, Auth: gate}
	visible := true
	in := PolicyInput{Scope: "all", DefaultVisible: &visible, Overrides: []Override{}}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := s.Update(ctx, actor, "siege", in); errs <- err }()
	}
	wg.Wait()
	close(errs)
	success, conflict := 0, 0
	for err := range errs {
		if err == nil {
			success++
		} else if errors.Is(err, ErrConflict) {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("success=%d conflict=%d", success, conflict)
	}
	fx.Exec(t, "ALTER TABLE game_policy_audit ADD CONSTRAINT fail_audit CHECK (revision < 2)")
	in.ExpectedRevision = 1
	in.Scope = "disabled"
	if _, err := s.Update(ctx, actor, "siege", in); err == nil {
		t.Fatal("save ignored failed audit")
	}
	p, _, err := loadPolicy(ctx, db.New(pool), "siege")
	if err != nil || p.Revision != 1 || p.Scope != "all" {
		t.Fatalf("rollback policy=%+v %v", p, err)
	}
	if n := fx.Count(t, "SELECT count(*) FROM game_policy_audit"); n != 1 {
		t.Fatalf("audit rows=%d", n)
	}
}

func TestDBLifeWorldSelectionKeepsSimulationDataIsolated(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	fx := testutil.New(pool, "", "")
	actor := fx.User(t, "Admin", "admin@example.invalid")
	home := fx.Workspace(t, "Simulation home", "home")
	chosen := fx.Workspace(t, "Chosen world", "chosen")
	gate, _ := adminauth.New(pool, "admin@example.invalid")
	s := &Service{Pool: pool, Auth: gate}
	fx.Insert(t, "life_world", testutil.Cols{"id": uuid.NewString(), "workspace_id": home, "tick_ms": 2000})
	visible := true
	in := PolicyInput{Scope: "selected", DefaultVisible: &visible, Overrides: []Override{{chosen, "allow", "show"}}}
	preview, err := s.Preview(ctx, "life", in)
	if err != nil || preview.Available != 1 || preview.Visible != 1 {
		t.Fatalf("preview=%+v err=%v", preview, err)
	}
	policy, err := s.Update(ctx, actor, "life", in)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		world     string
		available bool
	}{{home, false}, {chosen, true}} {
		out, err := s.Effective(ctx, tc.world, "life")
		if err != nil || out.Available != tc.available || out.Visible != tc.available {
			t.Fatalf("effective=%+v err=%v", out, err)
		}
	}
	uid, _ := util.ParseUUID(actor)
	handler := s.Guard("life", life.Handler(db.New(pool)))
	req := httptest.NewRequest("GET", "/api/life", nil)
	req = req.WithContext(middleware.SetMemberContext(req.Context(), chosen, db.Member{UserID: uid}))
	var snapshot struct {
		World  *json.RawMessage  `json:"world"`
		Agents []json.RawMessage `json:"agents"`
	}
	testutil.Call(t, handler.ServeHTTP, req).Want(200).JSON(&snapshot)
	if snapshot.World != nil || len(snapshot.Agents) != 0 {
		t.Fatalf("selected world received another world's simulation: %+v", snapshot)
	}
	in.ExpectedRevision = policy.Revision
	in.Scope = "all"
	in.Overrides = []Override{}
	policy, err = s.Update(ctx, actor, "life", in)
	if err != nil {
		t.Fatal(err)
	}
	if out, err := s.Effective(ctx, home, "life"); err != nil || !out.Available {
		t.Fatalf("all=%+v err=%v", out, err)
	}
	in.ExpectedRevision = policy.Revision
	in.Scope = "disabled"
	if _, err = s.Update(ctx, actor, "life", in); err != nil {
		t.Fatal(err)
	}
	if n := fx.Count(t, "SELECT count(*) FROM life_world WHERE workspace_id=$1", home); n != 1 {
		t.Fatal("policy change removed simulation")
	}
}

func TestDBLifeScopeMigrationPreservesAudience(t *testing.T) {
	for _, mode := range []string{"default", "inherit", "deny", "uninitialized"} {
		t.Run(mode, func(t *testing.T) {
			pool := testDB(t)
			fx := testutil.New(pool, "", "")
			actor := fx.User(t, "Admin", "admin@example.invalid")
			home := fx.Workspace(t, "Home", "home")
			other := fx.Workspace(t, "Other", "other")
			fx.Exec(t, "ALTER TABLE game_policy DROP CONSTRAINT game_policy_scope_check; ALTER TABLE game_policy ADD CONSTRAINT game_policy_scope_check CHECK (scope IN ('all','selected','bound','disabled'))")
			defaultVisible := mode == "default"
			fx.Exec(t, "INSERT INTO game_policy(game_id,scope,default_visible,revision,updated_by) VALUES('life','bound',$1,3,$2)", defaultVisible, actor)
			access := mode
			if mode == "uninitialized" {
				access = "inherit"
			} else {
				fx.Insert(t, "life_world", testutil.Cols{"id": uuid.NewString(), "workspace_id": home})
			}
			if mode != "default" {
				fx.Exec(t, "INSERT INTO game_world_override(game_id,workspace_id,access,visibility) VALUES('life',$1,$2,'show'),('life',$3,'allow','show')", home, access, other)
			}
			raw, err := os.ReadFile("../../migrations/327_life_game_world_selection.up.sql")
			if err != nil {
				t.Fatal(err)
			}
			fx.Exec(t, string(raw))
			s := &Service{Pool: pool}
			policy, _, err := loadPolicy(context.Background(), db.New(pool), "life")
			if err != nil || policy.Scope != "selected" || policy.Revision != 3 || policy.DefaultVisible != defaultVisible {
				t.Fatalf("migrated policy=%+v err=%v", policy, err)
			}
			for _, tc := range []struct {
				id        string
				available bool
			}{{home, mode == "inherit" || mode == "default"}, {other, false}} {
				out, err := s.Effective(context.Background(), tc.id, "life")
				if err != nil || out.Available != tc.available || out.Visible != tc.available {
					t.Fatalf("audience=%+v err=%v", out, err)
				}
			}
		})
	}
}
