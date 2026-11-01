package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/auro-ai/auro/server/internal/middleware"
	"github.com/auro-ai/auro/server/internal/testutil"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestDeriveAgentRuntimeAvailability(t *testing.T) {
	now := time.Date(2026, time.April, 27, 12, 0, 0, 0, time.UTC)
	timestamp := func(at time.Time) pgtype.Timestamptz {
		return pgtype.Timestamptz{Time: at, Valid: true}
	}

	for _, tc := range []struct {
		name   string
		status string
		seen   pgtype.Timestamptz
		want   string
	}{
		{name: "online", status: "online", want: "online"},
		{name: "recent loss", status: "offline", seen: timestamp(now.Add(-time.Minute)), want: "unstable"},
		{name: "offline", status: "offline", seen: timestamp(now.Add(-10 * time.Minute)), want: "offline"},
		{name: "missing heartbeat", status: "offline", want: "offline"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := deriveAgentRuntimeAvailability(db.AgentRuntime{
				Status:     tc.status,
				LastSeenAt: tc.seen,
			}, now)
			if got != tc.want {
				t.Fatalf("deriveAgentRuntimeAvailability = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestLoadAgentRuntimeAvailability_PrivilegedViewerSkipsRuntimeQuery(t *testing.T) {
	h := &Handler{}
	agents := []db.Agent{{
		RuntimeID: util.MustParseUUID("11111111-1111-1111-1111-111111111111"),
	}}

	for _, role := range []string{"owner", "admin"} {
		t.Run(role, func(t *testing.T) {
			got, err := h.loadAgentRuntimeAvailability(
				context.Background(),
				agents,
				"22222222-2222-2222-2222-222222222222",
				"33333333-3333-3333-3333-333333333333",
				role,
				time.Now(),
			)
			if err != nil {
				t.Fatalf("loadAgentRuntimeAvailability: %v", err)
			}
			if len(got) != 0 {
				t.Fatalf("availability = %v, want empty for %s", got, role)
			}
		})
	}
}

// TestMemberAllowedToViewAgent_Pure exercises the pure predicate that drives
// the private-agent VIEW gate. For a private agent it must allow:
//   - workspace owner / admin (regardless of agent ownership)
//   - the agent owner (regardless of role)
//
// And deny everyone else. This test runs without a database.
func TestMemberAllowedToViewAgent_Pure(t *testing.T) {
	ownerUserID := "11111111-1111-1111-1111-111111111111"
	otherUserID := "22222222-2222-2222-2222-222222222222"

	agent := db.Agent{
		OwnerID:        util.MustParseUUID(ownerUserID),
		PermissionMode: "private",
	}

	cases := []struct {
		name   string
		userID string
		role   string
		want   bool
	}{
		{"workspace owner, not agent owner", otherUserID, "owner", true},
		{"workspace admin, not agent owner", otherUserID, "admin", true},
		{"agent owner with member role", ownerUserID, "member", true},
		{"agent owner with admin role", ownerUserID, "admin", true},
		{"plain member, not agent owner", otherUserID, "member", false},
		{"plain member with no role string", otherUserID, "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := memberAllowedToViewAgent(agent, nil, tc.userID, tc.role)
			if got != tc.want {
				t.Fatalf("memberAllowedToViewAgent(userID=%s, role=%s) = %v; want %v",
					tc.userID, tc.role, got, tc.want)
			}
		})
	}
}

// privateAgentTestFixture sets up a private agent owned by a freshly created
// user, plus a second non-admin member in the workspace. Returns the agent
// id, the owner's user id, and the unrelated member's user id. The caller's
// own testUserID stays workspace owner so it can act as the privileged
// admin path.
func privateAgentTestFixture(t *testing.T) (agentID, ownerID, memberID string) {
	t.Helper()

	ctx := context.Background()
	// Keep these permission-focused fixtures out of the private-runtime owner
	// fence. Their agents remain private; the public runtime isolates invocation
	// authorization from the separate runtime/agent ownership rule.
	runtimeID := handlerTestRuntimeID(t)
	var runtimeVisibility string
	if err := testPool.QueryRow(ctx, `SELECT visibility FROM agent_runtime WHERE id = $1`, runtimeID).Scan(&runtimeVisibility); err != nil {
		t.Fatalf("read fixture runtime visibility: %v", err)
	}
	if _, err := testPool.Exec(ctx, `UPDATE agent_runtime SET visibility = 'public' WHERE id = $1`, runtimeID); err != nil {
		t.Fatalf("make fixture runtime public: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `UPDATE agent_runtime SET visibility = $1 WHERE id = $2`, runtimeVisibility, runtimeID)
	})
	if err := testPool.QueryRow(ctx, `
		INSERT INTO "user" (name, email)
		VALUES ('Private Agent Owner', 'private-agent-owner@auro.test')
		RETURNING id
	`).Scan(&ownerID); err != nil {
		t.Fatalf("create owner user: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(),
			`DELETE FROM "user" WHERE email = 'private-agent-owner@auro.test'`)
	})

	if _, err := testPool.Exec(ctx, `
		INSERT INTO member (workspace_id, user_id, role)
		VALUES ($1, $2, 'member')
	`, testWorkspaceID, ownerID); err != nil {
		t.Fatalf("add owner as member: %v", err)
	}

	if err := testPool.QueryRow(ctx, `
		INSERT INTO "user" (name, email)
		VALUES ('Plain Member', 'plain-member@auro.test')
		RETURNING id
	`).Scan(&memberID); err != nil {
		t.Fatalf("create plain member user: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(),
			`DELETE FROM "user" WHERE email = 'plain-member@auro.test'`)
	})

	if _, err := testPool.Exec(ctx, `
		INSERT INTO member (workspace_id, user_id, role)
		VALUES ($1, $2, 'member')
	`, testWorkspaceID, memberID); err != nil {
		t.Fatalf("add plain member: %v", err)
	}

	if err := testPool.QueryRow(ctx, `
		INSERT INTO agent (
			workspace_id, name, description, runtime_mode, runtime_config,
			runtime_id, visibility, max_concurrent_tasks, owner_id,
			instructions, custom_env, custom_args
		)
		VALUES ($1, 'private-access-test-agent', '', 'cloud', '{}'::jsonb,
		        $2, 'private', 1, $3, '', '{}'::jsonb, '[]'::jsonb)
		RETURNING id
	`, testWorkspaceID, runtimeID, ownerID).Scan(&agentID); err != nil {
		t.Fatalf("create private agent: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(),
			`DELETE FROM agent WHERE id = $1`, agentID)
	})

	return agentID, ownerID, memberID
}

func newRequestAs(userID, method, path string, body any) *http.Request {
	req := newRequest(method, path, body)
	req.Header.Set("X-User-ID", userID)
	return req
}

// TestGetAgent_PrivateAgentForbidsPlainMember verifies the private-agent
// visibility gate at the read-detail endpoint: a workspace member who is
// neither the agent owner nor a workspace owner/admin gets 403, while the
// agent owner and workspace owner both succeed. Mirrors the four-entry-point
// gate (chat, history, edit, delete) on its read surface.
func TestGetAgent_PrivateAgentForbidsPlainMember(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	agentID, ownerID, memberID := privateAgentTestFixture(t)

	// Workspace owner (testUserID): allowed via role.
	w := httptest.NewRecorder()
	testHandler.GetAgent(w, withURLParam(newRequest("GET", "/api/agents/"+agentID, nil), "id", agentID))
	if w.Code != http.StatusOK {
		t.Fatalf("GetAgent as workspace owner: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var ownerResponse map[string]json.RawMessage
	if err := json.Unmarshal(w.Body.Bytes(), &ownerResponse); err != nil {
		t.Fatalf("decode GetAgent owner response: %v", err)
	}
	if _, ok := ownerResponse["runtime_availability"]; ok {
		t.Fatal("runtime_availability should be omitted when the viewer owns the runtime")
	}

	// Agent owner (plain member who happens to own the agent): allowed.
	w = httptest.NewRecorder()
	testHandler.GetAgent(w, withURLParam(newRequestAs(ownerID, "GET", "/api/agents/"+agentID, nil), "id", agentID))
	if w.Code != http.StatusOK {
		t.Fatalf("GetAgent as agent owner: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Plain member (not in allowed_principals): denied with 403.
	w = httptest.NewRecorder()
	testHandler.GetAgent(w, withURLParam(newRequestAs(memberID, "GET", "/api/agents/"+agentID, nil), "id", agentID))
	if w.Code != http.StatusForbidden {
		t.Fatalf("GetAgent as plain member: expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

// TestListAgents_FiltersPrivateForPlainMember verifies that the workspace
// agents listing hides private agents from members who lack access. This is
// what makes the @-mention autocomplete picker (which feeds off this list)
// drop unreachable private agents without any client-side logic.
func TestListAgents_FiltersPrivateForPlainMember(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	agentID, _, memberID := privateAgentTestFixture(t)

	// Workspace owner sees the agent.
	w := httptest.NewRecorder()
	testHandler.ListAgents(w, newRequest("GET", "/api/agents", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("ListAgents as owner: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !listContainsAgent(t, w.Body.Bytes(), agentID) {
		t.Fatalf("ListAgents as owner did not include private agent %s", agentID)
	}

	// Plain member does NOT see the agent.
	w = httptest.NewRecorder()
	testHandler.ListAgents(w, newRequestAs(memberID, "GET", "/api/agents", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("ListAgents as plain member: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if listContainsAgent(t, w.Body.Bytes(), agentID) {
		t.Fatalf("ListAgents as plain member leaked private agent %s", agentID)
	}
}

// TestListAgents_SharedAgentCarriesPrivateRuntimeAvailability verifies the
// privacy-safe bridge used by presence derivation: a member may see a shared
// agent's coarse runtime availability even when that private runtime is absent
// from their runtime list, but no runtime detail fields are added to the agent
// response.
func TestListAgents_SharedAgentCarriesPrivateRuntimeAvailability(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	runtimeID, runtimeOwnerID, memberID := runtimeVisibilityFixture(t)
	agentID := dbfx.Agent(t, "shared-private-runtime-agent", runtimeID, testutil.Cols{
		"visibility":      "workspace",
		"permission_mode": "public_to",
		"owner_id":        runtimeOwnerID,
	})
	dbfx.Insert(t, "agent_invocation_target", testutil.Cols{
		"agent_id":    agentID,
		"target_type": "workspace",
		"target_id":   testWorkspaceID,
	})

	listResponse := testutil.Call(t, testHandler.ListAgents,
		newRequestAs(memberID, "GET", "/api/agents", nil)).Want(http.StatusOK)

	var responses []AgentResponse
	listResponse.JSON(&responses)
	var shared *AgentResponse
	for i := range responses {
		if responses[i].ID == agentID {
			shared = &responses[i]
			break
		}
	}
	if shared == nil {
		t.Fatalf("shared agent %s missing from member list", agentID)
	}
	if shared.RuntimeAvailability != "online" {
		t.Fatalf("runtime_availability = %q, want online", shared.RuntimeAvailability)
	}
	var wire []map[string]json.RawMessage
	listResponse.JSON(&wire)
	for _, item := range wire {
		if string(item["id"]) != strconv.Quote(agentID) {
			continue
		}
		for _, field := range []string{
			"device_info",
			"metadata",
			"daemon_id",
			"runtime_status",
			"runtime_last_seen_at",
		} {
			if _, ok := item[field]; ok {
				t.Errorf("agent response leaked runtime field %q", field)
			}
		}
		if string(item["runtime_availability"]) != strconv.Quote("online") {
			t.Errorf("runtime_availability = %s, want online", item["runtime_availability"])
		}
	}

	var detail AgentResponse
	testutil.Call(t, testHandler.GetAgent,
		withURLParam(newRequestAs(memberID, "GET", "/api/agents/"+agentID, nil), "id", agentID)).
		Want(http.StatusOK).JSON(&detail)
	if detail.RuntimeAvailability != "online" {
		t.Fatalf("GetAgent runtime_availability = %q, want online", detail.RuntimeAvailability)
	}

	// Archived agents short-circuit presence to "archived" and must not keep
	// every client polling for a projection it will never consume. Keep an
	// active sibling on the same runtime so this also catches accidentally
	// applying a runtime-keyed projection to the archived response.
	siblingID := dbfx.Agent(t, "active-shared-private-runtime-agent", runtimeID, testutil.Cols{
		"visibility":      "workspace",
		"permission_mode": "public_to",
		"owner_id":        runtimeOwnerID,
	})
	dbfx.Insert(t, "agent_invocation_target", testutil.Cols{
		"agent_id":    siblingID,
		"target_type": "workspace",
		"target_id":   testWorkspaceID,
	})
	dbfx.Exec(t, `UPDATE agent SET archived_at = now() WHERE id = $1`, agentID)

	archivedList := testutil.Call(t, testHandler.ListAgents,
		newRequestAs(memberID, "GET", "/api/agents?include_archived=true", nil)).Want(http.StatusOK)
	var archivedWire []map[string]json.RawMessage
	archivedList.JSON(&archivedWire)
	foundArchived := false
	foundActiveSibling := false
	for _, item := range archivedWire {
		switch string(item["id"]) {
		case strconv.Quote(agentID):
			foundArchived = true
			if _, ok := item["runtime_availability"]; ok {
				t.Fatal("archived agent should not carry runtime_availability")
			}
		case strconv.Quote(siblingID):
			foundActiveSibling = true
			if string(item["runtime_availability"]) != strconv.Quote("online") {
				t.Fatalf("active sibling runtime_availability = %s, want online", item["runtime_availability"])
			}
		}
	}
	if !foundArchived || !foundActiveSibling {
		t.Fatalf("include_archived list missing agents: archived=%t active_sibling=%t", foundArchived, foundActiveSibling)
	}
}

func listContainsAgent(t *testing.T, body []byte, agentID string) bool {
	t.Helper()
	var resp []AgentResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("decode ListAgents response: %v", err)
	}
	for _, a := range resp {
		if a.ID == agentID {
			return true
		}
	}
	return false
}

// TestListAgentTasks_PrivateAgentForbidsPlainMember verifies that the agent
// task history endpoint (the "查看历史会话" surface) is also gated.
func TestListAgentTasks_PrivateAgentForbidsPlainMember(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	agentID, ownerID, memberID := privateAgentTestFixture(t)

	w := httptest.NewRecorder()
	testHandler.ListAgentTasks(w, withURLParam(newRequestAs(ownerID, "GET", "/api/agents/"+agentID+"/tasks", nil), "id", agentID))
	if w.Code != http.StatusOK {
		t.Fatalf("ListAgentTasks as owner: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	testHandler.ListAgentTasks(w, withURLParam(newRequestAs(memberID, "GET", "/api/agents/"+agentID+"/tasks", nil), "id", agentID))
	if w.Code != http.StatusForbidden {
		t.Fatalf("ListAgentTasks as plain member: expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

// TestCreateChatSession_PrivateAgentForbidsPlainMember verifies that members
// who can't access the private agent cannot start a chat session against it.
// The chat handler reads workspace context from middleware, so we set it
// explicitly via middleware.SetMemberContext before invoking the handler
// (the test harness doesn't run the real middleware chain).
func TestCreateChatSession_PrivateAgentForbidsPlainMember(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	agentID, _, memberID := privateAgentTestFixture(t)

	// Load the plain member's row so we can build a realistic context.
	memberRow, err := testHandler.Queries.GetMemberByUserAndWorkspace(context.Background(), db.GetMemberByUserAndWorkspaceParams{
		UserID:      util.MustParseUUID(memberID),
		WorkspaceID: util.MustParseUUID(testWorkspaceID),
	})
	if err != nil {
		t.Fatalf("load plain member row: %v", err)
	}

	body := map[string]any{
		"agent_id": agentID,
		"title":    "should be denied",
	}
	w := httptest.NewRecorder()
	req := newRequestAs(memberID, "POST", "/api/chat/sessions", body)
	req = req.WithContext(middleware.SetMemberContext(req.Context(), testWorkspaceID, memberRow))
	testHandler.CreateChatSession(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("CreateChatSession as plain member: expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

// TestGetAgent_RejectsForgedAgentIDHeader is the regression test for the
// #2359 review finding "X-Agent-ID can be forged by a plain member to bypass
// the private gate". A workspace member sets X-Agent-ID to any visible
// agent's UUID without supplying a valid X-Task-ID — resolveActor must now
// fall back to the member identity, so the private-agent gate stays effective.
func TestGetAgent_RejectsForgedAgentIDHeader(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	agentID, _, memberID := privateAgentTestFixture(t)

	w := httptest.NewRecorder()
	req := newRequestAs(memberID, "GET", "/api/agents/"+agentID, nil)
	// Forge X-Agent-ID without X-Task-ID. Pre-fix this would have made
	// resolveActor return ("agent", agentID) and canAccessPrivateAgent
	// would have unconditionally allowed the read.
	req.Header.Set("X-Agent-ID", agentID)
	req = withURLParam(req, "id", agentID)
	testHandler.GetAgent(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("GetAgent with forged X-Agent-ID: expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

// TestListChatMessages_PrivateAgentForbidsAfterAccessRevoked is the regression
// test for the #2359 review finding "chat history read path doesn't re-gate".
// A member who created a chat session is later denied access to the agent
// (here simulated by the member never being on the allowlist for a private
// agent owned by someone else; the equivalent of an after-the-fact ownership
// transfer). The session row still names them as creator, but the read
// endpoints must refuse to surface the transcript.
func TestListChatMessages_PrivateAgentForbidsAfterAccessRevoked(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	agentID, _, memberID := privateAgentTestFixture(t)

	// Insert a chat session row directly with the plain member as creator,
	// bypassing CreateChatSession's own gate. This represents a session
	// that existed before the member lost access (or before the gate
	// landed).
	var sessionID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO chat_session (workspace_id, agent_id, creator_id, title, status)
		VALUES ($1, $2, $3, 'pre-revocation session', 'active')
		RETURNING id
	`, testWorkspaceID, agentID, memberID).Scan(&sessionID); err != nil {
		t.Fatalf("seed chat session: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM chat_session WHERE id = $1`, sessionID)
	})

	memberRow, err := testHandler.Queries.GetMemberByUserAndWorkspace(ctx, db.GetMemberByUserAndWorkspaceParams{
		UserID:      util.MustParseUUID(memberID),
		WorkspaceID: util.MustParseUUID(testWorkspaceID),
	})
	if err != nil {
		t.Fatalf("load plain member row: %v", err)
	}

	w := httptest.NewRecorder()
	req := newRequestAs(memberID, "GET", "/api/chat/sessions/"+sessionID+"/messages", nil)
	req = req.WithContext(middleware.SetMemberContext(req.Context(), testWorkspaceID, memberRow))
	req = withURLParam(req, "sessionId", sessionID)
	testHandler.ListChatMessages(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("ListChatMessages on stale session: expected 403, got %d: %s", w.Code, w.Body.String())
	}
}
