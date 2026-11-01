package service

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/auro-ai/auro/server/internal/dispatch"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

// TestAutopilotDispatchAdmitsClickerNotCreator is the acceptance test for
// MUL-4525 §3: a MANUAL "run now" admits on the invoke permission of the human
// who ordered it (not the autopilot creator's), while a dispatch that resolves
// no principal at all is refused. The two must not fork.
func TestAutopilotDispatchAdmitsClickerNotCreator(t *testing.T) {
	pool := newResolveOriginatorPool(t)
	ctx := context.Background()
	q := db.New(pool)
	// Fixture agent is private and owned by ownerID.
	workspaceID, ownerID, agentID, _ := seedAttributionFixture(t, pool)

	// A different member owns the autopilot; they neither own the private agent
	// nor sit on its allow-list, so the creator gate denies them.
	var apCreatorID string
	if err := pool.QueryRow(ctx, `INSERT INTO "user" (name, email) VALUES ('AP Creator', $1) RETURNING id`,
		fmt.Sprintf("apc-%d@auro.test", time.Now().UnixNano())).Scan(&apCreatorID); err != nil {
		t.Fatalf("seed ap creator: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM "user" WHERE id = $1`, apCreatorID) })
	if _, err := pool.Exec(ctx, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1, $2, 'admin')`,
		workspaceID, apCreatorID); err != nil {
		t.Fatalf("seed ap creator member: %v", err)
	}

	ap := db.Autopilot{
		WorkspaceID:   util.MustParseUUID(workspaceID),
		AssigneeID:    util.MustParseUUID(agentID),
		AssigneeType:  "agent",
		ExecutionMode: "run_only",
		Status:        "active",
		CreatedByType: "member",
		CreatedByID:   util.MustParseUUID(apCreatorID),
	}
	svc := &AutopilotService{Queries: q}

	// Manual dispatch by the agent owner is admitted. actorUserID is the human who
	// ORDERED the run — the clicking member, or the originator an agent acts for;
	// the handler resolves and authorizes it (requireAutopilotTriggerInvoker) before
	// this gate ever sees it.
	if reason, _, skip := svc.shouldSkipDispatch(ctx, ap, util.MustParseUUID(ownerID), pgtype.UUID{}); skip {
		t.Fatalf("manual dispatch by the agent owner should be admitted, got skip: %q", reason)
	}

	// Neither an actor nor a trigger: no principal exists to judge, so the gate
	// denies. This argument shape reaches the service only from an automation path
	// that lost its trigger — the manual entry point is refused upstream (#8078).
	//
	// The reason must NOT blame a trigger owner here. Until #8078 it did, and
	// because a manual "run now" passes exactly this pair (no member actor, no
	// trigger row), every agent-initiated trigger reported a broken trigger owner
	// for a trigger that never existed — which is what made the regression cost a
	// day to diagnose. Assert the phrasing, not just the skip.
	reason, code, skip := svc.shouldSkipDispatch(ctx, ap, pgtype.UUID{}, pgtype.UUID{})
	if !skip {
		t.Fatalf("dispatch with no resolvable principal should be blocked")
	}
	if !strings.Contains(strings.ToLower(reason), "no authorizing human") {
		t.Errorf("no-principal skip reason = %q, want the no-authorizing-human phrasing", reason)
	}
	if strings.Contains(strings.ToLower(reason), "trigger's owner") {
		t.Errorf("no-principal skip reason = %q, must not blame a trigger row that does not exist", reason)
	}
	if code != dispatch.ReasonInvocationNotAllowed {
		t.Errorf("skip reason_code = %q, want invocation_not_allowed", code)
	}
}
