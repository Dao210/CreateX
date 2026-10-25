package handler

import (
	"github.com/auro-ai/auro/server/internal/testutil"
	"github.com/google/uuid"
	"net/http"
	"net/url"
	"testing"
	"time"
)

func TestSystemArchivedInboxPaginationAndIsolation(t *testing.T) {
	ws := dbfx.Workspace(t, "Paged system archive", "archive-system-"+uuid.NewString())
	dbfx.Member(t, ws, testUserID, "owner")
	created := time.Now().UTC().Truncate(time.Microsecond)
	for range 205 {
		dbfx.Insert(t, "inbox_item", testutil.Cols{"workspace_id": ws, "recipient_type": "member", "recipient_id": testUserID, "type": "autopilot_paused", "severity": "info", "title": "Archived system notice", "archived": true, "created_at": created})
	}
	systemInboxFixture(t, ws, "quick_create_failed", false, true)
	seen := map[string]bool{}
	cursor := ""
	for pageNumber := 0; ; pageNumber++ {
		if pageNumber > 5 {
			t.Fatal("pagination did not terminate")
		}
		var page archivedInboxPageResponse
		testutil.Call(t, inboxWorkspaceHandler(testHandler.ListArchivedInboxPage), inboxRequest(http.MethodGet, "/api/inbox/archived/page?limit=50&cursor="+url.QueryEscape(cursor), ws)).Want(http.StatusOK).JSON(&page)
		for _, item := range page.Items {
			if seen[item.ID] || item.IssueID != nil || item.Type != "autopilot_paused" {
				t.Fatalf("invalid system notification: %+v", item)
			}
			seen[item.ID] = true
		}
		if !page.HasMore {
			break
		}
		if page.NextCursor == nil {
			t.Fatal("next page missing its cursor")
		}
		cursor = *page.NextCursor
	}
	if len(seen) != 205 {
		t.Fatalf("got %d notices, want 205", len(seen))
	}
	var legacy []InboxItemResponse
	testutil.Call(t, inboxWorkspaceHandler(testHandler.ListArchivedInbox), inboxRequest(http.MethodGet, "/api/inbox/archived", ws)).Want(http.StatusOK).JSON(&legacy)
	if len(legacy) != 200 {
		t.Fatalf("legacy archive = %d, want 200", len(legacy))
	}
	other := dbfx.Workspace(t, "Other system archive", "other-system-"+uuid.NewString())
	dbfx.Member(t, other, testUserID, "owner")
	var empty archivedInboxPageResponse
	for id := range seen {
		testutil.Call(t, inboxWorkspaceHandler(testHandler.ListArchivedInboxPage), inboxRequest(http.MethodGet, "/api/inbox/archived/page?group_id="+id, other)).Want(http.StatusOK).JSON(&empty)
		if len(empty.Items) != 0 {
			t.Fatal("cross-workspace archive leak")
		}
		break
	}
}
