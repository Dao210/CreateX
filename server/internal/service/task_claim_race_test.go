package service

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/auro-ai/auro/server/internal/events"
	"github.com/auro-ai/auro/server/internal/testutil"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

func newTaskClaimRacePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	return sharedTestPool(t)
}

func TestClaimTaskConcurrentCapacityRespected(t *testing.T) {
	ctx := context.Background()
	pool := newTaskClaimRacePool(t)
	queries := db.New(pool)

	agentID := createClaimCapacityFixture(t, ctx, pool)
	agentUUID := util.MustParseUUID(agentID)

	triggerName := fmt.Sprintf("claim_capacity_sleep_%d", time.Now().UnixNano())
	functionName := triggerName + "_fn"
	createSleepTrigger(t, ctx, pool, triggerName, functionName, agentID)
	svc := NewTaskService(queries, pool, nil, events.New())

	const workers = 2
	start := make(chan struct{})
	claimed := make(chan string, workers)
	errs := make(chan error, workers)

	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			task, err := svc.claimTask(ctx, agentUUID, pgtype.UUID{})
			if err != nil {
				errs <- err
				return
			}
			if task != nil {
				claimed <- util.UUIDToString(task.ID)
			}
		}()
	}

	close(start)
	wg.Wait()
	close(claimed)
	close(errs)

	for err := range errs {
		if err != nil {
			t.Fatalf("claim task: %v", err)
		}
	}

	var claimedIDs []string
	for id := range claimed {
		claimedIDs = append(claimedIDs, id)
	}
	if len(claimedIDs) != 1 {
		t.Fatalf("expected exactly 1 claimed task with max_concurrent_tasks=1, got %d (%v)", len(claimedIDs), claimedIDs)
	}

	var active int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM agent_task_queue
		WHERE agent_id = $1 AND status IN ('dispatched', 'running', 'waiting_local_directory')
	`, agentID).Scan(&active); err != nil {
		t.Fatalf("count active tasks: %v", err)
	}
	if active != 1 {
		t.Fatalf("expected 1 active task after concurrent claims, got %d", active)
	}
}

func createSleepTrigger(t *testing.T, ctx context.Context, pool *pgxpool.Pool, triggerName, functionName, agentID string) {
	t.Helper()

	if _, err := pool.Exec(ctx, fmt.Sprintf(`
		CREATE FUNCTION %s()
		RETURNS trigger
		LANGUAGE plpgsql
		AS $$
		BEGIN
			PERFORM pg_sleep(0.1);
			RETURN NEW;
		END;
		$$;
	`, quoteIdent(functionName))); err != nil {
		t.Fatalf("create sleep trigger function: %v", err)
	}
	if _, err := pool.Exec(ctx, fmt.Sprintf(`
		CREATE TRIGGER %s
		BEFORE UPDATE OF status ON agent_task_queue
		FOR EACH ROW
		WHEN (OLD.status = 'queued' AND NEW.status = 'dispatched' AND NEW.agent_id = %s::uuid)
		EXECUTE FUNCTION %s();
	`, quoteIdent(triggerName), quoteLiteral(agentID), quoteIdent(functionName))); err != nil {
		t.Fatalf("create sleep trigger: %v", err)
	}

	t.Cleanup(func() {
		cleanupCtx := context.Background()
		pool.Exec(cleanupCtx, fmt.Sprintf("DROP TRIGGER IF EXISTS %s ON agent_task_queue", quoteIdent(triggerName)))
		pool.Exec(cleanupCtx, fmt.Sprintf("DROP FUNCTION IF EXISTS %s()", quoteIdent(functionName)))
	})
}

func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

func quoteLiteral(s string) string {
	return `'` + strings.ReplaceAll(s, `'`, `''`) + `'`
}

func createClaimCapacityFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	fx := testutil.New(pool, "", "")
	fx.UserID = fx.User(t, "Claim Capacity", fmt.Sprintf("claim-capacity-%d@example.test", time.Now().UnixNano()))
	fx.WorkspaceID = fx.Workspace(t, "Claim Capacity", fmt.Sprintf("claim-capacity-%d", time.Now().UnixNano()))
	fx.Member(t, fx.WorkspaceID, fx.UserID, "owner")
	rt := fx.Runtime(t, "Capacity Runtime")
	agent := fx.Agent(t, "Capacity Agent", rt)
	for range 2 {
		chat := fx.ChatSession(t, agent)
		fx.Task(t, agent, testutil.Cols{"runtime_id": rt, "chat_session_id": chat})
	}
	return agent
}
