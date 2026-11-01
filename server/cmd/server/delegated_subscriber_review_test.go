package main

import (
	"testing"

	"github.com/auro-ai/auro/server/internal/events"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/auro-ai/auro/server/pkg/protocol"
)

// Regressions for the MUL-5483 code review. Each test pins one behavior that
// the first cut got wrong.

// countSubscriberAddedEvents subscribes to the bus and counts subscriber:added
// broadcasts for a given issue, so a test can assert on what CLIENTS were told
// rather than only on what the DB holds.
func countSubscriberAddedEvents(bus *events.Bus, issueID string) *int {
	n := 0
	bus.Subscribe(protocol.EventSubscriberAdded, func(e events.Event) {
		p, ok := e.Payload.(map[string]any)
		if !ok {
			return
		}
		if id, _ := p["issue_id"].(string); id == issueID {
			n++
		}
	})
	return &n
}

// TestAddSubscriber_BroadcastsOnRealInsert is the other half: the suppression
// above must not silence legitimate subscriptions.
func TestAddSubscriber_BroadcastsOnRealInsert(t *testing.T) {
	queries := db.New(testPool)
	bus := events.New()

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() { cleanupTestIssue(t, issueID) })

	events := countSubscriberAddedEvents(bus, issueID)
	addSubscriber(bus, queries, testWorkspaceID, issueID, "member", testUserID, "creator")

	if !isSubscribed(t, queries, issueID, "member", testUserID) {
		t.Fatal("expected the subscriber to be written")
	}
	if *events != 1 {
		t.Fatalf("expected exactly 1 subscriber:added event, got %d", *events)
	}
}
