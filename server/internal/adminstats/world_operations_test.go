package adminstats

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/auro-ai/auro/server/internal/adminauth"
	"github.com/auro-ai/auro/server/internal/gameadmin"
	"github.com/auro-ai/auro/server/internal/testutil"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

func worldOpsTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("WORLD_OPS_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("WORLD_OPS_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := "world_ops_test_" + uuid.NewString()[:8]
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
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
	for _, table := range []string{
		"user", "workspace", "member", "game_policy", "game_world_override", "game_progress",
		"fish_revision", "fish_request", "tank_character", "tank_character_revision", "siege_session",
		"mcp_activity", "life_world", "life_event",
	} {
		name := pgx.Identifier{table}.Sanitize()
		if _, err := pool.Exec(ctx, "CREATE TABLE "+name+" (LIKE public."+name+" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)"); err != nil {
			t.Fatal(err)
		}
	}
	for n := 338; n <= 345; n++ {
		paths, err := filepath.Glob(fmt.Sprintf("../../migrations/%d_*.up.sql", n))
		if err != nil || len(paths) != 1 {
			t.Fatalf("migration %d: %v %v", n, paths, err)
		}
		migration, err := os.ReadFile(paths[0])
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, string(migration)); err != nil {
			t.Fatalf("migration %d: %v", n, err)
		}
	}
	return pool
}

func TestWorldOpsObservedActivityAndFollowups(t *testing.T) {
	pool := worldOpsTestDB(t)
	ctx := context.Background()
	fx := testutil.New(pool, "", "")
	fx.Exec(t, "UPDATE world_ops_coverage SET started_at = now() - interval '20 days'")
	admin := fx.User(t, "Ops admin", "ops@example.invalid")
	second := fx.User(t, "Second admin", "second@example.invalid")
	owner := fx.User(t, "World owner", "owner@example.invalid")
	alpha := fx.Workspace(t, "Alpha", "alpha", testutil.Cols{"created_at": testutil.Raw("now() - interval '10 days'")})
	beta := fx.Workspace(t, "Beta", "beta", testutil.Cols{"created_at": testutil.Raw("now() - interval '12 days'")})
	fx.Member(t, alpha, admin, "owner")
	fx.Member(t, beta, admin, "member")
	fx.Member(t, beta, owner, "owner")
	id := func(s string) pgtype.UUID {
		t.Helper()
		u, err := util.ParseUUID(s)
		if err != nil {
			t.Fatal(err)
		}
		return u
	}
	q := db.New(pool)
	for _, world := range []string{alpha, alpha, beta} {
		if _, err := q.RecordWorldOpsVisit(ctx, db.RecordWorldOpsVisitParams{ID: id(world), UserID: id(admin)}); err != nil {
			t.Fatal(err)
		}
	}
	if n, err := q.RecordWorldOpsVisit(ctx, db.RecordWorldOpsVisitParams{ID: id(alpha), UserID: id(owner)}); n != 0 || err != nil {
		t.Fatalf("nonmember visit recorded: %d %v", n, err)
	}
	fx.Exec(t, `INSERT INTO world_ops_visit VALUES ($1, $2, (now() AT TIME ZONE 'Asia/Shanghai')::date - 1, now() - interval '1 day')`, alpha, admin)
	fish := uuid.NewString()
	fx.Exec(t, `INSERT INTO fish_revision (fish_id, revision, workspace_id, user_id, payload)
	VALUES ($1, 1, $2, $3, jsonb_build_object('origin', 'mcp', 'createdAt', to_char((now() - interval '8 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'draft', 'PRIVATE FISH')),
	       ($1, 2, $2, $3, '{"createdAt":"invalidZ"}')`, fish, alpha, admin)
	fx.Exec(t, `INSERT INTO game_progress (workspace_id, user_id, game, payload)
	VALUES ($1, $2, 'tanks', '{"best":0,"unlocked":1}')`, alpha, admin)
	fx.Exec(t, `UPDATE game_progress SET payload = '{"best":10,"unlocked":1}' WHERE workspace_id = $1`, alpha)
	fx.Exec(t, `UPDATE game_progress SET payload = payload WHERE workspace_id = $1`, alpha)
	fx.Exec(t, `INSERT INTO fish_request (workspace_id,user_id,operation,request_id,body_hash,response) VALUES ($1,$2,'release',$3,'hash','{}')`, alpha, admin, uuid.NewString())
	fx.Exec(t, `INSERT INTO mcp_activity (id, service_id, workspace_id, actor_id, kind, outcome) VALUES ($1,'fish',$2,$3,'call','error')`, uuid.NewString(), beta, owner)

	gate, err := adminauth.New(pool, "ops@example.invalid,second@example.invalid")
	if err != nil {
		t.Fatal(err)
	}
	service := &Service{Pool: pool, Auth: gate, Games: &gameadmin.Service{Pool: pool, Auth: gate}}
	handler := service.AdminHandler()
	req := func(method, path, actor string) *http.Request {
		r := testutil.JSONRequest(method, path, "")
		r.Header.Set("X-User-ID", actor)
		r.Header.Set("X-Workspace-ID", beta)
		return r
	}
	const base = "/api/admin/worlds"
	testutil.Call(t, handler.ServeHTTP, req("GET", base, owner)).Want(403)
	machine := req("GET", base, admin)
	machine.Header.Set("X-Actor-Source", "task_token")
	testutil.Call(t, handler.ServeHTTP, machine).Want(403)

	type item struct {
		ID                                                     string
		Visitors, Returning, ActiveMembers, Creations, Actions int
	}
	var list struct {
		Totals map[string]int
		Items  []item
	}
	testutil.Call(t, handler.ServeHTTP, req("GET", base+"?segment=browsing", admin)).Want(200).JSON(&list)
	if len(list.Items) != 1 || list.Items[0].ID != beta || list.Totals["returning"] != 1 || list.Totals["first"] != 1 ||
		list.Totals["creative"] != 1 || list.Totals["active"] != 1 || list.Totals["cohort"] != 2 {
		t.Fatalf("unexpected browse segment and totals: %+v", list)
	}
	today := time.Now().In(worldOpsLocation).Format(time.DateOnly)
	testutil.Call(t, handler.ServeHTTP, req("GET", base+"?segment=returning&point="+today, admin)).Want(200).JSON(&list)
	if len(list.Items) != 1 || list.Items[0].ID != alpha || list.Items[0].Returning != 1 {
		t.Fatalf("return-visit trend drill-down: %+v", list)
	}
	snapshot := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339Nano)
	fx.Workspace(t, "Later world", "later")
	testutil.Call(t, handler.ServeHTTP, req("GET", base+"?asOf="+url.QueryEscape(snapshot), admin)).Want(200).JSON(&list)
	if list.Totals["total"] != 2 || len(list.Items) != 2 {
		t.Fatalf("new world leaked into a pinned snapshot: %+v", list)
	}

	var detail struct {
		Items       []item
		Activity    json.RawMessage
		Policies    []gameadmin.Effective
		Diagnostics db.WorldOpsDiagnosticsRow
	}
	testutil.Call(t, handler.ServeHTTP, req("GET", base+"/"+alpha, admin)).Want(200).JSON(&detail)
	if len(detail.Items) != 1 || detail.Items[0] != (item{alpha, 1, 1, 1, 1, 3}) || len(detail.Policies) != 4 || detail.Diagnostics.Failed != 0 {
		t.Fatalf("unexpected detail: %+v", detail)
	}

	world := id(alpha)
	keys := []pgtype.UUID{id(uuid.NewString()), id(uuid.NewString())}
	opened := followupInput{Note: "Check connection"}
	results := make([]error, len(keys))
	var group sync.WaitGroup
	for index, key := range keys {
		group.Add(1)
		go func() {
			defer group.Done()
			results[index] = service.writeFollowup(ctx, admin, world, key, opened)
		}()
	}
	group.Wait()
	var followup pgtype.UUID
	for index, result := range results {
		if result == nil {
			if followup.Valid {
				t.Fatalf("multiple open followups: %v", results)
			}
			followup = keys[index]
		} else if !errors.Is(result, errWorldConflict) {
			t.Fatal(result)
		}
	}
	if !followup.Valid {
		t.Fatalf("no open followup: %v", results)
	}
	if err := service.writeFollowup(ctx, admin, world, followup, opened); err != nil {
		t.Fatalf("create retry: %v", err)
	}
	handedOff := followupInput{AssigneeID: second, ExpectedVersion: 1, Note: "Reproduce", DueOn: "2026-11-10"}
	if err := service.writeFollowup(ctx, admin, world, followup, handedOff); err != nil {
		t.Fatal(err)
	}
	testutil.Call(t, handler.ServeHTTP, req("GET", base+"?segment=mine", second)).Want(200).JSON(&list)
	if len(list.Items) != 1 || list.Items[0].ID != alpha {
		t.Fatalf("handoff did not transfer the queue item: %+v", list)
	}
	closed := followupInput{AssigneeID: second, ExpectedVersion: 2, Close: true, Note: "Connection works", DueOn: handedOff.DueOn}
	for i := 0; i < 2; i++ {
		if err := service.writeFollowup(ctx, second, world, followup, closed); err != nil {
			t.Fatalf("close attempt %d: %v", i, err)
		}
	}
	history, err := q.ListWorldOpsFollowupEntries(ctx, db.ListWorldOpsFollowupEntriesParams{WorkspaceID: world, FollowupID: followup})
	if err != nil || len(history) != 3 || history[0].Action != "closed" || history[0].Note != closed.Note {
		t.Fatalf("history=%+v err=%v", history, err)
	}
	if err := q.DeleteWorkspaceOperations(ctx, world); err != nil {
		t.Fatal(err)
	}
	history, err = q.ListWorldOpsFollowupEntries(ctx, db.ListWorldOpsFollowupEntriesParams{WorkspaceID: world, FollowupID: followup})
	if err != nil || len(history) != 0 {
		t.Fatalf("world cleanup left history=%+v err=%v", history, err)
	}
}
