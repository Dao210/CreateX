package handler

import (
	"context"
	"testing"

	"github.com/auro-ai/auro/server/internal/util"
	"github.com/jackc/pgx/v5/pgtype"
)

// autopilotDelegationFixture builds the create_issue scenario: a member-created
// autopilot creates an issue, and its dispatched leader agent runs a task ON that
// issue and authors an @mention delegation comment whose source_task_id points
// back at that leader task.
//
// Since MUL-6951 that leader task carries a real ORIGINATOR — the human
// responsible for the firing trigger — exactly as a live schedule/webhook run
// does. So the invoke gate judges these comments by that human's own rights, with
// no autopilot-specific borrow path involved. The fields stay exposed so tests can
// rewrite the comment's source_task_id, or strip the originator, and prove the
// gate then fails closed.

// TestAutopilotCommentAuthority_KeysOnRunOriginator pins the post-MUL-6951 rule
// for an autopilot run delegating mid-chain: the invoke gate keys on the run's own
// originator — the human who armed the trigger — and nothing else. There is no
// autopilot-shaped borrow path left, so the issue's provenance, the autopilot's
// creator and the task/issue binding no longer enter the decision; what remains is
// "does THIS human hold invoke rights", which is the same question asked of a
// member acting directly.
//
// The negative cases that matter are therefore the two below: a human without
// rights, and no human at all.
func TestAutopilotCommentAuthority_KeysOnRunOriginator(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	// agentID: private (default) agent owned by ownerID. plainMemberID: unrelated.
	agentID, ownerID, plainMemberID := privateAgentTestFixture(t)

	// mentionTriggersTarget runs the trigger compute the way the live comment paths
	// do — with the originator resolved from the speaking run — and reports whether
	// the private target fires.
	mentionTriggersTarget := func(fx autopilotDelegationFixture, originatorUserID string) bool {
		triggers, _ := testHandler.computeCommentAgentTriggers(
			ctx, fx.Issue, fx.Comment.Content, nil, "agent", fx.LeaderAgentID,
			commentTriggerComputeOptions{
				ExcludeTriggerCommentID: fx.Comment.ID,
				OriginatorUserID:        originatorUserID,
			},
		)
		for _, tr := range triggers {
			if uuidToString(tr.Agent.ID) == agentID {
				return true
			}
		}
		return false
	}

	t.Run("trigger owner owns the target -> triggers", func(t *testing.T) {
		fx := newAutopilotDelegationFixture(t, agentID, ownerID, "autopilot")
		if !mentionTriggersTarget(fx, ownerID) {
			t.Fatal("an autopilot run carrying its trigger owner must reach a private agent that owner owns")
		}
	})

	t.Run("trigger owner without invoke rights -> denied", func(t *testing.T) {
		fx := newAutopilotDelegationFixture(t, agentID, plainMemberID, "autopilot")
		if mentionTriggersTarget(fx, plainMemberID) {
			t.Fatal("a trigger owner with no invoke rights must not reach a private agent")
		}
	})

	t.Run("no originator on the run -> fails closed", func(t *testing.T) {
		// A run that reached this gate with no human at the top of its chain (a
		// legacy row, or a broken originator chain N hops back) must be denied
		// rather than fall back to any autopilot-derived identity.
		fx := newAutopilotDelegationFixture(t, agentID, ownerID, "autopilot")
		if mentionTriggersTarget(fx, "") {
			t.Fatal("a run with no human originator must not reach a private agent")
		}
	})
}

// TestReconcileCommentsOnCompletion_AutopilotDelegationRestoresAuthority is the
// MUL-4857 must-fix #1 (review round 2): when the mentioned target was BUSY at
// delegation time, the delegation is deferred to the target's completion
// reconcile. That replay must restore the SAME autopilot-creator authority from
// the comment's source_task_id — otherwise the unattributed autopilot chain's
// follow-up is gate-denied again and the delegation is silently lost.
func TestReconcileCommentsOnCompletion_AutopilotDelegationRestoresAuthority(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	workerID, ownerID, plainMemberID := privateAgentTestFixture(t)

	// followUps drives the reconcile: an autopilot delegation comment mentions the
	// busy private worker, the worker's task then completes, and we count the
	// follow-up tasks the completion reconcile enqueues for it.
	followUps := func(t *testing.T, creatorUserID string) (string, int) {
		fx := newAutopilotDelegationFixture(t, workerID, creatorUserID, "autopilot")
		issueID := uuidToString(fx.Issue.ID)
		workerTaskID := seedCompletedTaskOnIssueBefore(t, workerID, issueID, fx.RuntimeID)
		// Simulate a claim race that registered an undelivered thread input.
		dbfx.Exec(t, `UPDATE agent_task_queue SET coalesced_comment_ids=ARRAY[$2::uuid] WHERE id=$1`, workerTaskID, fx.Comment.ID)
		workerTask, err := testHandler.Queries.GetAgentTask(ctx, util.MustParseUUID(workerTaskID))
		if err != nil {
			t.Fatalf("load worker task: %v", err)
		}
		testHandler.reconcileCommentsOnCompletion(ctx, &workerTask)
		var queued int
		if err := testPool.QueryRow(ctx, `
			SELECT count(*) FROM agent_task_queue
			WHERE issue_id = $1 AND agent_id = $2 AND status = 'queued'
		`, issueID, workerID).Scan(&queued); err != nil {
			t.Fatalf("count follow-ups: %v", err)
		}
		return issueID, queued
	}

	t.Run("trigger owner owns busy target -> one follow-up carrying that human", func(t *testing.T) {
		issueID, queued := followUps(t, ownerID)
		if queued != 1 {
			t.Fatalf("expected exactly 1 reconcile follow-up for the freed worker, got %d", queued)
		}
		var originator pgtype.UUID
		if err := testPool.QueryRow(ctx, `
			SELECT originator_user_id FROM agent_task_queue
			WHERE issue_id = $1 AND agent_id = $2 AND status = 'queued'
		`, issueID, workerID).Scan(&originator); err != nil {
			t.Fatalf("read follow-up originator: %v", err)
		}
		if uuidToString(originator) != ownerID {
			t.Fatalf("reconcile follow-up originator = %q, want the trigger owner %q", uuidToString(originator), ownerID)
		}
	})

	t.Run("trigger owner without rights -> no follow-up", func(t *testing.T) {
		if _, queued := followUps(t, plainMemberID); queued != 0 {
			t.Fatalf("a creator without invoke rights must not spawn a reconcile follow-up, got %d", queued)
		}
	})
}
