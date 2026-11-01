package main

import (
	"context"
	"testing"

	"github.com/auro-ai/auro/server/internal/events"
	"github.com/auro-ai/auro/server/internal/handler"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/auro-ai/auro/server/pkg/protocol"
)

// notificationTest helpers — reuse the integration test fixtures from TestMain
// (testPool, testUserID, testWorkspaceID are set in integration_test.go).

// inboxItemsForRecipient returns all non-archived inbox items for a given recipient.
func inboxItemsForRecipient(t *testing.T, queries *db.Queries, recipientID string) []db.ListInboxItemsRow {
	t.Helper()
	items, err := queries.ListInboxItems(context.Background(), db.ListInboxItemsParams{
		WorkspaceID:   util.MustParseUUID(testWorkspaceID),
		RecipientType: "member",
		RecipientID:   util.MustParseUUID(recipientID),
	})
	if err != nil {
		t.Fatalf("ListInboxItems: %v", err)
	}
	return items
}

// addTestSubscriber manually inserts a subscriber for an issue.
func addTestSubscriber(t *testing.T, issueID, userType, userID, reason string) {
	t.Helper()
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO issue_subscriber (issue_id, user_type, user_id, reason)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (issue_id, user_type, user_id) DO NOTHING
	`, issueID, userType, userID, reason)
	if err != nil {
		t.Fatalf("addTestSubscriber: %v", err)
	}
}

// newNotificationBus creates a bus with subscriber + notification listeners registered.
func newNotificationBus(t *testing.T, queries *db.Queries) *events.Bus {
	t.Helper()
	bus := events.New()
	registerSubscriberListeners(bus, testPool)
	registerNotificationListeners(bus, queries)
	return bus
}

// TestNotification_CommentCreated verifies that all subscribers except the
// commenter receive a "new_comment" notification.
func TestNotification_CommentCreated(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	commenterEmail := "notif-commenter@auro.ai"
	commenterID := createTestUser(t, commenterEmail)
	t.Cleanup(func() { cleanupTestUser(t, commenterEmail) })

	sub1Email := "notif-sub1-comment@auro.ai"
	sub1ID := createTestUser(t, sub1Email)
	t.Cleanup(func() { cleanupTestUser(t, sub1Email) })

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	// Pre-add subscribers: creator and sub1. The commenter will also be added
	// by subscriber_listeners when the event fires.
	addTestSubscriber(t, issueID, "member", testUserID, "creator")
	addTestSubscriber(t, issueID, "member", sub1ID, "assignee")

	bus.Publish(events.Event{
		Type:        protocol.EventCommentCreated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     commenterID, // commenter is the actor
		Payload: map[string]any{
			"comment": handler.CommentResponse{
				ID:         "00000000-0000-0000-0000-000000000000",
				IssueID:    issueID,
				AuthorType: "member",
				AuthorID:   commenterID,
				Content:    "test comment content",
				Type:       "comment",
			},
			"issue_title":  "comment test issue",
			"issue_status": "todo",
		},
	})

	// Creator should get a new_comment notification
	creatorItems := inboxItemsForRecipient(t, queries, testUserID)
	if len(creatorItems) != 1 {
		t.Fatalf("expected 1 inbox item for creator, got %d", len(creatorItems))
	}
	if creatorItems[0].Type != "new_comment" {
		t.Fatalf("expected type 'new_comment', got %q", creatorItems[0].Type)
	}
	if creatorItems[0].Severity != "info" {
		t.Fatalf("expected severity 'info', got %q", creatorItems[0].Severity)
	}

	// sub1 should also get a new_comment notification
	sub1Items := inboxItemsForRecipient(t, queries, sub1ID)
	if len(sub1Items) != 1 {
		t.Fatalf("expected 1 inbox item for sub1, got %d", len(sub1Items))
	}
	if sub1Items[0].Type != "new_comment" {
		t.Fatalf("expected type 'new_comment', got %q", sub1Items[0].Type)
	}

	// Commenter (actor) should NOT get a notification
	commenterItems := inboxItemsForRecipient(t, queries, commenterID)
	if len(commenterItems) != 0 {
		t.Fatalf("expected 0 inbox items for commenter, got %d", len(commenterItems))
	}
}

// TestNotification_SystemCommentSkipsInboxAndMentions guards the MUL-2538
// must-fix: a comment with author_type='system' (the platform-generated
// child-done parent notify) must NOT create any inbox rows for parent
// subscribers and must NOT spawn mention-inbox rows even if the body string
// contains markdown mentions. The reviewer's concern was that a child title
// containing `mention://member/<uuid>` would silently light up that member's
// inbox once the title was transcluded into the system comment body —
// because the generic comment:created listener treated all comments
// identically. The fix is to gate at author_type='system'.
func TestNotification_SystemCommentSkipsInboxAndMentions(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	// Subscriber on the issue who would normally receive new_comment.
	subEmail := "notif-system-comment-sub@auro.ai"
	subID := createTestUser(t, subEmail)
	t.Cleanup(func() { cleanupTestUser(t, subEmail) })

	// A second member whose UUID we will smuggle into the system-comment
	// body as a fake mention to prove the listener does not parse it.
	targetEmail := "notif-system-comment-target@auro.ai"
	targetID := createTestUser(t, targetEmail)
	t.Cleanup(func() { cleanupTestUser(t, targetEmail) })

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	addTestSubscriber(t, issueID, "member", subID, "manual")

	// Publish a system-authored comment that transcludes a member mention
	// in the body — the exact attack vector the reviewer flagged. If the
	// generic listener path runs, the new_comment row will fire for `sub`
	// and the mention path will fire for `target`.
	bus.Publish(events.Event{
		Type:        protocol.EventCommentCreated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "system",
		ActorID:     "",
		Payload: map[string]any{
			"comment": handler.CommentResponse{
				ID:         "00000000-0000-0000-0000-000000000000",
				IssueID:    issueID,
				AuthorType: "system",
				AuthorID:   "00000000-0000-0000-0000-000000000000",
				Content:    "Sub-issue done — see [@Target](mention://member/" + targetID + ").",
				Type:       "system",
			},
			"issue_title":  "system comment isolation",
			"issue_status": "in_progress",
		},
	})

	if items := inboxItemsForRecipient(t, queries, subID); len(items) != 0 {
		t.Errorf("expected 0 inbox rows for issue subscriber, got %d", len(items))
	}
	if items := inboxItemsForRecipient(t, queries, targetID); len(items) != 0 {
		t.Errorf("expected 0 inbox rows for smuggled @mention target, got %d", len(items))
	}
}

// TestSubscriberSystemCommentDoesNotSubscribe guards the same boundary on
// the subscriber listener: a system-authored comment must NOT be treated as
// "a commenter joined the conversation." The CHECK constraint on
// issue_subscriber.user_type only permits ('member','agent'); without the
// author_type='system' early-return, AddIssueSubscriber would log a noisy
// constraint violation on every child-done event.
func TestSubscriberSystemCommentDoesNotSubscribe(t *testing.T) {
	queries := db.New(testPool)
	bus := events.New()
	registerSubscriberListeners(bus, testPool)

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() { cleanupTestIssue(t, issueID) })

	bus.Publish(events.Event{
		Type:        protocol.EventCommentCreated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "system",
		ActorID:     "",
		Payload: map[string]any{
			"comment": handler.CommentResponse{
				ID:         "00000000-0000-0000-0000-000000000000",
				IssueID:    issueID,
				AuthorType: "system",
				AuthorID:   "00000000-0000-0000-0000-000000000000",
				Content:    "platform notify",
				Type:       "system",
			},
		},
	})

	if count := subscriberCount(t, queries, issueID); count != 0 {
		t.Fatalf("expected 0 subscribers after system comment, got %d", count)
	}
}

// TestNotification_TaskCompleted verifies that task:completed events do NOT
// create inbox notifications (completion is visible from the status change).
func TestNotification_TaskCompleted(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	// The agent ID (acting as system actor)
	agentID := "00000000-0000-0000-0000-aaaaaaaaaaaa"

	// Pre-add subscribers: creator and the agent
	addTestSubscriber(t, issueID, "member", testUserID, "creator")
	addTestSubscriber(t, issueID, "agent", agentID, "assignee")

	bus.Publish(events.Event{
		Type:        protocol.EventTaskCompleted,
		WorkspaceID: testWorkspaceID,
		ActorType:   "system",
		ActorID:     "",
		Payload: map[string]any{
			"task_id":  "00000000-0000-0000-0000-bbbbbbbbbbbb",
			"agent_id": agentID,
			"issue_id": issueID,
			"status":   "completed",
		},
	})

	// No inbox notification should be created for task:completed
	creatorItems := inboxItemsForRecipient(t, queries, testUserID)
	if len(creatorItems) != 0 {
		t.Fatalf("expected 0 inbox items for creator on task:completed, got %d", len(creatorItems))
	}
}

// TestNotification_TaskFailed verifies that subscribers get a "task_failed"
// notification when a task fails, excluding the agent.
func TestNotification_TaskFailed(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	agentID := "00000000-0000-0000-0000-aaaaaaaaaaaa"

	addTestSubscriber(t, issueID, "member", testUserID, "creator")
	addTestSubscriber(t, issueID, "agent", agentID, "assignee")

	bus.Publish(events.Event{
		Type:        protocol.EventTaskFailed,
		WorkspaceID: testWorkspaceID,
		ActorType:   "system",
		ActorID:     "",
		Payload: map[string]any{
			"task_id":  "00000000-0000-0000-0000-bbbbbbbbbbbb",
			"agent_id": agentID,
			"issue_id": issueID,
			"status":   "failed",
		},
	})

	creatorItems := inboxItemsForRecipient(t, queries, testUserID)
	if len(creatorItems) != 1 {
		t.Fatalf("expected 1 inbox item for creator, got %d", len(creatorItems))
	}
	if creatorItems[0].Type != "task_failed" {
		t.Fatalf("expected type 'task_failed', got %q", creatorItems[0].Type)
	}
	if creatorItems[0].Severity != "action_required" {
		t.Fatalf("expected severity 'action_required', got %q", creatorItems[0].Severity)
	}
}

// countInboxByTypeForRecipient counts inbox rows of a given type for a
// recipient, including archived rows. Used to distinguish "row never created"
// from "row archived."
func countInboxByTypeForRecipient(t *testing.T, recipientID, notifType string) (active, archived int) {
	t.Helper()
	rows, err := testPool.Query(context.Background(), `
		SELECT archived FROM inbox_item
		WHERE workspace_id = $1 AND recipient_type = 'member' AND recipient_id = $2 AND type = $3
	`, testWorkspaceID, recipientID, notifType)
	if err != nil {
		t.Fatalf("countInboxByTypeForRecipient: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var isArchived bool
		if err := rows.Scan(&isArchived); err != nil {
			t.Fatalf("countInboxByTypeForRecipient scan: %v", err)
		}
		if isArchived {
			archived++
		} else {
			active++
		}
	}
	return active, archived
}

// TestNotification_StatusChange_ArchivesStaleTaskFailed verifies that when an
// issue transitions into a terminal status (in_review/done/cancelled), any
// existing task_failed inbox rows for that issue are archived for every
// affected member recipient, an inbox:batch-archived event fires per
// recipient, and sibling notifications on the same issue are untouched.
func TestNotification_StatusChange_ArchivesStaleTaskFailed(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	subEmail := "notif-archive-task-failed-sub@auro.ai"
	subID := createTestUser(t, subEmail)
	t.Cleanup(func() { cleanupTestUser(t, subEmail) })

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	addTestSubscriber(t, issueID, "member", testUserID, "creator")
	addTestSubscriber(t, issueID, "member", subID, "assignee")

	agentID := "00000000-0000-0000-0000-aaaaaaaaaaaa"

	// Two failed runs land before the status flip.
	for i := 0; i < 2; i++ {
		bus.Publish(events.Event{
			Type:        protocol.EventTaskFailed,
			WorkspaceID: testWorkspaceID,
			ActorType:   "system",
			Payload: map[string]any{
				"task_id":  "00000000-0000-0000-0000-bbbbbbbbbbbb",
				"agent_id": agentID,
				"issue_id": issueID,
			},
		})
	}

	// A separate non-task notification on the same issue, so we can prove
	// the archive scope is narrow. Use a comment-like notification by
	// directly inserting a row of a different type.
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO inbox_item (workspace_id, recipient_type, recipient_id, type, severity, issue_id, title, details)
		VALUES ($1, 'member', $2, 'new_comment', 'info', $3, 'sibling notification', '{}')
	`, testWorkspaceID, testUserID, issueID)
	if err != nil {
		t.Fatalf("seed sibling notification: %v", err)
	}

	if active, _ := countInboxByTypeForRecipient(t, testUserID, "task_failed"); active != 2 {
		t.Fatalf("precondition: expected 2 active task_failed rows for creator, got %d", active)
	}
	if active, _ := countInboxByTypeForRecipient(t, subID, "task_failed"); active != 2 {
		t.Fatalf("precondition: expected 2 active task_failed rows for sub, got %d", active)
	}

	// Track the batch-archived events fired during the status change.
	var batchArchived []events.Event
	bus.Subscribe(protocol.EventInboxBatchArchived, func(e events.Event) {
		batchArchived = append(batchArchived, e)
	})

	publishStatusChange(bus, issueID, "in_review", "in_progress")

	// task_failed rows are archived for both recipients.
	for _, recipient := range []string{testUserID, subID} {
		active, archived := countInboxByTypeForRecipient(t, recipient, "task_failed")
		if active != 0 {
			t.Fatalf("recipient %s: expected 0 active task_failed rows after terminal status, got %d", recipient, active)
		}
		if archived != 2 {
			t.Fatalf("recipient %s: expected 2 archived task_failed rows after terminal status, got %d", recipient, archived)
		}
	}

	// Sibling notification on the same issue is untouched.
	if active, _ := countInboxByTypeForRecipient(t, testUserID, "new_comment"); active != 1 {
		t.Fatalf("expected sibling new_comment row to remain active, got %d active", active)
	}

	// One inbox:batch-archived event per affected recipient.
	if len(batchArchived) != 2 {
		t.Fatalf("expected 2 inbox:batch-archived events (one per recipient), got %d", len(batchArchived))
	}
	seenRecipients := map[string]bool{}
	for _, e := range batchArchived {
		payload, ok := e.Payload.(map[string]any)
		if !ok {
			t.Fatalf("inbox:batch-archived: unexpected payload type %T", e.Payload)
		}
		recipientID, _ := payload["recipient_id"].(string)
		if recipientID == "" {
			t.Fatalf("inbox:batch-archived: missing recipient_id in payload %+v", payload)
		}
		if payload["issue_id"] != issueID {
			t.Fatalf("inbox:batch-archived: expected issue_id %q, got %v", issueID, payload["issue_id"])
		}
		if payload["reason"] != "issue_status_terminal" {
			t.Fatalf("inbox:batch-archived: expected reason 'issue_status_terminal', got %v", payload["reason"])
		}
		if count, _ := payload["count"].(int64); count != 2 {
			t.Fatalf("inbox:batch-archived: expected count=2 for recipient %s, got %v", recipientID, payload["count"])
		}
		seenRecipients[recipientID] = true
	}
	if !seenRecipients[testUserID] || !seenRecipients[subID] {
		t.Fatalf("expected batch-archived events for both creator and sub, got %v", seenRecipients)
	}
}

// TestNotification_StatusChange_NonTerminalKeepsTaskFailed verifies that a
// transition to a non-terminal status (e.g. in_progress) does NOT archive
// existing task_failed inbox rows.
func TestNotification_StatusChange_NonTerminalKeepsTaskFailed(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	addTestSubscriber(t, issueID, "member", testUserID, "creator")

	bus.Publish(events.Event{
		Type:        protocol.EventTaskFailed,
		WorkspaceID: testWorkspaceID,
		ActorType:   "system",
		Payload: map[string]any{
			"task_id":  "00000000-0000-0000-0000-bbbbbbbbbbbb",
			"agent_id": "00000000-0000-0000-0000-aaaaaaaaaaaa",
			"issue_id": issueID,
		},
	})

	if active, _ := countInboxByTypeForRecipient(t, testUserID, "task_failed"); active != 1 {
		t.Fatalf("precondition: expected 1 active task_failed row, got %d", active)
	}

	publishStatusChange(bus, issueID, "in_progress", "todo")

	// task_failed row stays active because in_progress is not terminal.
	active, archived := countInboxByTypeForRecipient(t, testUserID, "task_failed")
	if active != 1 || archived != 0 {
		t.Fatalf("expected task_failed row to remain active after non-terminal transition, got active=%d archived=%d", active, archived)
	}
}

// TestNotification_StatusChange_ReopenSurfacesNewTaskFailed verifies that
// after a terminal-status auto-archive, a status flip back to in_progress
// followed by a new task failure produces a fresh, visible task_failed row.
// This guards the "reopen and rerun" path described in the design.
func TestNotification_StatusChange_ReopenSurfacesNewTaskFailed(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	addTestSubscriber(t, issueID, "member", testUserID, "creator")

	agentID := "00000000-0000-0000-0000-aaaaaaaaaaaa"

	bus.Publish(events.Event{
		Type:        protocol.EventTaskFailed,
		WorkspaceID: testWorkspaceID,
		ActorType:   "system",
		Payload: map[string]any{
			"task_id":  "00000000-0000-0000-0000-bbbbbbbbbbbb",
			"agent_id": agentID,
			"issue_id": issueID,
		},
	})

	// First terminal transition archives the original failure.
	publishStatusChange(bus, issueID, "in_review", "in_progress")
	if active, archived := countInboxByTypeForRecipient(t, testUserID, "task_failed"); active != 0 || archived != 1 {
		t.Fatalf("after terminal transition: expected active=0 archived=1, got active=%d archived=%d", active, archived)
	}

	// Reviewer kicks the issue back; a rerun fails again.
	publishStatusChange(bus, issueID, "in_progress", "in_review")
	bus.Publish(events.Event{
		Type:        protocol.EventTaskFailed,
		WorkspaceID: testWorkspaceID,
		ActorType:   "system",
		Payload: map[string]any{
			"task_id":  "00000000-0000-0000-0000-cccccccccccc",
			"agent_id": agentID,
			"issue_id": issueID,
		},
	})

	// The new failure is visible; the old archived row stays archived.
	active, archived := countInboxByTypeForRecipient(t, testUserID, "task_failed")
	if active != 1 {
		t.Fatalf("expected 1 active task_failed row after reopen+fail, got %d", active)
	}
	if archived != 1 {
		t.Fatalf("expected 1 archived task_failed row preserved from prior cycle, got %d", archived)
	}
}
