package handler

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// enqueueViaRealQuery creates a task through the generated CreateAgentTask query —
// the actual production enqueue path, fence included. Raw INSERTs in tests would
// bypass the fence, which lives in the application SQL rather than in a trigger.
func enqueueViaRealQuery(ctx context.Context, q *db.Queries, agentID, runtimeID, issueID string) error {
	params := db.CreateAgentTaskParams{
		AgentID:   parseUUID(agentID),
		RuntimeID: parseUUID(runtimeID),
		Priority:  0,
	}
	if issueID != "" {
		params.IssueID = parseUUID(issueID)
	}
	_, err := q.CreateAgentTask(ctx, params)
	return err
}

// waitForBlockedWriter blocks until the given backend is waiting on a lock, so a
// race test can be sure the writer really is queued before the other side commits.
// The pid comes from the writer itself rather than being guessed from statement
// text, which on a shared test database could match an unrelated backend. Fails the
// test on timeout rather than proceeding, so a missed race shows up as a failure
// instead of a vacuous pass.
func waitForBlockedWriter(t *testing.T, ctx context.Context, pid int32) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var waiting bool
		if err := testPool.QueryRow(ctx, `
SELECT EXISTS (
    SELECT 1 FROM pg_stat_activity
    WHERE pid = $1 AND state = 'active' AND wait_event_type = 'Lock'
)
`, pid).Scan(&waiting); err != nil {
			t.Fatalf("poll pg_stat_activity: %v", err)
		}
		if waiting {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("backend %d never parked on a lock; the race was not set up", pid)
}

// TestTaskWriteFence_BlocksOnWorkspaceLockAlone shows the fence, and only the
// fence, standing between a concurrent enqueue and a workspace being torn down.
//
// The holder locks ONLY the workspace row — no agent, issue or runtime row — so no
// foreign key on agent_task_queue has anything to block on: none of them
// references workspace. Anything that blocks here is the fence taking FOR KEY
// SHARE on the owners' workspace row from inside the writer's own statement.
func TestTaskWriteFence_BlocksOnWorkspaceLockAlone(t *testing.T) {
	if testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	f := newWorkspaceDeletePathFixture(t, "fenceonly")

	holder, err := testPool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin holder: %v", err)
	}
	defer holder.Rollback(ctx)
	// Exactly what LockWorkspaceForDelete does, and nothing else.
	if _, err := holder.Exec(ctx, `SELECT id FROM workspace WHERE id = $1 FOR UPDATE`, f.victimID); err != nil {
		t.Fatalf("lock workspace row: %v", err)
	}

	// Each expected-blocked writer waits out its whole lock_timeout, which only
	// runs while the writer is actually blocked, so it is kept small.
	blockedEnqueue := func(name, agentID, runtimeID, issueID string) {
		t.Helper()
		writer, err := testPool.Begin(ctx)
		if err != nil {
			t.Fatalf("%s: begin: %v", name, err)
		}
		defer writer.Rollback(ctx)
		if _, err := writer.Exec(ctx, "SET LOCAL lock_timeout = 50"); err != nil {
			t.Fatalf("%s: set lock_timeout: %v", name, err)
		}
		err = enqueueViaRealQuery(ctx, testHandler.Queries.WithTx(writer), agentID, runtimeID, issueID)
		if err == nil {
			t.Errorf("%s: enqueue committed while the workspace row was locked; the fence is not in the write path", name)
			return
		}
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "55P03" {
			t.Errorf("%s: got %v, want lock_not_available (55P03)", name, err)
		}
	}

	blockedEnqueue("enqueue via the victim's agent", f.victimAgent, f.neighbourRuntime, f.neighbourIssue)
	blockedEnqueue("enqueue via the victim's runtime", f.neighbourAgent, f.victimRuntime, f.neighbourIssue)
	blockedEnqueue("enqueue via the victim's issue", f.neighbourAgent, f.neighbourRuntime, f.victimIssue)

	// Reassignment onto the victim's runtime is fenced too.
	reassign, err := testPool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin reassign: %v", err)
	}
	defer reassign.Rollback(ctx)
	if _, err := reassign.Exec(ctx, "SET LOCAL lock_timeout = 50"); err != nil {
		t.Fatalf("reassign: set lock_timeout: %v", err)
	}
	_, err = testHandler.Queries.WithTx(reassign).ReassignTasksToRuntime(ctx, db.ReassignTasksToRuntimeParams{
		NewRuntimeID: parseUUID(f.victimRuntime),
		OldRuntimeID: parseUUID(f.neighbourRuntime),
	})
	var pgErr *pgconn.PgError
	if err == nil || !errors.As(err, &pgErr) || pgErr.Code != "55P03" {
		t.Errorf("reassignment onto the victim's runtime: got %v, want lock_not_available (55P03)", err)
	}

	// A workspace nobody is deleting is unaffected.
	unrelated, err := testPool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin unrelated: %v", err)
	}
	defer unrelated.Rollback(ctx)
	if _, err := unrelated.Exec(ctx, "SET LOCAL lock_timeout = 200"); err != nil {
		t.Fatalf("unrelated: set lock_timeout: %v", err)
	}
	if err := enqueueViaRealQuery(ctx, testHandler.Queries.WithTx(unrelated),
		f.neighbourAgent, f.neighbourRuntime, f.neighbourIssue); err != nil {
		t.Errorf("neighbour-only enqueue was blocked by the victim's workspace lock: %v", err)
	}

	// Status-only updates are the hot path and must not touch the fence at all.
	statusUpdate, err := testPool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin status update: %v", err)
	}
	defer statusUpdate.Rollback(ctx)
	if _, err := statusUpdate.Exec(ctx, "SET LOCAL lock_timeout = 200"); err != nil {
		t.Fatalf("status update: set lock_timeout: %v", err)
	}
	if _, err := statusUpdate.Exec(ctx,
		`UPDATE agent_task_queue SET status = 'failed' WHERE id = $1`, f.taskViaAgent); err != nil {
		t.Errorf("status-only update was blocked: %v", err)
	}
}

// TestMergeLegacyRuntime_KeepsOldRuntimeWhenFenceRefuses is the regression test
// for the failure mode the review found: the fence refusing looked exactly like
// "the old runtime had no tasks", so the merge went on to delete the old runtime
// and agent_task_queue's ON DELETE CASCADE quietly took its history with it.
//
// Here the merge target has vanished before the reassignment runs, so the fence
// returns false. The old runtime and its task must both survive, and nothing may
// be recorded on the target.
func TestMergeLegacyRuntime_KeepsOldRuntimeWhenFenceRefuses(t *testing.T) {
	if testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	f := newWorkspaceDeletePathFixture(t, "mergefence")
	notifier := &recordingRuntimeGoneNotifier{}
	h := *testHandler
	h.DaemonRuntimeGone = notifier

	// A target runtime id that does not resolve — the same state a merge sees when
	// the target's workspace was torn down a moment ago.
	vanishedTarget := parseUUID("00000000-0000-0000-0000-0000000000fe")

	err := h.mergeLegacyRuntime(ctx, vanishedTarget, parseUUID(f.victimRuntime), "legacy-daemon", "delete-test")
	if !errors.Is(err, errRuntimeMergeFenced) {
		t.Fatalf("mergeLegacyRuntime = %v, want errRuntimeMergeFenced", err)
	}

	if !rowExists(t, "agent_runtime", f.victimRuntime) {
		t.Error("the old runtime was deleted even though the reassignment was fenced")
	}
	if !rowExists(t, "agent_task_queue", f.taskViaRuntime) {
		t.Error("the old runtime's task was deleted by the cascade behind a fenced merge")
	}
	var stillOnOldRuntime bool
	if err := testPool.QueryRow(ctx,
		`SELECT runtime_id = $1 FROM agent_task_queue WHERE id = $2`,
		f.victimRuntime, f.taskViaRuntime).Scan(&stillOnOldRuntime); err != nil {
		t.Fatalf("read task runtime: %v", err)
	}
	if !stillOnOldRuntime {
		t.Error("the task was re-pointed at the vanished runtime")
	}
	if len(notifier.runtimeIDs) != 0 {
		t.Fatalf("fenced merge emitted runtime-gone notifications: %v", notifier.runtimeIDs)
	}

	// And the happy path still merges, so the abort is not unconditional.
	var freshRuntime string
	if err := testPool.QueryRow(ctx, `
INSERT INTO agent_runtime (workspace_id, name, runtime_mode, provider, status, device_info, metadata, owner_id)
VALUES ($1, 'merge target', 'cloud', 'delete-test', 'offline', '', '{}'::jsonb, $2)
RETURNING id
`, f.victimID, testUserID).Scan(&freshRuntime); err != nil {
		t.Fatalf("create merge target: %v", err)
	}
	if err := h.mergeLegacyRuntime(ctx, parseUUID(freshRuntime), parseUUID(f.victimRuntime),
		"legacy-daemon", "delete-test"); err != nil {
		t.Fatalf("merge onto a live runtime: %v", err)
	}
	if rowExists(t, "agent_runtime", f.victimRuntime) {
		t.Error("the old runtime survived a merge that should have completed")
	}
	if !rowExists(t, "agent_task_queue", f.taskViaRuntime) {
		t.Error("a completed merge lost the old runtime's task")
	}
	if len(notifier.runtimeIDs) != 1 || notifier.runtimeIDs[0] != f.victimRuntime {
		t.Fatalf("runtime-gone notifications = %v, want [%s]", notifier.runtimeIDs, f.victimRuntime)
	}
}

// TestMergeLegacyRuntime_RollsBackWhenAStepFails is the fault-injection half of the
// merge contract: the four statements have to land together or not at all.
//
// Run as autocommit statements the merge could commit the task reassignment and
// then fail on the agent reassignment, leaving tasks on the new runtime and their
// agents on the old one while daemon registration still reported success. Worse,
// the fence's workspace lock ended with its own statement, so a teardown could slip
// into that gap, delete the target runtime and clear runtime_id on the tasks that
// had just moved — history the next merge could no longer find, because it looks up
// tasks by the OLD runtime id.
//
// The failure is injected in the database rather than through a code seam, so the
// test exercises the real statements: a trigger makes any agent row moving onto the
// merge target raise.
func TestMergeLegacyRuntime_RollsBackWhenAStepFails(t *testing.T) {
	if testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	f := newWorkspaceDeletePathFixture(t, "mergerollback")

	var target string
	if err := testPool.QueryRow(ctx, `
INSERT INTO agent_runtime (workspace_id, name, runtime_mode, provider, status, device_info, metadata, owner_id)
VALUES ($1, 'rollback merge target', 'cloud', 'delete-test', 'offline', '', '{}'::jsonb, $2)
RETURNING id
`, f.victimID, testUserID).Scan(&target); err != nil {
		t.Fatalf("create merge target: %v", err)
	}

	if _, err := testPool.Exec(ctx, `
CREATE OR REPLACE FUNCTION mul5999_fail_agent_move() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
    IF NEW.name = 'victim agent' AND NEW.runtime_id IS DISTINCT FROM OLD.runtime_id THEN
        RAISE EXCEPTION 'injected failure moving agent onto the merge target';
    END IF;
    RETURN NEW;
END
$fn$;
`); err != nil {
		t.Fatalf("create injection function: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
CREATE TRIGGER mul5999_fail_agent_move
BEFORE UPDATE OF runtime_id ON agent
FOR EACH ROW EXECUTE FUNCTION mul5999_fail_agent_move()
`); err != nil {
		t.Fatalf("create injection trigger: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = testPool.Exec(bg, `DROP TRIGGER IF EXISTS mul5999_fail_agent_move ON agent`)
		_, _ = testPool.Exec(bg, `DROP FUNCTION IF EXISTS mul5999_fail_agent_move()`)
	})

	err := testHandler.mergeLegacyRuntime(ctx, parseUUID(target), parseUUID(f.victimRuntime),
		"legacy-daemon", "delete-test")
	if err == nil {
		t.Fatal("merge reported success even though the agent reassignment failed")
	}
	if !strings.Contains(err.Error(), "reassign agents") {
		t.Errorf("error = %v, want the agent reassignment failure", err)
	}

	// Everything must look exactly as it did before the call.
	var taskRuntime, agentRuntime string
	if err := testPool.QueryRow(ctx,
		`SELECT runtime_id FROM agent_task_queue WHERE id = $1`, f.taskViaRuntime).Scan(&taskRuntime); err != nil {
		t.Fatalf("read task runtime: %v", err)
	}
	if taskRuntime != f.victimRuntime {
		t.Errorf("task moved to %s; the task reassignment was not rolled back", taskRuntime)
	}
	if err := testPool.QueryRow(ctx,
		`SELECT runtime_id FROM agent WHERE id = $1`, f.victimAgent).Scan(&agentRuntime); err != nil {
		t.Fatalf("read agent runtime: %v", err)
	}
	if agentRuntime != f.victimRuntime {
		t.Errorf("agent runtime = %s, want the original %s", agentRuntime, f.victimRuntime)
	}
	if !rowExists(t, "agent_runtime", f.victimRuntime) {
		t.Error("the old runtime was deleted by a merge that failed")
	}
	if !rowExists(t, "agent_runtime", target) {
		t.Error("the merge target disappeared")
	}
	var legacyRecorded bool
	if err := testPool.QueryRow(ctx,
		`SELECT legacy_daemon_id IS NOT NULL FROM agent_runtime WHERE id = $1`, target).Scan(&legacyRecorded); err != nil {
		t.Fatalf("read legacy daemon id: %v", err)
	}
	if legacyRecorded {
		t.Error("the legacy daemon_id audit write survived a rolled-back merge")
	}

	// With the injection removed the same merge completes, so the rollback above
	// was not just a permanently broken fixture.
	if _, err := testPool.Exec(ctx, `DROP TRIGGER mul5999_fail_agent_move ON agent`); err != nil {
		t.Fatalf("drop injection trigger: %v", err)
	}
	if err := testHandler.mergeLegacyRuntime(ctx, parseUUID(target), parseUUID(f.victimRuntime),
		"legacy-daemon", "delete-test"); err != nil {
		t.Fatalf("merge after removing the injection: %v", err)
	}
	if rowExists(t, "agent_runtime", f.victimRuntime) {
		t.Error("the old runtime survived a completed merge")
	}
}

// TestLockTaskOwnerRows_RejectsUnresolvableOwner pins the hole the review
// found in the first version of this fence: counting only the owners that still
// resolve made a deleted owner invisible, and the statement fell through to the
// foreign key. A reference that does not resolve must make the predicate false on
// its own.
func TestLockTaskOwnerRows_RejectsUnresolvableOwner(t *testing.T) {
	if testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	f := newWorkspaceDeletePathFixture(t, "unresolvable")
	missing := "00000000-0000-0000-0000-0000000000ff"

	for name, args := range map[string][3]any{
		"missing agent":               {missing, nil, nil},
		"missing issue":               {nil, missing, nil},
		"missing runtime":             {nil, nil, missing},
		"one of three owners missing": {f.victimAgent, missing, f.victimRuntime},
	} {
		var ok bool
		if err := testPool.QueryRow(ctx,
			`SELECT lock_task_owner_rows($1, $2, $3)`, args[0], args[1], args[2]).Scan(&ok); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if ok {
			t.Errorf("%s: fence returned true; the write would fall through to the foreign key", name)
		}
	}

	var ok bool
	if err := testPool.QueryRow(ctx, `SELECT lock_task_owner_rows($1, $2, $3)`,
		f.victimAgent, f.victimIssue, f.victimRuntime).Scan(&ok); err != nil {
		t.Fatalf("all owners present: %v", err)
	}
	if !ok {
		t.Error("fence returned false for a fully resolvable row")
	}
}

var _ = pgtype.UUID{}
