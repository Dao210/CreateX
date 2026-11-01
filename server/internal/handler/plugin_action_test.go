package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	publicapiv1 "github.com/auro-ai/auro/server/pkg/publicapi/v1"
	"github.com/go-chi/chi/v5"
)

// These are the Action API's security properties, not its happy path. Each one
// is a way a plugin could exceed what the person using it can do, and none of
// them is visible by reading the handler — they only hold if the three checks
// run in the right order against the right inputs.

// installPluginForAction installs the reference plugin and returns its id,
// leaving the caller free to vary scopes.
func installPluginForAction(t *testing.T, scopes []string) string {
	t.Helper()
	withPluginsV1Flag(t, testHandler, true)
	cleanupPluginInstallations(t)

	manifest := handlerTestManifest
	if scopes != nil {
		encoded, err := json.Marshal(scopes)
		if err != nil {
			t.Fatalf("encode scopes: %v", err)
		}
		manifest = strings.Replace(manifest,
			`"scopes": ["issues:read", "comments:write", "storage:user"]`,
			`"scopes": `+string(encoded), 1)
	}
	versionID := withLocalPluginSource(t, manifest)

	body, _ := json.Marshal(map[string]any{"version_id": versionID, "granted_scopes": scopes})
	recorder := httptest.NewRecorder()
	testHandler.InstallPlugin(recorder, pluginHandlerRequest(http.MethodPost, "/plugins", body, map[string]string{"id": testWorkspaceID}))
	if recorder.Code != http.StatusCreated {
		t.Fatalf("install status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var installed struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &installed); err != nil {
		t.Fatalf("decode installation: %v", err)
	}
	return installed.ID
}

func pluginActionRequest(method, path, installationID string, body any, params map[string]string) *http.Request {
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	request := httptest.NewRequest(method, path, &buf)
	request.Header.Set("X-User-ID", testUserID)
	request.Header.Set("Content-Type", "application/json")
	if installationID != "" {
		request.Header.Set(pluginInstallationHeader, installationID)
	}
	routeContext := chi.NewRouteContext()
	for key, value := range params {
		routeContext.URLParams.Add(key, value)
	}
	return request.WithContext(context.WithValue(request.Context(), chi.RouteCtxKey, routeContext))
}

func pluginInstallTokenRequest(method, path, token string, body any, params map[string]string) *http.Request {
	request := pluginActionRequest(method, path, "", body, params)
	request.Header.Del("X-User-ID")
	request.Header.Set("Authorization", "Bearer "+token)
	return request
}

func TestPluginActionRequiresTheFeatureFlag(t *testing.T) {
	withPluginsV1Flag(t, testHandler, false)
	recorder := httptest.NewRecorder()

	testHandler.GetPluginContext(recorder, pluginInstallTokenRequest(http.MethodGet, "/v1/context", "mpi_invalid", nil, nil))

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%s, want 403", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("Retry-After"); got != "" {
		t.Fatalf("Retry-After=%q, want empty for a non-retryable feature gate", got)
	}
	var problem publicapiv1.Problem
	if err := json.Unmarshal(recorder.Body.Bytes(), &problem); err != nil {
		t.Fatalf("decode feature flag problem: %v", err)
	}
	if problem.Status != http.StatusForbidden || problem.Code != "plugin_api_disabled" || problem.Title != "Forbidden" {
		t.Fatalf("unexpected feature flag problem: %+v", problem)
	}
}

func TestPluginInstallTokenEnforcesGrantedScope(t *testing.T) {
	installationID := installPluginForAction(t, []string{"issues:read"})
	token, err := testHandler.PluginService.IssueInstallToken(context.Background(), parseUUID(installationID))
	if err != nil {
		t.Fatalf("issue install token: %v", err)
	}
	issueID := createTestIssue(t, "Install token scope", "todo", "none")

	request := pluginInstallTokenRequest(http.MethodPatch, "/v1/issues/"+issueID, token,
		map[string]any{"title": "must not update"}, map[string]string{"issue_ref": issueID})
	response := httptest.NewRecorder()
	testHandler.PatchPluginIssue(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("ungranted install-token patch status=%d body=%s", response.Code, response.Body.String())
	}
	var problem publicapiv1.Problem
	if err := json.Unmarshal(response.Body.Bytes(), &problem); err != nil {
		t.Fatalf("decode scope problem: %v", err)
	}
	if problem.Code != "forbidden" || !strings.Contains(problem.Detail, "issues:write") {
		t.Fatalf("unexpected scope problem: %+v", problem)
	}
}

func TestPluginActionRequiresAGrantedScope(t *testing.T) {
	// Installed with issues:read only. Everything else must be refused, and the
	// refusal must name the missing scope so an admin can act on it.
	installationID := installPluginForAction(t, []string{"issues:read"})
	issueID := createTestIssue(t, "Plugin action scope test", "todo", "none")

	recorder := httptest.NewRecorder()
	testHandler.GetPluginIssue(recorder, pluginActionRequest(http.MethodGet, "/issues", installationID, nil,
		map[string]string{"issue_ref": issueID}))
	if recorder.Code != http.StatusOK {
		t.Fatalf("granted scope was refused: status=%d body=%s", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	testHandler.CreatePluginComment(recorder, pluginActionRequest(http.MethodPost, "/comments", installationID,
		map[string]any{"content": "hello"}, map[string]string{"issue_ref": issueID}))
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("ungranted scope status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "comments:write") {
		t.Fatalf("refusal does not name the missing scope: %s", recorder.Body.String())
	}
	var problem publicapiv1.Problem
	if err := json.Unmarshal(recorder.Body.Bytes(), &problem); err != nil {
		t.Fatalf("decode stable problem: %v", err)
	}
	if problem.Code != "forbidden" || problem.Error == "" || problem.RequestID == "" {
		t.Fatalf("unexpected stable problem: %+v", problem)
	}
}

func TestPluginActionRefusedWithoutAnInstallation(t *testing.T) {
	installPluginForAction(t, []string{"issues:read"})
	issueID := createTestIssue(t, "Plugin action installation test", "todo", "none")

	// No header at all: the endpoint must not fall back to "any installed
	// plugin" or to an unscoped call.
	recorder := httptest.NewRecorder()
	testHandler.GetPluginIssue(recorder, pluginActionRequest(http.MethodGet, "/issues", "", nil,
		map[string]string{"issue_ref": issueID}))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("missing installation header status=%d body=%s", recorder.Code, recorder.Body.String())
	}

	// An installation id that does not exist is a 404, never a pass-through.
	recorder = httptest.NewRecorder()
	testHandler.GetPluginIssue(recorder, pluginActionRequest(http.MethodGet, "/issues",
		"11111111-1111-1111-1111-111111111111", nil, map[string]string{"issue_ref": issueID}))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("unknown installation status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestPluginActionStopsWhenTheInstallationIsDisabled(t *testing.T) {
	installationID := installPluginForAction(t, []string{"issues:read"})
	issueID := createTestIssue(t, "Plugin action disable test", "todo", "none")

	recorder := httptest.NewRecorder()
	testHandler.DisablePlugin(recorder, pluginHandlerRequest(http.MethodPost, "/plugins/disable", nil,
		map[string]string{"id": testWorkspaceID, "installationId": installationID}))
	if recorder.Code != http.StatusOK {
		t.Fatalf("disable status=%d body=%s", recorder.Code, recorder.Body.String())
	}

	// A surface left open in a stale tab keeps its bridge; disabling has to cut
	// it off server-side or "disabled" only means "hidden".
	recorder = httptest.NewRecorder()
	testHandler.GetPluginIssue(recorder, pluginActionRequest(http.MethodGet, "/issues", installationID, nil,
		map[string]string{"issue_ref": issueID}))
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("disabled installation status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}
