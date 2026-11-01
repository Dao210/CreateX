package handler

import (
	"context"
	"testing"
)

// selfMentionFixture wires the seeded "Handler Test Agent" as J plus two
// fresh issues so we can exercise the agent-self-mention path on the @mention
// branch of computeCommentAgentTriggers. The three tests below cover
// the behavior we want post-MUL-2338:
//
//   - cross-issue self-mention enqueues (child→parent handoff between issues
//     assigned to the same agent must not be swallowed)
//   - same-issue self-mention with an in-flight running task enqueues a
//     follow-up (queue coalescing already allows this — the comment handler
//     must not pre-empt it with an extra in-thread guard)
//   - same-issue self-mention with a queued/dispatched task is deduped
//     (HasPendingTaskForIssueAndAgent still does its job)

// countQueuedOrDispatched returns the number of queued|dispatched tasks for
// (agent, issue). Mirrors the predicate used by HasPendingTaskForIssueAndAgent.
func countQueuedOrDispatched(t *testing.T, agentID, issueID string) int {
	t.Helper()
	var n int
	if err := testPool.QueryRow(context.Background(), `
		SELECT count(*) FROM agent_task_queue
		WHERE issue_id = $1 AND agent_id = $2 AND status IN ('queued', 'dispatched')
	`, issueID, agentID).Scan(&n); err != nil {
		t.Fatalf("count queued/dispatched tasks: %v", err)
	}
	return n
}

// TestEnqueueMentionedAgentTasks_SelfMentionWhileRunningQueuesFollowup proves
// that a self-mention posted in the same issue an agent is currently running
// in does NOT pre-empt the natural queue-coalescing behavior: a `running`
// task is not "pending" for dedup purposes, so a new queued follow-up is
// added and the agent picks it up on its next cycle.
func TestEnqueueMentionedAgentTasks_SelfMentionWhileRunningQueuesFollowup(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	fx := newSelfMentionFixture(t)

	// Seed a running task for J on issue A — this is the agent's current run.
	if _, err := testPool.Exec(ctx, `
		INSERT INTO agent_task_queue (agent_id, runtime_id, issue_id, status)
		VALUES ($1, $2, $3, 'running')
	`, fx.JID, fx.RuntimeID, fx.IssueAID); err != nil {
		t.Fatalf("seed running task: %v", err)
	}

	if got := countQueuedOrDispatched(t, fx.JID, fx.IssueAID); got != 0 {
		t.Fatalf("before: expected 0 queued/dispatched tasks (only the running task), got %d", got)
	}

	enqueueMentionedAgentTasksForTest(t, ctx, fx.IssueA, fx.CommentA, nil, "agent", fx.JID)

	if got := countQueuedOrDispatched(t, fx.JID, fx.IssueAID); got != 1 {
		t.Fatalf("after self-mention while running: expected 1 new queued follow-up, got %d", got)
	}
}

// TestEnqueueMentionedAgentTasks_SelfMentionDedupesAgainstPendingTask locks in
// that removing the self-trigger `continue` did NOT remove the standard
// HasPendingTaskForIssueAndAgent dedupe. If a queued or dispatched task
// already exists for the same agent on the same issue, a fresh self-mention
// must NOT pile on another duplicate.
func TestEnqueueMentionedAgentTasks_SelfMentionDedupesAgainstPendingTask(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	fx := newSelfMentionFixture(t)

	cases := []struct {
		name   string
		status string
	}{
		{name: "queued task blocks duplicate", status: "queued"},
		{name: "dispatched task blocks duplicate", status: "dispatched"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := testPool.Exec(ctx, `DELETE FROM agent_task_queue WHERE issue_id = $1`, fx.IssueAID); err != nil {
				t.Fatalf("reset tasks: %v", err)
			}
			if _, err := testPool.Exec(ctx, `
				INSERT INTO agent_task_queue (agent_id, runtime_id, issue_id, status, trigger_comment_id)
				VALUES ($1, $2, $3, $4, $5)
			`, fx.JID, fx.RuntimeID, fx.IssueAID, tc.status, fx.CommentA.ID); err != nil {
				t.Fatalf("seed %s task: %v", tc.status, err)
			}

			before := countQueuedOrDispatched(t, fx.JID, fx.IssueAID)
			if before != 1 {
				t.Fatalf("before: expected 1 pre-existing %s task, got %d", tc.status, before)
			}

			enqueueMentionedAgentTasksForTest(t, ctx, fx.IssueA, fx.CommentA, nil, "agent", fx.JID)

			after := countQueuedOrDispatched(t, fx.JID, fx.IssueAID)
			if after != 1 {
				t.Fatalf("after self-mention with pre-existing %s task: expected dedupe (still 1), got %d", tc.status, after)
			}
		})
	}
}
