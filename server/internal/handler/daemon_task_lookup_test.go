package handler

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/auro-ai/auro/server/internal/testutil"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// The daemon interrupts a running agent the moment a task-status poll answers
// `404 task not found` (shouldInterruptAgent → isTaskNotFoundError). So that
// body is a kill signal, and only a lookup that completed and found no task row
// may produce it. Transient failures and authorization misses must stay distinct.

// lookupFaultPool fails one named query and passes everything else through, so
// a single link in ResolveTaskWorkspaceIDChecked can be made to time out while
// the task row itself stays readable.
type lookupFaultPool struct {
	db.DBTX
	query  string
	called bool
}

func (f *lookupFaultPool) QueryRow(ctx context.Context, query string, args ...any) pgx.Row {
	if strings.Contains(query, "-- name: "+f.query+" :one") {
		f.called = true
		return &mockRow{err: context.DeadlineExceeded}
	}
	return f.DBTX.QueryRow(ctx, query, args...)
}

// TestGetTaskStatus_TaskRowPresenceContract distinguishes a genuinely missing
// task from a surviving task whose optional source row has gone away.
func TestGetTaskStatus_TaskRowPresenceContract(t *testing.T) {
	runtimeID := dbfx.Runtime(t, "MUL-7259 absent runtime")
	agentID := dbfx.Agent(t, "MUL-7259 absent agent", runtimeID)

	t.Run("task row missing", func(t *testing.T) {
		missing := uuid.NewString()
		req := newDaemonTokenRequest(http.MethodGet, "/api/daemon/tasks/"+missing+"/status", nil, testWorkspaceID, "test-daemon")
		req = withURLParam(req, "taskId", missing)
		w := testutil.Call(t, testHandler.GetTaskStatus, req).Want(http.StatusNotFound)
		if !strings.Contains(w.Body.String(), "task not found") {
			t.Fatalf("a genuinely missing task must still interrupt the daemon: %s", w.Body.String())
		}
	})

	t.Run("optional source missing", func(t *testing.T) {
		// agent_task_queue.chat_session_id is ON DELETE CASCADE, so an issue task can
		// never outlive its issue. chat_session_id is ON DELETE SET NULL, so a
		// chat task can survive its source. The status endpoint now authorizes
		// that row through its owning agent instead of treating the optional
		// source as task identity.
		chatID := dbfx.ChatSession(t, agentID)
		taskID := dbfx.Task(t, agentID, testutil.Cols{
			"runtime_id": runtimeID, "status": "running",
			"started_at": testutil.Raw("now()"), "chat_session_id": chatID,
		})
		dbfx.Exec(t, "DELETE FROM chat_session WHERE id = $1", chatID)

		req := newDaemonTokenRequest(http.MethodGet, "/api/daemon/tasks/"+taskID+"/status", nil, testWorkspaceID, "test-daemon")
		req = withURLParam(req, "taskId", taskID)
		var response map[string]string
		testutil.Call(t, testHandler.GetTaskStatus, req).Want(http.StatusOK).JSON(&response)
		if response["status"] != "running" {
			t.Fatalf("status = %q, want running", response["status"])
		}
	})
}
