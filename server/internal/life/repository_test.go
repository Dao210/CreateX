package life

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/auro-ai/auro/server/internal/events"
	"github.com/auro-ai/auro/server/internal/testutil"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func lifeDatabase(t *testing.T) (*Repository, *testutil.Fixture, string, *NodeRuntime) {
	t.Helper()
	dsn := os.Getenv("LIFE_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("LIFE_TEST_DATABASE_URL is not set")
	}
	path := os.Getenv("AGENT_LIFE_ENGINE_PATH")
	if path == "" {
		t.Fatal("build the engine and set AGENT_LIFE_ENGINE_PATH")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := pgx.Identifier{"life_test_" + uuid.NewString()[:8]}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
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
	for _, name := range []string{"workspace", "life_world", "life_agent", "life_resource", "life_action", "life_event", "world_inbox_event"} {
		table := pgx.Identifier{name}.Sanitize()
		if _, err = pool.Exec(ctx, "CREATE TABLE "+table+" (LIKE public."+table+" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)"); err != nil {
			t.Fatal(err)
		}
	}
	fx := testutil.New(pool, "", "")
	workspace := fx.Workspace(t, "Life", "life-test")
	runtime := NewNodeRuntime(path)
	t.Cleanup(func() { _ = runtime.Close() })
	return &Repository{Pool: pool}, fx, workspace, runtime
}

func TestDBSingleWriterRollbackRestartAndMilestones(t *testing.T) {
	repo, fx, workspace, runtime := lifeDatabase(t)
	ctx := context.Background()
	seed, err := runtime.Seed(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	ids := make(chan string, 4)
	for range 4 {
		wg.Go(func() {
			binding, e := repo.Initialize(ctx, workspace, seed)
			if e != nil {
				t.Error(e)
				return
			}
			ids <- util.UUIDToString(binding.ID)
		})
	}
	wg.Wait()
	close(ids)
	var world string
	for id := range ids {
		if world != "" && id != world {
			t.Fatal("duplicate world")
		}
		world = id
	}
	if fx.Count(t, "SELECT count(*) FROM life_agent") != 20 {
		t.Fatal("duplicate residents")
	}
	other := fx.Workspace(t, "Other", "other")
	if _, err = repo.Initialize(ctx, other, seed); !errors.Is(err, ErrBindingMismatch) {
		t.Fatalf("binding mismatch: %v", err)
	}
	bus := events.New()
	var published atomic.Int32
	bus.Subscribe("life:updated", func(event events.Event) {
		published.Add(1)
		if event.WorkspaceID != workspace {
			t.Error("cross-world event")
		}
	})
	service := NewService(repo, runtime, bus)
	if err = service.Prepare(ctx, ""); err != nil {
		t.Fatal(err)
	}
	var committed atomic.Int32
	for range 8 {
		wg.Go(func() {
			ok, e := service.Step(ctx)
			if e != nil {
				t.Error(e)
			}
			if ok {
				committed.Add(1)
			}
		})
	}
	wg.Wait()
	if committed.Load() != 1 || published.Load() != 1 {
		t.Fatalf("ticks=%d events=%d", committed.Load(), published.Load())
	}
	due := func() { fx.Exec(t, "UPDATE life_world SET next_tick_at=clock_timestamp()-interval '1 second'") }
	due()
	before := fx.Count(t, "SELECT count(*) FROM life_action")
	beforeResources := fx.Count(t, "SELECT sum(amount) FROM life_resource")
	beforeEnergy := fx.Count(t, "SELECT sum(energy) FROM life_agent")
	fx.Exec(t, `CREATE FUNCTION reject_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected_event_failure'; END $$`)
	fx.Exec(t, `CREATE TRIGGER reject_event BEFORE INSERT ON life_event FOR EACH ROW EXECUTE FUNCTION reject_event()`)
	if _, err = service.Step(ctx); err == nil || !strings.Contains(err.Error(), "injected_event_failure") {
		t.Fatal("expected event failure")
	}
	if fx.Count(t, "SELECT tick FROM life_world") != 1 || fx.Count(t, "SELECT count(*) FROM life_action") != before || published.Load() != 1 {
		t.Fatal("failed tick committed or published")
	}
	if fx.Count(t, "SELECT sum(amount) FROM life_resource") != beforeResources || fx.Count(t, "SELECT sum(energy) FROM life_agent") != beforeEnergy {
		t.Fatal("failed tick changed balances or needs")
	}
	fx.Exec(t, "DROP TRIGGER reject_event ON life_event")
	// A dead child fails this attempt without changing the database. The next attempt restarts it.
	_ = runtime.process.cmd.Process.Kill()
	if _, err = service.Step(ctx); err == nil {
		t.Fatal("expected compute process failure")
	}
	if fx.Count(t, "SELECT tick FROM life_world") != 1 {
		t.Fatal("process failure advanced world")
	}
	if ok, e := service.Step(ctx); e != nil || !ok {
		t.Fatalf("restart: %v %v", ok, e)
	}
	for range 70 {
		due()
		if _, err = service.Step(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if fx.Count(t, "SELECT tick FROM life_world") != 72 {
		t.Fatal("world did not resume")
	}
	if fx.Count(t, "SELECT count(*) FROM life_action a LEFT JOIN life_event e ON a.id=e.action_id WHERE a.status<>'running' AND e.action_id IS NULL") != 0 {
		t.Fatal("missing terminal event")
	}
	if fx.Count(t, "SELECT count(*) FROM life_resource WHERE amount<0") != 0 {
		t.Fatal("negative resource")
	}
	binding, err := repo.Binding(ctx)
	if err != nil {
		t.Fatal(err)
	}
	state, err := repo.Load(ctx, binding)
	if err != nil {
		t.Fatal(err)
	}
	resident := state.Agents[0]
	target := resident.Goal.Target + 100
	fx.Exec(t, "UPDATE life_agent SET x=9,y=6,energy=100,fullness=100,social=100,goal=jsonb_build_object('kind','wood','target',$2::int) WHERE id=$1::uuid", resident.ID, target)
	fx.Exec(t, "UPDATE life_resource SET amount=$2 WHERE owner=$1 AND kind='wood'", resident.ID, target-1)
	fx.Exec(t, `UPDATE life_action SET intent='{"kind":"GATHER_WOOD"}',due_tick=73 WHERE agent_id=$1::uuid AND status='running'`, resident.ID)
	due()
	facts := fx.Count(t, "SELECT count(*) FROM world_inbox_event")
	fx.Exec(t, `CREATE FUNCTION reject_fact() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected_fact_failure'; END $$`)
	fx.Exec(t, `CREATE TRIGGER reject_fact BEFORE INSERT ON world_inbox_event FOR EACH ROW EXECUTE FUNCTION reject_fact()`)
	if _, err = service.Step(ctx); err == nil || !strings.Contains(err.Error(), "injected_fact_failure") {
		t.Fatal("expected inbox failure")
	}
	if fx.Count(t, "SELECT tick FROM life_world") != 72 || fx.Count(t, "SELECT count(*) FROM world_inbox_event") != facts {
		t.Fatal("inbox failure partially committed")
	}
	fx.Exec(t, "DROP TRIGGER reject_fact ON world_inbox_event")
	if ok, e := service.Step(ctx); e != nil || !ok {
		t.Fatalf("milestone retry: %v %v", ok, e)
	}
	if fx.Count(t, "SELECT count(*) FROM world_inbox_event") != facts+1 {
		t.Fatal("milestone duplicated or lost")
	}
	if ok, e := service.Step(ctx); e != nil || ok {
		t.Fatalf("replayed tick: %v %v", ok, e)
	}
	// A stale computation cannot overwrite a committed Tick.
	staleResult, err := runtime.Advance(ctx, state)
	if err != nil {
		t.Fatal(err)
	}
	due()
	if err = repo.Commit(ctx, binding, state, staleResult); !errors.Is(err, ErrStaleTick) {
		t.Fatalf("stale commit: %v", err)
	}
	otherID, err := util.ParseUUID(other)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.New(repo.Pool).GetLifeSnapshot(ctx, otherID); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("cross-world snapshot: %v", err)
	}
}

func TestDBPrepareRefusesLegacyWriterAndDeletedWorkspace(t *testing.T) {
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
	before, err := repo.Load(ctx, binding)
	if err != nil {
		t.Fatal(err)
	}
	result, err := runtime.Advance(ctx, before)
	if err != nil {
		t.Fatal(err)
	}
	holder, err := repo.Pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = holder.Exec(ctx, "SET application_name='weavea-agent-life'"); err != nil {
		t.Fatal(err)
	}
	if err = service.Prepare(ctx, ""); err == nil {
		t.Error("accepted concurrent standalone writer")
	}
	_, _ = holder.Exec(ctx, "RESET application_name")
	holder.Release()
	workspaceID, err := util.ParseUUID(workspace)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := repo.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	q := db.New(tx)
	if _, err = q.LockLifeWorkspace(ctx, workspaceID); err != nil {
		t.Fatal(err)
	}
	if err = q.LockLifeWorldForDeletion(ctx, workspaceID); err != nil {
		t.Fatal(err)
	}
	if err = q.DeleteLifeWorldState(ctx, workspaceID); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, "DELETE FROM workspace WHERE id=$1", workspaceID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err = repo.Commit(ctx, binding, before, result); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("wrote deleted world: %v", err)
	}
	if fx.Count(t, "SELECT count(*) FROM life_agent") != 0 {
		t.Fatal("orphan residents")
	}
}
