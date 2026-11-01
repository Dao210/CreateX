package service

import (
	"context"
	"testing"

	"github.com/auro-ai/auro/server/internal/events"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TEN-356 regression: the reviewer-loop dedup keyed only on (issue_id,
// agent_id), so a completed/pending verdict for commit A was silently reused to
// satisfy a review request for a NEWER commit B pushed after A's run began —
// giving B zero review coverage. The fix stamps the reviewed head SHA into the
// task's context JSONB and keys HasPendingTaskForIssueAndAgent on it. These
// tests pin the three behaviors at the query layer, where the dedup decision
// actually lives.

func newHeadShaDedupPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	return sharedTestPool(t)
}

// headShaDedupFixture builds a workspace / runtime / agent / issue, plus an
// optional linked PR, and returns the identifiers the dedup tests need. When
// prHeadSha is non-empty a github_pull_request row is created and linked to the
// issue so ResolveIssueReviewSHA has a head to find.
type headShaDedupFixture struct {
	agentID   pgtype.UUID
	runtimeID pgtype.UUID
	issueID   pgtype.UUID
}

// enqueueReviewTask inserts a queued task carrying headSha in its context JSONB,
// mirroring what CreateAgentTask does at enqueue time.
func enqueueReviewTask(t *testing.T, ctx context.Context, q *db.Queries, fx headShaDedupFixture, headSha string) {
	t.Helper()
	if _, err := q.CreateAgentTask(ctx, db.CreateAgentTaskParams{
		AgentID:   fx.agentID,
		RuntimeID: fx.runtimeID,
		IssueID:   fx.issueID,
		Priority:  0,
		HeadSha:   pgtype.Text{String: headSha, Valid: headSha != ""},
	}); err != nil {
		t.Fatalf("create review task (head_sha=%q): %v", headSha, err)
	}
}

const (
	shaA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	shaB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
)

// Fall-back safety: an issue with no linked PR has no review SHA,
// so dedup falls back to the pre-TEN-356 (issue_id, agent_id) key and keeps
// coalescing exactly as before.
func TestHeadShaDedup_NoLinkedPRFallsBackToLegacyKey(t *testing.T) {
	ctx := context.Background()
	pool := newHeadShaDedupPool(t)
	q := db.New(pool)
	fx := createHeadShaDedupFixture(t, ctx, pool, "", "")

	svc := NewTaskService(q, pool, nil, events.New())
	if got := svc.ResolveIssueReviewSHA(ctx, fx.issueID); got != "" {
		t.Fatalf("ResolveIssueReviewSHA with no linked PR = %q, want empty", got)
	}

	// Enqueue with no head_sha (context NULL), then a legacy (empty-SHA) check
	// must still dedup.
	enqueueReviewTask(t, ctx, q, fx, "")
	if !hasPending(t, ctx, q, fx, "") {
		t.Fatalf("no-PR issue must dedup on (issue_id, agent_id) like pre-TEN-356")
	}
}
