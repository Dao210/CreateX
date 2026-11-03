package handler

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/auro-ai/auro/server/internal/events"
	"github.com/auro-ai/auro/server/internal/middleware"
	"github.com/auro-ai/auro/server/internal/testutil"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/auro-ai/auro/server/pkg/protocol"
	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestExtractIdentifiers(t *testing.T) {
	cases := []struct {
		name string
		in   []string
		want []string
	}{
		{
			name: "branch_name",
			in:   []string{"", "", "mul-1510/fix-login"},
			want: []string{"MUL-1510"},
		},
		{
			name: "single_character_prefix",
			in:   []string{"H-412: fix widget parity"},
			want: []string{"H-412"},
		},
		{
			name: "title_and_body",
			in:   []string{"Fix MUL-82", "Closes MUL-1510 and ABC-7", ""},
			want: []string{"MUL-82", "MUL-1510", "ABC-7"},
		},
		{
			name: "dedupe_across_fields",
			in:   []string{"MUL-1", "MUL-1 again", "mul-1/branch"},
			want: []string{"MUL-1"},
		},
		{
			name: "ignore_email_and_versions",
			in:   []string{"reply@user-1 v1.2-3 here", "", ""},
			// Word-boundary regex still matches "user-1"; identifier prefix is
			// any 2..10 letters/digits, so this is intentional. The downstream
			// workspace prefix check in lookupIssueByIdentifier filters it.
			want: []string{"USER-1"},
		},
		{
			name: "no_match",
			in:   []string{"plain text", "no idents", ""},
			want: []string{},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := extractIdentifiers(tc.in...)
			if len(got) == 0 && len(tc.want) == 0 {
				return
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("extractIdentifiers() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestExtractClosingIdentifiers(t *testing.T) {
	cases := []struct {
		name string
		in   []string
		want []string
	}{
		{
			name: "single_closes",
			in:   []string{"", "Closes MUL-1"},
			want: []string{"MUL-1"},
		},
		{
			name: "single_character_prefix",
			in:   []string{"", "Closes H-412"},
			want: []string{"H-412"},
		},
		{
			name: "all_keyword_inflections",
			in: []string{
				"",
				"close MUL-1\nclosed MUL-2\ncloses MUL-3\nfix MUL-4\nfixes MUL-5\nfixed MUL-6\nresolve MUL-7\nresolves MUL-8\nresolved MUL-9",
			},
			want: []string{"MUL-1", "MUL-2", "MUL-3", "MUL-4", "MUL-5", "MUL-6", "MUL-7", "MUL-8", "MUL-9"},
		},
		{
			name: "case_insensitive_and_colon",
			in:   []string{"CLOSES: MUL-1", "Fixes:MUL-2 resolves   MUL-3"},
			want: []string{"MUL-1", "MUL-2", "MUL-3"},
		},
		{
			name: "bare_reference_does_not_close",
			// The bug-report repro: only ABC-1 carries closing intent.
			// ABC-2/ABC-3 are linked (extractIdentifiers) but must not
			// appear in the closing set.
			in:   []string{"ABC-1: Lorem Ipsum", "Closes ABC-1. Follow up work planned in ABC-2. Unblocks ABC-3."},
			want: []string{"ABC-1"},
		},
		{
			name: "keyword_not_adjacent_does_not_close",
			// "Fix login MUL-1" — keyword present but the identifier is
			// not adjacent. Consistent with GitHub's closing-keyword
			// grammar; matches via extractIdentifiers for linking only.
			in:   []string{"Fix login MUL-1", ""},
			want: []string{},
		},
		{
			name: "dedupe_across_fields",
			in:   []string{"Closes MUL-1", "fixes mul-1"},
			want: []string{"MUL-1"},
		},
		{
			name: "no_match_on_disclosed_or_foreclose",
			// Word-boundary guards against keyword fragments embedded
			// in larger words ("Disclosed MUL-1", "Foreclose MUL-1").
			in:   []string{"Disclosed MUL-1 in foreclose MUL-2", ""},
			want: []string{},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := extractClosingIdentifiers(tc.in...)
			if len(got) == 0 && len(tc.want) == 0 {
				return
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("extractClosingIdentifiers() = %v, want %v", got, tc.want)
			}
		})
	}
}

// TestPRClaimedIdentifiers: the title and branch link, a closing keyword in the
// title or body links too, and a bare body mention claims nothing.
func TestPRClaimedIdentifiers(t *testing.T) {
	idents := prClaimedIdentifiers(
		"ABC-1: Lorem Ipsum",
		"Closes ABC-4. Follow up work planned in ABC-2.",
		"fix/abc-3-login",
	)
	if want := []string{"ABC-1", "ABC-3", "ABC-4"}; !reflect.DeepEqual(idents, want) {
		t.Errorf("idents = %v, want %v", idents, want)
	}
}

func TestDerivePRState(t *testing.T) {
	cases := []struct {
		state  string
		draft  bool
		merged bool
		want   string
	}{
		{"open", false, false, "open"},
		{"open", true, false, "draft"},
		{"closed", false, false, "closed"},
		{"closed", false, true, "merged"},
		{"closed", true, true, "merged"}, // merged trumps draft
	}
	for _, tc := range cases {
		got := derivePRState(tc.state, tc.draft, tc.merged)
		if got != tc.want {
			t.Errorf("derivePRState(%q, draft=%v, merged=%v) = %q, want %q",
				tc.state, tc.draft, tc.merged, got, tc.want)
		}
	}
}

func TestVerifyWebhookSignature(t *testing.T) {
	secret := "shared-secret"
	body := []byte(`{"action":"opened"}`)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	good := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	if !verifyWebhookSignature(secret, good, body) {
		t.Error("expected valid signature to verify")
	}
	if verifyWebhookSignature(secret, "sha256=deadbeef", body) {
		t.Error("expected bad hex to fail")
	}
	if verifyWebhookSignature(secret, "", body) {
		t.Error("expected empty header to fail")
	}
	if verifyWebhookSignature(secret, "sha1=whatever", body) {
		t.Error("expected non-sha256 prefix to fail")
	}
	if verifyWebhookSignature("other-secret", good, body) {
		t.Error("expected wrong secret to fail")
	}
}

func TestStateRoundTrip(t *testing.T) {
	t.Setenv("GITHUB_WEBHOOK_SECRET", "test-secret-123")
	wsID := "11111111-2222-3333-4444-555555555555"

	tok, err := signStateForReturn(wsID, githubReturnToRepositories)
	if err != nil {
		t.Fatalf("signState: %v", err)
	}
	if parts := strings.Split(tok, "."); len(parts) != 4 {
		t.Fatalf("default return state has %d parts, want legacy 3-part format", len(parts))
	}
	got, _, ok := verifyStateWithReturn(tok)
	if !ok {
		t.Fatal("verifyState rejected a freshly-signed token")
	}
	if got != wsID {
		t.Errorf("verifyState() = %q, want %q", got, wsID)
	}

	// Tampering with the workspace portion must fail (signature is bound
	// to it). Replace the leading UUID's first hex digit.
	tampered := "01111111" + tok[8:]
	if _, _, ok := verifyStateWithReturn(tampered); ok {
		t.Error("tampered state token should fail to verify")
	}

	// Wrong secret rejects.
	t.Setenv("GITHUB_WEBHOOK_SECRET", "different")
	if _, _, ok := verifyStateWithReturn(tok); ok {
		t.Error("token signed with old secret should fail under a new one")
	}
}

func TestStateRoundTripWithRepositoryReturnTarget(t *testing.T) {
	t.Setenv("GITHUB_WEBHOOK_SECRET", "test-secret-123")
	wsID := "11111111-2222-3333-4444-555555555555"

	tok, err := signStateForReturn(wsID, githubReturnToRepositories)
	if err != nil {
		t.Fatalf("signStateForReturn: %v", err)
	}
	if parts := strings.Split(tok, "."); len(parts) != 4 {
		t.Fatalf("repository return state has %d parts, want 4", len(parts))
	}
	gotWorkspaceID, gotReturnTo, ok := verifyStateWithReturn(tok)
	if !ok {
		t.Fatal("verifyStateWithReturn rejected a freshly-signed token")
	}
	if gotWorkspaceID != wsID || gotReturnTo != githubReturnToRepositories {
		t.Errorf(
			"verifyStateWithReturn() = (%q, %q), want (%q, %q)",
			gotWorkspaceID,
			gotReturnTo,
			wsID,
			githubReturnToRepositories,
		)
	}

	tampered := strings.Replace(tok, ".repositories.", ".github.", 1)
	if _, _, ok := verifyStateWithReturn(tampered); ok {
		t.Error("tampered return target should fail verification")
	}
}

func TestGitHubConnectRepositoryReturnTarget(t *testing.T) {
	t.Setenv("GITHUB_APP_SLUG", "auro-test")
	t.Setenv("GITHUB_WEBHOOK_SECRET", "test-secret-123")
	wsID := "11111111-2222-3333-4444-555555555555"

	req := httptest.NewRequest(
		http.MethodGet,
		"/api/workspaces/"+wsID+"/github/connect?return_to=repositories",
		nil,
	)
	req = withURLParam(req, "id", wsID)
	rec := httptest.NewRecorder()
	(&Handler{}).GitHubConnect(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GitHubConnect: got %d (%s)", rec.Code, rec.Body.String())
	}
	var body GitHubConnectResponse
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode connect response: %v", err)
	}
	installURL, err := url.Parse(body.URL)
	if err != nil {
		t.Fatalf("parse install URL: %v", err)
	}
	_, returnTo, ok := verifyStateWithReturn(installURL.Query().Get("state"))
	if !ok || returnTo != githubReturnToRepositories {
		t.Fatalf("signed return target = %q, valid=%v, want repositories", returnTo, ok)
	}

	badReq := httptest.NewRequest(
		http.MethodGet,
		"/api/workspaces/"+wsID+"/github/connect?return_to=https://evil.example",
		nil,
	)
	badReq = withURLParam(badReq, "id", wsID)
	badRec := httptest.NewRecorder()
	(&Handler{}).GitHubConnect(badRec, badReq)
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid return target: got %d, want 400", badRec.Code)
	}
}

func TestGitHubSetupCallbackRepositoryReturnTarget(t *testing.T) {
	t.Setenv("GITHUB_WEBHOOK_SECRET", "test-secret-123")
	t.Setenv("FRONTEND_ORIGIN", "https://app.auro.test/")
	wsID := "11111111-2222-3333-4444-555555555555"
	state, err := signStateForReturn(wsID, githubReturnToRepositories)
	if err != nil {
		t.Fatalf("signStateForReturn: %v", err)
	}

	req := httptest.NewRequest(
		http.MethodGet,
		"/api/github/setup?installation_id=not-a-number&state="+url.QueryEscape(state),
		nil,
	)
	rec := httptest.NewRecorder()
	(&Handler{}).GitHubSetupCallback(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("GitHubSetupCallback: got %d, want 302", rec.Code)
	}
	if got := rec.Header().Get("Location"); got != "https://app.auro.test/settings?tab=repositories&github_error=bad_installation_id" {
		t.Fatalf("redirect = %q, want repository settings error", got)
	}
}

func TestSignStateRequiresSecret(t *testing.T) {
	t.Setenv("GITHUB_WEBHOOK_SECRET", "")
	if _, err := signStateForReturn("ws", githubReturnToRepositories); err == nil {
		t.Error("signState should error when secret is unset")
	}
}

// TestWebhook_UninstallReturnsWorkspaceForBroadcast guards #4: the uninstall
// path must look up the workspace_id BEFORE deleting the row so the
// resulting `github_installation:deleted` event is broadcast scoped to that
// workspace (the realtime listener drops events with empty workspace_id).
func TestWebhook_UninstallReturnsWorkspaceForBroadcast(t *testing.T) {
	if testHandler == nil {
		t.Skip("handler test fixture not initialized (no DB?)")
	}
	ctx := context.Background()
	const installationID int64 = 55443322

	if _, err := testHandler.Queries.CreateGitHubInstallation(ctx, db.CreateGitHubInstallationParams{
		WorkspaceID:    parseUUID(testWorkspaceID),
		InstallationID: installationID,
		AccountLogin:   "uninstall-test",
		AccountType:    "User",
	}); err != nil {
		t.Fatalf("CreateGitHubInstallation: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM github_installation WHERE workspace_id = $1`, testWorkspaceID)
	})

	deleted, err := testHandler.Queries.DeleteGitHubInstallationByInstallationID(ctx, installationID)
	if err != nil {
		t.Fatalf("DeleteGitHubInstallationByInstallationID: %v", err)
	}
	if len(deleted) != 1 {
		t.Fatalf("expected 1 deleted binding, got %d", len(deleted))
	}
	if uuidToString(deleted[0].WorkspaceID) != testWorkspaceID {
		t.Errorf("expected returned workspace_id %s, got %s", testWorkspaceID, uuidToString(deleted[0].WorkspaceID))
	}
	// Re-deleting must return no rows so the handler skips the broadcast
	// (and does not panic).
	if again, err := testHandler.Queries.DeleteGitHubInstallationByInstallationID(ctx, installationID); err != nil {
		t.Errorf("second delete errored: %v", err)
	} else if len(again) != 0 {
		t.Errorf("expected 0 rows on second delete, got %d", len(again))
	}
}

// fireBareWebhook is a focused helper for the closing-keyword gate tests
// below: it fires a single merged-PR webhook with caller-controlled title,
// body, and branch so each test can exercise a specific PR-grammar shape
// (bare identifier, mixed closing/non-closing references, branch-only
// reference) without re-typing the full webhook envelope each time.
func fireBareWebhook(t *testing.T, secret string, installationID int64, prNumber int32, title, body, branch string) {
	t.Helper()
	payload := map[string]any{
		"action": "closed",
		"pull_request": map[string]any{
			"number":     prNumber,
			"html_url":   fmt.Sprintf("https://github.com/acme/widget/pull/%d", prNumber),
			"title":      title,
			"body":       body,
			"state":      "closed",
			"draft":      false,
			"merged":     true,
			"merged_at":  "2026-04-29T00:00:00Z",
			"closed_at":  "2026-04-29T00:00:00Z",
			"created_at": "2026-04-28T00:00:00Z",
			"updated_at": "2026-04-29T00:00:00Z",
			"head":       map[string]any{"ref": branch},
			"user":       map[string]any{"login": "octocat"},
		},
		"repository":   map[string]any{"name": "widget", "owner": map[string]any{"login": "acme"}},
		"installation": map[string]any{"id": installationID},
	}
	raw, _ := json.Marshal(payload)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(raw)
	sig := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	req := httptest.NewRequest("POST", "/api/webhooks/github", bytes.NewReader(raw))
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-Hub-Signature-256", sig)
	rec := testutil.Call(t, testHandler.HandleGitHubWebhook, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("webhook pr=%d: expected 202, got %d (%s)", prNumber, rec.Code, rec.Body.String())
	}
}

// ── PR auto-complete (MUL-7429) ────────────────────────────────────────────
//
// The rule these tests pin: a PR links to an issue when its title or branch
// carries the identifier (or a member links it by hand); when every linked PR
// is merged, the issue moves to Done. Keywords have no special meaning and the
// body is not scanned. The decision runs only on a PR event for the issue.

// firePRWebhook fires a webhook for a single PR with caller-controlled
// title, body, branch, and lifecycle (open / edited / merged / closed without
// merge / edited after merge).
func firePRWebhook(t *testing.T, secret string, installationID int64, prNumber int32, title, body, branch, lifecycle string) {
	t.Helper()
	var action, state string
	var merged bool
	var mergedAt, closedAt any
	switch lifecycle {
	case "opened":
		action, state, merged = "opened", "open", false
		mergedAt, closedAt = nil, nil
	case "edited":
		action, state, merged = "edited", "open", false
		mergedAt, closedAt = nil, nil
	case "merged":
		action, state, merged = "closed", "closed", true
		mergedAt, closedAt = "2026-04-29T00:00:00Z", "2026-04-29T00:00:00Z"
	case "edited_merged":
		action, state, merged = "edited", "closed", true
		mergedAt, closedAt = "2026-04-29T00:00:00Z", "2026-04-29T00:00:00Z"
	case "closed":
		action, state, merged = "closed", "closed", false
		mergedAt, closedAt = nil, "2026-04-29T00:00:00Z"
	default:
		t.Fatalf("firePRWebhook: unknown lifecycle %q", lifecycle)
	}
	payload := map[string]any{
		"action": action,
		"pull_request": map[string]any{
			"number":     prNumber,
			"html_url":   fmt.Sprintf("https://github.com/acme/widget/pull/%d", prNumber),
			"title":      title,
			"body":       body,
			"state":      state,
			"draft":      false,
			"merged":     merged,
			"merged_at":  mergedAt,
			"closed_at":  closedAt,
			"created_at": "2026-04-28T00:00:00Z",
			"updated_at": "2026-04-29T00:00:00Z",
			"head":       map[string]any{"ref": branch},
			"user":       map[string]any{"login": "octocat"},
		},
		"repository":   map[string]any{"name": "widget", "owner": map[string]any{"login": "acme"}},
		"installation": map[string]any{"id": installationID},
	}
	raw, _ := json.Marshal(payload)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(raw)
	sig := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	req := httptest.NewRequest("POST", "/api/webhooks/github", bytes.NewReader(raw))
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-Hub-Signature-256", sig)
	rec := testutil.Call(t, testHandler.HandleGitHubWebhook, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("webhook pr=%d (%s): expected 202, got %d (%s)", prNumber, lifecycle, rec.Code, rec.Body.String())
	}
}

// ── CI / mergeable_state tests ─────────────────────────────────────────────

// TestListGitHubInstallations_RoleGating covers the read-only relaxation
// in MUL-2413: the endpoint is now reachable by any workspace member, but
// the handler strips the numeric installation_id and reports `can_manage`
// based on the caller's role. Admins / owners still receive the full row.
func TestListGitHubInstallations_RoleGating(t *testing.T) {
	if testHandler == nil {
		t.Skip("handler test fixture not initialized (no DB?)")
	}
	ctx := context.Background()

	const installationID int64 = 42424242
	if _, err := testHandler.Queries.CreateGitHubInstallation(ctx, db.CreateGitHubInstallationParams{
		WorkspaceID:    parseUUID(testWorkspaceID),
		InstallationID: installationID,
		AccountLogin:   "role-gating-acct",
		AccountType:    "Organization",
	}); err != nil {
		t.Fatalf("CreateGitHubInstallation: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM github_installation WHERE workspace_id = $1`, testWorkspaceID)
	})

	call := func(t *testing.T, role string) map[string]any {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/api/workspaces/"+testWorkspaceID+"/github/installations", nil)
		req = withURLParam(req, "id", testWorkspaceID)
		req = req.WithContext(middleware.SetMemberContext(req.Context(), testWorkspaceID, db.Member{Role: role}))
		w := httptest.NewRecorder()
		testHandler.ListGitHubInstallations(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("ListGitHubInstallations(%s): %d %s", role, w.Code, w.Body.String())
		}
		var body map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode body (%s): %v", role, err)
		}
		return body
	}

	t.Run("admin sees installation_id + can_manage true", func(t *testing.T) {
		body := call(t, "admin")
		if got, _ := body["can_manage"].(bool); !got {
			t.Errorf("can_manage = %v, want true", body["can_manage"])
		}
		installs, _ := body["installations"].([]any)
		if len(installs) == 0 {
			t.Fatalf("expected at least one installation row, got %v", installs)
		}
		row, _ := installs[0].(map[string]any)
		gotID, ok := row["installation_id"].(float64)
		if !ok {
			t.Fatalf("admin response missing installation_id: %v", row)
		}
		if int64(gotID) != installationID {
			t.Errorf("installation_id = %v, want %d", gotID, installationID)
		}
	})

	t.Run("owner sees installation_id + can_manage true", func(t *testing.T) {
		body := call(t, "owner")
		if got, _ := body["can_manage"].(bool); !got {
			t.Errorf("can_manage = %v, want true", body["can_manage"])
		}
		installs, _ := body["installations"].([]any)
		row, _ := installs[0].(map[string]any)
		if _, ok := row["installation_id"]; !ok {
			t.Errorf("owner response missing installation_id: %v", row)
		}
	})

	t.Run("member sees row without installation_id and can_manage false", func(t *testing.T) {
		body := call(t, "member")
		canManage, _ := body["can_manage"].(bool)
		if canManage {
			t.Errorf("can_manage = true, want false for non-admin member")
		}
		installs, _ := body["installations"].([]any)
		if len(installs) == 0 {
			t.Fatalf("member should still see installation rows, got %v", installs)
		}
		row, _ := installs[0].(map[string]any)
		if _, present := row["installation_id"]; present {
			t.Errorf("installation_id must be omitted for non-admin members, row=%v", row)
		}
		// Display fields the read-only view still needs must round-trip.
		if got, _ := row["account_login"].(string); got != "role-gating-acct" {
			t.Errorf("account_login = %q, want role-gating-acct", got)
		}
	})

	t.Run("guest is treated as read-only and can_manage is false", func(t *testing.T) {
		body := call(t, "guest")
		if canManage, _ := body["can_manage"].(bool); canManage {
			t.Errorf("can_manage = true, want false for guest")
		}
		installs, _ := body["installations"].([]any)
		row, _ := installs[0].(map[string]any)
		if _, present := row["installation_id"]; present {
			t.Errorf("installation_id must be omitted for guest, row=%v", row)
		}
	})
}

// TestGitHubRoutes_RoleGating exercises the router-level middleware split
// introduced in MUL-2413: GET installations runs under
// RequireWorkspaceMemberFromURL while connect / delete remain behind
// RequireWorkspaceRoleFromURL(owner, admin). The handler-level tests above
// inject a member into context directly and so do not cover the middleware
// itself — a future routing change that accidentally moved one of the
// admin-only routes into the member group would slip past them.
func TestGitHubRoutes_RoleGating(t *testing.T) {
	if testHandler == nil {
		t.Skip("handler test fixture not initialized (no DB?)")
	}
	ctx := context.Background()

	const slug = "github-routes-role-gating"
	_, _ = testPool.Exec(ctx, `DELETE FROM workspace WHERE slug = $1`, slug)
	_, _ = testPool.Exec(ctx, `DELETE FROM "user" WHERE email LIKE $1`, "github-routes-"+slug+"-%")

	wsID := dbfx.Insert(t, "workspace", testutil.Cols{
		"name":        "GitHub Routes Role Gating",
		"slug":        slug,
		"description": "github routes role gating",
	})

	// Three workspace members + one outsider. We attach the requesting user
	// via the X-User-ID header so the middleware reads them off the auth
	// boundary just like a real request.
	mkUser := func(t *testing.T, label string) string {
		t.Helper()
		var id string
		email := fmt.Sprintf("github-routes-%s-%s@auro.ai", slug, label)
		dbfx.QueryRow(t, `
INSERT INTO "user" (name, email) VALUES ($1, $2) RETURNING id
`, "GHR "+label, email).Scan(&id)
		return id
	}
	adminUserID := mkUser(t, "admin")
	memberUserID := mkUser(t, "member")
	outsiderUserID := mkUser(t, "outsider")

	for _, m := range []struct {
		userID, role string
	}{
		{adminUserID, "admin"},
		{memberUserID, "member"},
	} {
		dbfx.Exec(t, `
INSERT INTO member (workspace_id, user_id, role) VALUES ($1, $2, $3)
`, wsID, m.userID, m.role)
	}

	const installationID int64 = 90909090
	createdInst, err := testHandler.Queries.CreateGitHubInstallation(ctx, db.CreateGitHubInstallationParams{
		WorkspaceID:    parseUUID(wsID),
		InstallationID: installationID,
		AccountLogin:   "routes-acct",
		AccountType:    "User",
	})
	if err != nil {
		t.Fatalf("CreateGitHubInstallation: %v", err)
	}

	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM workspace WHERE id = $1`, wsID)
		for _, uid := range []string{adminUserID, memberUserID, outsiderUserID} {
			_, _ = testPool.Exec(context.Background(), `DELETE FROM "user" WHERE id = $1`, uid)
		}
	})

	// Build a router subtree mirroring the production wiring at
	// server/cmd/server/router.go for the workspace-scoped GitHub routes.
	// Mounting the real middleware is what makes this a routing-level test —
	// the role split has to come from the chi groups, not from the handler.
	router := chi.NewRouter()
	router.Route("/api/workspaces/{id}", func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireWorkspaceMemberFromURL(testHandler.Queries, "id"))
			r.Get("/github/installations", testHandler.ListGitHubInstallations)
		})
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireWorkspaceRoleFromURL(testHandler.Queries, "id", "owner", "admin"))
			r.Get("/github/connect", testHandler.GitHubConnect)
			r.Get("/github/installations/{installationId}/repositories", testHandler.ListGitHubInstallationRepositories)
			r.Delete("/github/installations/{installationId}", testHandler.DeleteGitHubInstallation)
		})
	})

	exercise := func(t *testing.T, method, path, userID string) int {
		t.Helper()
		req := httptest.NewRequest(method, path, nil)
		if userID != "" {
			req.Header.Set("X-User-ID", userID)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec.Code
	}

	t.Run("GET installations is reachable by members", func(t *testing.T) {
		if code := exercise(t, http.MethodGet, "/api/workspaces/"+wsID+"/github/installations", memberUserID); code != http.StatusOK {
			t.Errorf("member GET installations: want 200, got %d", code)
		}
		if code := exercise(t, http.MethodGet, "/api/workspaces/"+wsID+"/github/installations", adminUserID); code != http.StatusOK {
			t.Errorf("admin GET installations: want 200, got %d", code)
		}
	})

	t.Run("GET installations rejects non-members", func(t *testing.T) {
		// Outsider hits the workspace middleware before the handler — the
		// middleware translates a missing membership row into 404.
		if code := exercise(t, http.MethodGet, "/api/workspaces/"+wsID+"/github/installations", outsiderUserID); code != http.StatusNotFound {
			t.Errorf("outsider GET installations: want 404, got %d", code)
		}
	})

	t.Run("GET connect remains owner/admin only", func(t *testing.T) {
		if code := exercise(t, http.MethodGet, "/api/workspaces/"+wsID+"/github/connect", adminUserID); code != http.StatusOK {
			t.Errorf("admin GET connect: want 200, got %d", code)
		}
		if code := exercise(t, http.MethodGet, "/api/workspaces/"+wsID+"/github/connect", memberUserID); code != http.StatusForbidden {
			t.Errorf("member GET connect: want 403, got %d", code)
		}
		if code := exercise(t, http.MethodGet, "/api/workspaces/"+wsID+"/github/connect", outsiderUserID); code != http.StatusNotFound {
			t.Errorf("outsider GET connect: want 404, got %d", code)
		}
	})

	t.Run("GET repositories remains owner/admin only", func(t *testing.T) {
		path := "/api/workspaces/" + wsID + "/github/installations/" + uuidToString(createdInst.ID) + "/repositories"
		if code := exercise(t, http.MethodGet, path, memberUserID); code != http.StatusForbidden {
			t.Errorf("member GET repositories: want 403, got %d", code)
		}
		if code := exercise(t, http.MethodGet, path, outsiderUserID); code != http.StatusNotFound {
			t.Errorf("outsider GET repositories: want 404, got %d", code)
		}
	})

	t.Run("DELETE installation remains owner/admin only", func(t *testing.T) {
		// Member: 403 — middleware rejects before the handler runs.
		if code := exercise(t, http.MethodDelete, "/api/workspaces/"+wsID+"/github/installations/"+uuidToString(createdInst.ID), memberUserID); code != http.StatusForbidden {
			t.Errorf("member DELETE installation: want 403, got %d", code)
		}
		// Outsider: 404 — workspace not found.
		if code := exercise(t, http.MethodDelete, "/api/workspaces/"+wsID+"/github/installations/"+uuidToString(createdInst.ID), outsiderUserID); code != http.StatusNotFound {
			t.Errorf("outsider DELETE installation: want 404, got %d", code)
		}
		// Admin: 204 and the row goes away.
		if code := exercise(t, http.MethodDelete, "/api/workspaces/"+wsID+"/github/installations/"+uuidToString(createdInst.ID), adminUserID); code != http.StatusNoContent {
			t.Errorf("admin DELETE installation: want 204, got %d", code)
		}
		var remaining int
		dbfx.QueryRow(t, `SELECT COUNT(*) FROM github_installation WHERE id = $1`, uuidToString(createdInst.ID)).Scan(&remaining)
		if remaining != 0 {
			t.Errorf("expected installation row gone after admin DELETE, got %d remaining", remaining)
		}
	})
}

// TestGitHubInstallationBroadcastRedaction guards Emacs' finding on PR #2886:
// the realtime payloads we publish on installation create / uninstall must
// not carry the numeric `installation_id`. The frontend uses these events
// only to invalidate the installations query, so an admin client recovers
// the management handle via the list endpoint — which already gates the
// numeric id by role.
func TestGitHubInstallationBroadcastRedaction(t *testing.T) {
	inst := db.GithubInstallation{
		InstallationID: 123456789,
		AccountLogin:   "broadcast-acct",
		AccountType:    "User",
	}
	got := githubInstallationToBroadcast(inst)
	if got.InstallationID != nil {
		t.Errorf("broadcast payload must omit installation_id, got %v", *got.InstallationID)
	}
	if got.AccountLogin != "broadcast-acct" {
		t.Errorf("expected account_login preserved, got %q", got.AccountLogin)
	}

	// Sanity: the JSON encoding actually drops the field (omitempty + nil
	// pointer). A future change to the response shape could re-introduce
	// the field through a different name; the JSON check is the real
	// assertion against the wire format clients see.
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal broadcast payload: %v", err)
	}
	var generic map[string]any
	if err := json.Unmarshal(raw, &generic); err != nil {
		t.Fatalf("unmarshal broadcast payload: %v", err)
	}
	if _, present := generic["installation_id"]; present {
		t.Errorf("installation_id leaked into broadcast JSON: %s", string(raw))
	}
}

// generateTestRSAKeyPEM returns the shared RSA-2048 test key's PKCS#1 PEM
// encoding (the format GitHub hands operators when they create the App)
// and the parsed *rsa.PrivateKey for verification.
func generateTestRSAKeyPEM(t *testing.T) (pemBytes []byte, key *rsa.PrivateKey) {
	t.Helper()
	k := sharedTestRSAKey(t)
	der := x509.MarshalPKCS1PrivateKey(k)
	return pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: der}), k
}

// TestSignGitHubAppJWT_NotConfigured pins the contract that missing env
// vars produce ("", nil) — a soft "App auth not available" signal that
// fetchInstallationAccount uses to fall through to its unauthenticated
// path. Returning an error here would force every install on a vanilla
// self-host to log a noisy warning even though the deployment is
// intentionally not running App-authenticated calls.
func TestSignGitHubAppJWT_NotConfigured(t *testing.T) {
	t.Setenv("GITHUB_APP_ID", "")
	t.Setenv("GITHUB_APP_PRIVATE_KEY", "")
	tok, err := signGitHubAppJWT(time.Now())
	if err != nil {
		t.Fatalf("expected nil error when env not set, got %v", err)
	}
	if tok != "" {
		t.Errorf("expected empty token when env not set, got %q", tok)
	}

	// Half-configured (one var set, the other empty) is treated the same
	// as fully unset — we never want a partial config to claim the App
	// is wired up.
	t.Setenv("GITHUB_APP_ID", "12345")
	t.Setenv("GITHUB_APP_PRIVATE_KEY", "")
	tok, err = signGitHubAppJWT(time.Now())
	if err != nil || tok != "" {
		t.Errorf("partial config should return empty token, got tok=%q err=%v", tok, err)
	}
}

// TestSignGitHubAppJWT_InvalidPEM proves that a malformed private key is
// surfaced as an error, not silently swallowed. The setup-callback path
// catches and logs this so the operator gets a breadcrumb instead of an
// install that quietly never enriches the row.
func TestSignGitHubAppJWT_InvalidPEM(t *testing.T) {
	t.Setenv("GITHUB_APP_ID", "12345")
	t.Setenv("GITHUB_APP_PRIVATE_KEY", "not a real PEM block")
	if _, err := signGitHubAppJWT(time.Now()); err == nil {
		t.Error("expected error for malformed private key, got nil")
	}
}

// TestSignGitHubAppJWT_ClaimsAndSignature signs a token with a known key
// and verifies (a) the claims GitHub requires (`iss`, `iat`, `exp`) carry
// the values we set, (b) iat is back-dated for clock skew, (c) exp stays
// inside GitHub's 10-minute cap, and (d) the signature verifies against
// the matching public key.
func TestSignGitHubAppJWT_ClaimsAndSignature(t *testing.T) {
	pemBytes, key := generateTestRSAKeyPEM(t)
	t.Setenv("GITHUB_APP_ID", "424242")
	t.Setenv("GITHUB_APP_PRIVATE_KEY", string(pemBytes))

	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	tok, err := signGitHubAppJWT(now)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if tok == "" {
		t.Fatal("expected non-empty token when fully configured")
	}

	// Inject the same `now` into the parser's clock so default exp/nbf
	// validation is anchored to the test-time, not real wall clock —
	// otherwise the test becomes a time bomb that fails for real once
	// the real time crosses the token's exp (now + 9m).
	parsed, err := jwt.Parse(
		tok,
		func(token *jwt.Token) (any, error) {
			if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return &key.PublicKey, nil
		},
		jwt.WithTimeFunc(func() time.Time { return now }),
	)
	if err != nil || !parsed.Valid {
		t.Fatalf("verify token: err=%v valid=%v", err, parsed != nil && parsed.Valid)
	}
	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok {
		t.Fatalf("claims type: %T", parsed.Claims)
	}
	if got, _ := claims["iss"].(string); got != "424242" {
		t.Errorf("iss = %q, want 424242", got)
	}
	iat := int64(claims["iat"].(float64))
	exp := int64(claims["exp"].(float64))
	if iat != now.Add(-60*time.Second).Unix() {
		t.Errorf("iat = %d, want %d (now - 60s for clock skew)", iat, now.Add(-60*time.Second).Unix())
	}
	if exp != now.Add(9*time.Minute).Unix() {
		t.Errorf("exp = %d, want %d (now + 9m, inside GitHub's 10m cap)", exp, now.Add(9*time.Minute).Unix())
	}
	if exp-iat > int64(10*time.Minute/time.Second) {
		t.Errorf("exp-iat = %d s, exceeds GitHub's 10m max", exp-iat)
	}
}

func TestFetchGitHubInstallationRepositories(t *testing.T) {
	pemBytes, key := generateTestRSAKeyPEM(t)
	t.Setenv("GITHUB_APP_ID", "424242")
	t.Setenv("GITHUB_APP_PRIVATE_KEY", string(pemBytes))

	const installationID int64 = 314159
	var tokenRevoked bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/app/installations/314159/access_tokens":
			bearer := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if bearer == "" {
				http.Error(w, "missing app jwt", http.StatusUnauthorized)
				return
			}
			if _, err := jwt.Parse(bearer, func(token *jwt.Token) (any, error) {
				return &key.PublicKey, nil
			}); err != nil {
				http.Error(w, "bad app jwt", http.StatusUnauthorized)
				return
			}
			var tokenRequest struct {
				Permissions map[string]string `json:"permissions"`
			}
			if err := json.NewDecoder(r.Body).Decode(&tokenRequest); err != nil {
				http.Error(w, "bad token request", http.StatusBadRequest)
				return
			}
			if !reflect.DeepEqual(tokenRequest.Permissions, map[string]string{"metadata": "read"}) {
				http.Error(w, "overbroad token permissions", http.StatusBadRequest)
				return
			}
			writeJSON(w, http.StatusCreated, map[string]any{"token": "installation-secret"})
		case r.Method == http.MethodGet && r.URL.Path == "/installation/repositories":
			if got := r.Header.Get("Authorization"); got != "Bearer installation-secret" {
				http.Error(w, "bad installation token", http.StatusUnauthorized)
				return
			}
			if r.URL.Query().Get("page") != "2" || r.URL.Query().Get("per_page") != "1" {
				http.Error(w, "bad pagination", http.StatusBadRequest)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"total_count": 3,
				"repositories": []map[string]any{{
					"id":             9,
					"full_name":      "acme/private-repo",
					"html_url":       "https://github.com/acme/private-repo",
					"clone_url":      "https://github.com/acme/private-repo.git",
					"description":    "Private repository",
					"private":        true,
					"archived":       false,
					"default_branch": "main",
				}},
			})
		case r.Method == http.MethodDelete && r.URL.Path == "/installation/token":
			tokenRevoked = r.Header.Get("Authorization") == "Bearer installation-secret"
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	oldBase := githubAPIBase
	githubAPIBase = srv.URL
	t.Cleanup(func() { githubAPIBase = oldBase })

	got, err := fetchGitHubInstallationRepositories(
		context.Background(),
		installationID,
		2,
		1,
	)
	if err != nil {
		t.Fatalf("fetchGitHubInstallationRepositories: %v", err)
	}
	if len(got.Repositories) != 1 {
		t.Fatalf("repositories = %d, want 1", len(got.Repositories))
	}
	repository := got.Repositories[0]
	if repository.FullName != "acme/private-repo" || !repository.Private {
		t.Errorf("repository = %+v, want mapped private repository", repository)
	}
	if got.TotalCount != 3 || got.NextPage == nil || *got.NextPage != 3 {
		t.Errorf("pagination = total %d, next %v; want total 3, next 3", got.TotalCount, got.NextPage)
	}
	if !tokenRevoked {
		t.Error("installation token was not revoked after repository listing")
	}
}

func TestListGitHubInstallationRepositoriesRejectsCrossWorkspaceRow(t *testing.T) {
	if testHandler == nil {
		t.Skip("handler test fixture not initialized (no DB?)")
	}
	ctx := context.Background()
	const installationID int64 = 818181
	row, err := testHandler.Queries.CreateGitHubInstallation(ctx, db.CreateGitHubInstallationParams{
		WorkspaceID:    parseUUID(testWorkspaceID),
		InstallationID: installationID,
		AccountLogin:   "cross-workspace-acct",
		AccountType:    "Organization",
	})
	if err != nil {
		t.Fatalf("CreateGitHubInstallation: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM github_installation WHERE installation_id = $1`, installationID)
	})

	otherWorkspaceID := "11111111-2222-3333-4444-555555555555"
	req := httptest.NewRequest(
		http.MethodGet,
		"/api/workspaces/"+otherWorkspaceID+"/github/installations/"+uuidToString(row.ID)+"/repositories",
		nil,
	)
	rec := httptest.NewRecorder()
	router := chi.NewRouter()
	router.Get(
		"/api/workspaces/{id}/github/installations/{installationId}/repositories",
		testHandler.ListGitHubInstallationRepositories,
	)
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("cross-workspace row: got %d (%s), want 404", rec.Code, rec.Body.String())
	}
}

func TestGitHubWebhook_UnconfiguredDeploymentReturns404(t *testing.T) {
	t.Setenv("GITHUB_WEBHOOK_SECRET", "")
	req := httptest.NewRequest(http.MethodPost, "/api/webhooks/github", strings.NewReader(`{}`))
	rec := httptest.NewRecorder()

	(&Handler{}).HandleGitHubWebhook(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when webhook is unconfigured, got %d (%s)", rec.Code, rec.Body.String())
	}
}

// TestFetchInstallationAccount_AuthenticatedPopulatesRow simulates the
// GitHub `/app/installations/{id}` endpoint with a JWT-gated mock and
// verifies that fetchInstallationAccount, when fully configured,
// (a) sends a Bearer JWT, (b) parses the JSON response, and (c) returns
// the real account login instead of the "unknown" placeholder. This is
// the assertion that nails down the bug fix for MUL-3078.
func TestFetchInstallationAccount_AuthenticatedPopulatesRow(t *testing.T) {
	pemBytes, key := generateTestRSAKeyPEM(t)
	t.Setenv("GITHUB_APP_ID", "11111")
	t.Setenv("GITHUB_APP_PRIVATE_KEY", string(pemBytes))

	const wantInstallationID int64 = 7777777
	var sawAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawAuth = r.Header.Get("Authorization")
		expectedPath := fmt.Sprintf("/app/installations/%d", wantInstallationID)
		if r.URL.Path != expectedPath {
			t.Errorf("unexpected path: got %q want %q", r.URL.Path, expectedPath)
		}
		// Verify JWT signature using the matching public key — this is
		// what GitHub does on the real endpoint.
		bearer := strings.TrimPrefix(sawAuth, "Bearer ")
		if bearer == sawAuth {
			http.Error(w, "missing Bearer prefix", http.StatusUnauthorized)
			return
		}
		if _, err := jwt.Parse(bearer, func(token *jwt.Token) (any, error) {
			return &key.PublicKey, nil
		}); err != nil {
			http.Error(w, "bad jwt: "+err.Error(), http.StatusUnauthorized)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"account": map[string]any{
				"login":      "octocat",
				"type":       "Organization",
				"avatar_url": "https://example.com/o.png",
			},
		})
	}))
	t.Cleanup(srv.Close)

	oldBase := githubAPIBase
	githubAPIBase = srv.URL
	t.Cleanup(func() { githubAPIBase = oldBase })

	login, accountType, avatar := fetchInstallationAccount(context.Background(), wantInstallationID)
	if login != "octocat" {
		t.Errorf("login = %q, want %q (the bug repro: stayed as 'unknown' before the fix)", login, "octocat")
	}
	if accountType != "Organization" {
		t.Errorf("accountType = %q, want Organization", accountType)
	}
	if avatar == nil || *avatar != "https://example.com/o.png" {
		t.Errorf("avatar = %v, want pointer to https://example.com/o.png", avatar)
	}
	if !strings.HasPrefix(sawAuth, "Bearer ") {
		t.Errorf("expected Bearer auth header, got %q", sawAuth)
	}
}

// TestFetchInstallationAccount_UnauthenticatedFallsBack documents the
// degraded path: when the operator hasn't set GITHUB_APP_ID/PRIVATE_KEY,
// the call is made unauthenticated, GitHub returns 401, and the function
// returns the "unknown" placeholder. This is the input the webhook then
// upserts over once GitHub delivers `installation.created`.
func TestFetchInstallationAccount_UnauthenticatedFallsBack(t *testing.T) {
	t.Setenv("GITHUB_APP_ID", "")
	t.Setenv("GITHUB_APP_PRIVATE_KEY", "")

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			http.Error(w, "auth required", http.StatusUnauthorized)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"account": map[string]any{"login": "should-not-see"}})
	}))
	t.Cleanup(srv.Close)
	oldBase := githubAPIBase
	githubAPIBase = srv.URL
	t.Cleanup(func() { githubAPIBase = oldBase })

	login, _, _ := fetchInstallationAccount(context.Background(), 999)
	if login != "unknown" {
		t.Errorf("login = %q, want unknown placeholder when auth not configured", login)
	}
}

// TestFetchInstallationAccount_EmptyAccountKeepsPlaceholder pins that a 200
// response with a missing `account.login` (e.g. GitHub returned a partial
// payload) still yields the safe "unknown" placeholder rather than writing
// an empty string — the frontend renders the literal value, so an empty
// string would surface as "已连接到 " (the bug we're fixing, in a different
// shape).
func TestFetchInstallationAccount_EmptyAccountKeepsPlaceholder(t *testing.T) {
	pemBytes, _ := generateTestRSAKeyPEM(t)
	t.Setenv("GITHUB_APP_ID", "1")
	t.Setenv("GITHUB_APP_PRIVATE_KEY", string(pemBytes))

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"account": map[string]any{}})
	}))
	t.Cleanup(srv.Close)
	oldBase := githubAPIBase
	githubAPIBase = srv.URL
	t.Cleanup(func() { githubAPIBase = oldBase })

	login, accountType, avatar := fetchInstallationAccount(context.Background(), 12)
	if login != "unknown" {
		t.Errorf("expected 'unknown' placeholder for empty account.login, got %q", login)
	}
	if accountType != "User" {
		t.Errorf("expected default 'User' accountType, got %q", accountType)
	}
	if avatar != nil {
		t.Errorf("expected nil avatar, got %v", *avatar)
	}
}

// TestWebhook_InstallationCreatedRefreshesUnknownLogin guards the fix for
// MUL-3078: when the setup callback persists a row with the "unknown"
// placeholder (because the operator hasn't configured App JWT auth, or
// the API call failed), the subsequent `installation.created` webhook
// must (a) overwrite account_login with the real value from the payload
// and (b) broadcast a `github_installation:created` event so any open
// Settings → GitHub tab re-queries without needing a manual refresh.
func TestWebhook_InstallationCreatedRefreshesUnknownLogin(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("handler test fixture not initialized (no DB?)")
	}
	ctx := context.Background()
	secret := "installation-refresh-secret"
	t.Setenv("GITHUB_WEBHOOK_SECRET", secret)

	const installationID int64 = 71717171
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM github_installation WHERE installation_id = $1`, installationID)
	})

	// Seed the row the way the setup callback does today when App JWT
	// auth isn't available: account_login = "unknown".
	if _, err := testHandler.Queries.CreateGitHubInstallation(ctx, db.CreateGitHubInstallationParams{
		WorkspaceID:    parseUUID(testWorkspaceID),
		InstallationID: installationID,
		AccountLogin:   "unknown",
		AccountType:    "User",
	}); err != nil {
		t.Fatalf("seed installation row: %v", err)
	}

	// Subscribe to the bus BEFORE firing the webhook so we can assert the
	// broadcast actually fired. Bus.Subscribe is per-event-type, which
	// matches the realtime hub's downstream filter.
	gotEvent := make(chan events.Event, 1)
	testHandler.Bus.Subscribe(protocol.EventGitHubInstallationCreated, func(e events.Event) {
		select {
		case gotEvent <- e:
		default:
		}
	})

	body, _ := json.Marshal(map[string]any{
		"action": "created",
		"installation": map[string]any{
			"id": installationID,
			"account": map[string]any{
				"login":      "real-octocat",
				"type":       "Organization",
				"avatar_url": "https://example.com/avatar.png",
			},
		},
	})
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	sig := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	req := httptest.NewRequest("POST", "/api/webhooks/github", bytes.NewReader(body))
	req.Header.Set("X-GitHub-Event", "installation")
	req.Header.Set("X-Hub-Signature-256", sig)
	testutil.Call(t, testHandler.HandleGitHubWebhook, req).Want(http.StatusAccepted)

	// (a) The row's account_login must be the real login, not "unknown".
	rows, err := testHandler.Queries.ListGitHubInstallationsByInstallationID(ctx, installationID)
	if err != nil {
		t.Fatalf("list installations: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 installation row, got %d", len(rows))
	}
	got := rows[0]
	if got.AccountLogin != "real-octocat" {
		t.Errorf("account_login = %q, want %q (refresh did not overwrite the unknown placeholder)",
			got.AccountLogin, "real-octocat")
	}
	if got.AccountType != "Organization" {
		t.Errorf("account_type = %q, want Organization", got.AccountType)
	}

	// (b) A broadcast must have been emitted on the installation:created
	// channel so the frontend re-queries the list. The realtime listener
	// drops events with empty workspace_id, so we verify both the type
	// AND the workspace scope.
	select {
	case ev := <-gotEvent:
		if ev.WorkspaceID != testWorkspaceID {
			t.Errorf("broadcast WorkspaceID = %q, want %q", ev.WorkspaceID, testWorkspaceID)
		}
		// The payload must carry the redacted installation shape so
		// non-admin clients on the workspace channel can't extract the
		// numeric installation_id from the broadcast itself.
		payload, ok := ev.Payload.(map[string]any)
		if !ok {
			t.Fatalf("broadcast payload type: %T", ev.Payload)
		}
		inst, ok := payload["installation"].(GitHubInstallationResponse)
		if !ok {
			t.Fatalf("installation payload type: %T", payload["installation"])
		}
		if inst.AccountLogin != "real-octocat" {
			t.Errorf("broadcast account_login = %q, want real-octocat", inst.AccountLogin)
		}
		if inst.InstallationID != nil {
			t.Errorf("broadcast must redact installation_id, got %v", *inst.InstallationID)
		}
	case <-time.After(2 * time.Second):
		t.Errorf("expected github_installation:created broadcast after webhook refresh, got none in 2s")
	}
}

// TestSetupCallback_ConsumesPendingInstallationCreated covers the inverse
// race to TestWebhook_InstallationCreatedRefreshesUnknownLogin: GitHub can
// deliver installation.created before the setup callback has created the local
// workspace binding. The webhook cannot broadcast yet, but it must not be lost;
// the callback consumes the pending account metadata even if its direct GitHub
// API lookup falls back to the "unknown" placeholder.
func TestSetupCallback_ConsumesPendingInstallationCreated(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("handler test fixture not initialized (no DB?)")
	}
	ctx := context.Background()
	secret := "pending-installation-secret"
	t.Setenv("GITHUB_WEBHOOK_SECRET", secret)
	t.Setenv("GITHUB_APP_ID", "")
	t.Setenv("GITHUB_APP_PRIVATE_KEY", "")
	t.Setenv("FRONTEND_ORIGIN", "https://app.example.test")

	const installationID int64 = 81818181
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM github_installation WHERE installation_id = $1`, installationID)
		testPool.Exec(ctx, `DELETE FROM github_pending_installation WHERE installation_id = $1`, installationID)
	})

	// Force fetchInstallationAccount to take its degraded path. This pins that
	// the final real account name comes from the earlier webhook, not the
	// setup callback's synchronous GitHub API lookup.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "auth required", http.StatusUnauthorized)
	}))
	t.Cleanup(srv.Close)
	oldBase := githubAPIBase
	githubAPIBase = srv.URL
	t.Cleanup(func() { githubAPIBase = oldBase })

	body, _ := json.Marshal(map[string]any{
		"action": "created",
		"installation": map[string]any{
			"id": installationID,
			"account": map[string]any{
				"login":      "pending-octocat",
				"type":       "Organization",
				"avatar_url": "https://example.com/pending.png",
			},
		},
	})
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	sig := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	rec := httptest.NewRecorder()
	hookReq := httptest.NewRequest("POST", "/api/webhooks/github", bytes.NewReader(body))
	hookReq.Header.Set("X-GitHub-Event", "installation")
	hookReq.Header.Set("X-Hub-Signature-256", sig)
	testHandler.HandleGitHubWebhook(rec, hookReq)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("webhook: expected 202, got %d (%s)", rec.Code, rec.Body.String())
	}

	var pendingLogin string
	dbfx.QueryRow(t,
		`SELECT account_login FROM github_pending_installation WHERE installation_id = $1`,
		installationID,
	).Scan(&pendingLogin)
	if pendingLogin != "pending-octocat" {
		t.Fatalf("pending account_login = %q, want pending-octocat", pendingLogin)
	}

	state, err := signStateForReturn(testWorkspaceID, githubReturnToRepositories)
	if err != nil {
		t.Fatalf("signState: %v", err)
	}
	setupReq := httptest.NewRequest("GET",
		fmt.Sprintf("/api/github/setup?installation_id=%d&state=%s", installationID, state),
		nil,
	)
	setupRec := httptest.NewRecorder()
	testHandler.GitHubSetupCallback(setupRec, setupReq)
	if setupRec.Code != http.StatusFound {
		t.Fatalf("setup callback: expected 302, got %d (%s)", setupRec.Code, setupRec.Body.String())
	}
	if loc := setupRec.Header().Get("Location"); !strings.Contains(loc, "github_connected=1") {
		t.Fatalf("setup callback redirect = %q, want github_connected=1", loc)
	}

	rows, err := testHandler.Queries.ListGitHubInstallationsByInstallationID(ctx, installationID)
	if err != nil {
		t.Fatalf("list installations: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 installation row, got %d", len(rows))
	}
	got := rows[0]
	if got.AccountLogin != "pending-octocat" {
		t.Errorf("account_login = %q, want pending-octocat (callback left the unknown placeholder)", got.AccountLogin)
	}
	if got.AccountType != "Organization" {
		t.Errorf("account_type = %q, want Organization", got.AccountType)
	}
	if got.AccountAvatarUrl.String != "https://example.com/pending.png" || !got.AccountAvatarUrl.Valid {
		t.Errorf("account_avatar_url = %+v, want pending avatar", got.AccountAvatarUrl)
	}

	var pendingCount int
	dbfx.QueryRow(t,
		`SELECT count(*) FROM github_pending_installation WHERE installation_id = $1`,
		installationID,
	).Scan(&pendingCount)
	if pendingCount != 0 {
		t.Fatalf("pending installation row should be consumed, got count %d", pendingCount)
	}
}

// bindSecondWorkspaceForTest creates a throwaway workspace with the given issue
// prefix, binds it to installationID, and registers cleanup for both. Returns
// the new workspace id.
func bindSecondWorkspaceForTest(t *testing.T, slug, prefix string, installationID int64) pgtype.UUID {
	t.Helper()
	ctx := context.Background()
	testPool.Exec(ctx, `DELETE FROM github_installation WHERE installation_id = $1`, installationID)
	testPool.Exec(ctx, `DELETE FROM workspace WHERE slug = $1`, slug)
	ws, err := testHandler.Queries.CreateWorkspace(ctx, db.CreateWorkspaceParams{
		Name: slug, Slug: slug,
	})
	if err != nil {
		t.Fatalf("CreateWorkspace %s: %v", slug, err)
	}
	if _, err := testHandler.Queries.CreateGitHubInstallation(ctx, db.CreateGitHubInstallationParams{
		WorkspaceID: ws.ID, InstallationID: installationID, AccountLogin: "acme", AccountType: "User",
	}); err != nil {
		t.Fatalf("CreateGitHubInstallation %s: %v", slug, err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		testPool.Exec(bg, `DELETE FROM github_installation WHERE installation_id = $1`, installationID)
		testPool.Exec(bg, `DELETE FROM workspace WHERE id = $1`, ws.ID)
	})
	return ws.ID
}

// TestSecondWorkspaceBindDoesNotUnbindFirst is the #4823 regression: binding
// the same GitHub App installation in a second workspace must NOT overwrite the
// first workspace's binding. Both bindings coexist, and re-binding an existing
// (workspace, installation) pair upserts its row in place.
func TestSecondWorkspaceBindDoesNotUnbindFirst(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("handler test fixture not initialized (no DB?)")
	}
	ctx := context.Background()
	const installationID int64 = 909090909

	testPool.Exec(ctx, `DELETE FROM workspace WHERE slug = $1`, "multi-bind-ws-b")
	wsB, err := testHandler.Queries.CreateWorkspace(ctx, db.CreateWorkspaceParams{
		Name: "multi-bind-ws-b",
		Slug: "multi-bind-ws-b",
	})
	if err != nil {
		t.Fatalf("CreateWorkspace: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM github_installation WHERE installation_id = $1`, installationID)
		testPool.Exec(ctx, `DELETE FROM workspace WHERE id = $1`, wsB.ID)
	})

	if _, err := testHandler.Queries.CreateGitHubInstallation(ctx, db.CreateGitHubInstallationParams{
		WorkspaceID:    parseUUID(testWorkspaceID),
		InstallationID: installationID,
		AccountLogin:   "shared-org",
		AccountType:    "Organization",
	}); err != nil {
		t.Fatalf("bind workspace A: %v", err)
	}
	if _, err := testHandler.Queries.CreateGitHubInstallation(ctx, db.CreateGitHubInstallationParams{
		WorkspaceID:    wsB.ID,
		InstallationID: installationID,
		AccountLogin:   "shared-org",
		AccountType:    "Organization",
	}); err != nil {
		t.Fatalf("bind workspace B: %v", err)
	}

	rows, err := testHandler.Queries.ListGitHubInstallationsByInstallationID(ctx, installationID)
	if err != nil {
		t.Fatalf("list installations: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 bindings to coexist (silent unbind regression), got %d", len(rows))
	}
	seen := map[string]bool{}
	for _, r := range rows {
		seen[uuidToString(r.WorkspaceID)] = true
	}
	if !seen[testWorkspaceID] || !seen[uuidToString(wsB.ID)] {
		t.Errorf("both workspaces must retain a binding; got %v", seen)
	}

	// Re-binding workspace A must upsert its own row in place, not add a third.
	if _, err := testHandler.Queries.CreateGitHubInstallation(ctx, db.CreateGitHubInstallationParams{
		WorkspaceID:    parseUUID(testWorkspaceID),
		InstallationID: installationID,
		AccountLogin:   "shared-org-renamed",
		AccountType:    "Organization",
	}); err != nil {
		t.Fatalf("re-bind workspace A: %v", err)
	}
	rows, err = testHandler.Queries.ListGitHubInstallationsByInstallationID(ctx, installationID)
	if err != nil {
		t.Fatalf("list installations after re-bind: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("re-binding an existing (workspace, installation) must upsert, got %d rows", len(rows))
	}
}

// TestWebhook_UninstallDeletesAllBindings verifies a GitHub-side app uninstall
// drops every workspace binding for the installation and broadcasts to each
// affected workspace so their Settings tabs refresh.
func TestWebhook_UninstallDeletesAllBindings(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("handler test fixture not initialized (no DB?)")
	}
	ctx := context.Background()
	secret := "uninstall-all-secret"
	t.Setenv("GITHUB_WEBHOOK_SECRET", secret)
	const installationID int64 = 707070707

	testPool.Exec(ctx, `DELETE FROM workspace WHERE slug = $1`, "uninstall-all-ws-b")
	wsB, err := testHandler.Queries.CreateWorkspace(ctx, db.CreateWorkspaceParams{
		Name: "uninstall-all-ws-b",
		Slug: "uninstall-all-ws-b",
	})
	if err != nil {
		t.Fatalf("CreateWorkspace: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM github_installation WHERE installation_id = $1`, installationID)
		testPool.Exec(ctx, `DELETE FROM workspace WHERE id = $1`, wsB.ID)
	})

	if _, err := testHandler.Queries.CreateGitHubInstallation(ctx, db.CreateGitHubInstallationParams{
		WorkspaceID:    parseUUID(testWorkspaceID),
		InstallationID: installationID,
		AccountLogin:   "shared-org",
		AccountType:    "Organization",
	}); err != nil {
		t.Fatalf("bind workspace A: %v", err)
	}
	if _, err := testHandler.Queries.CreateGitHubInstallation(ctx, db.CreateGitHubInstallationParams{
		WorkspaceID:    wsB.ID,
		InstallationID: installationID,
		AccountLogin:   "shared-org",
		AccountType:    "Organization",
	}); err != nil {
		t.Fatalf("bind workspace B: %v", err)
	}

	gotWS := make(chan string, 2)
	testHandler.Bus.Subscribe(protocol.EventGitHubInstallationDeleted, func(e events.Event) {
		select {
		case gotWS <- e.WorkspaceID:
		default:
		}
	})

	body, _ := json.Marshal(map[string]any{
		"action":       "deleted",
		"installation": map[string]any{"id": installationID},
	})
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	sig := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	req := httptest.NewRequest("POST", "/api/webhooks/github", bytes.NewReader(body))
	req.Header.Set("X-GitHub-Event", "installation")
	req.Header.Set("X-Hub-Signature-256", sig)
	testutil.Call(t, testHandler.HandleGitHubWebhook, req).Want(http.StatusAccepted)

	rows, err := testHandler.Queries.ListGitHubInstallationsByInstallationID(ctx, installationID)
	if err != nil {
		t.Fatalf("list installations: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("expected all bindings deleted, got %d", len(rows))
	}

	seen := map[string]bool{}
	deadline := time.After(2 * time.Second)
	for len(seen) < 2 {
		select {
		case ws := <-gotWS:
			seen[ws] = true
		case <-deadline:
			t.Fatalf("expected 2 deleted broadcasts (one per workspace), saw %v", seen)
		}
	}
	if !seen[testWorkspaceID] || !seen[uuidToString(wsB.ID)] {
		t.Errorf("deleted broadcasts must cover both workspaces; saw %v", seen)
	}
}
