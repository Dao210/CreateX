package handler

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/auro-ai/auro/server/internal/util/secretbox"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func withVCSBox(t *testing.T) *secretbox.Box {
	t.Helper()
	box, err := secretbox.New(bytes.Repeat([]byte("k"), 32))
	if err != nil {
		t.Fatalf("secretbox.New: %v", err)
	}
	prev := testHandler.VCSSecretBox
	testHandler.VCSSecretBox = box
	// The feature also requires the deployment-level switch; the box alone is
	// no longer sufficient. Enable it for the "configured" path tests.
	prevEnabled := testHandler.cfg.VCSIntegrationEnabled
	testHandler.cfg.VCSIntegrationEnabled = true
	t.Cleanup(func() {
		testHandler.VCSSecretBox = prev
		testHandler.cfg.VCSIntegrationEnabled = prevEnabled
	})
	return box
}

const vcsTestSecret = "vcs-webhook-secret"

func seedVCSConnection(t *testing.T, ctx context.Context, box *secretbox.Box, provider, instanceURL string) string {
	t.Helper()
	sealed, err := box.Seal([]byte(vcsTestSecret))
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	tokenSealed, _ := box.Seal([]byte("tok"))
	conn, err := testHandler.Queries.UpsertVCSConnection(ctx, db.UpsertVCSConnectionParams{
		WorkspaceID:            parseUUID(testWorkspaceID),
		Provider:               provider,
		InstanceUrl:            instanceURL,
		AccountLogin:           "acme",
		AccessTokenEncrypted:   base64.StdEncoding.EncodeToString(tokenSealed),
		WebhookSecretEncrypted: base64.StdEncoding.EncodeToString(sealed),
		ConnectedByID:          pgtype.UUID{},
	})
	if err != nil {
		t.Fatalf("UpsertVCSConnection: %v", err)
	}
	return uuidToString(conn.ID)
}

func vcsWebhookReq(connID string, headers map[string]string, raw []byte) *http.Request {
	req := httptest.NewRequest("POST", "/api/webhooks/vcs/"+connID, bytes.NewReader(raw))
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("connectionId", connID)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func giteaSig(raw []byte) string {
	mac := hmac.New(sha256.New, []byte(vcsTestSecret))
	mac.Write(raw)
	return hex.EncodeToString(mac.Sum(nil))
}

func TestVCSWebhook_BadSignature(t *testing.T) {
	ctx := context.Background()
	box := withVCSBox(t)
	connID := seedVCSConnection(t, ctx, box, "forgejo", "https://forgejo.test")
	t.Cleanup(func() { cleanupVCS(ctx, "") })

	raw := []byte(`{"action":"opened","pull_request":{"number":1}}`)
	w := httptest.NewRecorder()
	testHandler.HandleVCSWebhook(w, vcsWebhookReq(connID, map[string]string{
		"X-Gitea-Event": "pull_request", "X-Gitea-Signature": "00",
	}, raw))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestVCSWebhook_UnknownConnection(t *testing.T) {
	withVCSBox(t)
	req := vcsWebhookReq("00000000-0000-0000-0000-000000000000", map[string]string{
		"X-Gitea-Event": "pull_request", "X-Gitea-Signature": "00",
	}, []byte(`{}`))
	w := httptest.NewRecorder()
	testHandler.HandleVCSWebhook(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// TestVCSWebhook_DisabledDeploymentReturns404 verifies the deployment-level
// switch is enforced server-side: with the integration off (the managed-cloud
// posture), even a valid, correctly-signed delivery to a real connection is
// rejected with a bare 404, so the feature is never processed and reveals
// nothing about config. The availability gate short-circuits before signature
// verification.
func TestVCSWebhook_DisabledDeploymentReturns404(t *testing.T) {
	ctx := context.Background()
	box := withVCSBox(t) // sets the box AND enables the switch
	connID := seedVCSConnection(t, ctx, box, "forgejo", "https://forgejo.test")
	t.Cleanup(func() { cleanupVCS(ctx, "") })

	// Now flip the deployment switch off (withVCSBox's cleanup restores it).
	testHandler.cfg.VCSIntegrationEnabled = false

	raw := []byte(`{"action":"opened","pull_request":{"number":1}}`)
	w := httptest.NewRecorder()
	testHandler.HandleVCSWebhook(w, vcsWebhookReq(connID, map[string]string{
		"X-Gitea-Event": "pull_request", "X-Gitea-Signature": giteaSig(raw),
	}, raw))
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when integration disabled, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestVCSWebhook_UnconfiguredDeploymentReturns404(t *testing.T) {
	h := &Handler{cfg: Config{VCSIntegrationEnabled: true}}
	w := httptest.NewRecorder()
	h.HandleVCSWebhook(w, vcsWebhookReq("00000000-0000-0000-0000-000000000000", nil, []byte(`{}`)))

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when integration is unconfigured, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestVCSWebhook_MalformedTolerated(t *testing.T) {
	ctx := context.Background()
	box := withVCSBox(t)
	connID := seedVCSConnection(t, ctx, box, "forgejo", "https://forgejo.test")
	t.Cleanup(func() { cleanupVCS(ctx, "") })

	raw := []byte(`{"action":"opened","pull_request":"not-an-object"}`)
	w := httptest.NewRecorder()
	testHandler.HandleVCSWebhook(w, vcsWebhookReq(connID, map[string]string{
		"X-Gitea-Event": "pull_request", "X-Gitea-Signature": giteaSig(raw),
	}, raw))
	if w.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d (%s)", w.Code, w.Body.String())
	}
	var count int
	testPool.QueryRow(ctx, `SELECT count(*) FROM vcs_pull_request WHERE workspace_id = $1`, testWorkspaceID).Scan(&count)
	if count != 0 {
		t.Errorf("expected no PR rows, got %d", count)
	}
}

func cleanupVCS(ctx context.Context, issueID string) {
	testPool.Exec(ctx, `DELETE FROM issue_vcs_pull_request WHERE issue_id = $1`, issueID)
	testPool.Exec(ctx, `DELETE FROM vcs_commit_status cs USING vcs_connection c WHERE cs.connection_id = c.id AND c.workspace_id = $1`, testWorkspaceID)
	testPool.Exec(ctx, `DELETE FROM vcs_pull_request WHERE workspace_id = $1`, testWorkspaceID)
	testPool.Exec(ctx, `DELETE FROM vcs_connection WHERE workspace_id = $1`, testWorkspaceID)
	if issueID != "" {
		testPool.Exec(ctx, `DELETE FROM activity_log WHERE issue_id = $1`, issueID)
		testPool.Exec(ctx, `DELETE FROM issue WHERE id = $1`, issueID)
	}
}
