package main

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/auro-ai/auro/server/internal/events"
	"github.com/auro-ai/auro/server/internal/service"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
)

func TestPeriodicSweepStopsWithItsContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	called := make(chan struct{}, 1)
	stopped := make(chan struct{})
	go func() {
		runPeriodicSweep(ctx, 10*time.Millisecond, func() {
			select {
			case called <- struct{}{}:
			default:
			}
		})
		close(stopped)
	}()

	select {
	case <-called:
	case <-time.After(2 * time.Second):
		t.Fatal("periodic sweep did not run")
	}
	cancel()
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("periodic sweep did not stop with its context")
	}
}

// ageOutAgentRuntime marks the agent's runtime as stale — old last_seen_at —
// so the runtime-liveness gate on the running-task sweep predicate
// (agent_runtime.last_seen_at within staleThresholdSeconds) does NOT protect
// the test task from being killed by the wall clock. Register a cleanup that
// restores last_seen_at so subsequent tests re-using this runtime see it as
// fresh. Callers pass a `staleAgo` well beyond staleThresholdSeconds so tests
// are insensitive to that constant's precise value.
func ageOutAgentRuntime(t *testing.T, agentID string, staleAgo time.Duration) {
	t.Helper()
	ctx := context.Background()
	if _, err := testPool.Exec(ctx, `
		UPDATE agent_runtime SET last_seen_at = now() - make_interval(secs => $1)
		WHERE id = (SELECT runtime_id FROM agent WHERE id = $2)
	`, staleAgo.Seconds(), agentID); err != nil {
		t.Fatalf("failed to age out agent runtime: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `
			UPDATE agent_runtime SET last_seen_at = now()
			WHERE id = (SELECT runtime_id FROM agent WHERE id = $1)
		`, agentID)
	})
}

func setAgentRuntimeOffline(t *testing.T, agentID string, lastSeenAgo time.Duration) {
	t.Helper()
	ctx := context.Background()
	if _, err := testPool.Exec(ctx, `
		UPDATE agent_runtime
		SET status = 'offline', last_seen_at = now() - make_interval(secs => $1)
		WHERE id = (SELECT runtime_id FROM agent WHERE id = $2)
	`, lastSeenAgo.Seconds(), agentID); err != nil {
		t.Fatalf("failed to mark agent runtime offline: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `
			UPDATE agent_runtime SET status = 'online', last_seen_at = now()
			WHERE id = (SELECT runtime_id FROM agent WHERE id = $1)
		`, agentID)
	})
}

func TestRefreshAgentStatusFromTasks(t *testing.T) {
	if testPool == nil {
		t.Skip("no database connection")
	}

	ctx := context.Background()
	issueID, agentID, taskID := setupSweeperTestFixture(t, "dispatched")
	t.Cleanup(func() { cleanupSweeperFixture(t, issueID, agentID) })

	queries := db.New(testPool)
	taskService := service.NewTaskService(queries, testPool, nil, events.New())

	if _, err := testPool.Exec(ctx, `UPDATE agent SET status = 'idle' WHERE id = $1`, agentID); err != nil {
		t.Fatalf("failed to seed idle agent status: %v", err)
	}

	agent, err := queries.RefreshAgentStatusFromTasks(ctx, parseUUID(agentID))
	if err != nil {
		t.Fatalf("RefreshAgentStatusFromTasks with dispatched task failed: %v", err)
	}
	if agent.Status != "working" {
		t.Fatalf("expected dispatched task to refresh agent status to working, got %q", agent.Status)
	}

	if _, err := taskService.MarkTaskWaitingLocalDirectory(ctx, parseUUID(taskID), "test path busy"); err != nil {
		t.Fatalf("MarkTaskWaitingLocalDirectory failed: %v", err)
	}
	agent, err = queries.GetAgent(ctx, parseUUID(agentID))
	if err != nil {
		t.Fatalf("GetAgent after local-directory wait failed: %v", err)
	}
	if agent.Status != "idle" {
		t.Fatalf("expected waiter-only agent status idle, got %q", agent.Status)
	}

	if _, err := taskService.StartTask(ctx, parseUUID(taskID)); err != nil {
		t.Fatalf("StartTask from local-directory wait failed: %v", err)
	}
	agent, err = queries.GetAgent(ctx, parseUUID(agentID))
	if err != nil {
		t.Fatalf("GetAgent after StartTask failed: %v", err)
	}
	if agent.Status != "working" {
		t.Fatalf("expected running task to restore agent status working, got %q", agent.Status)
	}

	if _, err := testPool.Exec(ctx, `
		UPDATE agent_task_queue
		SET status = 'cancelled', completed_at = now()
		WHERE id = $1
	`, taskID); err != nil {
		t.Fatalf("failed to cancel seeded task: %v", err)
	}
	if _, err := testPool.Exec(ctx, `UPDATE agent SET status = 'working' WHERE id = $1`, agentID); err != nil {
		t.Fatalf("failed to reseed working agent status: %v", err)
	}

	agent, err = queries.RefreshAgentStatusFromTasks(ctx, parseUUID(agentID))
	if err != nil {
		t.Fatalf("RefreshAgentStatusFromTasks with no active tasks failed: %v", err)
	}
	if agent.Status != "idle" {
		t.Fatalf("expected cancelled-only task set to refresh agent status to idle, got %q", agent.Status)
	}
}

func TestStartTaskSkipsUnchangedAgentStatusWriteAndBroadcast(t *testing.T) {
	if testPool == nil {
		t.Skip("no database connection")
	}

	ctx := context.Background()
	issueID, agentID, taskID := setupSweeperTestFixture(t, "dispatched")
	t.Cleanup(func() { cleanupSweeperFixture(t, issueID, agentID) })

	var updatedAtBefore time.Time
	if err := testPool.QueryRow(ctx, `
		UPDATE agent
		SET status = 'working', updated_at = now() - interval '1 hour'
		WHERE id = $1
		RETURNING updated_at
	`, agentID).Scan(&updatedAtBefore); err != nil {
		t.Fatalf("seed working agent status: %v", err)
	}

	bus := events.New()
	statusEvents := 0
	bus.Subscribe("agent:status", func(events.Event) {
		statusEvents++
	})
	taskService := service.NewTaskService(db.New(testPool), testPool, nil, bus)

	if _, err := taskService.StartTask(ctx, parseUUID(taskID)); err != nil {
		t.Fatalf("StartTask from dispatched failed: %v", err)
	}

	var (
		status         string
		updatedAtAfter time.Time
	)
	if err := testPool.QueryRow(ctx, `
		SELECT status, updated_at FROM agent WHERE id = $1
	`, agentID).Scan(&status, &updatedAtAfter); err != nil {
		t.Fatalf("load agent after StartTask: %v", err)
	}
	if status != "working" {
		t.Fatalf("agent status after StartTask = %q, want working", status)
	}
	if !updatedAtAfter.Equal(updatedAtBefore) {
		t.Fatalf("unchanged status rewrote updated_at: before=%s after=%s", updatedAtBefore, updatedAtAfter)
	}
	if statusEvents != 0 {
		t.Fatalf("unchanged status broadcasts = %d, want 0", statusEvents)
	}
}

// TestSweepStaleTasksBroadcastsWithWorkspaceID verifies that when the task sweeper
// fails a stale running task, the task:failed event is broadcast with the correct
// WorkspaceID so it reaches frontend WebSocket clients (events without WorkspaceID
// are silently dropped by the WS listener — that was the original bug).
func TestSweepStaleTasksBroadcastsWithWorkspaceID(t *testing.T) {
	if testPool == nil {
		t.Skip("no database connection")
	}

	issueID, agentID, taskID := setupSweeperTestFixture(t, "running")
	t.Cleanup(func() { cleanupSweeperFixture(t, issueID, agentID) })
	// The running-task sweep now requires the task's runtime to be NOT
	// heartbeating (MUL-4107). Age the runtime out so this test still
	// exercises the sweeper wall clock rather than being silently skipped.
	ageOutAgentRuntime(t, agentID, defaultRuntimeReconnectGrace+time.Hour)

	queries := db.New(testPool)
	bus := events.New()

	// Capture task:failed events to verify WorkspaceID is set
	var taskEvents []events.Event
	var mu sync.Mutex
	bus.Subscribe("task:failed", func(e events.Event) {
		mu.Lock()
		taskEvents = append(taskEvents, e)
		mu.Unlock()
	})

	// Use very short timeouts to trigger the sweep on our test task
	failedTasks, err := queries.FailStaleTasks(context.Background(), db.FailStaleTasksParams{
		DispatchTimeoutSecs:       300.0,
		RunningTimeoutSecs:        1.0, // 1 second — our task is 3 hours old
		RuntimeStaleSecs:          staleThresholdSeconds,
		RuntimeReconnectGraceSecs: defaultRuntimeReconnectGrace.Seconds(),
	})
	if err != nil {
		t.Fatalf("FailStaleTasks query failed: %v", err)
	}
	if len(failedTasks) == 0 {
		t.Fatal("expected at least 1 stale task to be failed")
	}

	// Verify our task was included
	found := false
	for _, ft := range failedTasks {
		if ft.ID.Bytes == parseUUIDBytes(taskID) {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected task %s to be in failed tasks list", taskID)
	}

	// Call broadcastFailedTasks — this is what we're testing
	broadcastFailedTasks(context.Background(), queries, nil, bus, failedTasks)

	// Verify the event was published with WorkspaceID (the core of the bug fix)
	mu.Lock()
	defer mu.Unlock()
	var foundEvent bool
	for _, e := range taskEvents {
		payload, _ := e.Payload.(map[string]any)
		if payload["task_id"] == taskID {
			if e.WorkspaceID == "" {
				t.Fatal("task:failed event is missing WorkspaceID — this was the original bug")
			}
			if e.WorkspaceID != testWorkspaceID {
				t.Fatalf("expected WorkspaceID %s, got %s", testWorkspaceID, e.WorkspaceID)
			}
			if e.TaskID != taskID {
				t.Fatalf("expected envelope TaskID %s, got %s", taskID, e.TaskID)
			}
			if payload["error"] != "task timed out" {
				t.Fatalf("expected deliverable error %q, got %v", "task timed out", payload["error"])
			}
			if payload["failure_reason"] != "timeout" || payload["retry_pending"] != false {
				t.Fatalf("unexpected failure metadata: reason=%v retry_pending=%v", payload["failure_reason"], payload["retry_pending"])
			}
			foundEvent = true
			break
		}
	}
	if !foundEvent {
		t.Fatalf("expected task:failed event for task %s", taskID)
	}

	// Verify DB: task should be failed
	var status string
	err = testPool.QueryRow(context.Background(), `SELECT status FROM agent_task_queue WHERE id = $1`, taskID).Scan(&status)
	if err != nil {
		t.Fatalf("failed to query task status: %v", err)
	}
	if status != "failed" {
		t.Fatalf("expected task status 'failed', got '%s'", status)
	}
}

// TestSweepStaleTasksReconcileAgentStatus verifies that after the sweeper fails
// stale tasks, the agent status is reconciled from "working" back to "idle".
func TestSweepStaleTasksReconcileAgentStatus(t *testing.T) {
	if testPool == nil {
		t.Skip("no database connection")
	}

	issueID, agentID, _ := setupSweeperTestFixture(t, "running")
	t.Cleanup(func() { cleanupSweeperFixture(t, issueID, agentID) })
	// Runtime must be stale for the running-task wall clock to fire (MUL-4107).
	ageOutAgentRuntime(t, agentID, defaultRuntimeReconnectGrace+time.Hour)

	queries := db.New(testPool)
	bus := events.New()

	// Capture agent:status events
	var agentStatusEvents []events.Event
	var mu sync.Mutex
	bus.Subscribe("agent:status", func(e events.Event) {
		mu.Lock()
		agentStatusEvents = append(agentStatusEvents, e)
		mu.Unlock()
	})

	// Fail stale tasks with short timeout
	failedTasks, err := queries.FailStaleTasks(context.Background(), db.FailStaleTasksParams{
		DispatchTimeoutSecs:       300.0,
		RunningTimeoutSecs:        1.0,
		RuntimeStaleSecs:          staleThresholdSeconds,
		RuntimeReconnectGraceSecs: defaultRuntimeReconnectGrace.Seconds(),
	})
	if err != nil {
		t.Fatalf("FailStaleTasks failed: %v", err)
	}
	if len(failedTasks) == 0 {
		t.Fatal("expected at least 1 stale task")
	}

	broadcastFailedTasks(context.Background(), queries, nil, bus, failedTasks)

	// Verify agent status is now "idle" in DB
	var agentStatus string
	err = testPool.QueryRow(context.Background(), `SELECT status FROM agent WHERE id = $1`, agentID).Scan(&agentStatus)
	if err != nil {
		t.Fatalf("failed to query agent status: %v", err)
	}
	if agentStatus != "idle" {
		t.Fatalf("expected agent status 'idle', got '%s'", agentStatus)
	}

	// Verify agent:status event was published with correct WorkspaceID
	mu.Lock()
	defer mu.Unlock()
	if len(agentStatusEvents) == 0 {
		t.Fatal("expected agent:status event to be published")
	}
	lastEvent := agentStatusEvents[len(agentStatusEvents)-1]
	if lastEvent.WorkspaceID == "" {
		t.Fatal("agent:status event should have WorkspaceID set")
	}
	if lastEvent.WorkspaceID != testWorkspaceID {
		t.Fatalf("expected WorkspaceID %s, got %s", testWorkspaceID, lastEvent.WorkspaceID)
	}
}

// TestSweepDispatchedStaleTask verifies the sweeper handles dispatched tasks
// stuck beyond the dispatch timeout.
func TestSweepDispatchedStaleTask(t *testing.T) {
	if testPool == nil {
		t.Skip("no database connection")
	}

	issueID, agentID, taskID := setupSweeperTestFixture(t, "dispatched")
	t.Cleanup(func() { cleanupSweeperFixture(t, issueID, agentID) })

	queries := db.New(testPool)
	bus := events.New()

	// Capture task:failed events
	var taskEvents []events.Event
	var mu sync.Mutex
	bus.Subscribe("task:failed", func(e events.Event) {
		mu.Lock()
		taskEvents = append(taskEvents, e)
		mu.Unlock()
	})

	// Fail stale tasks — dispatch timeout of 1 second (our task is 10 minutes old)
	failedTasks, err := queries.FailStaleTasks(context.Background(), db.FailStaleTasksParams{
		DispatchTimeoutSecs: 1.0,
		RunningTimeoutSecs:  9000.0,
		// RuntimeStaleSecs only affects the running branch — irrelevant for
		// this dispatched-timeout test, but wired for API consistency.
		RuntimeStaleSecs:          staleThresholdSeconds,
		RuntimeReconnectGraceSecs: defaultRuntimeReconnectGrace.Seconds(),
	})
	if err != nil {
		t.Fatalf("FailStaleTasks failed: %v", err)
	}
	if len(failedTasks) == 0 {
		t.Fatal("expected at least 1 stale dispatched task")
	}

	broadcastFailedTasks(context.Background(), queries, nil, bus, failedTasks)

	// Verify DB: task should be failed
	var status string
	err = testPool.QueryRow(context.Background(), `SELECT status FROM agent_task_queue WHERE id = $1`, taskID).Scan(&status)
	if err != nil {
		t.Fatalf("failed to query task: %v", err)
	}
	if status != "failed" {
		t.Fatalf("expected task status 'failed', got '%s'", status)
	}

	// Verify task:failed event was published WITH WorkspaceID
	mu.Lock()
	defer mu.Unlock()
	found := false
	for _, e := range taskEvents {
		payload, _ := e.Payload.(map[string]any)
		if payload["task_id"] == taskID {
			if e.WorkspaceID == "" {
				t.Fatal("task:failed event is missing WorkspaceID — this was the bug")
			}
			if e.WorkspaceID != testWorkspaceID {
				t.Fatalf("expected WorkspaceID %s, got %s", testWorkspaceID, e.WorkspaceID)
			}
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected task:failed event for task %s", taskID)
	}

	// Verify agent status reconciled to idle
	var agentStatus string
	err = testPool.QueryRow(context.Background(), `SELECT status FROM agent WHERE id = $1`, agentID).Scan(&agentStatus)
	if err != nil {
		t.Fatalf("failed to query agent: %v", err)
	}
	if agentStatus != "idle" {
		t.Fatalf("expected agent status 'idle' after sweep, got '%s'", agentStatus)
	}
}

// TestSweepDispatchedTaskWaitsThroughReconnectGrace locks the network-partition
// behavior for the pre-start window: an expired prepare lease must not consume
// a retry while the runtime has only recently gone offline.
func TestSweepDispatchedTaskWaitsThroughReconnectGrace(t *testing.T) {
	if testPool == nil {
		t.Skip("no database connection")
	}

	issueID, agentID, taskID := setupSweeperTestFixture(t, "dispatched")
	t.Cleanup(func() { cleanupSweeperFixture(t, issueID, agentID) })
	setAgentRuntimeOffline(t, agentID, 10*time.Minute)

	failedTasks, err := db.New(testPool).FailStaleTasks(context.Background(), db.FailStaleTasksParams{
		DispatchTimeoutSecs:       1.0,
		RunningTimeoutSecs:        9000.0,
		RuntimeStaleSecs:          staleThresholdSeconds,
		RuntimeReconnectGraceSecs: defaultRuntimeReconnectGrace.Seconds(),
	})
	if err != nil {
		t.Fatalf("FailStaleTasks failed: %v", err)
	}
	for _, task := range failedTasks {
		if task.ID.Bytes == parseUUIDBytes(taskID) {
			t.Fatal("dispatched task was failed inside reconnect grace")
		}
	}

	var status string
	if err := testPool.QueryRow(context.Background(), `SELECT status FROM agent_task_queue WHERE id = $1`, taskID).Scan(&status); err != nil {
		t.Fatalf("read task status: %v", err)
	}
	if status != "dispatched" {
		t.Fatalf("task status = %q, want dispatched", status)
	}
}

// TestSweepRunningTaskSkippedWhenRuntimeFresh is the MUL-4107 regression test:
// a running task whose wall-clock deadline has already passed MUST NOT be
// killed by the sweeper as long as its owning runtime is 'online' and its
// last_seen_at is within the runtime stale window. This preserves healthy
// multi-hour research / training runs — the primary motivation for the
// liveness-keyed sweep predicate.
func TestSweepRunningTaskSkippedWhenRuntimeFresh(t *testing.T) {
	if testPool == nil {
		t.Skip("no database connection")
	}

	issueID, agentID, taskID := setupSweeperTestFixture(t, "running")
	t.Cleanup(func() { cleanupSweeperFixture(t, issueID, agentID) })

	// Runtime heartbeat is fresh (integration fixture inserts last_seen_at=now()).
	// Task started_at is 3h ago; RunningTimeoutSecs=1s would kill on wall clock
	// alone — but the runtime is proving liveness, so the sweeper must skip it.
	queries := db.New(testPool)
	failedTasks, err := queries.FailStaleTasks(context.Background(), db.FailStaleTasksParams{
		DispatchTimeoutSecs:       300.0,
		RunningTimeoutSecs:        1.0,
		RuntimeStaleSecs:          staleThresholdSeconds,
		RuntimeReconnectGraceSecs: defaultRuntimeReconnectGrace.Seconds(),
	})
	if err != nil {
		t.Fatalf("FailStaleTasks failed: %v", err)
	}

	for _, ft := range failedTasks {
		if ft.ID.Bytes == parseUUIDBytes(taskID) {
			t.Fatalf("healthy long-running task on live daemon must NOT be swept — that was the MUL-4107 bug")
		}
	}

	var status string
	if err := testPool.QueryRow(context.Background(),
		`SELECT status FROM agent_task_queue WHERE id = $1`, taskID,
	).Scan(&status); err != nil {
		t.Fatalf("failed to query task status: %v", err)
	}
	if status != "running" {
		t.Fatalf("expected task to stay 'running', got %q", status)
	}
}

func TestSweepRunningTaskWaitsThroughReconnectGrace(t *testing.T) {
	if testPool == nil {
		t.Skip("no database connection")
	}

	issueID, agentID, taskID := setupSweeperTestFixture(t, "running")
	t.Cleanup(func() { cleanupSweeperFixture(t, issueID, agentID) })
	setAgentRuntimeOffline(t, agentID, 10*time.Minute)

	failedTasks, err := db.New(testPool).FailStaleTasks(context.Background(), db.FailStaleTasksParams{
		DispatchTimeoutSecs:       300.0,
		RunningTimeoutSecs:        1.0,
		RuntimeStaleSecs:          staleThresholdSeconds,
		RuntimeReconnectGraceSecs: defaultRuntimeReconnectGrace.Seconds(),
	})
	if err != nil {
		t.Fatalf("FailStaleTasks failed: %v", err)
	}
	for _, task := range failedTasks {
		if task.ID.Bytes == parseUUIDBytes(taskID) {
			t.Fatal("long-running task was failed inside reconnect grace")
		}
	}

	var status string
	if err := testPool.QueryRow(context.Background(), `SELECT status FROM agent_task_queue WHERE id = $1`, taskID).Scan(&status); err != nil {
		t.Fatalf("read task status: %v", err)
	}
	if status != "running" {
		t.Fatalf("task status = %q, want running", status)
	}
}

// TestSweepRunningTaskKilledBeyondReconnectGrace is the companion coverage: a
// running task is killed once both its own deadline and the runtime reconnect
// grace have elapsed.
func TestSweepRunningTaskKilledBeyondReconnectGrace(t *testing.T) {
	if testPool == nil {
		t.Skip("no database connection")
	}

	issueID, agentID, taskID := setupSweeperTestFixture(t, "running")
	t.Cleanup(func() { cleanupSweeperFixture(t, issueID, agentID) })
	ageOutAgentRuntime(t, agentID, defaultRuntimeReconnectGrace+time.Hour)

	queries := db.New(testPool)
	failedTasks, err := queries.FailStaleTasks(context.Background(), db.FailStaleTasksParams{
		DispatchTimeoutSecs:       300.0,
		RunningTimeoutSecs:        1.0,
		RuntimeStaleSecs:          staleThresholdSeconds,
		RuntimeReconnectGraceSecs: defaultRuntimeReconnectGrace.Seconds(),
	})
	if err != nil {
		t.Fatalf("FailStaleTasks failed: %v", err)
	}

	found := false
	for _, ft := range failedTasks {
		if ft.ID.Bytes == parseUUIDBytes(taskID) {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected wall clock to fire when runtime heartbeat is stale, but task %s was not swept", taskID)
	}

	var status string
	if err := testPool.QueryRow(context.Background(),
		`SELECT status FROM agent_task_queue WHERE id = $1`, taskID,
	).Scan(&status); err != nil {
		t.Fatalf("failed to query task status: %v", err)
	}
	if status != "failed" {
		t.Fatalf("expected task status 'failed', got %q", status)
	}
}

func TestOfflineRuntimeTasksRespectReconnectGrace(t *testing.T) {
	if testPool == nil {
		t.Skip("no database connection")
	}

	ctx := context.Background()
	issueID, agentID, taskID := setupSweeperTestFixture(t, "running")
	t.Cleanup(func() { cleanupSweeperFixture(t, issueID, agentID) })
	setAgentRuntimeOffline(t, agentID, 10*time.Minute)
	queries := db.New(testPool)

	failed, err := queries.FailTasksForOfflineRuntimes(ctx, db.FailTasksForOfflineRuntimesParams{
		ReconnectGraceSecs: defaultRuntimeReconnectGrace.Seconds(),
		MaxPerTick:         offlineTaskFailBatchSize,
	})
	if err != nil {
		t.Fatalf("FailTasksForOfflineRuntimes inside grace: %v", err)
	}
	for _, task := range failed {
		if task.ID.Bytes == parseUUIDBytes(taskID) {
			t.Fatal("running task was failed inside reconnect grace")
		}
	}

	if _, err := testPool.Exec(ctx, `
		UPDATE agent_runtime
		SET last_seen_at = now() - make_interval(secs => $1)
		WHERE id = (SELECT runtime_id FROM agent WHERE id = $2)
	`, (defaultRuntimeReconnectGrace + time.Hour).Seconds(), agentID); err != nil {
		t.Fatalf("age runtime beyond grace: %v", err)
	}

	failed, err = queries.FailTasksForOfflineRuntimes(ctx, db.FailTasksForOfflineRuntimesParams{
		ReconnectGraceSecs: defaultRuntimeReconnectGrace.Seconds(),
		MaxPerTick:         offlineTaskFailBatchSize,
	})
	if err != nil {
		t.Fatalf("FailTasksForOfflineRuntimes beyond grace: %v", err)
	}
	found := false
	for _, task := range failed {
		if task.ID.Bytes == parseUUIDBytes(taskID) {
			found = true
			if !task.FailureReason.Valid || task.FailureReason.String != "runtime_offline" {
				t.Fatalf("failure reason = %q, want runtime_offline", task.FailureReason.String)
			}
		}
	}
	if !found {
		t.Fatal("task was not failed after reconnect grace elapsed")
	}
}

// parseUUIDBytes converts a UUID string to the 16-byte array used by pgtype.UUID.
func parseUUIDBytes(s string) [16]byte {
	s = strings.ReplaceAll(s, "-", "")
	var b [16]byte
	for i := 0; i < 16; i++ {
		hi := unhex(s[i*2])
		lo := unhex(s[i*2+1])
		b[i] = hi<<4 | lo
	}
	return b
}

func unhex(c byte) byte {
	switch {
	case c >= '0' && c <= '9':
		return c - '0'
	case c >= 'a' && c <= 'f':
		return c - 'a' + 10
	case c >= 'A' && c <= 'F':
		return c - 'A' + 10
	}
	return 0
}
