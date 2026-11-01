package handler

import (
	"context"
	"time"

	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

// ── Response types ──────────────────────────────────────────────────────────

// ── Converters ──────────────────────────────────────────────────────────────

// ── Helpers ─────────────────────────────────────────────────────────────────

// ── Handlers ────────────────────────────────────────────────────────────────

// ── Squad Members ───────────────────────────────────────────────────────────

// ── Squad Member Status ────────────────────────────────────────────────────

// deriveRuntimeAvailability owns the shared three-state runtime reachability
// policy. Agent projections use these values directly; squad presence maps an
// online runtime to its user-facing "idle" bucket after workload precedence.
func deriveRuntimeAvailability(
	runtimeStatus pgtype.Text,
	lastSeen pgtype.Timestamptz,
	now time.Time,
) string {
	if !runtimeStatus.Valid {
		return "offline"
	}
	if runtimeStatus.String == "online" {
		return "online"
	}
	if !lastSeen.Valid {
		return "offline"
	}
	if now.Sub(lastSeen.Time) < 5*time.Minute {
		return "unstable"
	}
	return "offline"
}

// ── Squad Leader Evaluation ──────────────────────────────────────────────────

// ── Squad Trigger Logic ─────────────────────────────────────────────────────

// shouldSuppressSquadLeaderSelfTrigger reports whether a squad leader's own
// comment should be blocked from re-enqueuing that same leader. The only
// leader-authored non-leader task allowed to wake the assigned leader is a
// same-squad worker task; generic agent tasks such as direct mentions and
// thread-parent replies are not worker-role proof and must not self-trigger.
func (h *Handler) shouldSuppressSquadLeaderSelfTrigger(ctx context.Context, issueID, leaderID, squadID pgtype.UUID) bool {
	latest, err := h.Queries.GetLatestTaskRoleForIssueAndAgent(ctx, db.GetLatestTaskRoleForIssueAndAgentParams{
		IssueID: issueID,
		AgentID: leaderID,
	})
	if err != nil {
		return false
	}
	if latest.IsLeaderTask {
		return true
	}
	return !latest.SquadID.Valid || uuidToString(latest.SquadID) != uuidToString(squadID)
}

// The squad-leader assign/promotion readiness decision now lives in the single
// service.IssueService.WillEnqueueRun predicate (MUL-3375), shared by the issue
// write paths and the preview endpoint. The former handler-local mirrors
// (shouldEnqueueSquadLeaderOnAssign / isSquadLeaderReady) were removed to stop
// the four-entry-point drift. The squad enqueue side effect still flows through
// enqueueSquadLeaderTask below, which keeps the leader access gate and pending
// dedup in one place.
