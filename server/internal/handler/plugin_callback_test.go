package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/auro-ai/auro/server/internal/service"
	"github.com/go-chi/chi/v5"
)

// The identity model, exercised through the path that actually decides it.
//
// A hook handler calls back with a token, and the token — not the request body,
// not a header — says who the resulting writes belong to. This is the whole
// reason the callback token exists instead of handing a plugin's server the
// install token and trusting it to say who it is acting for.

func callbackRequest(token, method, path string, body any, params map[string]string) *http.Request {
	var payload []byte
	if body != nil {
		payload, _ = json.Marshal(body)
	}
	request := httptest.NewRequest(method, path, bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	// No X-User-ID: a plugin's own server has no session. The token is the
	// entire credential, which is what these tests are about.
	request.Header.Set("Authorization", "Bearer "+token)
	routeContext := chi.NewRouteContext()
	for key, value := range params {
		routeContext.URLParams.Add(key, value)
	}
	return request.WithContext(context.WithValue(request.Context(), chi.RouteCtxKey, routeContext))
}

func withCallbackTokens(t *testing.T) {
	t.Helper()
	previous := testHandler.PluginService.Callbacks
	testHandler.PluginService.Callbacks = service.NewCallbackTokens()
	t.Cleanup(func() { testHandler.PluginService.Callbacks = previous })
}

// storage:user is per-member state. A caller with no member has no such scope
// to resolve, and falling through would key every plugin-actor write to the
// zero UUID — one shared bucket masquerading as somebody's private one.
func TestPluginActorCannotReachUserStorage(t *testing.T) {
	withPluginsV1Flag(t, testHandler, true)
	cleanupPluginInstallations(t)
	withCallbackTokens(t)
	installationID := installPluginForAction(t, []string{"storage:user"})

	token := hookCallbackToken(t, installationID, service.HookActor{Type: "plugin", ID: parseUUID(installationID)})
	recorder := httptest.NewRecorder()
	testHandler.PutPluginStorage(recorder, callbackRequest(token, http.MethodPut,
		"/v1/storage/user/pref",
		map[string]any{"value": "x"},
		map[string]string{"scope": "user", "key": "pref"}))
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%s, want 403", recorder.Code, recorder.Body.String())
	}
}

// /context has no scope requirement, but it must not invent a user for a caller
// that has none — a handler reading `user` would believe it is acting for
// somebody.
func TestPluginContextOmitsTheUserForAPluginActor(t *testing.T) {
	withPluginsV1Flag(t, testHandler, true)
	cleanupPluginInstallations(t)
	withCallbackTokens(t)
	installationID := installHookPlugin(t)

	token := hookCallbackToken(t, installationID, service.HookActor{Type: "plugin", ID: parseUUID(installationID)})
	recorder := httptest.NewRecorder()
	testHandler.GetPluginContext(recorder, callbackRequest(token, http.MethodGet, "/v1/context", nil, nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode context: %v", err)
	}
	if _, present := payload["user"]; present {
		t.Fatalf("context carried a user for a plugin actor: %s", recorder.Body.String())
	}
	if payload["actor"] != "plugin" {
		t.Fatalf("actor = %v, want plugin", payload["actor"])
	}
}

func hookCallbackToken(t *testing.T, installationID string, actor service.HookActor) string {
	t.Helper()
	inst, err := testHandler.Queries.GetPluginInstallation(context.Background(), parseUUID(installationID))
	if err != nil {
		t.Fatal(err)
	}
	token, err := testHandler.PluginService.Callbacks.Issue(context.Background(), service.HookInvocation{Installation: inst, Actor: actor, Trigger: "manual"})
	if err != nil {
		t.Fatal(err)
	}
	return token
}
func TestCallbackTokenServesWholeStorageInvocation(t *testing.T) {
	withPluginsV1Flag(t, testHandler, true)
	withCallbackTokens(t)
	installationID := installPluginForAction(t, []string{"storage:user"})
	token := hookCallbackToken(t, installationID, service.HookActor{Type: "member", ID: parseUUID(testUserID)})
	params := map[string]string{"scope": "user", "key": "pref"}
	first := httptest.NewRecorder()
	testHandler.PutPluginStorage(first, callbackRequest(token, http.MethodPut, "/v1/storage/user/pref", map[string]any{"value": "saved"}, params))
	if first.Code != http.StatusNoContent {
		t.Fatalf("write: %d %s", first.Code, first.Body.String())
	}
	second := httptest.NewRecorder()
	testHandler.GetPluginStorage(second, callbackRequest(token, http.MethodGet, "/v1/storage/user/pref", nil, params))
	if second.Code != http.StatusOK {
		t.Fatalf("read: %d %s", second.Code, second.Body.String())
	}
	testHandler.PluginService.Callbacks.Revoke(token)
	third := httptest.NewRecorder()
	testHandler.GetPluginStorage(third, callbackRequest(token, http.MethodGet, "/v1/storage/user/pref", nil, params))
	if third.Code != http.StatusForbidden {
		t.Fatalf("revoked: %d %s", third.Code, third.Body.String())
	}
}
