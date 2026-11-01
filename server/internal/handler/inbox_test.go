package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/auro-ai/auro/server/internal/middleware"
	"github.com/auro-ai/auro/server/internal/testutil"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/google/uuid"
)

func TestInboxResponseKeepsNullRetiredFieldsAndStructuredContent(t *testing.T) {
	content := []byte(`{"entries":[],"totalEntries":1}`)
	raw, err := json.Marshal(inboxToResponse(db.InboxItem{Type: "world_digest", Content: content}))
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"issue_id", "issue_status", "issue_priority"} {
		if string(fields[name]) != "null" {
			t.Fatalf("compatibility field %s=%s, want null", name, fields[name])
		}
	}
	if string(fields["content"]) != string(content) {
		t.Fatalf("content=%s", fields["content"])
	}
}

func inboxRequest(method, path, workspaceID string) *http.Request {
	return testutil.WithHeaders(testutil.JSONRequest(method, path, nil), "X-User-ID", testUserID, "X-Workspace-ID", workspaceID)
}

func inboxWorkspaceHandler(handler http.HandlerFunc) http.HandlerFunc {
	return middleware.RequireWorkspaceMember(testHandler.Queries)(handler).ServeHTTP
}

func systemInboxFixture(t *testing.T, workspaceID, kind string, read, archived bool) string {
	t.Helper()
	return dbfx.Insert(t, "inbox_item", testutil.Cols{
		"workspace_id": workspaceID, "recipient_type": "member", "recipient_id": testUserID,
		"type": kind, "severity": "info", "title": kind, "read": read, "archived": archived,
	})
}

func TestSystemInboxExcludesRetiredTaskNotifications(t *testing.T) {
	ws := dbfx.Workspace(t, "System inbox", "system-inbox-"+uuid.NewString())
	dbfx.Member(t, ws, testUserID, "owner")
	notice := systemInboxFixture(t, ws, "autopilot_paused", false, false)
	systemInboxFixture(t, ws, "quick_create_failed", false, false)
	systemInboxFixture(t, ws, "issue_assigned", false, false)
	var items []InboxItemResponse
	testutil.Call(t, inboxWorkspaceHandler(testHandler.ListInbox), inboxRequest(http.MethodGet, "/api/inbox", ws)).Want(http.StatusOK).JSON(&items)
	if len(items) != 1 || items[0].ID != notice || items[0].LegacyIssueID != nil || items[0].LegacyIssueStatus != nil || items[0].LegacyIssuePriority != nil {
		t.Fatalf("unexpected system inbox: %+v", items)
	}
	var summary []struct {
		WorkspaceID string `json:"workspace_id"`
		Count       int64  `json:"count"`
	}
	testutil.Call(t, inboxWorkspaceHandler(testHandler.UnreadInboxSummary), inboxRequest(http.MethodGet, "/api/inbox/unread-summary", ws)).Want(http.StatusOK).JSON(&summary)
	found := false
	for _, row := range summary {
		if row.WorkspaceID == ws {
			found = true
			if row.Count != 1 {
				t.Fatalf("unread = %d, want 1", row.Count)
			}
		}
	}
	if !found {
		t.Fatal("system notification missing from unread summary")
	}
}

func TestSystemInboxReadUnreadAndArchive(t *testing.T) {
	ws := dbfx.Workspace(t, "System actions", "system-actions-"+uuid.NewString())
	dbfx.Member(t, ws, testUserID, "owner")
	id := systemInboxFixture(t, ws, "autopilot_paused", false, false)
	for _, action := range []struct {
		handler http.HandlerFunc
		path    string
	}{
		{testHandler.MarkInboxRead, "/api/inbox/" + id + "/read"},
		{testHandler.MarkInboxUnread, "/api/inbox/" + id + "/unread"},
		{testHandler.ArchiveInboxItem, "/api/inbox/" + id + "/archive"},
		{testHandler.UnarchiveInboxItem, "/api/inbox/" + id + "/unarchive"},
	} {
		req := inboxRequest(http.MethodPost, action.path, ws)
		req.SetPathValue("id", id)
		// Chi owns URL parameters in production; exercise the shared middleware path.
		testutil.Call(t, inboxWorkspaceHandler(action.handler), withURLParam(req, "id", id)).Want(http.StatusOK)
	}
}
