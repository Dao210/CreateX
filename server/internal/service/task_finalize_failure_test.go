package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/auro-ai/auro/server/internal/events"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

// TestFinalizeTaskClaimFailureRollsBackTokenThenRequeue is the regression for
// the PR #5193 review ask on the batch path's failure handling: when
// FinalizeTaskClaim fails (here: a delivery receipt referencing an id outside
// the task's comment plan, which the CAS subset-guard rejects), the token write
// is rolled back with it, and RequeueTaskAfterClaimFailure releases the exact
// dispatched claim back to `queued`. These are the two building blocks the
// batch handler composes on a finalization error.
func TestFinalizeTaskClaimFailureRollsBackTokenThenRequeue(t *testing.T) {
	ctx := context.Background()
	pool := newTaskClaimRacePool(t)
	svc := NewTaskService(db.New(pool), pool, nil, events.New())
	queries := db.New(pool)

	taskID, userID, workspaceID := dispatchedCommentTaskFixture(t, ctx, pool)
	task, err := queries.GetAgentTask(ctx, util.MustParseUUID(taskID))
	if err != nil {
		t.Fatalf("load task: %v", err)
	}

	// A delivered id outside the task's plan (no trigger/coalesced match) makes
	// SetTaskDeliveredCommentIDs match zero rows → FinalizeTaskClaim errors.
	bogus := util.MustParseUUID("11111111-1111-1111-1111-111111111111")
	_, ferr := svc.FinalizeTaskClaim(ctx, task, db.CreateTaskTokenParams{
		TokenHash:   fmt.Sprintf("finalize-fail-hash-%d", time.Now().UnixNano()),
		TaskID:      task.ID,
		AgentID:     task.AgentID,
		WorkspaceID: util.MustParseUUID(workspaceID),
		UserID:      util.MustParseUUID(userID),
		ExpiresAt:   pgtype.Timestamptz{Time: time.Now().Add(24 * time.Hour), Valid: true},
	}, []pgtype.UUID{bogus}, true, nil, nil)
	if ferr == nil {
		t.Fatal("expected FinalizeTaskClaim to fail for an out-of-plan delivery receipt")
	}
	if errors.Is(ferr, context.Canceled) {
		t.Fatalf("unexpected ctx error: %v", ferr)
	}

	// Token write must have rolled back with the receipt (transactional).
	var tokenCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM task_token WHERE task_id = $1`, taskID).Scan(&tokenCount); err != nil {
		t.Fatalf("count tokens: %v", err)
	}
	if tokenCount != 0 {
		t.Fatalf("expected token rolled back, found %d task_token rows", tokenCount)
	}

	// The exact dispatched claim is released back to queued.
	if _, err := svc.RequeueTaskAfterClaimFailure(ctx, task); err != nil {
		t.Fatalf("requeue: %v", err)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM agent_task_queue WHERE id = $1`, taskID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != "queued" {
		t.Fatalf("task status = %s, want queued after requeue", status)
	}
}
