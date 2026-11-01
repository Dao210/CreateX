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

// subscriberTest helpers — reuse the integration test fixtures from TestMain
// (testPool, testUserID, testWorkspaceID are set in integration_test.go).

// createTestUser inserts a user with the given email and returns the UUID string.
func createTestUser(t *testing.T, email string) string {
	t.Helper()
	ctx := context.Background()
	var userID string
	err := testPool.QueryRow(ctx, `
		INSERT INTO "user" (name, email)
		VALUES ($1, $2)
		RETURNING id
	`, "Subscriber Test User", email).Scan(&userID)
	if err != nil {
		t.Fatalf("createTestUser: %v", err)
	}
	return userID
}

func cleanupTestUser(t *testing.T, email string) {
	t.Helper()
	testPool.Exec(context.Background(), `DELETE FROM "user" WHERE email = $1`, email)
}

func subscriberCount(t *testing.T, queries *db.Queries, issueID string) int {
	t.Helper()
	subs, err := queries.ListIssueSubscribers(context.Background(), util.MustParseUUID(issueID))
	if err != nil {
		t.Fatalf("ListIssueSubscribers: %v", err)
	}
	return len(subs)
}

func TestSubscriberCommentCreated_CommenterSubscribed(t *testing.T) {
	queries := db.New(testPool)
	bus := events.New()
	registerSubscriberListeners(bus, testPool)

	commenterEmail := "subscriber-commenter-test@auro.ai"
	commenterID := createTestUser(t, commenterEmail)
	t.Cleanup(func() { cleanupTestUser(t, commenterEmail) })

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() { cleanupTestIssue(t, issueID) })

	bus.Publish(events.Event{
		Type:        protocol.EventCommentCreated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     commenterID,
		Payload: map[string]any{
			"comment": handler.CommentResponse{
				ID:         "00000000-0000-0000-0000-000000000000",
				IssueID:    issueID,
				AuthorType: "member",
				AuthorID:   commenterID,
				Content:    "test comment",
				Type:       "comment",
			},
		},
	})

	if !isSubscribed(t, queries, issueID, "member", commenterID) {
		t.Fatal("expected commenter to be subscribed after comment:created")
	}
}
