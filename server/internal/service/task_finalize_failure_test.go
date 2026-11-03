package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/auro-ai/auro/server/internal/events"
	"github.com/auro-ai/auro/server/internal/testutil"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

// A failed secondary credential write must roll back the task token too.
func TestFinalizeTaskClaimFailureRollsBackTokenThenRequeue(t *testing.T) {
	ctx := context.Background()
	pool := newTaskClaimRacePool(t)
	fx := testutil.New(pool, "", "")
	suffix := fmt.Sprint(time.Now().UnixNano())
	fx.UserID = fx.User(t, "Finalize Test", "finalize-"+suffix+"@example.test")
	fx.WorkspaceID = fx.Workspace(t, "Finalize Test", "finalize-"+suffix)
	fx.Member(t, fx.WorkspaceID, fx.UserID, "owner")
	rt := fx.Runtime(t, "Finalize Runtime")
	agent := fx.Agent(t, "Finalize Agent", rt)
	chat := fx.ChatSession(t, agent)
	taskID := fx.Task(t, agent, testutil.Cols{"chat_session_id": chat, "runtime_id": rt, "status": "dispatched", "dispatched_at": testutil.Raw("now()")})
	q := db.New(pool)
	svc := NewTaskService(q, pool, nil, events.New())
	task, err := q.GetAgentTask(ctx, util.MustParseUUID(taskID))
	if err != nil {
		t.Fatal(err)
	}
	expires := pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true}
	daemon := db.CreateDaemonTokenParams{TokenHash: "duplicate-" + suffix, WorkspaceID: util.MustParseUUID(fx.WorkspaceID), DaemonID: "test-daemon", ExpiresAt: expires}
	if _, err := q.CreateDaemonToken(ctx, daemon); err != nil {
		t.Fatal(err)
	}
	fx.Cleanup(t, `DELETE FROM daemon_token WHERE token_hash=$1`, daemon.TokenHash)
	err = svc.FinalizeTaskClaim(ctx, db.CreateTaskTokenParams{TokenHash: "task-" + suffix, TaskID: task.ID, AgentID: task.AgentID, WorkspaceID: util.MustParseUUID(fx.WorkspaceID), UserID: util.MustParseUUID(fx.UserID), ExpiresAt: expires}, nil, daemon)
	if err == nil {
		t.Fatal("expected duplicate daemon credential to fail")
	}
	if n := fx.Count(t, `SELECT count(*) FROM task_token WHERE task_id=$1`, taskID); n != 0 {
		t.Fatalf("task token persisted after rollback: %d", n)
	}
	if _, err := svc.RequeueTaskAfterClaimFailure(ctx, task); err != nil {
		t.Fatal(err)
	}
	var status string
	fx.QueryRow(t, `SELECT status FROM agent_task_queue WHERE id=$1`, taskID).Scan(&status)
	if status != "queued" {
		t.Fatalf("status=%q, want queued", status)
	}
}
