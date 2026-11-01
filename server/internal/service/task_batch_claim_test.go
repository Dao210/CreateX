package service

import (
	"context"
	"testing"
	"time"

	"github.com/auro-ai/auro/server/internal/events"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

// TestClaimTasksForRuntimes_MultiRuntimeDrain verifies the machine-level batch
// claim (MUL-4257): a single call claims across all runtimes, one task per
// agent per call (matching the singular path's dedup), routes each task to its
// runtime, respects a subsequent drain, and reports empty once nothing is
// queued.
func TestClaimTasksForRuntimes_MultiRuntimeDrain(t *testing.T) {
	ctx := context.Background()
	pool := newTaskClaimRacePool(t)
	svc := NewTaskService(db.New(pool), pool, nil, events.New())

	rt1, rt2 := batchClaimFixture(t, ctx, pool)
	ids := []pgtype.UUID{util.MustParseUUID(rt1), util.MustParseUUID(rt2)}

	// Call 1: one task per agent (agent1→rt1, agent2→rt2) => 2 tasks, one per runtime.
	got1, err := svc.ClaimTasksForRuntimes(ctx, ids, 5)
	if err != nil {
		t.Fatalf("call1: %v", err)
	}
	if len(got1) != 2 {
		t.Fatalf("call1 claimed %d tasks, want 2", len(got1))
	}
	seen := map[string]int{}
	for _, task := range got1 {
		seen[util.UUIDToString(task.RuntimeID)]++
	}
	if seen[rt1] != 1 || seen[rt2] != 1 {
		t.Fatalf("call1 runtime distribution = %v, want one task each for rt1/rt2", seen)
	}

	// Call 2: agent1 still has a second queued task (different issue, capacity 5);
	// agent2 is drained => exactly 1 task, on rt1.
	got2, err := svc.ClaimTasksForRuntimes(ctx, ids, 5)
	if err != nil {
		t.Fatalf("call2: %v", err)
	}
	if len(got2) != 1 {
		t.Fatalf("call2 claimed %d tasks, want 1", len(got2))
	}
	if util.UUIDToString(got2[0].RuntimeID) != rt1 {
		t.Fatalf("call2 claimed runtime = %s, want rt1", util.UUIDToString(got2[0].RuntimeID))
	}

	// Call 3: everything dispatched => empty.
	got3, err := svc.ClaimTasksForRuntimes(ctx, ids, 5)
	if err != nil {
		t.Fatalf("call3: %v", err)
	}
	if len(got3) != 0 {
		t.Fatalf("call3 claimed %d tasks, want 0", len(got3))
	}
}

// TestClaimTasksForRuntimes_MaxTasksCap verifies max_tasks bounds the number of
// tasks returned in a single batch call.
func TestClaimTasksForRuntimes_MaxTasksCap(t *testing.T) {
	ctx := context.Background()
	pool := newTaskClaimRacePool(t)
	svc := NewTaskService(db.New(pool), pool, nil, events.New())

	rt1, rt2 := batchClaimFixture(t, ctx, pool)
	ids := []pgtype.UUID{util.MustParseUUID(rt1), util.MustParseUUID(rt2)}

	got, err := svc.ClaimTasksForRuntimes(ctx, ids, 1)
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("claimed %d tasks with max_tasks=1, want 1", len(got))
	}
}

// TestClaimTasksForRuntimes_AnyDueRuntimeChecksTheCompleteSet pins MUL-6486's
// collection-level reclaim gate. Per-runtime backstops can begin staggered, but
// one due member must run the single UPDATE over every runtime on that daemon;
// filtering the SQL array to only the due member both misses recoverable work
// and lets fixed query overhead drift back toward one call per poll.
func TestClaimTasksForRuntimes_AnyDueRuntimeChecksTheCompleteSet(t *testing.T) {
	ctx := context.Background()
	rdb := newRedisTestClient(t)
	pool := newTaskClaimRacePool(t)
	svc := NewTaskService(db.New(pool), pool, nil, events.New())
	svc.ReclaimCheck = NewReclaimCheckCache(rdb)

	rt1, rt2 := batchClaimFixture(t, ctx, pool)
	ids := []pgtype.UUID{util.MustParseUUID(rt1), util.MustParseUUID(rt2)}

	var staleTaskID string
	if err := pool.QueryRow(ctx, `
		SELECT id FROM agent_task_queue
		WHERE runtime_id = $1
		ORDER BY created_at
		LIMIT 1
	`, rt2).Scan(&staleTaskID); err != nil {
		t.Fatalf("load rt2 task: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE agent_task_queue
		SET status = 'dispatched', dispatched_at = now() - interval '10 minutes',
		    started_at = NULL, prepare_lease_expires_at = NULL
		WHERE id = $1
	`, staleTaskID); err != nil {
		t.Fatalf("make rt2 task stale: %v", err)
	}

	now := time.Now()
	svc.ReclaimCheck.MarkChecked(
		ctx,
		[]string{rt1},
		now.Add(-ReclaimCheckBackstopInterval-time.Second),
		now.Add(ReclaimCheckRetryInterval),
	)
	svc.ReclaimCheck.MarkChecked(ctx, []string{rt2}, now, now.Add(ReclaimCheckRetryInterval))
	due := svc.ReclaimCheck.DueRuntimeIDs(ctx, []string{rt1, rt2}, now)
	if len(due) != 1 || due[0] != rt1 {
		t.Fatalf("precondition due runtimes = %v, want [%s]", due, rt1)
	}

	claimed, err := svc.ClaimTasksForRuntimes(ctx, ids, 5)
	if err != nil {
		t.Fatalf("batch claim: %v", err)
	}
	for _, task := range claimed {
		if util.UUIDToString(task.ID) == staleTaskID {
			return
		}
	}
	t.Fatalf("batch claim omitted stale task %s on non-due runtime %s: got %v", staleTaskID, rt2, claimed)
}

// TestClaimTasksForRuntimes_EmptyReclaimDefersHintForRetry covers the recovery
// hole where the task hint was previously made inert after one empty UPDATE.
// A temporarily stale runtime heartbeat is intentionally correlated with a
// lost claim response: the task remains dispatched, and its hint must become
// due again after the short retry rather than waiting for the 90-second
// backstop.
func TestClaimTasksForRuntimes_EmptyReclaimDefersHintForRetry(t *testing.T) {
	ctx := context.Background()
	rdb := newRedisTestClient(t)
	pool := newTaskClaimRacePool(t)
	svc := NewTaskService(db.New(pool), pool, nil, events.New())
	svc.ReclaimCheck = NewReclaimCheckCache(rdb)

	rt1, _ := batchClaimFixture(t, ctx, pool)
	runtimeID := util.MustParseUUID(rt1)
	var taskID string
	if err := pool.QueryRow(ctx, `
		SELECT id FROM agent_task_queue
		WHERE runtime_id = $1
		ORDER BY created_at
		LIMIT 1
	`, rt1).Scan(&taskID); err != nil {
		t.Fatalf("load task: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE agent_task_queue
		SET status = 'dispatched', dispatched_at = now() - interval '10 minutes',
		    started_at = NULL, prepare_lease_expires_at = NULL
		WHERE id = $1
	`, taskID); err != nil {
		t.Fatalf("make task stale: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE agent_runtime
		SET status = 'online', last_seen_at = now() - interval '10 minutes'
		WHERE id = $1
	`, rt1); err != nil {
		t.Fatalf("make runtime temporarily ineligible: %v", err)
	}

	now := time.Now()
	svc.ReclaimCheck.MarkChecked(ctx, []string{rt1}, now, now.Add(ReclaimCheckRetryInterval))
	svc.ReclaimCheck.Track(ctx, rt1, taskID, now.Add(-time.Second))
	if due := svc.ReclaimCheck.DueRuntimeIDs(ctx, []string{rt1}, now); len(due) != 1 {
		t.Fatalf("precondition due runtimes = %v, want [%s]", due, rt1)
	}

	if claimed, err := svc.ClaimTasksForRuntimes(ctx, []pgtype.UUID{runtimeID}, 5); err != nil {
		t.Fatalf("batch claim: %v", err)
	} else if len(claimed) != 0 {
		t.Fatalf("claimed tasks with stale runtime heartbeat: %v", claimed)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM agent_task_queue WHERE id = $1`, taskID).Scan(&status); err != nil {
		t.Fatalf("read task after empty reclaim: %v", err)
	}
	if status != "dispatched" {
		t.Fatalf("task status after empty reclaim = %q, want dispatched", status)
	}

	score, err := rdb.ZScore(ctx, reclaimCheckScheduleKey(rt1), taskID).Result()
	if err != nil {
		t.Fatalf("read deferred hint: %v", err)
	}
	retryAt := time.UnixMilli(int64(score))
	if retryAt.Before(now.Add(ReclaimCheckRetryInterval)) || retryAt.After(time.Now().Add(ReclaimCheckRetryInterval+time.Second)) {
		t.Fatalf("retry hint = %v, want approximately one retry interval after the check", retryAt)
	}
	if due := svc.ReclaimCheck.DueRuntimeIDs(ctx, []string{rt1}, retryAt.Add(-time.Millisecond)); len(due) != 0 {
		t.Fatalf("hint retriggered before retry deadline: %v", due)
	}
	if due := svc.ReclaimCheck.DueRuntimeIDs(ctx, []string{rt1}, retryAt.Add(time.Millisecond)); len(due) != 1 {
		t.Fatalf("hint did not retrigger after empty reclaim: %v", due)
	}
}

// TestClaimTasksForRuntimes_EmptyInputs guards the trivial short-circuits.
func TestClaimTasksForRuntimes_EmptyInputs(t *testing.T) {
	ctx := context.Background()
	pool := newTaskClaimRacePool(t)
	svc := NewTaskService(db.New(pool), pool, nil, events.New())

	if got, err := svc.ClaimTasksForRuntimes(ctx, nil, 5); err != nil || got != nil {
		t.Fatalf("nil runtimes: got=%v err=%v, want nil,nil", got, err)
	}
	rt1, _ := batchClaimFixture(t, ctx, pool)
	if got, err := svc.ClaimTasksForRuntimes(ctx, []pgtype.UUID{util.MustParseUUID(rt1)}, 0); err != nil || got != nil {
		t.Fatalf("maxTasks=0: got=%v err=%v, want nil,nil", got, err)
	}
}
