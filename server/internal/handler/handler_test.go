package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/auro-ai/auro/server/internal/analytics"
	"github.com/auro-ai/auro/server/internal/events"
	"github.com/auro-ai/auro/server/internal/realtime"
	"github.com/auro-ai/auro/server/internal/service"
	"github.com/auro-ai/auro/server/internal/testutil"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var testHandler *Handler
var testPool *pgxpool.Pool
var testUserID string
var testWorkspaceID string
var testRuntimeID string

// dbfx builds the rows these tests act on and removes them again when the test
// that asked for them ends. New tests build fixtures through it rather than
// writing an INSERT and a matching DELETE by hand; see internal/testutil.
var dbfx *testutil.Fixture

const (
	handlerTestEmail         = "handler-test@auro.ai"
	handlerTestName          = "Handler Test User"
	handlerTestWorkspaceSlug = "handler-tests"
)

func TestMain(m *testing.M) {
	ctx := context.Background()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://auro:auro@localhost:5432/auro?sslmode=disable"
	}

	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		fmt.Printf("Skipping tests: could not connect to database: %v\n", err)
		os.Exit(0)
	}
	if err := pool.Ping(ctx); err != nil {
		fmt.Printf("Skipping tests: database not reachable: %v\n", err)
		pool.Close()
		os.Exit(0)
	}

	queries := db.New(pool)
	hub := realtime.NewHub()
	go hub.Run()
	bus := events.New()
	emailSvc := service.NewEmailService()
	testHandler = New(queries, pool, hub, bus, emailSvc, nil, nil, analytics.NoopClient{}, Config{AllowSignup: true})
	// httptest.NewRequest defaults RemoteAddr to 192.0.2.1, so every webhook
	// test in the suite shares one IP bucket. With the production default
	// (30/min) the budget runs out partway through the suite and unrelated
	// downstream tests see a 429 from the IP gate instead of the response
	// they're asserting. Tests that exercise rate limiting deliberately
	// swap in a tight limiter with t.Cleanup; this generous default keeps
	// the rest of the suite hermetic.
	testHandler.WebhookRateLimiter = NewMemoryWebhookRateLimiter(WebhookRateLimit{Limit: 1_000_000, Window: time.Minute})
	testHandler.WebhookIPRateLimiter = NewMemoryWebhookIPRateLimiter(WebhookRateLimit{Limit: 1_000_000, Window: time.Minute})
	testHandler.WebhookAbsoluteIPRateLimiter = NewMemoryWebhookAbsoluteIPRateLimiter(WebhookRateLimit{Limit: 1_000_000, Window: time.Minute})
	testHandler.InvitationRateLimiters = NewMemoryInvitationRateLimiters(InvitationRateLimits{
		Actor:     SlidingWindowRateLimit{Limit: 1_000_000, Window: time.Minute},
		Workspace: SlidingWindowRateLimit{Limit: 1_000_000, Window: time.Minute},
		Recipient: SlidingWindowRateLimit{Limit: 1_000_000, Window: time.Minute},
	})
	testPool = pool

	testUserID, testWorkspaceID, err = setupHandlerTestFixture(ctx, pool)
	if err != nil {
		fmt.Printf("Failed to set up handler test fixture: %v\n", err)
		pool.Close()
		os.Exit(1)
	}
	dbfx = testutil.New(pool, testWorkspaceID, testUserID)

	code := m.Run()
	if err := cleanupHandlerTestFixture(context.Background(), pool); err != nil {
		fmt.Printf("Failed to clean up handler test fixture: %v\n", err)
		if code == 0 {
			code = 1
		}
	}
	pool.Close()
	os.Exit(code)
}

func setupHandlerTestFixture(ctx context.Context, pool *pgxpool.Pool) (string, string, error) {
	if err := cleanupHandlerTestFixture(ctx, pool); err != nil {
		return "", "", err
	}

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO "user" (name, email)
		VALUES ($1, $2)
		RETURNING id
	`, handlerTestName, handlerTestEmail).Scan(&userID); err != nil {
		return "", "", err
	}

	var workspaceID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO workspace (name, slug, description)
		VALUES ($1, $2, $3)
		RETURNING id
	`, "Handler Tests", handlerTestWorkspaceSlug, "Temporary workspace for handler tests").Scan(&workspaceID); err != nil {
		return "", "", err
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO member (workspace_id, user_id, role)
		VALUES ($1, $2, 'owner')
	`, workspaceID, userID); err != nil {
		return "", "", err
	}

	var runtimeID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO agent_runtime (
			workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata, owner_id, last_seen_at
		)
		VALUES ($1, NULL, $2, 'cloud', $3, 'online', $4, '{}'::jsonb, $5, now())
		RETURNING id
	`, workspaceID, "Handler Test Runtime", "handler_test_runtime", "Handler test runtime", userID).Scan(&runtimeID); err != nil {
		return "", "", err
	}
	testRuntimeID = runtimeID

	var seededAgentID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO agent (
			workspace_id, name, description, runtime_mode, runtime_config,
			runtime_id, visibility, permission_mode, max_concurrent_tasks, owner_id
		)
		VALUES ($1, $2, '', 'cloud', '{}'::jsonb, $3, 'workspace', 'public_to', 1, $4)
		RETURNING id
	`, workspaceID, "Handler Test Agent", runtimeID, userID).Scan(&seededAgentID); err != nil {
		return "", "", err
	}
	// MUL-3963: the seeded workspace-visible agent is invocable by workspace
	// members and A2A triggers, so seed its workspace invocation target.
	if _, err := pool.Exec(ctx, `
		INSERT INTO agent_invocation_target (agent_id, target_type, target_id)
		VALUES ($1, 'workspace', $2)
		ON CONFLICT (agent_id, target_type, target_id) DO NOTHING
	`, seededAgentID, workspaceID); err != nil {
		return "", "", err
	}

	return userID, workspaceID, nil
}

func cleanupHandlerTestFixture(ctx context.Context, pool *pgxpool.Pool) error {
	var hasClientUsageTable bool
	if err := pool.QueryRow(ctx, `SELECT to_regclass('client_usage_daily') IS NOT NULL`).Scan(&hasClientUsageTable); err != nil {
		return err
	}
	if hasClientUsageTable {
		if _, err := pool.Exec(ctx, `DELETE FROM client_usage_daily WHERE user_id IN (SELECT id FROM "user" WHERE email = $1)`, handlerTestEmail); err != nil {
			return err
		}
	}
	if _, err := pool.Exec(ctx, `DELETE FROM workspace WHERE slug = $1`, handlerTestWorkspaceSlug); err != nil {
		return err
	}
	if _, err := pool.Exec(ctx, `DELETE FROM "user" WHERE email = $1`, handlerTestEmail); err != nil {
		return err
	}
	return nil
}

func newRequest(method, path string, body any) *http.Request {
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", testUserID)
	req.Header.Set("X-Workspace-ID", testWorkspaceID)
	return req
}

func withURLParam(req *http.Request, key, value string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add(key, value)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func handlerTestRuntimeID(t *testing.T) string {
	t.Helper()

	var runtimeID string
	dbfx.QueryRow(t,
		`SELECT id FROM agent_runtime WHERE workspace_id = $1 ORDER BY created_at ASC LIMIT 1`,
		testWorkspaceID,
	).Scan(&runtimeID)

	return runtimeID
}

func createHandlerTestAgent(t *testing.T, name string, mcpConfig []byte) string {
	t.Helper()

	agentID := dbfx.Agent(t, name, handlerTestRuntimeID(t), testutil.Cols{
		"visibility":      "workspace",
		"permission_mode": "public_to",
		"instructions":    "",
		"custom_env":      testutil.Raw("'{}'::jsonb"),
		"custom_args":     testutil.Raw("'[]'::jsonb"),
		"mcp_config":      mcpConfig,
	})
	// Generic test agents are workspace-invocable (MUL-3963): seed the
	// matching workspace invocation target so canInvokeAgent admits workspace
	// members and A2A triggers, mirroring the pre-permission-model behavior
	// where a workspace-visible agent could be triggered by anyone in the
	// workspace. Dedicated private-agent tests use privateAgentTestFixture.
	dbfx.Exec(t, `
		INSERT INTO agent_invocation_target (agent_id, target_type, target_id)
		VALUES ($1, 'workspace', $2)
		ON CONFLICT (agent_id, target_type, target_id) DO NOTHING
	`, agentID, testWorkspaceID)

	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM agent WHERE id = $1`, agentID)
	})

	return agentID
}

// createHandlerTestTaskForAgent seeds a running agent_task_queue row for the
// given agent (with no associated issue) and returns the task UUID. Used by
// tests that need to set X-Task-ID alongside X-Agent-ID — resolveActor now
// requires the pair to be present and consistent before granting "agent"
// actor identity.
func createHandlerTestTaskForAgent(t *testing.T, agentID string) string {
	t.Helper()
	chatID := dbfx.ChatSession(t, agentID)
	return dbfx.Task(t, agentID, testutil.Cols{"chat_session_id": chatID, "runtime_id": handlerTestRuntimeID(t), "status": "running"})
}

func fetchAgentMcpConfig(t *testing.T, agentID string) []byte {
	t.Helper()

	var mcpConfig []byte
	dbfx.QueryRow(t, `SELECT mcp_config FROM agent WHERE id = $1`, agentID).Scan(&mcpConfig)

	return mcpConfig
}

func assertJSONEqual(t *testing.T, got []byte, want string) {
	t.Helper()

	var gotValue any
	if err := json.Unmarshal(got, &gotValue); err != nil {
		t.Fatalf("failed to unmarshal got JSON %q: %v", string(got), err)
	}

	var wantValue any
	if err := json.Unmarshal([]byte(want), &wantValue); err != nil {
		t.Fatalf("failed to unmarshal want JSON %q: %v", want, err)
	}

	gotJSON, err := json.Marshal(gotValue)
	if err != nil {
		t.Fatalf("failed to marshal normalized got JSON: %v", err)
	}
	wantJSON, err := json.Marshal(wantValue)
	if err != nil {
		t.Fatalf("failed to marshal normalized want JSON: %v", err)
	}

	if string(gotJSON) != string(wantJSON) {
		t.Fatalf("expected JSON %s, got %s", string(wantJSON), string(gotJSON))
	}
}

func TestGetChatSessionRejectsMalformedSessionID(t *testing.T) {
	req := newRequest("GET", "/api/chat/sessions/not-a-uuid", nil)
	req = withURLParam(req, "sessionId", "not-a-uuid")
	testutil.Call(t, testHandler.GetChatSession, req).Want(http.StatusBadRequest)
}

func TestCreateAutopilotRejectsMalformedAssigneeID(t *testing.T) {
	req := newRequest("POST", "/api/autopilots", map[string]any{
		"title":          "Malformed assignee autopilot",
		"assignee_id":    "not-a-uuid",
		"execution_mode": "run_only",
	})
	testutil.Call(t, testHandler.CreateAutopilot, req).Want(http.StatusBadRequest)
}

func TestUpdateAutopilotRejectsMalformedID(t *testing.T) {
	req := newRequest("PUT", "/api/autopilots/not-a-uuid", map[string]any{
		"title": "Malformed autopilot id",
	})
	req = withURLParam(req, "id", "not-a-uuid")
	testutil.Call(t, testHandler.UpdateAutopilot, req).Want(http.StatusBadRequest)
}

func TestUpdateAgentRejectsMalformedAgentID(t *testing.T) {
	req := newRequest("PUT", "/api/agents/not-a-uuid", map[string]any{
		"name": "Malformed agent id",
	})
	req = withURLParam(req, "id", "not-a-uuid")
	testutil.Call(t, testHandler.UpdateAgent, req).Want(http.StatusBadRequest)
}

func TestCreateAgentRejectsMalformedRuntimeID(t *testing.T) {
	req := newRequest("POST", "/api/agents", map[string]any{
		"name":       "Malformed runtime agent",
		"runtime_id": "not-a-uuid",
	})
	testutil.Call(t, testHandler.CreateAgent, req).Want(http.StatusBadRequest)
}

func TestUpdateAgentRejectsMalformedRuntimeID(t *testing.T) {
	agentID := createHandlerTestAgent(t, "Handler Malformed Runtime Update", nil)

	req := newRequest("PUT", "/api/agents/"+agentID, map[string]any{
		"runtime_id": "not-a-uuid",
	})
	req = withURLParam(req, "id", agentID)
	testutil.Call(t, testHandler.UpdateAgent, req).Want(http.StatusBadRequest)
}

func TestUpdateWorkspaceRejectsMalformedID(t *testing.T) {
	req := newRequest("PUT", "/api/workspaces/not-a-uuid", map[string]any{
		"name": "Malformed workspace id",
	})
	req = withURLParam(req, "id", "not-a-uuid")
	testutil.Call(t, testHandler.UpdateWorkspace, req).Want(http.StatusBadRequest)
}

func TestUpdateMemberRejectsMalformedMemberID(t *testing.T) {
	req := newRequest("PATCH", "/api/workspaces/"+testWorkspaceID+"/members/not-a-uuid", map[string]any{
		"role": "member",
	})
	req = withURLParams(req, "id", testWorkspaceID, "memberId", "not-a-uuid")
	testutil.Call(t, testHandler.UpdateMember, req).Want(http.StatusBadRequest)
}

func TestRevokeInvitationRejectsMalformedInvitationID(t *testing.T) {
	req := newRequest("DELETE", "/api/workspaces/"+testWorkspaceID+"/invitations/not-a-uuid", nil)
	req = withURLParams(req, "id", testWorkspaceID, "invitationId", "not-a-uuid")
	testutil.Call(t, testHandler.RevokeInvitation, req).Want(http.StatusBadRequest)
}

func TestGetMyInvitationRejectsMalformedID(t *testing.T) {
	req := newRequest("GET", "/api/invitations/not-a-uuid", nil)
	req = withURLParam(req, "id", "not-a-uuid")
	testutil.Call(t, testHandler.GetMyInvitation, req).Want(http.StatusBadRequest)
}

func TestMarkInboxReadRejectsMalformedItemID(t *testing.T) {
	req := newRequest("POST", "/api/inbox/not-a-uuid/read", nil)
	req = withURLParam(req, "id", "not-a-uuid")
	testutil.Call(t, testHandler.MarkInboxRead, req).Want(http.StatusBadRequest)
}

func TestRevokePersonalAccessTokenRejectsMalformedID(t *testing.T) {
	req := newRequest("DELETE", "/api/tokens/not-a-uuid", nil)
	req = withURLParam(req, "id", "not-a-uuid")
	testutil.Call(t, testHandler.RevokePersonalAccessToken, req).Want(http.StatusBadRequest)
}

func TestRequestBodyUUIDFieldsRejectMalformed(t *testing.T) {
	tests := []struct {
		name   string
		req    *http.Request
		handle func(http.ResponseWriter, *http.Request)
	}{
		{
			name: "daemon register workspace_id",
			req: newRequest("POST", "/api/daemon/register", map[string]any{
				"workspace_id": "not-a-uuid",
				"daemon_id":    "daemon-malformed-workspace",
				"runtimes": []map[string]any{
					{"name": "codex", "type": "codex", "status": "online"},
				},
			}),
			handle: testHandler.DaemonRegister,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			tt.handle(w, tt.req)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("%s: expected 400 for malformed body UUID, got %d: %s", tt.name, w.Code, w.Body.String())
			}
		})
	}
}

func TestDaemonDeregisterRejectsMalformedRuntimeID(t *testing.T) {
	req := newRequest("POST", "/api/daemon/deregister", map[string]any{
		"runtime_ids": []string{"not-a-uuid"},
	})
	testutil.Call(t, testHandler.DaemonDeregister, req).Want(http.StatusBadRequest)
}

func TestSetAgentSkillsRejectsMalformedSkillID(t *testing.T) {
	agentID := createHandlerTestAgent(t, "Handler Malformed Skill Assignment", nil)

	req := newRequest("PUT", "/api/agents/"+agentID+"/skills", map[string]any{
		"skill_ids": []string{"not-a-uuid"},
	})
	req = withURLParam(req, "id", agentID)
	testutil.Call(t, testHandler.SetAgentSkills, req).Want(http.StatusBadRequest)
}

func TestAddAgentSkillsPreservesExistingAssignments(t *testing.T) {
	agentID := createHandlerTestAgent(t, "Handler Add Skill Preserves Existing", nil)
	existingSkillID := insertHandlerTestSkill(t, "add-preserve-existing", "existing body")
	newSkillID := insertHandlerTestSkill(t, "add-preserve-new", "new body")

	dbfx.Exec(t,
		`INSERT INTO agent_skill (agent_id, skill_id) VALUES ($1, $2)`,
		agentID, existingSkillID,
	)

	req := newRequest("POST", "/api/agents/"+agentID+"/skills/add", map[string]any{
		"skill_ids": []string{newSkillID},
	})
	req = withURLParam(req, "id", agentID)
	w := testutil.Call(t, testHandler.AddAgentSkills, req).Want(http.StatusOK)

	var resp []SkillSummaryResponse
	w.JSON(&resp)
	assertSkillIDsPresent(t, resp, existingSkillID, newSkillID)
	assertAgentSkillRowCount(t, agentID, 2)
}

func TestAddAgentSkillsAddsMultipleAndIsIdempotent(t *testing.T) {
	agentID := createHandlerTestAgent(t, "Handler Add Multiple Skills", nil)
	skillA := insertHandlerTestSkill(t, "add-multiple-a", "a body")
	skillB := insertHandlerTestSkill(t, "add-multiple-b", "b body")

	for attempt := 0; attempt < 2; attempt++ {
		req := newRequest("POST", "/api/agents/"+agentID+"/skills/add", map[string]any{
			"skill_ids": []string{skillA, skillB},
		})
		req = withURLParam(req, "id", agentID)
		w := testutil.Call(t, testHandler.AddAgentSkills, req)
		if w.Code != http.StatusOK {
			t.Fatalf("AddAgentSkills attempt %d: expected 200, got %d: %s", attempt+1, w.Code, w.Body.String())
		}
	}

	assertAgentSkillRowCount(t, agentID, 2)
}

func TestAddAgentSkillsRejectsMalformedSkillID(t *testing.T) {
	agentID := createHandlerTestAgent(t, "Handler Add Malformed Skill Assignment", nil)

	req := newRequest("POST", "/api/agents/"+agentID+"/skills/add", map[string]any{
		"skill_ids": []string{"not-a-uuid"},
	})
	req = withURLParam(req, "id", agentID)
	testutil.Call(t, testHandler.AddAgentSkills, req).Want(http.StatusBadRequest)
}

func TestAddAgentSkillsRejectsCrossWorkspaceSkillID(t *testing.T) {
	agentID := createHandlerTestAgent(t, "Handler Add Cross Workspace Skill", nil)
	foreignSkillID := insertHandlerTestSkillInForeignWorkspace(t, "add-cross-workspace", "foreign body")

	req := newRequest("POST", "/api/agents/"+agentID+"/skills/add", map[string]any{
		"skill_ids": []string{foreignSkillID},
	})
	req = withURLParam(req, "id", agentID)
	testutil.Call(t, testHandler.AddAgentSkills, req).Want(http.StatusNotFound)
	assertAgentSkillRowCount(t, agentID, 0)
}

func insertHandlerTestSkillInForeignWorkspace(t *testing.T, namePrefix, content string) string {
	t.Helper()
	slug := "foreign-skill-" + strings.ToLower(strings.ReplaceAll(t.Name(), "_", "-"))

	workspaceID := dbfx.Insert(t, "workspace", testutil.Cols{
		"name":        "Foreign Skill Workspace " + t.Name(),
		"slug":        slug,
		"description": "",
	})

	name := namePrefix + "-" + t.Name()
	skillID := dbfx.Insert(t, "skill", testutil.Cols{
		"workspace_id": workspaceID,
		"name":         name,
		"description":  "fixture",
		"content":      content,
		"config":       testutil.Raw("'{}'::jsonb"),
		"created_by":   testUserID,
	})
	return skillID
}

func assertSkillIDsPresent(t *testing.T, skills []SkillSummaryResponse, wantIDs ...string) {
	t.Helper()
	got := make(map[string]bool, len(skills))
	for _, s := range skills {
		got[s.ID] = true
	}
	for _, want := range wantIDs {
		if !got[want] {
			t.Fatalf("response missing skill %s; got %+v", want, skills)
		}
	}
}

func assertAgentSkillRowCount(t *testing.T, agentID string, want int) {
	t.Helper()
	var got int
	dbfx.QueryRow(t,
		`SELECT COUNT(*) FROM agent_skill WHERE agent_id = $1`,
		agentID,
	).Scan(&got)
	if got != want {
		t.Fatalf("agent_skill row count: got %d, want %d", got, want)
	}
}

func TestAgentCRUD(t *testing.T) {
	// List agents
	w := testutil.Call(t, testHandler.ListAgents, newRequest("GET", "/api/agents?workspace_id="+testWorkspaceID, nil)).Want(http.StatusOK)

	var agents []AgentResponse
	json.NewDecoder(w.Body).Decode(&agents)
	if len(agents) == 0 {
		t.Fatal("ListAgents: expected at least 1 agent")
	}

	// Update agent status
	agentID := agents[0].ID
	req := newRequest("PUT", "/api/agents/"+agentID, map[string]any{
		"status": "idle",
	})
	req = withURLParam(req, "id", agentID)
	w = testutil.Call(t, testHandler.UpdateAgent, req).Want(http.StatusOK)

	var updated AgentResponse
	json.NewDecoder(w.Body).Decode(&updated)
	if updated.Status != "idle" {
		t.Fatalf("UpdateAgent: expected status 'idle', got '%s'", updated.Status)
	}
	if updated.Name != agents[0].Name {
		t.Fatalf("UpdateAgent: name should be preserved, got '%s'", updated.Name)
	}
}

func TestUpdateAgentMcpConfigAbsentPreservesValue(t *testing.T) {
	agentID := createHandlerTestAgent(t, "Handler Mcp Preserve", []byte(`{"preset":"keep"}`))

	req := newRequest("PUT", "/api/agents/"+agentID, map[string]any{
		"name": "Handler Mcp Preserve Updated",
	})
	req = withURLParam(req, "id", agentID)
	w := testutil.Call(t, testHandler.UpdateAgent, req).Want(http.StatusOK)

	var updated AgentResponse
	w.JSON(&updated)
	assertJSONEqual(t, updated.McpConfig, `{"preset":"keep"}`)
	assertJSONEqual(t, fetchAgentMcpConfig(t, agentID), `{"preset":"keep"}`)
}

func TestUpdateAgentMcpConfigNullClearsValue(t *testing.T) {
	agentID := createHandlerTestAgent(t, "Handler Mcp Clear", []byte(`{"preset":"clear"}`))

	req := newRequest("PUT", "/api/agents/"+agentID, map[string]any{
		"mcp_config": nil,
	})
	req = withURLParam(req, "id", agentID)
	w := testutil.Call(t, testHandler.UpdateAgent, req).Want(http.StatusOK)

	var updated AgentResponse
	w.JSON(&updated)
	assertJSONEqual(t, updated.McpConfig, `null`)
	if fetchAgentMcpConfig(t, agentID) != nil {
		t.Fatalf("UpdateAgent: expected DB mcp_config to be SQL NULL")
	}
}

func TestUpdateAgentMcpConfigObjectUpdatesValue(t *testing.T) {
	agentID := createHandlerTestAgent(t, "Handler Mcp Update", []byte(`{"preset":"old"}`))

	req := newRequest("PUT", "/api/agents/"+agentID, map[string]any{
		"mcp_config": map[string]any{"preset": "new"},
	})
	req = withURLParam(req, "id", agentID)
	w := testutil.Call(t, testHandler.UpdateAgent, req).Want(http.StatusOK)

	var updated AgentResponse
	w.JSON(&updated)
	assertJSONEqual(t, updated.McpConfig, `{"preset":"new"}`)
	assertJSONEqual(t, fetchAgentMcpConfig(t, agentID), `{"preset":"new"}`)
}

func TestUpdateAgentMcpConfigPreservesBoundaryEmptyArguments(t *testing.T) {
	agentID := createHandlerTestAgent(t, "Handler Mcp Empty Args", nil)
	want := `{"mcpServers":{"fetch":{"command":"uvx","args":["","2222","","333",""]}}}`

	req := newRequest("PUT", "/api/agents/"+agentID, map[string]any{
		"mcp_config": map[string]any{
			"mcpServers": map[string]any{
				"fetch": map[string]any{
					"command": "uvx",
					"args":    []string{"", "2222", "", "333", ""},
				},
			},
		},
	})
	req = withURLParam(req, "id", agentID)
	w := testutil.Call(t, testHandler.UpdateAgent, req).Want(http.StatusOK)

	var updated AgentResponse
	w.JSON(&updated)
	assertJSONEqual(t, updated.McpConfig, want)
	assertJSONEqual(t, fetchAgentMcpConfig(t, agentID), want)
}

func TestCreateAgentMcpConfigNullStoresSQLNull(t *testing.T) {
	req := newRequest("POST", "/api/agents", map[string]any{
		"name":        "Handler Mcp Create Null",
		"runtime_id":  handlerTestRuntimeID(t),
		"mcp_config":  nil,
		"custom_env":  map[string]string{},
		"custom_args": []string{},
	})
	w := testutil.Call(t, testHandler.CreateAgent, req).Want(http.StatusCreated)

	var created AgentResponse
	w.JSON(&created)
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM agent WHERE id = $1`, created.ID)
	})

	assertJSONEqual(t, created.McpConfig, `null`)
	if fetchAgentMcpConfig(t, created.ID) != nil {
		t.Fatalf("CreateAgent: expected DB mcp_config to be SQL NULL")
	}
}

func TestWorkspaceCRUD(t *testing.T) {
	// List workspaces
	w := testutil.Call(t, testHandler.ListWorkspaces, newRequest("GET", "/api/workspaces", nil)).Want(http.StatusOK)

	var workspaces []WorkspaceResponse
	json.NewDecoder(w.Body).Decode(&workspaces)
	if len(workspaces) == 0 {
		t.Fatal("ListWorkspaces: expected at least 1 workspace")
	}

	// Get workspace
	wsID := workspaces[0].ID
	req := newRequest("GET", "/api/workspaces/"+wsID, nil)
	req = withURLParam(req, "id", wsID)
	w = testutil.Call(t, testHandler.GetWorkspace, req).Want(http.StatusOK)
}

func TestCreateWorkspaceUsesRequestedSlug(t *testing.T) {
	const slug = "handler-create-workspace-requested"
	ctx := context.Background()

	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM workspace WHERE slug = $1`, slug)
	})

	req := newRequest("POST", "/api/workspaces", map[string]string{
		"name": "Handler Create Workspace Requested",
		"slug": slug,
	})
	w := testutil.Call(t, testHandler.CreateWorkspace, req).Want(http.StatusCreated)

	var created WorkspaceResponse
	w.JSON(&created)
	if created.Slug != slug {
		t.Fatalf("CreateWorkspace: expected slug %q, got %q", slug, created.Slug)
	}
}

func TestCreateWorkspaceSlugConflictReturnsConflict(t *testing.T) {
	ctx := context.Background()
	retriedSlug := handlerTestWorkspaceSlug + "-2"

	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM workspace WHERE slug = $1`, retriedSlug)
	})

	req := newRequest("POST", "/api/workspaces", map[string]string{
		"name": "Duplicate Handler Workspace",
		"slug": handlerTestWorkspaceSlug,
	})
	testutil.Call(t, testHandler.CreateWorkspace, req).Want(http.StatusConflict)

	var count int
	dbfx.QueryRow(t, `SELECT count(*) FROM workspace WHERE slug = $1`, retriedSlug).Scan(&count)
	if count != 0 {
		t.Fatalf("CreateWorkspace: expected no fallback slug %q, got %d rows", retriedSlug, count)
	}
}

func TestCreateWorkspaceInvalidSlugReturnsBadRequest(t *testing.T) {
	req := newRequest("POST", "/api/workspaces", map[string]string{
		"name": "Invalid Slug Workspace",
		"slug": "invalid slug",
	})
	testutil.Call(t, testHandler.CreateWorkspace, req).Want(http.StatusBadRequest)
}

func TestSendCode(t *testing.T) {
	w := httptest.NewRecorder()
	body := map[string]string{"email": "sendcode-test@auro.ai"}
	var buf bytes.Buffer
	json.NewEncoder(&buf).Encode(body)
	req := httptest.NewRequest("POST", "/auth/send-code", &buf)
	req.Header.Set("Content-Type", "application/json")
	testHandler.SendCode(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("SendCode: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["message"] == "" {
		t.Fatal("SendCode: expected non-empty message")
	}

	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM verification_code WHERE email = $1`, "sendcode-test@auro.ai")
	})
}

func TestSendCodeDbError(t *testing.T) {
	// We can't easily mock the DB here without changing architecture,
	// but we can simulate a DB error by closing the pool temporarily or
	// using a cancelled context if the query respects it.

	// Create a handler with a "broken" queries object is hard because it's a struct.
	// Instead, let's use a context that is already cancelled.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	w := httptest.NewRecorder()
	body := map[string]string{"email": "dberror-test@auro.ai"}
	var buf bytes.Buffer
	json.NewEncoder(&buf).Encode(body)
	req := httptest.NewRequest("POST", "/auth/send-code", &buf)
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(ctx)

	testHandler.SendCode(w, req)

	// If the DB query respects the cancelled context, it should return an error.
	// pgx usually returns context.Canceled which is not what isNotFound checks for.
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("SendCode (db error): expected 500, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["error"] != "failed to lookup user" {
		t.Fatalf("SendCode (db error): expected error message 'failed to lookup user', got '%s'", resp["error"])
	}
}

func TestSendCodeRateLimit(t *testing.T) {
	const email = "ratelimit-test@auro.ai"
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM verification_code WHERE email = $1`, email)
	})

	// First request should succeed
	w := httptest.NewRecorder()
	body := map[string]string{"email": email}
	var buf bytes.Buffer
	json.NewEncoder(&buf).Encode(body)
	req := httptest.NewRequest("POST", "/auth/send-code", &buf)
	req.Header.Set("Content-Type", "application/json")
	testHandler.SendCode(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("SendCode (first): expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Second request within 60s should be rate limited
	w = httptest.NewRecorder()
	buf.Reset()
	json.NewEncoder(&buf).Encode(body)
	req = httptest.NewRequest("POST", "/auth/send-code", &buf)
	req.Header.Set("Content-Type", "application/json")
	testHandler.SendCode(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("SendCode (second): expected 429, got %d: %s", w.Code, w.Body.String())
	}
}

func TestVerifyCode(t *testing.T) {
	const email = "verify-test@auro.ai"
	ctx := context.Background()

	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM verification_code WHERE email = $1`, email)
		user, err := testHandler.Queries.GetUserByEmail(ctx, email)
		if err == nil {
			workspaces, listErr := testHandler.Queries.ListWorkspaces(ctx, user.ID)
			if listErr == nil {
				for _, workspace := range workspaces {
					_ = testHandler.Queries.DeleteWorkspace(ctx, workspace.ID)
				}
			}
		}
		testPool.Exec(ctx, `DELETE FROM "user" WHERE email = $1`, email)
	})

	// Send code first
	w := httptest.NewRecorder()
	var buf bytes.Buffer
	json.NewEncoder(&buf).Encode(map[string]string{"email": email})
	req := httptest.NewRequest("POST", "/auth/send-code", &buf)
	req.Header.Set("Content-Type", "application/json")
	testHandler.SendCode(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("SendCode: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Read code from DB
	dbCode, err := testHandler.Queries.GetLatestVerificationCode(ctx, email)
	if err != nil {
		t.Fatalf("GetLatestVerificationCode: %v", err)
	}

	// Verify with correct code
	w = httptest.NewRecorder()
	buf.Reset()
	json.NewEncoder(&buf).Encode(map[string]string{"email": email, "code": dbCode.Code})
	req = httptest.NewRequest("POST", "/auth/verify-code", &buf)
	req.Header.Set("Content-Type", "application/json")
	testHandler.VerifyCode(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("VerifyCode: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp LoginResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.Token == "" {
		t.Fatal("VerifyCode: expected non-empty token")
	}
	if resp.User.Email != email {
		t.Fatalf("VerifyCode: expected email '%s', got '%s'", email, resp.User.Email)
	}
}

func createVerificationCodeForTest(t *testing.T, email, code string) {
	t.Helper()

	_, err := testPool.Exec(context.Background(), `
		INSERT INTO verification_code (email, code, expires_at)
		VALUES ($1, $2, now() + interval '10 minutes')
	`, email, code)
	if err != nil {
		t.Fatalf("create verification code: %v", err)
	}
}

func TestVerifyCodeRejectsDevCodeUnlessExplicitlyConfigured(t *testing.T) {
	t.Setenv(devVerificationCodeEnv, "")
	t.Setenv("APP_ENV", "")

	const email = "dev-code-disabled-test@auro.ai"
	ctx := context.Background()

	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM verification_code WHERE email = $1`, email)
	})

	createVerificationCodeForTest(t, email, "123456")

	w := httptest.NewRecorder()
	var buf bytes.Buffer
	json.NewEncoder(&buf).Encode(map[string]string{"email": email, "code": "888888"})
	req := httptest.NewRequest("POST", "/auth/verify-code", &buf)
	req.Header.Set("Content-Type", "application/json")
	testHandler.VerifyCode(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("VerifyCode (disabled dev code): expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestVerifyCodeAcceptsConfiguredDevCodeOutsideProduction(t *testing.T) {
	t.Setenv(devVerificationCodeEnv, "888888")
	t.Setenv("APP_ENV", "development")

	const email = "dev-code-enabled-test@auro.ai"
	ctx := context.Background()

	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM verification_code WHERE email = $1`, email)
		testPool.Exec(ctx, `DELETE FROM "user" WHERE email = $1`, email)
	})

	createVerificationCodeForTest(t, email, "123456")

	w := httptest.NewRecorder()
	var buf bytes.Buffer
	json.NewEncoder(&buf).Encode(map[string]string{"email": email, "code": "888888"})
	req := httptest.NewRequest("POST", "/auth/verify-code", &buf)
	req.Header.Set("Content-Type", "application/json")
	testHandler.VerifyCode(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("VerifyCode (enabled dev code): expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestVerifyCodeRejectsConfiguredDevCodeInProduction(t *testing.T) {
	t.Setenv(devVerificationCodeEnv, "888888")
	t.Setenv("APP_ENV", "production")

	const email = "dev-code-production-test@auro.ai"
	ctx := context.Background()

	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM verification_code WHERE email = $1`, email)
	})

	createVerificationCodeForTest(t, email, "123456")

	w := httptest.NewRecorder()
	var buf bytes.Buffer
	json.NewEncoder(&buf).Encode(map[string]string{"email": email, "code": "888888"})
	req := httptest.NewRequest("POST", "/auth/verify-code", &buf)
	req.Header.Set("Content-Type", "application/json")
	testHandler.VerifyCode(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("VerifyCode (production dev code): expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestVerifyCodeWrongCode(t *testing.T) {
	t.Setenv(devVerificationCodeEnv, "")

	const email = "wrong-code-test@auro.ai"
	ctx := context.Background()

	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM verification_code WHERE email = $1`, email)
	})

	// Send code
	w := httptest.NewRecorder()
	var buf bytes.Buffer
	json.NewEncoder(&buf).Encode(map[string]string{"email": email})
	req := httptest.NewRequest("POST", "/auth/send-code", &buf)
	req.Header.Set("Content-Type", "application/json")
	testHandler.SendCode(w, req)

	// Verify with wrong code
	w = httptest.NewRecorder()
	buf.Reset()
	json.NewEncoder(&buf).Encode(map[string]string{"email": email, "code": "000000"})
	req = httptest.NewRequest("POST", "/auth/verify-code", &buf)
	req.Header.Set("Content-Type", "application/json")
	testHandler.VerifyCode(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("VerifyCode (wrong code): expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestVerifyCodeBruteForceProtection(t *testing.T) {
	t.Setenv(devVerificationCodeEnv, "")

	const email = "bruteforce-test@auro.ai"
	ctx := context.Background()

	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM verification_code WHERE email = $1`, email)
	})

	// Send code
	w := httptest.NewRecorder()
	var buf bytes.Buffer
	json.NewEncoder(&buf).Encode(map[string]string{"email": email})
	req := httptest.NewRequest("POST", "/auth/send-code", &buf)
	req.Header.Set("Content-Type", "application/json")
	testHandler.SendCode(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("SendCode: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Read actual code so we can try it after lockout
	dbCode, err := testHandler.Queries.GetLatestVerificationCode(ctx, email)
	if err != nil {
		t.Fatalf("GetLatestVerificationCode: %v", err)
	}

	// Exhaust all 5 attempts with wrong codes
	for i := 0; i < 5; i++ {
		w = httptest.NewRecorder()
		buf.Reset()
		json.NewEncoder(&buf).Encode(map[string]string{"email": email, "code": "000000"})
		req = httptest.NewRequest("POST", "/auth/verify-code", &buf)
		req.Header.Set("Content-Type", "application/json")
		testHandler.VerifyCode(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("attempt %d: expected 400, got %d", i+1, w.Code)
		}
	}

	// Now even the correct code should be rejected (code is locked out)
	w = httptest.NewRecorder()
	buf.Reset()
	json.NewEncoder(&buf).Encode(map[string]string{"email": email, "code": dbCode.Code})
	req = httptest.NewRequest("POST", "/auth/verify-code", &buf)
	req.Header.Set("Content-Type", "application/json")
	testHandler.VerifyCode(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("after lockout: expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestVerifyCodeNewUserHasNoWorkspace(t *testing.T) {
	const email = "workspace-verify-test@auro.ai"
	ctx := context.Background()

	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM verification_code WHERE email = $1`, email)
		testPool.Exec(ctx, `DELETE FROM "user" WHERE email = $1`, email)
	})

	// Send code
	w := httptest.NewRecorder()
	var buf bytes.Buffer
	json.NewEncoder(&buf).Encode(map[string]string{"email": email})
	req := httptest.NewRequest("POST", "/auth/send-code", &buf)
	req.Header.Set("Content-Type", "application/json")
	testHandler.SendCode(w, req)

	// Read code from DB
	dbCode, err := testHandler.Queries.GetLatestVerificationCode(ctx, email)
	if err != nil {
		t.Fatalf("GetLatestVerificationCode: %v", err)
	}

	// Verify
	w = httptest.NewRecorder()
	buf.Reset()
	json.NewEncoder(&buf).Encode(map[string]string{"email": email, "code": dbCode.Code})
	req = httptest.NewRequest("POST", "/auth/verify-code", &buf)
	req.Header.Set("Content-Type", "application/json")
	testHandler.VerifyCode(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("VerifyCode: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	user, err := testHandler.Queries.GetUserByEmail(ctx, email)
	if err != nil {
		t.Fatalf("GetUserByEmail: %v", err)
	}

	// New users should have no workspaces (/workspaces/new creates one)
	workspaces, err := testHandler.Queries.ListWorkspaces(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListWorkspaces: %v", err)
	}
	if len(workspaces) != 0 {
		t.Fatalf("ListWorkspaces: expected 0 workspaces for new user, got %d", len(workspaces))
	}
}

func TestDaemonRegisterMissingWorkspaceReturns404(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/daemon/register", bytes.NewBufferString(`{
		"workspace_id":"00000000-0000-0000-0000-000000000001",
		"daemon_id":"local-daemon",
		"device_name":"test-machine",
		"runtimes":[{"name":"Local Codex","type":"codex","version":"1.0.0","status":"online"}]
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", testUserID)
	w := testutil.Call(t, testHandler.DaemonRegister, req).Want(http.StatusNotFound)
	if !strings.Contains(w.Body.String(), "workspace not found") {
		t.Fatalf("DaemonRegister: expected workspace not found error, got %s", w.Body.String())
	}
}

func TestCreateSkillSkipsSkillMdFile(t *testing.T) {
	if testPool == nil {
		t.Skip("no database available")
	}

	req := newRequest(http.MethodPost, "/api/workspaces/"+testWorkspaceID+"/skills", CreateSkillRequest{
		Name:    "test-skill-create-skip-skillmd",
		Content: "# SKILL.md content",
		Files: []CreateSkillFileRequest{
			{Path: "README.md", Content: "readme"},
			{Path: "SKILL.md", Content: "should be skipped"},
			{Path: "helper.go", Content: "package main"},
		},
	})
	rec := httptest.NewRecorder()
	testHandler.CreateSkill(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp SkillWithFilesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	// Should only have README.md and helper.go, not SKILL.md
	if len(resp.Files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(resp.Files))
	}
	for _, f := range resp.Files {
		if strings.EqualFold(f.Path, "SKILL.md") {
			t.Fatalf("SKILL.md should not be in response files")
		}
	}

	// Verify DB state directly
	ctx := context.Background()
	rows, err := testPool.Query(ctx, "SELECT path FROM skill_file WHERE skill_id = $1", resp.ID)
	if err != nil {
		t.Fatalf("query skill_file: %v", err)
	}
	defer rows.Close()

	var paths []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			t.Fatalf("scan path: %v", err)
		}
		paths = append(paths, p)
	}
	if len(paths) != 2 {
		t.Fatalf("expected 2 rows in skill_file, got %d", len(paths))
	}
	for _, p := range paths {
		if strings.EqualFold(p, "SKILL.md") {
			t.Fatalf("SKILL.md should not be stored in skill_file")
		}
	}
}

func TestUpdateSkillSkipsSkillMdFile(t *testing.T) {
	if testPool == nil {
		t.Skip("no database available")
	}

	// Create a skill first
	req := newRequest(http.MethodPost, "/api/workspaces/"+testWorkspaceID+"/skills", CreateSkillRequest{
		Name:    "test-skill-update-skip-skillmd",
		Content: "# SKILL.md content",
		Files: []CreateSkillFileRequest{
			{Path: "README.md", Content: "readme"},
		},
	})
	rec := httptest.NewRecorder()
	testHandler.CreateSkill(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create skill: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var createResp SkillWithFilesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("unmarshal create response: %v", err)
	}

	// Update with SKILL.md in files
	updateReq := newRequest(http.MethodPut, "/api/skills/"+createResp.ID, UpdateSkillRequest{
		Name:    strPtr("updated-name"),
		Content: strPtr("updated content"),
		Files: []CreateSkillFileRequest{
			{Path: "README.md", Content: "updated readme"},
			{Path: "SKILL.md", Content: "should be skipped"},
			{Path: "new.go", Content: "package main"},
		},
	})
	updateReq = withURLParam(updateReq, "id", createResp.ID)
	updateRec := httptest.NewRecorder()
	testHandler.UpdateSkill(updateRec, updateReq)

	if updateRec.Code != http.StatusOK {
		t.Fatalf("update skill: expected 200, got %d: %s", updateRec.Code, updateRec.Body.String())
	}

	var updateResp SkillWithFilesResponse
	if err := json.Unmarshal(updateRec.Body.Bytes(), &updateResp); err != nil {
		t.Fatalf("unmarshal update response: %v", err)
	}

	if len(updateResp.Files) != 2 {
		t.Fatalf("expected 2 files after update, got %d", len(updateResp.Files))
	}
	for _, f := range updateResp.Files {
		if strings.EqualFold(f.Path, "SKILL.md") {
			t.Fatalf("SKILL.md should not be in updated response files")
		}
	}

	// Verify DB state
	ctx := context.Background()
	rows, err := testPool.Query(ctx, "SELECT path FROM skill_file WHERE skill_id = $1", createResp.ID)
	if err != nil {
		t.Fatalf("query skill_file: %v", err)
	}
	defer rows.Close()

	var paths []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			t.Fatalf("scan path: %v", err)
		}
		paths = append(paths, p)
	}
	if len(paths) != 2 {
		t.Fatalf("expected 2 rows in skill_file after update, got %d", len(paths))
	}
	for _, p := range paths {
		if strings.EqualFold(p, "SKILL.md") {
			t.Fatalf("SKILL.md should not be stored in skill_file after update")
		}
	}
}

func strPtr(s string) *string {
	return &s
}

func TestUpsertSkillFileRejectsSkillMd(t *testing.T) {
	if testPool == nil {
		t.Skip("no database available")
	}

	// Create a skill first
	req := newRequest(http.MethodPost, "/api/workspaces/"+testWorkspaceID+"/skills", CreateSkillRequest{
		Name:    "test-skill-upsert-reject-skillmd",
		Content: "# SKILL.md content",
	})
	rec := httptest.NewRecorder()
	testHandler.CreateSkill(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create skill: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var createResp SkillWithFilesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("unmarshal create response: %v", err)
	}

	// Try to upsert SKILL.md
	upsertReq := newRequest(http.MethodPut, "/api/skills/"+createResp.ID+"/files", CreateSkillFileRequest{
		Path:    "SKILL.md",
		Content: "should be rejected",
	})
	upsertReq = withURLParam(upsertReq, "id", createResp.ID)
	upsertRec := httptest.NewRecorder()
	testHandler.UpsertSkillFile(upsertRec, upsertReq)

	if upsertRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", upsertRec.Code, upsertRec.Body.String())
	}
	if !strings.Contains(upsertRec.Body.String(), "SKILL.md is reserved") {
		t.Fatalf("expected error message about reserved SKILL.md, got: %s", upsertRec.Body.String())
	}
}
