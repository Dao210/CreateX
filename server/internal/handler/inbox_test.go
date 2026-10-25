package handler

import (
	"net/http"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/auro-ai/auro/server/internal/middleware"
	"github.com/auro-ai/auro/server/internal/testutil"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

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
	task := dbfx.Issue(t, "Retired task", testutil.Cols{"workspace_id": ws})
	dbfx.Insert(t, "inbox_item", testutil.Cols{"workspace_id": ws, "recipient_type": "member", "recipient_id": testUserID, "type": "issue_assigned", "severity": "info", "title": "Retired task", "issue_id": task})
	var items []InboxItemResponse
	testutil.Call(t, inboxWorkspaceHandler(testHandler.ListInbox), inboxRequest(http.MethodGet, "/api/inbox", ws)).Want(http.StatusOK).JSON(&items)
	if len(items) != 1 || items[0].ID != notice || items[0].IssueID != nil || items[0].IssueStatus != nil || items[0].IssuePriority != nil {
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

func TestInboxListBodyPreview(t *testing.T) {
	issue := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	text := func(s string) pgtype.Text { return pgtype.Text{String: s, Valid: true} }
	long := strings.Repeat("a", 5000)
	// Every CJK character is three bytes in UTF-8: a byte-based cut would land
	// mid-character and produce invalid UTF-8.
	longCJK := strings.Repeat("评论内容", 500)

	cases := []struct {
		name      string
		notifType string
		issueID   pgtype.UUID
		body      pgtype.Text
		want      *string
	}{
		{"null body stays null", "new_comment", issue, pgtype.Text{}, nil},
		{"short comment is untouched", "new_comment", issue, text("looks good"), ptr("looks good")},
		{"exactly at the limit is untouched", "new_comment", issue,
			text(strings.Repeat("a", inboxListBodyPreviewLimit)),
			ptr(strings.Repeat("a", inboxListBodyPreviewLimit))},
		{"one past the limit is cut, ellipsis included", "new_comment", issue,
			text(strings.Repeat("a", inboxListBodyPreviewLimit+1)),
			ptr(strings.Repeat("a", inboxListBodyPreviewLimit-1) + "…")},
		{"long comment is cut to the limit", "new_comment", issue, text(long),
			ptr(strings.Repeat("a", inboxListBodyPreviewLimit-1) + "…")},
		// Issue-less notifications render their body in the detail pane from
		// the list cache, so shortening them would lose content.
		{"comment without an issue keeps its full body", "new_comment", pgtype.UUID{}, text(long), ptr(long)},
		// Other types are out of scope even when issue-backed: their body is
		// not merely a preview of something the issue page shows.
		{"other types keep their full body", "task_failed", issue, text(long), ptr(long)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := inboxListBody(tc.notifType, tc.issueID, tc.body)
			switch {
			case tc.want == nil && got != nil:
				t.Fatalf("body = %q, want nil", *got)
			case tc.want != nil && got == nil:
				t.Fatalf("body = nil, want %d characters", utf8.RuneCountInString(*tc.want))
			case tc.want != nil && *got != *tc.want:
				t.Fatalf("body = %d characters %q…, want %d characters",
					utf8.RuneCountInString(*got), truncateForLog(*got),
					utf8.RuneCountInString(*tc.want))
			}
		})
	}

	t.Run("multi-byte text is cut on a character boundary", func(t *testing.T) {
		got := inboxListBody("new_comment", issue, text(longCJK))
		if got == nil {
			t.Fatal("body = nil")
		}
		if !utf8.ValidString(*got) {
			t.Fatalf("preview is not valid UTF-8: %q", truncateForLog(*got))
		}
		if n := utf8.RuneCountInString(*got); n != inboxListBodyPreviewLimit {
			t.Fatalf("preview = %d characters, want %d", n, inboxListBodyPreviewLimit)
		}
		if !strings.HasSuffix(*got, "…") {
			t.Fatalf("preview does not end with an ellipsis: %q", truncateForLog(*got))
		}
	})
}

// Both inbox lists ship the preview, the stored row keeps the whole comment,
// and a notification that needs its full body still gets it.

func truncateForLog(s string) string {
	if r := []rune(s); len(r) > 40 {
		return string(r[:40])
	}
	return s
}
