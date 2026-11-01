package service

import (
	"context"
	"sync"
	"testing"

	"github.com/auro-ai/auro/server/internal/events"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/auro-ai/auro/server/pkg/protocol"
	"github.com/jackc/pgx/v5/pgtype"
)

// TestClaimTasksForRuntimes_PromotesDeferredAndEmitsQueuedEvent is the
// regression test for the PR #5193 review must-fix: the batch promote step must
// replay the singular service method's per-row side effects — emit the
// deferred→queued (`task:queued`) event AND invalidate the empty-claim verdict
// via NotifyTaskEnqueued — so a just-promoted deferred task is claimable in the
// SAME batch call rather than sitting idle until the empty key's TTL.
//
// The empty-claim cache is nil in tests (no Redis), so this asserts the two
// directly observable halves of the fix: (1) the promoted task is claimed this
// round, and (2) a `task:queued` event is published for it.
func TestClaimTasksForRuntimes_PromotesDeferredAndEmitsQueuedEvent(t *testing.T) {
	ctx := context.Background()
	pool := newTaskClaimRacePool(t)
	bus := events.New()

	var mu sync.Mutex
	queuedTaskIDs := map[string]int{}
	bus.Subscribe(protocol.EventTaskQueued, func(e events.Event) {
		if payload, ok := e.Payload.(map[string]any); ok {
			if id, ok := payload["task_id"].(string); ok {
				mu.Lock()
				queuedTaskIDs[id]++
				mu.Unlock()
			}
		}
	})

	svc := NewTaskService(db.New(pool), pool, nil, bus)
	rt, deferredTaskID := deferredBatchFixture(t, ctx, pool)

	got, err := svc.ClaimTasksForRuntimes(ctx, []pgtype.UUID{util.MustParseUUID(rt)}, 5)
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	if len(got) != 1 || util.UUIDToString(got[0].ID) != deferredTaskID {
		t.Fatalf("expected the promoted deferred task %s to be claimed this round, got %d tasks", deferredTaskID, len(got))
	}

	mu.Lock()
	n := queuedTaskIDs[deferredTaskID]
	mu.Unlock()
	if n != 1 {
		t.Fatalf("expected exactly one task:queued event for the promoted task, got %d", n)
	}
}
