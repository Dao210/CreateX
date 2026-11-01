package handler

import (
	"context"
	"net/http"
	"testing"

	"github.com/auro-ai/auro/server/internal/testutil"
	"github.com/google/uuid"
)

func createRuntimeAccessDeniedAgent(t *testing.T, ctx context.Context, runtimeID, name string) string {
	t.Helper()
	foreignOwnerID := dbfx.User(t, name+" owner", "runtime-access-owner-"+uuid.NewString()+"@example.com")
	dbfx.Member(t, testWorkspaceID, foreignOwnerID, "member")
	agentID := createCascadeFixtureAgent(t, ctx, runtimeID, name)
	dbfx.Exec(t, `UPDATE agent SET owner_id = $1, visibility = 'workspace', permission_mode = 'public_to' WHERE id = $2`, foreignOwnerID, agentID)
	dbfx.Exec(t, `
		INSERT INTO agent_invocation_target (agent_id, target_type, target_id)
		VALUES ($1, 'workspace', $2)
		ON CONFLICT (agent_id, target_type, target_id) DO NOTHING
	`, agentID, testWorkspaceID)
	return agentID
}

func TestSendChatMessage_RuntimeAccessDeniedReturnsStructuredConflict(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	runtimeID := createCascadeFixtureRuntime(t, ctx, "Chat access denied runtime")
	agentID := createRuntimeAccessDeniedAgent(t, ctx, runtimeID, "Chat access denied agent")
	sessionID := createHandlerTestChatSession(t, agentID)

	req := newRequest(http.MethodPost, "/api/chat/sessions/"+sessionID+"/messages", map[string]any{"content": "please help"})
	req = withURLParam(req, "sessionId", sessionID)
	req = withChatTestWorkspaceCtx(t, req)
	w := testutil.Call(t, testHandler.SendChatMessage, req).Want(http.StatusConflict)
	var body struct {
		ReasonCode string `json:"reason_code"`
	}
	w.JSON(&body)
	if body.ReasonCode != string(ReasonRuntimeAccessDenied) {
		t.Fatalf("reason_code = %q, want %s", body.ReasonCode, ReasonRuntimeAccessDenied)
	}
	var taskCount int
	dbfx.QueryRow(t, `SELECT count(*) FROM agent_task_queue WHERE chat_session_id = $1`, sessionID).Scan(&taskCount)
	if taskCount != 0 {
		t.Fatalf("blocked chat created %d task rows, want 0", taskCount)
	}
}
