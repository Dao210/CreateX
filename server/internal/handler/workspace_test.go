package handler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/auro-ai/auro/server/internal/testutil"
)

func TestCreateWorkspace_RejectsReservedSlug(t *testing.T) {
	// Drive the test off the actual reservedSlugs map so the test can never
	// drift from the source of truth. New entries are covered automatically.
	reserved := make([]string, 0, len(reservedSlugs))
	for slug := range reservedSlugs {
		reserved = append(reserved, slug)
	}
	sort.Strings(reserved) // deterministic test order

	for _, slug := range reserved {
		t.Run(slug, func(t *testing.T) {
			req := newRequest("POST", "/api/workspaces", map[string]any{
				"name": fmt.Sprintf("Test %s", slug),
				"slug": slug,
			})
			w := testutil.Call(t, testHandler.CreateWorkspace, req)

			if w.Code != http.StatusBadRequest {
				t.Fatalf("slug %q: expected 400, got %d: %s", slug, w.Code, w.Body.String())
			}
		})
	}
}

// TestCreateWorkspace_DoesNotMarkOnboarded guards the onboarding
// contract: creating a workspace MUST leave user.onboarded_at NULL so
// the route guard in apps/web/app/[workspaceSlug]/layout.tsx (and the
// desktop App.tsx overlay decision) can redirect the un-onboarded user
// back to /onboarding to finish Step 3. The previous behavior atomically
// set onboarded_at inside CreateWorkspace; this test makes the new
// invariant explicit and regression-protected.
//
// CompleteOnboarding (Step 3 exit) and AcceptInvitation are the only
// remaining handlers that flip onboarded_at.
func TestCreateWorkspace_DoesNotMarkOnboarded(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	const slug = "handler-tests-onboarded-null"
	_, _ = testPool.Exec(ctx, `DELETE FROM workspace WHERE slug = $1`, slug)
	// Ensure the test user starts un-onboarded so the assertion is meaningful.
	_, _ = testPool.Exec(ctx, `UPDATE "user" SET onboarded_at = NULL WHERE id = $1`, testUserID)

	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM workspace WHERE slug = $1`, slug)
		_, _ = testPool.Exec(context.Background(), `UPDATE "user" SET onboarded_at = NULL WHERE id = $1`, testUserID)
	})

	req := newRequest("POST", "/api/workspaces", map[string]any{
		"name": "Onboarding Invariant Probe",
		"slug": slug,
	})
	testutil.Call(t, testHandler.CreateWorkspace, req).Want(http.StatusCreated)

	var onboardedAt *string
	dbfx.QueryRow(t, `SELECT onboarded_at FROM "user" WHERE id = $1`, testUserID).Scan(&onboardedAt)
	if onboardedAt != nil {
		t.Fatalf("CreateWorkspace marked user as onboarded; expected NULL, got %q. The workspace layout hard gate relies on this staying NULL until Step 3 CompleteOnboarding fires.", *onboardedAt)
	}
}

// TestCreateWorkspace_DisabledByConfig guards the self-host gate added by
// #3433: when DisableWorkspaceCreation is true on the handler config, every
// caller — even an already-authenticated user — must receive 403 and the
// workspace row must not be written.
func TestCreateWorkspace_DisabledByConfig(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	const slug = "handler-tests-disabled-create"
	ctx := context.Background()
	_, _ = testPool.Exec(ctx, `DELETE FROM workspace WHERE slug = $1`, slug)
	dbfx.Cleanup(t, `DELETE FROM workspace WHERE slug = $1`, slug)

	prev := testHandler.cfg
	testHandler.cfg = Config{
		AllowSignup:              prev.AllowSignup,
		DisableWorkspaceCreation: true,
	}
	t.Cleanup(func() { testHandler.cfg = prev })

	req := newRequest("POST", "/api/workspaces", map[string]any{
		"name": "Disabled Create",
		"slug": slug,
	})
	testutil.Call(t, testHandler.CreateWorkspace, req).Want(http.StatusForbidden)

	var count int
	dbfx.QueryRow(t, `SELECT count(*) FROM workspace WHERE slug = $1`, slug).Scan(&count)
	if count != 0 {
		t.Fatalf("expected no workspace row to be written when gate fires, found %d", count)
	}
}

// TestDeleteWorkspace_RequiresOwner exercises the in-handler authorization
// added to DeleteWorkspace by calling the handler directly (bypassing the
// router-level RequireWorkspaceRoleFromURL middleware). Without the handler
// check, a non-owner member request would reach DeleteWorkspace and erase the
// workspace; with it, the handler must return 403 and leave the workspace
// intact.
func TestDeleteWorkspace_RequiresOwner(t *testing.T) {
	ctx := context.Background()

	const slug = "handler-tests-delete-403"
	_, _ = testPool.Exec(ctx, `DELETE FROM workspace WHERE slug = $1`, slug)

	wsID := dbfx.Insert(t, "workspace", testutil.Cols{
		"name":        "Handler Test Delete 403",
		"slug":        slug,
		"description": "DeleteWorkspace handler permission test",
	})

	dbfx.Exec(t, `
INSERT INTO member (workspace_id, user_id, role)
VALUES ($1, $2, 'admin')
`, wsID, testUserID)

	req := newRequest("DELETE", "/api/workspaces/"+wsID, nil)
	req = withURLParam(req, "id", wsID)
	testutil.Call(t, testHandler.DeleteWorkspace, req).Want(http.StatusForbidden)

	var exists bool
	dbfx.QueryRow(t, `SELECT EXISTS (SELECT 1 FROM workspace WHERE id = $1)`, wsID).Scan(&exists)
	if !exists {
		t.Fatal("workspace was deleted despite non-owner request — handler-level check did not fire")
	}
}

func TestDeleteWorkspace_DirtyTriggersHaveTeardownGuard(t *testing.T) {
	for _, triggerName := range []string{
		"trg_atq_dirty_hourly",
		"trg_tu_dirty_hourly",
	} {
		var definition string
		dbfx.QueryRow(t, `
SELECT pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgname = $1
  AND NOT tgisinternal
`, triggerName).Scan(&definition)
		if !strings.Contains(definition, "auro.workspace_teardown") {
			t.Fatalf("trigger %s does not guard workspace teardown: %s", triggerName, definition)
		}
	}
}

// TestUpdateWorkspace_AvatarURL covers the avatar_url field added to
// UpdateWorkspaceRequest: a PATCH with avatar_url is persisted and surfaced
// back on the response, and partial updates leave other fields untouched.
// Route-level authorization (owner/admin) is enforced by middleware in
// router.go; the handler test calls UpdateWorkspace directly to verify the
// payload wiring.
func TestUpdateWorkspace_AvatarURL(t *testing.T) {
	ctx := context.Background()

	const slug = "handler-tests-avatar-url"
	_, _ = testPool.Exec(ctx, `DELETE FROM workspace WHERE slug = $1`, slug)

	wsID := dbfx.Insert(t, "workspace", testutil.Cols{
		"name":        "Handler Test Avatar URL",
		"slug":        slug,
		"description": "UpdateWorkspace avatar_url test",
	})

	dbfx.Exec(t, `
INSERT INTO member (workspace_id, user_id, role)
VALUES ($1, $2, 'owner')
`, wsID, testUserID)

	const avatarURL = "https://cdn.example.com/workspaces/abc/logo.png"

	req := newRequest("PATCH", "/api/workspaces/"+wsID, map[string]any{
		"avatar_url": avatarURL,
	})
	req = withURLParam(req, "id", wsID)
	w := testutil.Call(t, testHandler.UpdateWorkspace, req).Want(http.StatusOK)

	var resp WorkspaceResponse
	w.JSON(&resp)
	if resp.AvatarURL == nil || *resp.AvatarURL != avatarURL {
		t.Fatalf("expected avatar_url %q in response, got %v", avatarURL, resp.AvatarURL)
	}
	if resp.Name != "Handler Test Avatar URL" {
		t.Fatalf("name should be unchanged by avatar-only update, got %q", resp.Name)
	}

	var dbAvatar *string
	dbfx.QueryRow(t, `SELECT avatar_url FROM workspace WHERE id = $1`, wsID).Scan(&dbAvatar)
	if dbAvatar == nil || *dbAvatar != avatarURL {
		t.Fatalf("expected avatar_url %q persisted, got %v", avatarURL, dbAvatar)
	}

	// A follow-up update that doesn't include avatar_url must leave it alone.
	req2 := newRequest("PATCH", "/api/workspaces/"+wsID, map[string]any{
		"description": "new description",
	})
	req2 = withURLParam(req2, "id", wsID)
	w2 := testutil.Call(t, testHandler.UpdateWorkspace, req2).Want(http.StatusOK)

	var resp2 WorkspaceResponse
	w2.JSON(&resp2)
	if resp2.AvatarURL == nil || *resp2.AvatarURL != avatarURL {
		t.Fatalf("avatar_url should be preserved by partial update, got %v", resp2.AvatarURL)
	}
}

// recordingWorkspaceRefreshNotifier captures the daemon wakeups a workspace
// write fans out to its members.
type recordingWorkspaceRefreshNotifier struct {
	userIDs []string
}

func (n *recordingWorkspaceRefreshNotifier) NotifyWorkspacesChanged(userID string) {
	n.userIDs = append(n.userIDs, userID)
}

// Daemons cache workspace settings and read the GitHub master switch and the
// Co-authored-by toggle from them. A settings edit that does not wake them
// leaves the old verdict live until the workspace's next repo checkout, which
// is how a disabled Co-authored-by trailer kept landing in commits (MUL-6921).
func TestUpdateWorkspace_NotifiesDaemonsOnSettingsChange(t *testing.T) {
	ctx := context.Background()

	const slug = "handler-tests-settings-notify"
	_, _ = testPool.Exec(ctx, `DELETE FROM workspace WHERE slug = $1`, slug)

	wsID := dbfx.Insert(t, "workspace", testutil.Cols{
		"name":        "Handler Test Settings Notify",
		"slug":        slug,
		"description": "UpdateWorkspace settings notification test",
	})

	dbfx.Exec(t, `
INSERT INTO member (workspace_id, user_id, role)
VALUES ($1, $2, 'owner')
`, wsID, testUserID)

	notifier := &recordingWorkspaceRefreshNotifier{}
	previous := testHandler.DaemonWorkspaceRefresh
	testHandler.DaemonWorkspaceRefresh = notifier
	t.Cleanup(func() { testHandler.DaemonWorkspaceRefresh = previous })

	req := newRequest("PATCH", "/api/workspaces/"+wsID, map[string]any{
		"settings": map[string]any{"co_authored_by_enabled": false},
	})
	req = withURLParam(req, "id", wsID)
	testutil.Call(t, testHandler.UpdateWorkspace, req).Want(http.StatusOK)

	if len(notifier.userIDs) != 1 || notifier.userIDs[0] != testUserID {
		t.Fatalf("settings update notified %v, want exactly the workspace member %s", notifier.userIDs, testUserID)
	}

	// An edit that touches neither the name nor the settings has nothing for
	// daemons to re-read.
	notifier.userIDs = nil
	req2 := newRequest("PATCH", "/api/workspaces/"+wsID, map[string]any{
		"description": "new description",
	})
	req2 = withURLParam(req2, "id", wsID)
	testutil.Call(t, testHandler.UpdateWorkspace, req2).Want(http.StatusOK)

	if len(notifier.userIDs) != 0 {
		t.Fatalf("description-only update notified %v, want no daemon wakeup", notifier.userIDs)
	}
}

func TestUpdateWorkspace_ReposValidation(t *testing.T) {
	ctx := context.Background()

	const slug = "handler-tests-repos-validation"
	_, _ = testPool.Exec(ctx, `DELETE FROM workspace WHERE slug = $1`, slug)

	wsID := dbfx.Insert(t, "workspace", testutil.Cols{
		"name":        "Handler Test Repos Validation",
		"slug":        slug,
		"description": "UpdateWorkspace repos validation test",
	})

	dbfx.Exec(t, `
INSERT INTO member (workspace_id, user_id, role)
VALUES ($1, $2, 'owner')
`, wsID, testUserID)

	t.Run("rejects invalid repo URLs without persisting", func(t *testing.T) {
		req := newRequest("PATCH", "/api/workspaces/"+wsID, map[string]any{
			"repos": []map[string]any{
				{"url": "not-a-url"},
			},
		})
		req = withURLParam(req, "id", wsID)
		testutil.Call(t, testHandler.UpdateWorkspace, req).Want(http.StatusBadRequest)

		var raw []byte
		dbfx.QueryRow(t, `SELECT repos FROM workspace WHERE id = $1`, wsID).Scan(&raw)
		if string(raw) != "[]" {
			t.Fatalf("invalid repos update should not persist, got %s", raw)
		}
	})

	t.Run("normalizes valid repos", func(t *testing.T) {
		req := newRequest("PATCH", "/api/workspaces/"+wsID, map[string]any{
			"repos": []map[string]any{
				{
					"url":         "  https://github.com/auro-ai/auro.git  ",
					"description": "  main monorepo  ",
				},
				{
					"url": "https://github.com/auro-ai/auro.git",
				},
				{
					"url": "git@github.com:auro-ai/auro-cloud.git",
				},
			},
		})
		req = withURLParam(req, "id", wsID)
		testutil.Call(t, testHandler.UpdateWorkspace, req).Want(http.StatusOK)

		var raw []byte
		dbfx.QueryRow(t, `SELECT repos FROM workspace WHERE id = $1`, wsID).Scan(&raw)
		var repos []workspaceRepoRef
		if err := json.Unmarshal(raw, &repos); err != nil {
			t.Fatalf("decode repos: %v", err)
		}
		if len(repos) != 2 {
			t.Fatalf("expected duplicate URL to be deduped, got %d repos: %s", len(repos), raw)
		}
		if repos[0].URL != "https://github.com/auro-ai/auro.git" || repos[0].Description != "main monorepo" {
			t.Fatalf("first repo not normalized: %+v", repos[0])
		}
		if repos[1].URL != "git@github.com:auro-ai/auro-cloud.git" {
			t.Fatalf("second repo not preserved: %+v", repos[1])
		}
	})
}

// revocationFixture is a minimal (workspace, member-to-revoke, runtime,
// agent, queued-task, daemon-token) bundle used to drive the revocation
// tests. The "requester" is always testUserID (owner of the workspace) so
// `newRequest` passes the existing fixtures' auth context unchanged.
type revocationFixture struct {
	WorkspaceID  string
	TargetUserID string
	MemberID     string
	RuntimeID    string
	AgentID      string
	TaskID       string
	DaemonID     string
	TokenHash    string
}

func setupRevocationFixture(t *testing.T, slug, daemonID string) revocationFixture {
	t.Helper()
	ctx := context.Background()

	_, _ = testPool.Exec(ctx, `DELETE FROM workspace WHERE slug = $1`, slug)

	wsID := dbfx.Insert(t, "workspace", testutil.Cols{
		"name":        "Revocation " + slug,
		"slug":        slug,
		"description": "revocation test",
	})

	// Requester (= testUserID) is always an owner so DeleteMember authorization
	// passes. Two owners total so LeaveWorkspace doesn't trip the "must keep
	// at least one owner" guard.
	dbfx.Exec(t, `
INSERT INTO member (workspace_id, user_id, role) VALUES ($1, $2, 'owner')
`, wsID, testUserID)

	targetEmail := fmt.Sprintf("revocation-%s@auro.ai", slug)
	targetUserID := dbfx.Insert(t, "user", testutil.Cols{
		"name":  "Revocation Target " + slug,
		"email": targetEmail,
	})

	// Cleanup ordering: workspace first (cascade clears agent_runtime,
	// agent, member, daemon_token), then user (whose deletion would
	// otherwise be blocked by agent.owner_id / agent_runtime.owner_id FKs).
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM workspace WHERE id = $1`, wsID)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM "user" WHERE id = $1`, targetUserID)
	})

	memberID := dbfx.Insert(t, "member", testutil.Cols{
		"workspace_id": wsID,
		"user_id":      targetUserID,
		"role":         "owner",
	})

	runtimeID := dbfx.Runtime(t, "Target Runtime", testutil.Cols{
		"workspace_id": wsID,
		"daemon_id":    daemonID,
		"runtime_mode": "local",
		"provider":     "auro_daemon",
		"owner_id":     targetUserID,
	})

	agentID := dbfx.Agent(t, "Target Agent", runtimeID, testutil.Cols{
		"workspace_id": wsID,
		"runtime_mode": "local",
		"visibility":   "workspace",
		"owner_id":     targetUserID,
	})

	taskID := dbfx.Task(t, agentID, testutil.Cols{
		"runtime_id": runtimeID,
	})

	// daemon_token row — paired with the runtime's daemon_id so the
	// revocation should sweep its hash up via DeleteDaemonTokensByWorkspaceAndDaemons.
	rawToken := "mdt_test_" + slug
	sum := sha256.Sum256([]byte(rawToken))
	tokenHash := hex.EncodeToString(sum[:])
	dbfx.Exec(t, `
INSERT INTO daemon_token (token_hash, workspace_id, daemon_id, expires_at)
VALUES ($1, $2, $3, now() + interval '1 day')
`, tokenHash, wsID, daemonID)

	return revocationFixture{
		WorkspaceID:  wsID,
		TargetUserID: targetUserID,
		MemberID:     memberID,
		RuntimeID:    runtimeID,
		AgentID:      agentID,
		TaskID:       taskID,
		DaemonID:     daemonID,
		TokenHash:    tokenHash,
	}
}

func assertRevoked(t *testing.T, fx revocationFixture) {
	t.Helper()

	var memberExists bool
	dbfx.QueryRow(t, `SELECT EXISTS (SELECT 1 FROM member WHERE id = $1)`, fx.MemberID).Scan(&memberExists)
	if memberExists {
		t.Fatal("member row was not deleted")
	}

	var runtimeStatus string
	dbfx.QueryRow(t, `SELECT status FROM agent_runtime WHERE id = $1`, fx.RuntimeID).Scan(&runtimeStatus)
	if runtimeStatus != "offline" {
		t.Fatalf("expected runtime offline, got %q", runtimeStatus)
	}

	var archivedAt *string
	dbfx.QueryRow(t, `SELECT archived_at::text FROM agent WHERE id = $1`, fx.AgentID).Scan(&archivedAt)
	if archivedAt == nil {
		t.Fatal("agent was not archived")
	}

	var taskStatus string
	dbfx.QueryRow(t, `SELECT status FROM agent_task_queue WHERE id = $1`, fx.TaskID).Scan(&taskStatus)
	if taskStatus != "cancelled" {
		t.Fatalf("expected task cancelled, got %q", taskStatus)
	}

	var tokenExists bool
	dbfx.QueryRow(t, `SELECT EXISTS (SELECT 1 FROM daemon_token WHERE token_hash = $1)`, fx.TokenHash).Scan(&tokenExists)
	if tokenExists {
		t.Fatal("daemon_token row was not deleted")
	}
}

// TestDeleteMember_RevokesTargetRuntimes verifies that when an admin removes
// another member from a workspace, every runtime owned by the removed member
// has its agents archived, its in-flight tasks cancelled, its row flipped
// offline, and its daemon_token rows deleted — all atomically with the member
// row deletion.
func TestDeleteMember_RevokesTargetRuntimes(t *testing.T) {
	fx := setupRevocationFixture(t, "handler-tests-revoke-kick", "daemon-revoke-kick")

	req := newRequest("DELETE", "/api/workspaces/"+fx.WorkspaceID+"/members/"+fx.MemberID, nil)
	req.Header.Set("X-Workspace-ID", fx.WorkspaceID)
	req = withURLParams(req, "id", fx.WorkspaceID, "memberId", fx.MemberID)
	testutil.Call(t, testHandler.DeleteMember, req).Want(http.StatusNoContent)

	assertRevoked(t, fx)
}

// TestDeleteMember_PrunesChannelUserBindings verifies the application-layer
// replacement for the channel_user_binding member-FK cascade (MUL-3515 §4):
// removing a member prunes that member's channel bindings, in the same tx as
// the member-row delete, while leaving a remaining member's binding intact.
func TestDeleteMember_PrunesChannelUserBindings(t *testing.T) {
	fx := setupRevocationFixture(t, "handler-tests-revoke-binding", "daemon-revoke-binding")

	const appID = "cli_revoke_binding"
	const removedOpenID = "ou_revoke_binding_removed"
	const keepOpenID = "ou_revoke_binding_keep"

	// channel_* rows have no FK to workspace (MUL-3515 §4), so the fixture's
	// workspace-delete cleanup never reaches them; clear by deterministic key
	// both before (in case a prior run was killed mid-test) and after.
	cleanChannel := func() {
		_, _ = testPool.Exec(context.Background(),
			`DELETE FROM channel_user_binding WHERE channel_user_id = ANY($1)`,
			[]string{removedOpenID, keepOpenID})
		_, _ = testPool.Exec(context.Background(),
			`DELETE FROM channel_installation WHERE channel_type = 'feishu' AND config->>'app_id' = $1`, appID)
	}
	cleanChannel()
	t.Cleanup(cleanChannel)

	var installID string
	dbfx.QueryRow(t, `
INSERT INTO channel_installation (workspace_id, agent_id, channel_type, config, installer_user_id)
VALUES ($1, $2, 'feishu', jsonb_build_object('app_id', $3::text), $4)
RETURNING id
`, fx.WorkspaceID, fx.AgentID, appID, testUserID).Scan(&installID)

	// Binding for the member being removed — must be pruned.
	dbfx.Exec(t, `
INSERT INTO channel_user_binding (workspace_id, auro_user_id, installation_id, channel_type, channel_user_id)
VALUES ($1, $2, $3, 'feishu', $4)
`, fx.WorkspaceID, fx.TargetUserID, installID, removedOpenID)

	// Binding for the requester (an owner who stays) — must survive, proving
	// the prune is scoped to the removed user, not the whole workspace.
	dbfx.Exec(t, `
INSERT INTO channel_user_binding (workspace_id, auro_user_id, installation_id, channel_type, channel_user_id)
VALUES ($1, $2, $3, 'feishu', $4)
`, fx.WorkspaceID, testUserID, installID, keepOpenID)

	req := newRequest("DELETE", "/api/workspaces/"+fx.WorkspaceID+"/members/"+fx.MemberID, nil)
	req.Header.Set("X-Workspace-ID", fx.WorkspaceID)
	req = withURLParams(req, "id", fx.WorkspaceID, "memberId", fx.MemberID)
	testutil.Call(t, testHandler.DeleteMember, req).Want(http.StatusNoContent)

	var removedExists bool
	dbfx.QueryRow(t,
		`SELECT EXISTS (SELECT 1 FROM channel_user_binding WHERE channel_user_id = $1)`, removedOpenID).Scan(&removedExists)
	if removedExists {
		t.Fatal("removed member's channel_user_binding was not pruned")
	}

	var keepExists bool
	dbfx.QueryRow(t,
		`SELECT EXISTS (SELECT 1 FROM channel_user_binding WHERE channel_user_id = $1)`, keepOpenID).Scan(&keepExists)
	if !keepExists {
		t.Fatal("remaining member's channel_user_binding was wrongly pruned")
	}
}

// TestLeaveWorkspace_RevokesOwnRuntimes is the self-removal counterpart: when
// a member leaves a workspace voluntarily, their own runtimes are revoked
// with the same atomic write set as DeleteMember.
func TestLeaveWorkspace_RevokesOwnRuntimes(t *testing.T) {
	fx := setupRevocationFixture(t, "handler-tests-revoke-leave", "daemon-revoke-leave")

	// Re-target the request from the leaving member's perspective: the
	// leaver is the request actor, not the workspace owner.
	req := newRequest("DELETE", "/api/workspaces/"+fx.WorkspaceID+"/leave", nil)
	req.Header.Set("X-User-ID", fx.TargetUserID)
	req.Header.Set("X-Workspace-ID", fx.WorkspaceID)
	req = withURLParam(req, "id", fx.WorkspaceID)
	testutil.Call(t, testHandler.LeaveWorkspace, req).Want(http.StatusNoContent)

	assertRevoked(t, fx)
}

// TestDeleteMember_CancelsTasksFromAgentReassignment covers a subtle
// case: an agent's runtime_id can be changed via UpdateAgent, but
// agent_task_queue.runtime_id keeps the value from when the task was
// queued. So after a leaving member is removed, an agent currently bound
// to their runtime gets archived — but tasks that agent queued under a
// PRIOR runtime (still owned by another active member) keep their old
// runtime_id and would not be caught by a runtime-only sweep. Because
// ClaimAgentTask does not gate on agent.archived_at, those orphaned
// queued tasks would remain claimable.
func TestDeleteMember_CancelsTasksFromAgentReassignment(t *testing.T) {
	fx := setupRevocationFixture(t, "handler-tests-revoke-reassign", "daemon-revoke-reassign")

	// Create a SECOND runtime in the workspace owned by the requester
	// (not the leaving member). The agent originally lived here.
	otherRuntimeID := dbfx.Runtime(t, "Other Runtime", testutil.Cols{
		"workspace_id": fx.WorkspaceID,
		"daemon_id":    "daemon-revoke-reassign-other",
		"runtime_mode": "local",
		"provider":     "auro_daemon",
	})

	// Queue a task on the agent while it was still pinned to the OTHER
	// runtime (simulating a task created before the agent was reassigned
	// to the leaving member's runtime).
	orphanTaskID := dbfx.Task(t, fx.AgentID, testutil.Cols{
		"runtime_id": otherRuntimeID,
	})

	req := newRequest("DELETE", "/api/workspaces/"+fx.WorkspaceID+"/members/"+fx.MemberID, nil)
	req.Header.Set("X-Workspace-ID", fx.WorkspaceID)
	req = withURLParams(req, "id", fx.WorkspaceID, "memberId", fx.MemberID)
	testutil.Call(t, testHandler.DeleteMember, req).Want(http.StatusNoContent)

	assertRevoked(t, fx)

	// The orphan task — same agent, different runtime — must also be
	// cancelled. Without the by-agent leg in CancelAgentTasksByRuntimeOrAgent
	// this stays 'queued' and would be picked up by the other runtime.
	var orphanStatus string
	dbfx.QueryRow(t, `SELECT status FROM agent_task_queue WHERE id = $1`, orphanTaskID).Scan(&orphanStatus)
	if orphanStatus != "cancelled" {
		t.Fatalf("expected orphan task cancelled (archived agent leftover on other runtime), got %q", orphanStatus)
	}

	// And the OTHER runtime — owned by an active member — must still be
	// online: revocation is scoped to the leaving member's owned runtimes.
	var otherStatus string
	dbfx.QueryRow(t, `SELECT status FROM agent_runtime WHERE id = $1`, otherRuntimeID).Scan(&otherStatus)
	if otherStatus != "online" {
		t.Fatalf("expected other-member runtime to stay online, got %q", otherStatus)
	}
}

// TestDeleteMember_CancelsDeferredTasks covers the second caller of
// CancelAgentTasksByRuntimeOrAgent. Member revocation must cancel a scheduled
// fallback just like queued/running work; otherwise it could become claimable
// after its owner and runtime access have been removed.
func TestDeleteMember_CancelsDeferredTasks(t *testing.T) {
	fx := setupRevocationFixture(t, "handler-tests-revoke-deferred", "daemon-revoke-deferred")

	deferredTaskID := dbfx.Task(t, fx.AgentID, testutil.Cols{
		"runtime_id": fx.RuntimeID,
		"status":     "deferred",
		"fire_at":    testutil.Raw("now() + interval '1 hour'"),
	})

	req := newRequest("DELETE", "/api/workspaces/"+fx.WorkspaceID+"/members/"+fx.MemberID, nil)
	req.Header.Set("X-Workspace-ID", fx.WorkspaceID)
	req = withURLParams(req, "id", fx.WorkspaceID, "memberId", fx.MemberID)
	testutil.Call(t, testHandler.DeleteMember, req).Want(http.StatusNoContent)

	assertRevoked(t, fx)

	var status string
	var completedAt *time.Time
	dbfx.QueryRow(t,
		`SELECT status, completed_at FROM agent_task_queue WHERE id = $1`,
		deferredTaskID,
	).Scan(&status, &completedAt)
	if status != "cancelled" || completedAt == nil {
		t.Fatalf("deferred task = (%q, %v), want cancelled with completed_at", status, completedAt)
	}
}

// TestDeleteMember_NoRuntimes_DeletesMember covers the empty-revocation
// path: a member with no owned runtimes should still have their member row
// deleted by the same atomic transaction, with no spurious archive/cancel
// writes.
func TestDeleteMember_NoRuntimes_DeletesMember(t *testing.T) {
	ctx := context.Background()
	const slug = "handler-tests-revoke-no-runtimes"
	_, _ = testPool.Exec(ctx, `DELETE FROM workspace WHERE slug = $1`, slug)

	wsID := dbfx.Insert(t, "workspace", testutil.Cols{
		"name":        "Revocation no runtimes",
		"slug":        slug,
		"description": "revocation no-runtimes test",
	})

	dbfx.Exec(t, `
INSERT INTO member (workspace_id, user_id, role) VALUES ($1, $2, 'owner')
`, wsID, testUserID)

	targetUserID := dbfx.Insert(t, "user", testutil.Cols{
		"name":  "Revocation No Runtimes Target",
		"email": "revocation-no-runtimes@auro.ai",
	})
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM workspace WHERE id = $1`, wsID)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM "user" WHERE id = $1`, targetUserID)
	})

	memberID := dbfx.Insert(t, "member", testutil.Cols{
		"workspace_id": wsID,
		"user_id":      targetUserID,
		"role":         "admin",
	})

	req := newRequest("DELETE", "/api/workspaces/"+wsID+"/members/"+memberID, nil)
	req.Header.Set("X-Workspace-ID", wsID)
	req = withURLParams(req, "id", wsID, "memberId", memberID)
	testutil.Call(t, testHandler.DeleteMember, req).Want(http.StatusNoContent)

	var memberExists bool
	dbfx.QueryRow(t, `SELECT EXISTS (SELECT 1 FROM member WHERE id = $1)`, memberID).Scan(&memberExists)
	if memberExists {
		t.Fatal("member row was not deleted")
	}
}

func TestDeleteWorkspace_OwnerSucceeds(t *testing.T) {
	ctx := context.Background()
	wsID := dbfx.Workspace(t, "Delete fixture", fmt.Sprintf("delete-fixture-%d", time.Now().UnixNano()))
	fx := testutil.New(testPool, wsID, testUserID)
	fx.Member(t, wsID, testUserID, "owner")
	runtimeID := fx.Runtime(t, "Delete runtime")
	agentID := fx.Agent(t, "Delete agent", runtimeID)
	chatID := fx.ChatSession(t, agentID)
	messageID := fx.Insert(t, "chat_message", testutil.Cols{"chat_session_id": chatID, "role": "user", "content": "owned message"})
	attachmentID := fx.Insert(t, "attachment", testutil.Cols{"workspace_id": wsID, "chat_session_id": chatID, "chat_message_id": messageID, "uploader_type": "member", "uploader_id": testUserID, "filename": "fixture.txt", "url": "https://example.test/fixture", "content_type": "text/plain", "size_bytes": 1})
	labelID := fx.Insert(t, "label", testutil.Cols{"workspace_id": wsID, "name": "Retained label", "color": "blue", "resource_type": "agent"})
	req := withURLParam(newRequest("DELETE", "/api/workspaces/"+wsID, nil), "id", wsID)
	testutil.Call(t, testHandler.DeleteWorkspace, req).Want(http.StatusNoContent)
	for _, row := range []struct{ table, id string }{{"workspace", wsID}, {"agent_runtime", runtimeID}, {"agent", agentID}, {"chat_session", chatID}, {"chat_message", messageID}, {"attachment", attachmentID}, {"label", labelID}} {
		var exists bool
		if err := testPool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM `+row.table+` WHERE id=$1)`, row.id).Scan(&exists); err != nil {
			t.Fatal(err)
		}
		if exists {
			t.Errorf("%s row survived workspace deletion", row.table)
		}
	}
}
