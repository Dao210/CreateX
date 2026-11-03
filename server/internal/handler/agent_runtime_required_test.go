package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// An unbound agent is refused by every execution entry point — that part already
// worked, because service.AgentReadiness and these gates all check
// RuntimeID.Valid. What did not work is what the user is told: the refusal reused
// runtime_offline, whose copy asks them to bring a machine back online. An
// unbound agent has no machine to bring back; the fix is to bind one. These tests
// pin the distinct reason code (MUL-5559).

// TestChatSend_UnboundAgentReturnsStructuredConflict: the chat gate already
// refused, but with a bare error string. The composer needs a code to offer
// "bind a runtime" instead of a generic failure.
func TestChatSend_UnboundAgentReturnsStructuredConflict(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	runtimeID := createCascadeFixtureRuntime(t, ctx, "Chat Unbound Runtime")
	agentID := createCascadeFixtureAgent(t, ctx, runtimeID, "Chat Unbound Agent")
	sessionID := createHandlerTestChatSession(t, agentID)

	unbindRuntime(t, ctx, runtimeID, agentID)

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/chat/sessions/"+sessionID+"/messages",
		map[string]any{"content": "are you still there?"})
	req = withURLParam(req, "sessionId", sessionID)
	req = withChatTestWorkspaceCtx(t, req)
	testHandler.SendChatMessage(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", w.Code, w.Body.String())
	}

	var body struct {
		Error      string `json:"error"`
		ReasonCode string `json:"reason_code"`
	}
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.ReasonCode != string(ReasonAgentRuntimeRequired) {
		t.Fatalf("reason_code = %q, want agent_runtime_required", body.ReasonCode)
	}
	if body.Error == "" {
		t.Fatalf("expected a human-readable error alongside the code")
	}
}

func TestCreateAutopilot_UnboundAgentRejected(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	runtimeID := createCascadeFixtureRuntime(t, ctx, "Autopilot Create Unbound Runtime")
	agentID := createCascadeFixtureAgent(t, ctx, runtimeID, "Autopilot Create Unbound Agent")
	unbindRuntime(t, ctx, runtimeID, agentID)

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/autopilots?workspace_id="+testWorkspaceID, map[string]any{
		"title":          "must not start unbound",
		"assignee_id":    agentID,
		"execution_mode": "run_only",
	})
	testHandler.CreateAutopilot(w, req)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", w.Code, w.Body.String())
	}

	var rows int
	if err := testPool.QueryRow(ctx,
		`SELECT count(*) FROM autopilot WHERE title = 'must not start unbound' AND assignee_id = $1`,
		agentID,
	).Scan(&rows); err != nil {
		t.Fatalf("count autopilots: %v", err)
	}
	if rows != 0 {
		t.Fatalf("unbound Agent received %d active Autopilots, want 0", rows)
	}
}

func TestUpdateAutopilot_UnboundAgentCannotResume(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	runtimeID := createCascadeFixtureRuntime(t, ctx, "Autopilot Resume Unbound Runtime")
	agentID := createCascadeFixtureAgent(t, ctx, runtimeID, "Autopilot Resume Unbound Agent")

	var autopilotID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO autopilot (
			workspace_id, title, assignee_type, assignee_id, status,
			execution_mode, created_by_type, created_by_id
		)
		VALUES ($1, 'cannot resume unbound', 'agent', $2, 'active',
			'run_only', 'member', $3)
		RETURNING id
	`, testWorkspaceID, agentID, testUserID).Scan(&autopilotID); err != nil {
		t.Fatalf("insert paused autopilot: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `WITH runs AS MATERIALIZED (SELECT id FROM autopilot_run WHERE autopilot_id=$1),
 removed_deliveries AS (DELETE FROM webhook_delivery WHERE autopilot_id=$1),
 removed_triggers AS (DELETE FROM autopilot_trigger WHERE autopilot_id=$1),
 removed_versions AS (DELETE FROM autopilot_rule_version WHERE autopilot_id=$1),
 removed_collaborators AS (DELETE FROM autopilot_collaborator WHERE autopilot_id=$1),
 detached_tasks AS (UPDATE agent_task_queue SET autopilot_run_id=NULL WHERE autopilot_run_id IN (SELECT id FROM runs)),
 removed_runs AS (DELETE FROM autopilot_run WHERE autopilot_id=$1)
 DELETE FROM autopilot WHERE id=$1`, autopilotID)
	})

	unbindRuntime(t, ctx, runtimeID, agentID)

	w := httptest.NewRecorder()
	req := newRequest("PATCH", "/api/autopilots/"+autopilotID+"?workspace_id="+testWorkspaceID,
		map[string]any{"status": "active"})
	req = withURLParam(req, "id", autopilotID)
	testHandler.UpdateAutopilot(w, req)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", w.Code, w.Body.String())
	}

	var status, pauseReason string
	if err := testPool.QueryRow(ctx,
		`SELECT status, pause_reason FROM autopilot WHERE id = $1`,
		autopilotID,
	).Scan(&status, &pauseReason); err != nil {
		t.Fatalf("read autopilot: %v", err)
	}
	if status != "paused" || pauseReason != string(ReasonAgentRuntimeRequired) {
		t.Fatalf("autopilot = (%q, %q), want (paused, agent_runtime_required)", status, pauseReason)
	}
}
