package handler

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/auro-ai/auro/server/internal/testutil"
)

func TestListTimeline_ReturnsAllEntriesAscending(t *testing.T) {
	issueID := createIssueForTimeline(t, "All entries test")
	commentIDs, _ := seedTimelineEntries(t, issueID, 5, 0)

	entries, status := fetchTimeline(t, issueID)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	// Handler tests don't register the activity listener (that lives in
	// cmd/server), so issue creation does not seed an auto-activity here.
	// We assert directly on the seeded comments.
	commentEntries := []TimelineEntry{}
	for _, e := range entries {
		if e.Type == "comment" {
			commentEntries = append(commentEntries, e)
		}
	}
	if got, want := len(commentEntries), len(commentIDs); got != want {
		t.Fatalf("comment count = %d, want %d", got, want)
	}
	for i, e := range commentEntries {
		if e.ID != commentIDs[i] {
			t.Errorf("entry %d: id = %s, want %s", i, e.ID, commentIDs[i])
		}
	}
}

func TestListTimeline_MergesCommentsAndActivities(t *testing.T) {
	issueID := createIssueForTimeline(t, "Merged entries test")
	seedTimelineEntries(t, issueID, 3, 2)

	entries, status := fetchTimeline(t, issueID)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	// Verify chronological non-decreasing order across types.
	for i := 1; i < len(entries); i++ {
		if entries[i-1].CreatedAt > entries[i].CreatedAt {
			t.Errorf("not chronological at %d: %q then %q",
				i, entries[i-1].CreatedAt, entries[i].CreatedAt)
		}
	}
	// 3 seeded comments + 2 seeded activities = 5. Handler tests don't
	// register the activity listener, so there is no auto issue-created row.
	if got, want := len(entries), 5; got != want {
		t.Fatalf("entries = %d, want %d", got, want)
	}
}

func TestListTimeline_HydratesDepartedMemberIdentity(t *testing.T) {
	const (
		name      = "Former Timeline Member"
		avatarURL = "https://profiles.example.com/former.png"
	)
	userID := dbfx.User(
		t,
		name,
		fmt.Sprintf("former-timeline-%d@example.com", time.Now().UnixNano()),
		testutil.Cols{"avatar_url": avatarURL},
	)
	memberID := dbfx.Member(t, testWorkspaceID, userID, "member")
	issueID := dbfx.Issue(t, "Departed member timeline identity")
	commentID := dbfx.Comment(t, issueID, "Authored before leaving", testutil.Cols{
		"author_id": userID,
	})
	activityID := dbfx.Insert(t, "activity_log", testutil.Cols{
		"workspace_id": testWorkspaceID,
		"issue_id":     issueID,
		"actor_type":   "member",
		"actor_id":     userID,
		"action":       "description_updated",
		"details":      testutil.Raw("'{}'::jsonb"),
	})

	// Membership is current workspace state. Timeline attribution must keep
	// resolving through the global user row after that state is removed.
	dbfx.Exec(t, `DELETE FROM member WHERE id = $1`, memberID)

	entries, status := fetchTimeline(t, issueID)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	wantIDs := map[string]bool{commentID: false, activityID: false}
	for _, entry := range entries {
		if _, ok := wantIDs[entry.ID]; !ok {
			continue
		}
		wantIDs[entry.ID] = true
		if entry.ActorName != name {
			t.Errorf("entry %s actor_name = %q, want %q", entry.ID, entry.ActorName, name)
		}
		if entry.ActorAvatarURL != avatarURL {
			t.Errorf("entry %s actor_avatar_url = %q, want %q", entry.ID, entry.ActorAvatarURL, avatarURL)
		}
	}
	for id, found := range wantIDs {
		if !found {
			t.Errorf("timeline entry %s missing", id)
		}
	}
}

// Boundary-compat: a stale client between #2128 and #1929 sends ?limit=50
// and parses the response with TimelinePageSchema. The handler must keep
// returning the wrapped object so that path doesn't fall back to an empty
// timeline.
func TestListTimeline_LegacyWrappedShape_OnPaginationParams(t *testing.T) {
	issueID := createIssueForTimeline(t, "Legacy wrapped shape test")
	commentIDs, _ := seedTimelineEntries(t, issueID, 3, 0)

	resp, status := fetchTimelineWrapped(t, issueID, "limit=50")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if resp.HasMoreBefore || resp.HasMoreAfter {
		t.Errorf("has_more_*: want false/false, got before=%v after=%v",
			resp.HasMoreBefore, resp.HasMoreAfter)
	}
	if resp.NextCursor != nil || resp.PrevCursor != nil {
		t.Errorf("cursors: want nil/nil, got next=%v prev=%v", resp.NextCursor, resp.PrevCursor)
	}
	// DESC order: most recent comment first; activity from issue-creation
	// sits at the bottom.
	commentEntries := []TimelineEntry{}
	for _, e := range resp.Entries {
		if e.Type == "comment" {
			commentEntries = append(commentEntries, e)
		}
	}
	if got, want := len(commentEntries), len(commentIDs); got != want {
		t.Fatalf("comment count = %d, want %d", got, want)
	}
	for i, e := range commentEntries {
		want := commentIDs[len(commentIDs)-1-i]
		if e.ID != want {
			t.Errorf("DESC entry %d: id = %s, want %s", i, e.ID, want)
		}
	}
}

func TestListTimeline_LegacyWrappedShape_AroundFillsTargetIndex(t *testing.T) {
	issueID := createIssueForTimeline(t, "Around target index test")
	commentIDs, _ := seedTimelineEntries(t, issueID, 5, 0)
	anchor := commentIDs[2] // pick a middle comment

	resp, status := fetchTimelineWrapped(t, issueID, "around="+anchor)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if resp.TargetIndex == nil {
		t.Fatalf("target_index: want non-nil for around mode")
	}
	if got := resp.Entries[*resp.TargetIndex].ID; got != anchor {
		t.Errorf("target_index points at %s, want anchor %s", got, anchor)
	}
}
