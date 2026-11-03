package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/auro-ai/auro/server/internal/analytics"
	"github.com/auro-ai/auro/server/internal/auth"
	"github.com/auro-ai/auro/server/internal/events"
	"github.com/auro-ai/auro/server/internal/realtime"
	"github.com/auro-ai/auro/server/internal/testutil"
)

var (
	testServer      *httptest.Server
	testPool        *pgxpool.Pool
	testToken       string
	testUserID      string
	testWorkspaceID string
)

// jwtSecret is resolved at runtime via auth.JWTSecret() so it respects
// the JWT_SECRET env var (set in .env) and stays in sync with the server.

const (
	integrationTestEmail         = "integration-test@auro.ai"
	integrationTestName          = "Integration Tester"
	integrationTestWorkspaceSlug = "integration-tests"
)

func setupIntegrationTestFixture(ctx context.Context, pool *pgxpool.Pool) (string, string, error) {
	if err := cleanupIntegrationTestFixture(ctx, pool); err != nil {
		return "", "", err
	}

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO "user" (name, email)
		VALUES ($1, $2)
		RETURNING id
	`, integrationTestName, integrationTestEmail).Scan(&userID); err != nil {
		return "", "", err
	}

	var workspaceID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO workspace (name, slug, description)
		VALUES ($1, $2, $3)
		RETURNING id
	`, "Integration Tests", integrationTestWorkspaceSlug, "Temporary workspace for router integration tests").Scan(&workspaceID); err != nil {
		return "", "", err
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO member (workspace_id, user_id, role)
		VALUES ($1, $2, 'owner')
	`, workspaceID, userID); err != nil {
		return "", "", err
	}

	// Owned by the fixture user, like every runtime a real daemon registers
	// with a member credential: a private runtime is bindable only by its
	// owner, so an ownerless one could not host the agents these tests create
	// through the API.
	var runtimeID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO agent_runtime (
			workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata, owner_id, last_seen_at
		)
		VALUES ($1, NULL, $2, 'cloud', $3, 'online', $4, '{}'::jsonb, $5, now())
		RETURNING id
	`, workspaceID, "Integration Test Runtime", "integration_test_runtime", "Integration test runtime", userID).Scan(&runtimeID); err != nil {
		return "", "", err
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO agent (
			workspace_id, name, description, runtime_mode, runtime_config,
			runtime_id, visibility, max_concurrent_tasks, owner_id
		)
		VALUES ($1, $2, '', 'cloud', '{}'::jsonb, $3, 'workspace', 1, $4)
	`, workspaceID, "Integration Test Agent", runtimeID, userID); err != nil {
		return "", "", err
	}

	return userID, workspaceID, nil
}

func cleanupIntegrationTestFixture(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, `DELETE FROM workspace WHERE slug = $1`, integrationTestWorkspaceSlug); err != nil {
		return err
	}
	if _, err := pool.Exec(ctx, `DELETE FROM "user" WHERE email = $1`, integrationTestEmail); err != nil {
		return err
	}
	return nil
}

// Helper to make authenticated requests
func authRequest(t *testing.T, method, path string, body any) *http.Response {
	t.Helper()
	var bodyReader io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		bodyReader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, testServer.URL+path, bodyReader)
	if err != nil {
		t.Fatalf("failed to create request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+testToken)
	req.Header.Set("X-Workspace-ID", testWorkspaceID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	return resp
}

func readJSON(t *testing.T, resp *http.Response, v any) {
	t.Helper()
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(v); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
}

func generateTestJWT(userID, email, name string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":   userID,
		"email": email,
		"name":  name,
		"exp":   time.Now().Add(72 * time.Hour).Unix(),
		"iat":   time.Now().Unix(),
	})
	return token.SignedString(auth.JWTSecret())
}

// ---- Health ----

func TestHealth(t *testing.T) {
	resp, err := http.Get(testServer.URL + "/health")
	if err != nil {
		t.Fatalf("health check failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var result map[string]string
	json.NewDecoder(resp.Body).Decode(&result)
	if result["status"] != "ok" {
		t.Fatalf("expected status ok, got %s", result["status"])
	}
}

func TestReadinessEndpoints(t *testing.T) {
	for _, path := range []string{"/readyz", "/healthz"} {
		t.Run(path, func(t *testing.T) {
			resp, err := http.Get(testServer.URL + path)
			if err != nil {
				t.Fatalf("readiness check failed: %v", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				t.Fatalf("expected 200, got %d", resp.StatusCode)
			}

			var result struct {
				Status string            `json:"status"`
				Checks map[string]string `json:"checks"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if result.Status != "ok" {
				t.Fatalf("expected status ok, got %s", result.Status)
			}
			if result.Checks["db"] != "ok" {
				t.Fatalf("expected db check ok, got %s", result.Checks["db"])
			}
			if result.Checks["migrations"] != "ok" {
				t.Fatalf("expected migrations check ok, got %s", result.Checks["migrations"])
			}
		})
	}
}

func TestConfigRouteIsPublic(t *testing.T) {
	resp, err := http.Get(testServer.URL + "/api/config")
	if err != nil {
		t.Fatalf("config request failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, body)
	}

	var result struct {
		CdnDomain string `json:"cdn_domain"`
	}
	readJSON(t, resp, &result)
}

// ---- Auth ----

func TestSendCodeAndVerify(t *testing.T) {
	const email = "integration-sendcode@auro.ai"
	ctx := context.Background()

	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM verification_code WHERE email = $1`, email)
		var userID string
		err := testPool.QueryRow(ctx, `SELECT id FROM "user" WHERE email = $1`, email).Scan(&userID)
		if err == nil {
			rows, queryErr := testPool.Query(ctx, `
				SELECT w.id FROM workspace w JOIN member m ON m.workspace_id = w.id WHERE m.user_id = $1
			`, userID)
			if queryErr == nil {
				defer rows.Close()
				for rows.Next() {
					var wsID string
					if rows.Scan(&wsID) == nil {
						testPool.Exec(ctx, `DELETE FROM workspace WHERE id = $1`, wsID)
					}
				}
			}
		}
		testPool.Exec(ctx, `DELETE FROM "user" WHERE email = $1`, email)
	})

	// Step 1: Send code
	body, _ := json.Marshal(map[string]string{"email": email})
	resp, err := http.Post(testServer.URL+"/auth/send-code", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("send-code failed: %v", err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("send-code: expected 200, got %d", resp.StatusCode)
	}
	resp.Body.Close()

	// Read code from DB
	var code string
	err = testPool.QueryRow(ctx, `SELECT code FROM verification_code WHERE email = $1 ORDER BY created_at DESC LIMIT 1`, email).Scan(&code)
	if err != nil {
		t.Fatalf("failed to read code from DB: %v", err)
	}

	// Step 2: Verify code
	body, _ = json.Marshal(map[string]string{"email": email, "code": code})
	resp, err = http.Post(testServer.URL+"/auth/verify-code", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("verify-code failed: %v", err)
	}
	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("verify-code: expected 200, got %d: %s", resp.StatusCode, respBody)
	}

	var loginResp struct {
		Token string `json:"token"`
		User  struct {
			Email string `json:"email"`
		} `json:"user"`
	}
	readJSON(t, resp, &loginResp)

	if loginResp.Token == "" {
		t.Fatal("expected non-empty token")
	}
	if loginResp.User.Email != email {
		t.Fatalf("expected email '%s', got '%s'", email, loginResp.User.Email)
	}

	// Verify the token works with /api/me
	req, _ := http.NewRequest("GET", testServer.URL+"/api/me", nil)
	req.Header.Set("Authorization", "Bearer "+loginResp.Token)
	meResp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("getMe failed: %v", err)
	}
	if meResp.StatusCode != 200 {
		t.Fatalf("getMe: expected 200, got %d", meResp.StatusCode)
	}
	meResp.Body.Close()
}

func TestVerifyCodeNewUserHasNoWorkspace(t *testing.T) {
	const email = "new-integration-verify@auro.ai"
	ctx := context.Background()

	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM verification_code WHERE email = $1`, email)
		testPool.Exec(ctx, `DELETE FROM "user" WHERE email = $1`, email)
	})

	testPool.Exec(ctx, `DELETE FROM "user" WHERE email = $1`, email)

	// Send code
	body, _ := json.Marshal(map[string]string{"email": email})
	resp, err := http.Post(testServer.URL+"/auth/send-code", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("send-code failed: %v", err)
	}
	resp.Body.Close()

	// Read code from DB
	var code string
	err = testPool.QueryRow(ctx, `SELECT code FROM verification_code WHERE email = $1 ORDER BY created_at DESC LIMIT 1`, email).Scan(&code)
	if err != nil {
		t.Fatalf("failed to read code from DB: %v", err)
	}

	// Verify code
	body, _ = json.Marshal(map[string]string{"email": email, "code": code})
	resp, err = http.Post(testServer.URL+"/auth/verify-code", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("verify-code failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("verify-code: expected 200, got %d", resp.StatusCode)
	}

	var loginResp struct {
		Token string `json:"token"`
	}
	readJSON(t, resp, &loginResp)

	// New users should have no workspaces (/workspaces/new creates one)
	req, _ := http.NewRequest("GET", testServer.URL+"/api/workspaces", nil)
	req.Header.Set("Authorization", "Bearer "+loginResp.Token)
	workspacesResp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("listWorkspaces failed: %v", err)
	}
	defer workspacesResp.Body.Close()

	if workspacesResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", workspacesResp.StatusCode)
	}

	var workspaces []struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	readJSON(t, workspacesResp, &workspaces)

	if len(workspaces) != 0 {
		t.Fatalf("expected 0 workspaces for new user, got %d", len(workspaces))
	}
}

func TestInvalidJWT(t *testing.T) {
	cases := []struct {
		name  string
		token string
	}{
		{"garbage token", "not-a-jwt"},
		{"empty token", ""},
		{"wrong secret", func() string {
			claims := jwt.MapClaims{"sub": "test", "exp": time.Now().Add(time.Hour).Unix()}
			t, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("wrong"))
			return t
		}()},
		{"expired token", func() string {
			claims := jwt.MapClaims{"sub": "test", "exp": time.Now().Add(-time.Hour).Unix()}
			t, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(auth.JWTSecret())
			return t
		}()},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req, _ := http.NewRequest("GET", testServer.URL+"/api/me", nil)
			if tc.token != "" {
				req.Header.Set("Authorization", "Bearer "+tc.token)
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("request failed: %v", err)
			}
			resp.Body.Close()
			if resp.StatusCode != 401 {
				t.Fatalf("expected 401, got %d", resp.StatusCode)
			}
		})
	}
}

// ---- Issues CRUD through full router ----

// ---- Comments through full router ----

// ---- Agents through full router ----

func TestAgentsThroughRouter(t *testing.T) {
	// List
	resp := authRequest(t, "GET", "/api/agents?workspace_id="+testWorkspaceID, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("ListAgents: expected 200, got %d", resp.StatusCode)
	}
	var agents []map[string]any
	readJSON(t, resp, &agents)
	if len(agents) < 1 {
		t.Fatal("expected at least 1 agent")
	}

	// Get
	agentID := agents[0]["id"].(string)
	resp = authRequest(t, "GET", "/api/agents/"+agentID, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("GetAgent: expected 200, got %d", resp.StatusCode)
	}
	var agent map[string]any
	readJSON(t, resp, &agent)
	if agent["id"] != agentID {
		t.Fatalf("expected agent id %s, got %s", agentID, agent["id"])
	}

	// Update status
	resp = authRequest(t, "PUT", "/api/agents/"+agentID, map[string]any{
		"status": "idle",
	})
	if resp.StatusCode != 200 {
		t.Fatalf("UpdateAgent: expected 200, got %d", resp.StatusCode)
	}
	var updated map[string]any
	readJSON(t, resp, &updated)
	if updated["status"] != "idle" {
		t.Fatalf("expected status 'idle', got '%s'", updated["status"])
	}
	// Name should be preserved
	if updated["name"] != agents[0]["name"] {
		t.Fatalf("name should be preserved, got '%s'", updated["name"])
	}
}

// ---- Workspaces through full router ----

func TestWorkspacesThroughRouter(t *testing.T) {
	// List
	resp := authRequest(t, "GET", "/api/workspaces", nil)
	if resp.StatusCode != 200 {
		t.Fatalf("ListWorkspaces: expected 200, got %d", resp.StatusCode)
	}
	var workspaces []map[string]any
	readJSON(t, resp, &workspaces)
	if len(workspaces) < 1 {
		t.Fatal("expected at least 1 workspace")
	}

	// Get
	wsID := workspaces[0]["id"].(string)
	resp = authRequest(t, "GET", "/api/workspaces/"+wsID, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("GetWorkspace: expected 200, got %d", resp.StatusCode)
	}
	var ws map[string]any
	readJSON(t, resp, &ws)
	if ws["id"] != wsID {
		t.Fatalf("expected workspace id %s, got %s", wsID, ws["id"])
	}

	// Update
	resp = authRequest(t, "PUT", "/api/workspaces/"+wsID, map[string]any{
		"description": "Integration test update",
	})
	if resp.StatusCode != 200 {
		t.Fatalf("UpdateWorkspace: expected 200, got %d", resp.StatusCode)
	}
	var updated map[string]any
	readJSON(t, resp, &updated)
	if updated["description"] != "Integration test update" {
		t.Fatalf("expected description 'Integration test update', got '%v'", updated["description"])
	}
	// Name should be preserved
	if updated["name"] != ws["name"] {
		t.Fatalf("name should be preserved")
	}

	// Members
	resp = authRequest(t, "GET", "/api/workspaces/"+wsID+"/members", nil)
	if resp.StatusCode != 200 {
		t.Fatalf("ListMembers: expected 200, got %d", resp.StatusCode)
	}
	var members []map[string]any
	readJSON(t, resp, &members)
	if len(members) < 1 {
		t.Fatal("expected at least 1 member")
	}
	// Verify member has user info
	if members[0]["email"] == nil || members[0]["email"] == "" {
		t.Fatal("member should have email field")
	}
	if members[0]["role"] == nil || members[0]["role"] == "" {
		t.Fatal("member should have role field")
	}
}

// TestDeleteWorkspaceRequiresOwner is a defense-in-depth regression test for the
// permission gate on DELETE /api/workspaces/{id}. It creates a separate workspace
// in which the integration test user is only an "admin" (not "owner") and asserts
// that DELETE returns 403, leaving the workspace intact. This guards against both
// router misconfiguration (missing middleware) and handler regressions.
func TestDeleteWorkspaceRequiresOwner(t *testing.T) {
	ctx := context.Background()

	const slug = "integration-tests-delete-403"
	// Best-effort cleanup from any prior run.
	_, _ = testPool.Exec(ctx, `DELETE FROM workspace WHERE slug = $1`, slug)

	var wsID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO workspace (name, slug, description)
		VALUES ($1, $2, $3)
		RETURNING id
	`, "Integration Tests Delete 403", slug, "DeleteWorkspace permission test").Scan(&wsID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM workspace WHERE id = $1`, wsID)
	})

	if _, err := testPool.Exec(ctx, `
		INSERT INTO member (workspace_id, user_id, role)
		VALUES ($1, $2, 'admin')
	`, wsID, testUserID); err != nil {
		t.Fatalf("create admin member: %v", err)
	}

	req, err := http.NewRequest("DELETE", testServer.URL+"/api/workspaces/"+wsID, nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+testToken)
	req.Header.Set("X-Workspace-ID", wsID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for non-owner DELETE, got %d", resp.StatusCode)
	}

	var exists bool
	if err := testPool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM workspace WHERE id = $1)`, wsID).Scan(&exists); err != nil {
		t.Fatalf("verify workspace: %v", err)
	}
	if !exists {
		t.Fatal("workspace was deleted despite non-owner request")
	}
}

func TestDingTalkGroupsThroughRouterSupportsFilteredWorkspaceAndAgentScopes(t *testing.T) {
	removedRouteResp := authRequest(t, http.MethodGet, "/api/workspaces/"+testWorkspaceID+"/dingtalk/group-routes", nil)
	removedRouteResp.Body.Close()
	if removedRouteResp.StatusCode != http.StatusNotFound {
		t.Fatalf("removed DingTalk group-routes status = %d, want 404", removedRouteResp.StatusCode)
	}

	resp := authRequest(t, http.MethodGet, "/api/workspaces/"+testWorkspaceID+"/dingtalk/groups", nil)
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("member DingTalk groups status = %d, want 200", resp.StatusCode)
	}
	var result struct {
		Groups []any `json:"groups"`
	}
	readJSON(t, resp, &result)
	if result.Groups == nil || len(result.Groups) != 0 {
		t.Fatalf("disabled DingTalk groups = %#v, want stable empty list", result.Groups)
	}

	var agentID string
	if err := testPool.QueryRow(context.Background(), `
SELECT id FROM agent WHERE workspace_id = $1 ORDER BY created_at LIMIT 1
`, testWorkspaceID).Scan(&agentID); err != nil {
		t.Fatalf("load fixture agent: %v", err)
	}
	resp = authRequest(t, http.MethodGet, "/api/agents/"+agentID+"/dingtalk/groups", nil)
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("visible Agent DingTalk groups status = %d, want 200", resp.StatusCode)
	}
	readJSON(t, resp, &result)
	if result.Groups == nil || len(result.Groups) != 0 {
		t.Fatalf("disabled Agent DingTalk groups = %#v, want stable empty list", result.Groups)
	}

	var memberUserID string
	if err := testPool.QueryRow(context.Background(), `
INSERT INTO "user" (name, email) VALUES ('DingTalk group member', $1) RETURNING id
`, "dingtalk-groups-member-"+time.Now().Format("150405.000000000")+"@example.test").Scan(&memberUserID); err != nil {
		t.Fatalf("create member user: %v", err)
	}
	if _, err := testPool.Exec(context.Background(), `
INSERT INTO member (workspace_id, user_id, role) VALUES ($1, $2, 'member')
`, testWorkspaceID, memberUserID); err != nil {
		t.Fatalf("create workspace member: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM member WHERE workspace_id = $1 AND user_id = $2`, testWorkspaceID, memberUserID)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM "user" WHERE id = $1`, memberUserID)
	})
	memberToken, err := generateTestJWT(memberUserID, "dingtalk-groups-member@example.test", "DingTalk group member")
	if err != nil {
		t.Fatalf("generate member token: %v", err)
	}
	req, err := http.NewRequest(http.MethodGet, testServer.URL+"/api/workspaces/"+testWorkspaceID+"/dingtalk/groups", nil)
	if err != nil {
		t.Fatalf("build member request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+memberToken)
	req.Header.Set("X-Workspace-ID", testWorkspaceID)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("member request failed: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("member filtered DingTalk groups status = %d, want 200", resp.StatusCode)
	}

	// Mutation routes admit workspace members to the handler, where the target
	// agent's ownership is checked. Temporarily make this member the agent owner;
	// a router-level admin gate would return 403 before the disabled/validation
	// response below.
	var originalOwnerID string
	if err := testPool.QueryRow(context.Background(), `
SELECT owner_id FROM agent WHERE id = $1
`, agentID).Scan(&originalOwnerID); err != nil {
		t.Fatalf("load fixture Agent owner: %v", err)
	}
	if _, err := testPool.Exec(context.Background(), `
UPDATE agent SET owner_id = $2 WHERE id = $1
`, agentID, memberUserID); err != nil {
		t.Fatalf("assign fixture Agent owner: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `UPDATE agent SET owner_id = $2 WHERE id = $1`, agentID, originalOwnerID)
	})
	req, err = http.NewRequest(http.MethodPost,
		testServer.URL+"/api/workspaces/"+testWorkspaceID+"/dingtalk/install/byo?agent_id="+agentID,
		strings.NewReader(`{}`))
	if err != nil {
		t.Fatalf("build member DingTalk install request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+memberToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Workspace-ID", testWorkspaceID)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("member DingTalk install request failed: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest && resp.StatusCode != http.StatusForbidden {
		t.Fatalf("agent-owner DingTalk install status = %d, want 400 or 403", resp.StatusCode)
	}
	if _, err := testPool.Exec(context.Background(), `
UPDATE agent SET owner_id = $2 WHERE id = $1
`, agentID, originalOwnerID); err != nil {
		t.Fatalf("restore fixture Agent owner: %v", err)
	}

	var originalPermissionMode, originalVisibility string
	if err := testPool.QueryRow(context.Background(), `
SELECT permission_mode, visibility FROM agent WHERE id = $1
`, agentID).Scan(&originalPermissionMode, &originalVisibility); err != nil {
		t.Fatalf("load fixture Agent access mode: %v", err)
	}
	if _, err := testPool.Exec(context.Background(), `
UPDATE agent SET permission_mode = 'public_to', visibility = 'workspace' WHERE id = $1
`, agentID); err != nil {
		t.Fatalf("make fixture Agent public_to: %v", err)
	}
	targetInsert, err := testPool.Exec(context.Background(), `
INSERT INTO agent_invocation_target (agent_id, target_type, target_id)
VALUES ($1, 'workspace', $2)
ON CONFLICT (agent_id, target_type, target_id) DO NOTHING
`, agentID, testWorkspaceID)
	if err != nil {
		t.Fatalf("make fixture agent workspace-visible: %v", err)
	}
	insertedTarget := targetInsert.RowsAffected() == 1
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `
UPDATE agent SET permission_mode = $2, visibility = $3 WHERE id = $1
`, agentID, originalPermissionMode, originalVisibility)
		if !insertedTarget {
			return
		}
		_, _ = testPool.Exec(context.Background(), `
DELETE FROM agent_invocation_target WHERE agent_id = $1 AND target_type = 'workspace' AND target_id = $2
`, agentID, testWorkspaceID)
	})
	req, err = http.NewRequest(http.MethodGet, testServer.URL+"/api/agents/"+agentID+"/dingtalk/groups", nil)
	if err != nil {
		t.Fatalf("build member Agent request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+memberToken)
	req.Header.Set("X-Workspace-ID", testWorkspaceID)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("member Agent request failed: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("member visible-Agent DingTalk groups status = %d, want 200", resp.StatusCode)
	}

	var runtimeID, privateAgentID string
	if err := testPool.QueryRow(context.Background(), `
SELECT runtime_id FROM agent WHERE id = $1
`, agentID).Scan(&runtimeID); err != nil {
		t.Fatalf("load fixture runtime: %v", err)
	}
	if err := testPool.QueryRow(context.Background(), `
INSERT INTO agent (
  workspace_id, name, description, runtime_mode, runtime_config, runtime_id,
  visibility, permission_mode, max_concurrent_tasks, owner_id
) VALUES ($1, 'DingTalk private groups fixture', '', 'cloud', '{}'::jsonb, $2,
          'private', 'private', 1, $3)
RETURNING id
`, testWorkspaceID, runtimeID, testUserID).Scan(&privateAgentID); err != nil {
		t.Fatalf("create private Agent: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM agent WHERE id = $1`, privateAgentID)
	})
	req, err = http.NewRequest(http.MethodGet, testServer.URL+"/api/agents/"+privateAgentID+"/dingtalk/groups", nil)
	if err != nil {
		t.Fatalf("build private Agent request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+memberToken)
	req.Header.Set("X-Workspace-ID", testWorkspaceID)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("private Agent request failed: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("member private-Agent DingTalk groups status = %d, want 403", resp.StatusCode)
	}

	const outsideWorkspaceID = "d1474000-0000-4000-8000-000000000001"
	resp = authRequest(t, http.MethodGet, "/api/workspaces/"+outsideWorkspaceID+"/dingtalk/groups", nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("non-member DingTalk groups status = %d, want 404", resp.StatusCode)
	}
}

// ---- Inbox through full router ----

func TestInboxThroughRouter(t *testing.T) {
	resp := authRequest(t, "GET", "/api/inbox", nil)
	if resp.StatusCode != 200 {
		t.Fatalf("ListInbox: expected 200, got %d", resp.StatusCode)
	}
	var items []map[string]any
	readJSON(t, resp, &items)
	// Inbox may be empty, just verify it returns valid JSON array
	if items == nil {
		t.Fatal("expected non-nil inbox items array")
	}
}

func TestInboxUnreadSummaryThroughRouter(t *testing.T) {
	ctx := context.Background()

	// Seed one unread inbox item for the test user in the test workspace.
	var itemID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO inbox_item (workspace_id, recipient_type, recipient_id, type, title)
		VALUES ($1, 'member', $2, 'autopilot_paused', 'Summary fixture')
		RETURNING id
	`, testWorkspaceID, testUserID).Scan(&itemID); err != nil {
		t.Fatalf("failed to seed inbox item: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM inbox_item WHERE id = $1`, itemID)
	})

	resp := authRequest(t, "GET", "/api/inbox/unread-summary", nil)
	if resp.StatusCode != 200 {
		t.Fatalf("UnreadInboxSummary: expected 200, got %d", resp.StatusCode)
	}
	var summary []struct {
		WorkspaceID string `json:"workspace_id"`
		Count       int64  `json:"count"`
	}
	readJSON(t, resp, &summary)

	var found bool
	for _, s := range summary {
		if s.WorkspaceID == testWorkspaceID {
			found = true
			if s.Count < 1 {
				t.Fatalf("expected unread count >= 1 for test workspace, got %d", s.Count)
			}
		}
	}
	if !found {
		t.Fatalf("expected test workspace %s in unread summary, got %+v", testWorkspaceID, summary)
	}

	// After marking it read, the workspace should drop out of the summary.
	if _, err := testPool.Exec(ctx, `UPDATE inbox_item SET read = true WHERE id = $1`, itemID); err != nil {
		t.Fatalf("failed to mark item read: %v", err)
	}
	resp = authRequest(t, "GET", "/api/inbox/unread-summary", nil)
	if resp.StatusCode != 200 {
		t.Fatalf("UnreadInboxSummary (after read): expected 200, got %d", resp.StatusCode)
	}
	readJSON(t, resp, &summary)
	for _, s := range summary {
		if s.WorkspaceID == testWorkspaceID && s.Count > 0 {
			t.Fatalf("expected no unread for test workspace after read, got count %d", s.Count)
		}
	}
}

// ---- Archived inbox (MUL-3736) ----

type inboxItemJSON struct {
	ID       string  `json:"id"`
	IssueID  *string `json:"issue_id"`
	Title    string  `json:"title"`
	Read     bool    `json:"read"`
	Archived bool    `json:"archived"`
}

func listArchivedInbox(t *testing.T) []inboxItemJSON {
	t.Helper()
	resp := authRequest(t, "GET", "/api/inbox/archived", nil)
	if resp.StatusCode != 200 {
		t.Fatalf("ListArchivedInbox: expected 200, got %d", resp.StatusCode)
	}
	var items []inboxItemJSON
	readJSON(t, resp, &items)
	if items == nil {
		t.Fatal("expected non-nil archived items array")
	}
	return items
}

// The read/unread endpoints resolve the item within the caller's workspace and
// recipient scope, so someone else's notification is not addressable.
func TestMarkInboxUnreadRejectsForeignItem(t *testing.T) {
	ctx := context.Background()
	var foreignItemID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO inbox_item (workspace_id, recipient_type, recipient_id, type, title, read)
		VALUES ($1, 'member', gen_random_uuid(), 'autopilot_paused', 'someone else', true)
		RETURNING id
	`, testWorkspaceID).Scan(&foreignItemID); err != nil {
		t.Fatalf("failed to seed foreign inbox item: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM inbox_item WHERE id = $1`, foreignItemID)
	})

	resp := authRequest(t, "POST", "/api/inbox/"+foreignItemID+"/unread", nil)
	if resp.StatusCode == 200 {
		t.Fatal("expected mark-unread of another recipient's item to be rejected")
	}

	var read bool
	if err := testPool.QueryRow(ctx,
		`SELECT read FROM inbox_item WHERE id = $1`, foreignItemID).Scan(&read); err != nil {
		t.Fatalf("failed to read back foreign item: %v", err)
	}
	if !read {
		t.Fatal("another recipient's item must stay read")
	}
}

func TestUnarchiveInboxRejectsForeignItem(t *testing.T) {
	ctx := context.Background()
	var foreignItemID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO inbox_item (workspace_id, recipient_type, recipient_id, type, title, archived)
		VALUES ($1, 'member', gen_random_uuid(), 'autopilot_paused', 'someone else', true)
		RETURNING id
	`, testWorkspaceID).Scan(&foreignItemID); err != nil {
		t.Fatalf("failed to seed foreign inbox item: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM inbox_item WHERE id = $1`, foreignItemID)
	})

	resp := authRequest(t, "POST", "/api/inbox/"+foreignItemID+"/unarchive", nil)
	if resp.StatusCode == 200 {
		t.Fatal("expected unarchive of another recipient's item to be rejected")
	}

	var archived bool
	if err := testPool.QueryRow(ctx,
		`SELECT archived FROM inbox_item WHERE id = $1`, foreignItemID).Scan(&archived); err != nil {
		t.Fatalf("failed to read back foreign item: %v", err)
	}
	if !archived {
		t.Fatal("another recipient's item must stay archived")
	}
}

// ---- 404 for non-existent resources ----

// ---- Invalid request bodies ----

// ---- WebSocket integration through full router ----

// readWSMessageOfType reads frames until one of the wanted type arrives. The
// activity listeners are wired like production, so an activity:created frame
// for the same write can land before or after the issue event itself.
func readWSMessageOfType(t *testing.T, conn *websocket.Conn, wantType string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		conn.SetReadDeadline(deadline)
		_, msg, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("WebSocket read error waiting for %s: %v", wantType, err)
		}
		var wsMsg map[string]any
		if err := json.Unmarshal(msg, &wsMsg); err != nil {
			t.Fatalf("failed to parse WebSocket message: %v", err)
		}
		if wsMsg["type"] == wantType {
			return wsMsg
		}
		if wsMsg["type"] != "activity:created" {
			t.Fatalf("expected type '%s', got '%s'", wantType, wsMsg["type"])
		}
	}
}

func seedRouterInboxNotice(t *testing.T, title string, read, archived bool) string {
	t.Helper()
	fx := testutil.New(testPool, testWorkspaceID, testUserID)
	return fx.Insert(t, "inbox_item", testutil.Cols{"workspace_id": testWorkspaceID, "recipient_type": "member", "recipient_id": testUserID, "actor_type": "system", "type": "autopilot_paused", "title": title, "read": read, "archived": archived})
}
func TestArchivedInboxThroughRouter(t *testing.T) {
	id := seedRouterInboxNotice(t, "archived one", false, true)
	for _, item := range listArchivedInbox(t) {
		if item.ID == id {
			if !item.Archived {
				t.Fatal("archive returned active notice")
			}
			return
		}
	}
	t.Fatal("archived notice missing")
}
func TestUnarchiveInboxPreservesUnread(t *testing.T) {
	id := seedRouterInboxNotice(t, "restore unread", false, true)
	sibling := seedRouterInboxNotice(t, "other hour", true, true)
	resp := authRequest(t, "POST", "/api/inbox/"+id+"/unarchive", nil)
	if resp.StatusCode != 200 {
		t.Fatalf("unarchive status %d", resp.StatusCode)
	}
	var row inboxItemJSON
	readJSON(t, resp, &row)
	if row.Read || row.Archived {
		t.Fatalf("restore changed read state: %+v", row)
	}
	var read, archived bool
	if err := testPool.QueryRow(context.Background(), "SELECT read,archived FROM inbox_item WHERE id=$1", sibling).Scan(&read, &archived); err != nil {
		t.Fatal(err)
	}
	if !read || !archived {
		t.Fatal("restore changed another notice")
	}
	resp = authRequest(t, "GET", "/api/inbox/unread-count", nil)
	var count struct {
		Count int64 `json:"count"`
	}
	readJSON(t, resp, &count)
	if count.Count < 1 {
		t.Fatal("restored unread notice missing from badge")
	}
}
func TestMarkInboxUnreadIsItemScoped(t *testing.T) {
	id := seedRouterInboxNotice(t, "mark unread", true, false)
	sibling := seedRouterInboxNotice(t, "other notice", true, false)
	resp := authRequest(t, "POST", "/api/inbox/"+id+"/unread", nil)
	if resp.StatusCode != 200 {
		t.Fatalf("mark unread status %d", resp.StatusCode)
	}
	var row inboxItemJSON
	readJSON(t, resp, &row)
	if row.Read || row.Archived {
		t.Fatalf("incorrect unread response: %+v", row)
	}
	var read bool
	if err := testPool.QueryRow(context.Background(), "SELECT read FROM inbox_item WHERE id=$1", sibling).Scan(&read); err != nil {
		t.Fatal(err)
	}
	if !read {
		t.Fatal("mark unread changed another notice")
	}
}

func TestMain(m *testing.M) {
	ctx := context.Background()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://auro:auro@localhost:5432/auro?sslmode=disable"
	}

	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		fmt.Printf("Skipping integration tests: could not connect to database: %v\n", err)
		os.Exit(0)
	}
	if err := pool.Ping(ctx); err != nil {
		fmt.Printf("Skipping integration tests: database not reachable: %v\n", err)
		pool.Close()
		os.Exit(0)
	}

	testPool = pool
	testUserID, testWorkspaceID, err = setupIntegrationTestFixture(ctx, pool)
	if err != nil {
		fmt.Printf("Failed to set up integration test fixture: %v\n", err)
		pool.Close()
		os.Exit(1)
	}

	hub := realtime.NewHub()
	go hub.Run()

	bus := events.New()
	registerListeners(bus, hub)
	// Same wiring as main.go: HTTP writes through the test server log activity.
	router := NewRouter(pool, hub, bus, analytics.NoopClient{}, nil)
	testServer = httptest.NewServer(router)

	// Generate a JWT token directly for the test user
	testToken, err = generateTestJWT(testUserID, integrationTestEmail, integrationTestName)
	if err != nil {
		fmt.Printf("Failed to generate test JWT: %v\n", err)
		testServer.Close()
		pool.Close()
		os.Exit(1)
	}

	code := m.Run()

	if err := cleanupIntegrationTestFixture(context.Background(), pool); err != nil {
		fmt.Printf("Failed to clean up integration test fixture: %v\n", err)
		if code == 0 {
			code = 1
		}
	}
	testServer.Close()
	pool.Close()
	os.Exit(code)
}
