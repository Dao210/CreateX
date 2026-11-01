package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/auro-ai/auro/server/pkg/protocol"
	"github.com/jackc/pgx/v5/pgtype"
)

func localDirRef(t *testing.T, path, daemonID, mode string) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(map[string]string{
		"local_path": path, "daemon_id": daemonID, "execution_mode": mode,
	})
	if err != nil {
		t.Fatalf("marshal ref: %v", err)
	}
	return raw
}

func runtimeWithVersion(daemonID, cliVersion string) db.AgentRuntime {
	rt := db.AgentRuntime{DaemonID: pgtype.Text{String: daemonID, Valid: daemonID != ""}}
	if cliVersion != "" {
		rt.Metadata, _ = json.Marshal(map[string]string{"cli_version": cliVersion})
	}
	return rt
}

// The save-time gate cannot cover a machine downgraded after the resource was
// written, and an old daemon json-skips execution_mode entirely — it would run
// the task IN PLACE, editing the working copy the user asked to isolate. This
// is the last point where that can be stopped.
func TestWorktreeClaimBlockReason(t *testing.T) {
	const daemon = "daemon-a"

	worktreeRes := []ProjectResourceData{{
		ID: "r1", ResourceType: "local_directory",
		ResourceRef: localDirRef(t, "/Users/dev/game", daemon, "worktree"),
	}}

	t.Run("blocks a runtime that does not advertise the capability", func(t *testing.T) {
		reason := worktreeClaimBlockReason(worktreeRes, runtimeWithVersion(daemon, "0.4.10"), false)
		if reason == "" {
			t.Fatal("an outdated runtime was allowed to claim a worktree task")
		}
		if !strings.Contains(reason, "/Users/dev/game") || !strings.Contains(reason, "Update the Auro app") {
			t.Errorf("reason should name the directory and tell the user to update, got: %q", reason)
		}
	})

	t.Run("blocks a runtime that advertises nothing at all", func(t *testing.T) {
		// Fail closed: "no version" is what a daemon far older than the field
		// looks like, which is exactly the dangerous case.
		if worktreeClaimBlockReason(worktreeRes, runtimeWithVersion(daemon, ""), false) == "" {
			t.Error("a runtime advertising nothing was allowed to claim")
		}
	})

	t.Run("allows a runtime that advertises the capability", func(t *testing.T) {
		if reason := worktreeClaimBlockReason(worktreeRes, runtimeWithVersion(daemon, "9.9.9"), true); reason != "" {
			t.Errorf("a capable runtime was blocked: %q", reason)
		}
	})

	t.Run("ignores in_place and absent modes", func(t *testing.T) {
		for _, mode := range []string{"in_place", ""} {
			res := []ProjectResourceData{{
				ID: "r1", ResourceType: "local_directory",
				ResourceRef: localDirRef(t, "/Users/dev/game", daemon, mode),
			}}
			if reason := worktreeClaimBlockReason(res, runtimeWithVersion(daemon, "0.1.0"), false); reason != "" {
				t.Errorf("mode %q blocked a daemon that can run it fine: %q", mode, reason)
			}
		}
	})

	// A project may carry one local_directory per machine. Another machine's
	// worktree resource says nothing about this runtime's ability to run.
	t.Run("ignores a resource bound to a different daemon", func(t *testing.T) {
		other := []ProjectResourceData{{
			ID: "r1", ResourceType: "local_directory",
			ResourceRef: localDirRef(t, "/Users/dev/game", "daemon-b", "worktree"),
		}}
		if reason := worktreeClaimBlockReason(other, runtimeWithVersion(daemon, "0.1.0"), false); reason != "" {
			t.Errorf("another machine's resource blocked this claim: %q", reason)
		}
	})

	t.Run("ignores non-local_directory resources", func(t *testing.T) {
		repo := []ProjectResourceData{{
			ID: "r1", ResourceType: "github_repo",
			ResourceRef: json.RawMessage(`{"url":"https://github.com/a/b"}`),
		}}
		if reason := worktreeClaimBlockReason(repo, runtimeWithVersion(daemon, "0.1.0"), false); reason != "" {
			t.Errorf("github_repo resource blocked a claim: %q", reason)
		}
	})

	t.Run("ignores a runtime with no daemon id", func(t *testing.T) {
		if reason := worktreeClaimBlockReason(worktreeRes, runtimeWithVersion("", "0.1.0"), false); reason != "" {
			t.Errorf("cloud runtime blocked: %q", reason)
		}
	})

	t.Run("survives a malformed ref", func(t *testing.T) {
		bad := []ProjectResourceData{{
			ID: "r1", ResourceType: "local_directory",
			ResourceRef: json.RawMessage(`{"local_path": 42}`),
		}}
		if reason := worktreeClaimBlockReason(bad, runtimeWithVersion(daemon, "0.1.0"), false); reason != "" {
			t.Errorf("malformed ref produced a block: %q", reason)
		}
	})
}

// The claim gate cancels the task; the reason has to land on the row. The 4xx
// only reaches the daemon's log, and batch claim drops the task from its
// response entirely — so without a persisted reason the user sees a bare
// "cancelled" for a condition only they can fix.
func TestWorktreeClaimGateCancelPersistsReason(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	var agentID, runtimeID string
	if err := testPool.QueryRow(ctx, `
		SELECT a.id, a.runtime_id FROM agent a WHERE a.workspace_id = $1 LIMIT 1
	`, testWorkspaceID).Scan(&agentID, &runtimeID); err != nil {
		t.Fatalf("setup: get agent: %v", err)
	}
	var taskID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO agent_task_queue (agent_id, runtime_id, status, priority, dispatched_at)
		VALUES ($1, $2, 'dispatched', 0, now())
		RETURNING id
	`, agentID, runtimeID).Scan(&taskID); err != nil {
		t.Fatalf("setup: create task: %v", err)
	}
	t.Cleanup(func() { testPool.Exec(ctx, `DELETE FROM agent_task_queue WHERE id = $1`, taskID) })

	const reason = "worktree mode needs a newer runtime on that machine"
	if _, err := testHandler.Queries.CancelAgentTaskWithReason(ctx, db.CancelAgentTaskWithReasonParams{
		ID:            parseUUID(taskID),
		Error:         pgtype.Text{String: reason, Valid: true},
		FailureReason: pgtype.Text{String: "local_directory_error", Valid: true},
	}); err != nil {
		t.Fatalf("CancelAgentTaskWithReason: %v", err)
	}

	var status string
	var errText, failureReason pgtype.Text
	if err := testPool.QueryRow(ctx,
		`SELECT status, error, failure_reason FROM agent_task_queue WHERE id = $1`,
		taskID).Scan(&status, &errText, &failureReason); err != nil {
		t.Fatalf("read task: %v", err)
	}
	if status != "cancelled" {
		t.Errorf("status = %q, want cancelled", status)
	}
	if errText.String != reason {
		t.Errorf("error = %q, want the user-facing reason persisted", errText.String)
	}
	if failureReason.String != "local_directory_error" {
		t.Errorf("failure_reason = %q, want local_directory_error", failureReason.String)
	}
}

// assertWorktreeGateCancelled reads the task row and asserts the gate left it
// in the state the user can act on: cancelled, with the reason persisted.
func assertWorktreeGateCancelled(t *testing.T, ctx context.Context, taskID string) {
	t.Helper()
	var status string
	var errText, failureReason pgtype.Text
	if err := testPool.QueryRow(ctx,
		`SELECT status, error, failure_reason FROM agent_task_queue WHERE id = $1`,
		taskID).Scan(&status, &errText, &failureReason); err != nil {
		t.Fatalf("read task: %v", err)
	}
	if status != "cancelled" {
		t.Errorf("status = %q, want cancelled", status)
	}
	if !strings.Contains(errText.String, "/Users/dev/wtgate") {
		t.Errorf("error = %q, want the persisted reason naming the directory", errText.String)
	}
	if failureReason.String != "local_directory_error" {
		t.Errorf("failure_reason = %q, want local_directory_error", failureReason.String)
	}
}

// TestClaimTask_WorktreeGateSingular drives the REAL singular claim endpoint
// against a too-old runtime: the daemon must get the reason as a 422, and the
// row must land cancelled-with-reason via the full TaskService path — not a
// bare status flip that leaves agent status and live cards stale.
func TestClaimTask_WorktreeGateSingular(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	const daemonID = "wtgate-singular-daemon"
	runtimeID, taskID := seedWorktreeGateClaimFixture(t, ctx, "WT gate singular", daemonID, "0.4.10")

	w := httptest.NewRecorder()
	req := newDaemonTokenRequest("POST", "/api/daemon/runtimes/"+runtimeID+"/claim", nil, testWorkspaceID, daemonID)
	req = withURLParam(req, "runtimeId", runtimeID)
	testHandler.ClaimTaskByRuntime(w, req)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for a too-old runtime, got %d: %s", w.Code, w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, "/Users/dev/wtgate") ||
		!strings.Contains(body, "does not support parallel") ||
		!strings.Contains(body, "Update the Auro app") {
		t.Errorf("422 body should name the directory and tell the user to update, got: %s", body)
	}
	assertWorktreeGateCancelled(t, ctx, taskID)
}

// TestClaimTask_WorktreeGateBatch drives the REAL batch claim endpoint: the
// blocked task is omitted from the response (the daemon never sees it), so the
// persisted row reason is the ONLY explanation the user gets — assert both.
func TestClaimTask_WorktreeGateBatch(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	// The batch token and body share batchClaimTestDaemonID; the runtime row
	// and resource ref must use the same machine for the gate to key on it.
	runtimeID, taskID := seedWorktreeGateClaimFixture(t, ctx, "WT gate batch", batchClaimTestDaemonID, "0.4.10")

	w := postBatchClaim(t, testWorkspaceID, []string{runtimeID}, 5)
	if w.Code != http.StatusOK {
		t.Fatalf("batch claim: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Tasks []AgentTaskResponse `json:"tasks"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Tasks) != 0 {
		t.Fatalf("blocked worktree task leaked into the batch response: %+v", resp.Tasks)
	}
	assertWorktreeGateCancelled(t, ctx, taskID)
}

// TestClaimTask_WorktreeGateAllowsCurrentRuntime is the control: the same
// fixture with a daemon that ADVERTISES worktree support claims normally,
// proving the gate blocks on the missing capability — not on worktree
// resources in general. Note the deliberately ancient version string: the gate
// must not consult it at all.
func TestClaimTask_WorktreeGateAllowsCurrentRuntime(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	const daemonID = "wtgate-ok-daemon"
	runtimeID, taskID := seedWorktreeGateClaimFixture(t, ctx, "WT gate ok", daemonID, "0.0.1")

	w := httptest.NewRecorder()
	req := newDaemonTokenRequest("POST", "/api/daemon/runtimes/"+runtimeID+"/claim", nil, testWorkspaceID, daemonID)
	req.Header.Set("X-Client-Capabilities", protocol.DaemonCapabilityLocalWorktreeV1)
	req = withURLParam(req, "runtimeId", runtimeID)
	testHandler.ClaimTaskByRuntime(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for a current runtime, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Task *AgentTaskResponse `json:"task"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Task == nil {
		t.Fatal("expected the task to be claimed by a new-enough runtime")
	}
	var status string
	if err := testPool.QueryRow(ctx, `SELECT status FROM agent_task_queue WHERE id = $1`, taskID).Scan(&status); err != nil {
		t.Fatalf("read task: %v", err)
	}
	if status != "dispatched" {
		t.Errorf("status = %q, want dispatched", status)
	}
}

// injectCancelFailureForTask installs a row-scoped trigger that makes any
// UPDATE flipping this task to 'cancelled' raise — real fault injection at the
// layer the gate's cancel actually fails at. The requeue path (status back to
// 'queued') passes through untouched, which is exactly the recovery the gate
// must take.
func injectCancelFailureForTask(t *testing.T, ctx context.Context, taskID string) {
	t.Helper()
	if _, err := testPool.Exec(ctx, `
		CREATE OR REPLACE FUNCTION wtgate_fail_cancel() RETURNS trigger AS $fn$
		BEGIN
			IF NEW.status = 'cancelled' THEN
				RAISE EXCEPTION 'injected cancel failure';
			END IF;
			RETURN NEW;
		END $fn$ LANGUAGE plpgsql
	`); err != nil {
		t.Fatalf("create fault function: %v", err)
	}
	if _, err := testPool.Exec(ctx,
		`CREATE TRIGGER wtgate_fail_cancel_trg BEFORE UPDATE ON agent_task_queue
		 FOR EACH ROW WHEN (OLD.id = '`+taskID+`'::uuid) EXECUTE FUNCTION wtgate_fail_cancel()`); err != nil {
		t.Fatalf("create fault trigger: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(ctx, `DROP TRIGGER IF EXISTS wtgate_fail_cancel_trg ON agent_task_queue`)
		testPool.Exec(ctx, `DROP FUNCTION IF EXISTS wtgate_fail_cancel`)
	})
}

// When the gate's cancel itself fails, the claimed row must NOT strand in
// dispatched (the daemon was refused the task, so nothing would ever run or
// release it until stale reclaim). The gate requeues it so the next claim
// re-runs the gate and retries the cancel.
func TestClaimTask_WorktreeGateCancelFailureRequeuesSingular(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	const daemonID = "wtgate-cancelfail-daemon"
	runtimeID, taskID := seedWorktreeGateClaimFixture(t, ctx, "WT gate cancelfail", daemonID, "0.4.10")
	injectCancelFailureForTask(t, ctx, taskID)

	w := httptest.NewRecorder()
	req := newDaemonTokenRequest("POST", "/api/daemon/runtimes/"+runtimeID+"/claim", nil, testWorkspaceID, daemonID)
	req = withURLParam(req, "runtimeId", runtimeID)
	testHandler.ClaimTaskByRuntime(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 (transient server problem, not a claim refusal), got %d: %s", w.Code, w.Body.String())
	}
	var status string
	if err := testPool.QueryRow(ctx, `SELECT status FROM agent_task_queue WHERE id = $1`, taskID).Scan(&status); err != nil {
		t.Fatalf("read task: %v", err)
	}
	if status != "queued" {
		t.Errorf("status = %q, want queued — a stranded dispatched row waits on stale reclaim with no reason", status)
	}
}

func TestClaimTask_WorktreeGateCancelFailureRequeuesBatch(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	runtimeID, taskID := seedWorktreeGateClaimFixture(t, ctx, "WT gate cancelfail batch", batchClaimTestDaemonID, "0.4.10")
	injectCancelFailureForTask(t, ctx, taskID)

	w := postBatchClaim(t, testWorkspaceID, []string{runtimeID}, 5)
	if w.Code != http.StatusOK {
		t.Fatalf("batch claim: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Tasks []AgentTaskResponse `json:"tasks"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Tasks) != 0 {
		t.Fatalf("blocked worktree task leaked into the batch response: %+v", resp.Tasks)
	}
	var status string
	if err := testPool.QueryRow(ctx, `SELECT status FROM agent_task_queue WHERE id = $1`, taskID).Scan(&status); err != nil {
		t.Fatalf("read task: %v", err)
	}
	if status != "queued" {
		t.Errorf("status = %q, want queued after the batch gate's cancel failed", status)
	}
}

// The bug this gate was rebuilt for: a dev-built daemon reports a git-describe
// version that the version floor deliberately exempts, so the old version-based
// gate waved through a binary with no worktree implementation and two tasks ran
// in the user's own directory (MUL-5707). The capability signal is immune to
// how the version string happens to be spelled.
func TestWorktreeClaimGateIgnoresVersionStrings(t *testing.T) {
	const daemon = "daemon-a"
	res := []ProjectResourceData{{
		ID: "r1", ResourceType: "local_directory",
		ResourceRef: localDirRef(t, "/Users/dev/game", daemon, "worktree"),
	}}

	// Every one of these is a version string that the old floor check would
	// have ALLOWED. Without the capability, all must now be blocked.
	for _, version := range []string{
		"v0.4.21-24-gcd3c0bb89", // the exact dev-describe build that got through
		"0.4.24",                // at the floor
		"9.9.9",                 // far above it
		"",                      // none reported
	} {
		if worktreeClaimBlockReason(res, runtimeWithVersion(daemon, version), false) == "" {
			t.Errorf("version %q was allowed to claim without advertising the capability", version)
		}
	}

	// And the converse: a capable daemon runs regardless of how old its version
	// string looks, so the gate can never strand a runtime that actually works.
	for _, version := range []string{"v0.4.21-24-gcd3c0bb89", "0.0.1", ""} {
		if reason := worktreeClaimBlockReason(res, runtimeWithVersion(daemon, version), true); reason != "" {
			t.Errorf("version %q blocked a capable runtime: %q", version, reason)
		}
	}
}

// The stored-capability read backs the save-time gate and the UI, which cannot
// see the live request. Absent metadata is an older daemon: fail closed.
func TestRuntimeHasCapability(t *testing.T) {
	withCaps := func(caps ...string) []byte {
		raw, err := json.Marshal(map[string]any{"capabilities": caps})
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		return raw
	}

	if !runtimeHasCapability(withCaps("skill-bundles-v1", "local-worktree-v1"), "local-worktree-v1") {
		t.Error("advertised capability not detected")
	}
	if runtimeHasCapability(withCaps("skill-bundles-v1"), "local-worktree-v1") {
		t.Error("unadvertised capability reported as present")
	}
	for _, metadata := range [][]byte{
		nil,
		[]byte(`{}`),
		[]byte(`{"cli_version":"9.9.9"}`), // an old daemon: version, no capabilities
		[]byte(`not json`),
	} {
		if runtimeHasCapability(metadata, "local-worktree-v1") {
			t.Errorf("metadata %q reported the capability as present", string(metadata))
		}
	}
}

func runtimeRow(daemonID string, seenAt time.Time, caps ...string) db.AgentRuntime {
	rt := db.AgentRuntime{
		DaemonID:   pgtype.Text{String: daemonID, Valid: daemonID != ""},
		LastSeenAt: pgtype.Timestamptz{Time: seenAt, Valid: !seenAt.IsZero()},
	}
	payload := map[string]any{"cli_version": "9.9.9"}
	if len(caps) > 0 {
		payload["capabilities"] = caps
	}
	rt.Metadata, _ = json.Marshal(payload)
	return rt
}

// Deregistering a runtime only flips the row to offline — its metadata,
// capabilities included, survives — and ListAgentRuntimes returns every row. So
// "any row advertised it" keeps answering yes long after the machine downgraded,
// and the save gate and UI would keep offering a mode the claim gate then
// refuses. Newest-seen row wins.
func TestDaemonAdvertisesWorktreeUsesNewestRow(t *testing.T) {
	const daemon = "daemon-a"
	older := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	newer := time.Date(2026, 8, 13, 0, 0, 0, 0, time.UTC)

	t.Run("stale capable row does not rescue a downgraded daemon", func(t *testing.T) {
		rows := []db.AgentRuntime{
			runtimeRow(daemon, older, "local-worktree-v1"), // left behind by the old capable build
			runtimeRow(daemon, newer),                      // what the machine runs now
		}
		if daemonAdvertisesWorktree(rows, daemon) {
			t.Error("a stale capable row was allowed to vouch for a downgraded daemon")
		}
	})

	t.Run("newest capable row wins over an older incapable one", func(t *testing.T) {
		rows := []db.AgentRuntime{
			runtimeRow(daemon, older),
			runtimeRow(daemon, newer, "local-worktree-v1"), // the upgrade
		}
		if !daemonAdvertisesWorktree(rows, daemon) {
			t.Error("an upgraded daemon was not recognised")
		}
	})

	t.Run("row order does not matter", func(t *testing.T) {
		rows := []db.AgentRuntime{
			runtimeRow(daemon, newer),
			runtimeRow(daemon, older, "local-worktree-v1"),
		}
		if daemonAdvertisesWorktree(rows, daemon) {
			t.Error("result depended on slice order")
		}
	})

	t.Run("a row that never reported loses to one that did", func(t *testing.T) {
		var never time.Time
		rows := []db.AgentRuntime{
			runtimeRow(daemon, never, "local-worktree-v1"),
			runtimeRow(daemon, newer),
		}
		if daemonAdvertisesWorktree(rows, daemon) {
			t.Error("a never-seen row outvoted a live one")
		}
	})

	t.Run("ignores other daemons and empty ids", func(t *testing.T) {
		rows := []db.AgentRuntime{runtimeRow("daemon-b", newer, "local-worktree-v1")}
		if daemonAdvertisesWorktree(rows, daemon) {
			t.Error("another machine's row vouched for this daemon")
		}
		if daemonAdvertisesWorktree(rows, "") {
			t.Error("empty daemon id matched a row")
		}
		if daemonAdvertisesWorktree(nil, daemon) {
			t.Error("no rows at all reported capable")
		}
	})
}

// The bridge the whole gate rests on: what the daemon advertises on the
// register request has to survive onto the runtime row, or the save gate and
// the UI read an empty capability list and refuse a machine that is perfectly
// capable. Drives the real DaemonRegister handler.
func TestDaemonRegisterPersistsCapabilities(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	const daemonID = "capability-roundtrip-daemon"

	register := func(t *testing.T, capabilities string) string {
		t.Helper()
		w := httptest.NewRecorder()
		req := newDaemonTokenRequest("POST", "/api/daemon/register", map[string]any{
			"workspace_id": testWorkspaceID,
			"daemon_id":    daemonID,
			"device_name":  "capability-roundtrip-device",
			"runtimes": []map[string]any{
				{"name": "cap-runtime", "type": "claude", "version": "1.0.0", "status": "online"},
			},
		}, testWorkspaceID, daemonID)
		if capabilities != "" {
			req.Header.Set("X-Client-Capabilities", capabilities)
		} else {
			req.Header.Del("X-Client-Capabilities")
		}
		testHandler.DaemonRegister(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("DaemonRegister: expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var resp map[string]any
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("decode: %v", err)
		}
		runtimes, ok := resp["runtimes"].([]any)
		if !ok || len(runtimes) == 0 {
			t.Fatalf("expected runtimes in response, got %v", resp)
		}
		id := runtimes[0].(map[string]any)["id"].(string)
		t.Cleanup(func() { testPool.Exec(ctx, `DELETE FROM agent_runtime WHERE id = $1`, id) })
		return id
	}

	assertCapable := func(t *testing.T, runtimeID string, want bool) {
		t.Helper()
		var metadata []byte
		if err := testPool.QueryRow(ctx,
			`SELECT metadata FROM agent_runtime WHERE id = $1`, runtimeID).Scan(&metadata); err != nil {
			t.Fatalf("read metadata: %v", err)
		}
		if got := runtimeHasCapability(metadata, protocol.DaemonCapabilityLocalWorktreeV1); got != want {
			t.Errorf("capability persisted = %v, want %v (metadata: %s)", got, want, metadata)
		}
	}

	t.Run("advertised capability lands on the row", func(t *testing.T) {
		id := register(t, protocol.DaemonCapabilitySkillBundlesV1+","+protocol.DaemonCapabilityLocalWorktreeV1)
		assertCapable(t, id, true)
	})

	// An older daemon sends no header at all. Re-registering must overwrite the
	// row rather than leave a capable-looking one behind — that is precisely the
	// downgrade the save gate has to notice.
	t.Run("re-registering without the header clears it", func(t *testing.T) {
		id := register(t, protocol.DaemonCapabilitySkillBundlesV1+","+protocol.DaemonCapabilityLocalWorktreeV1)
		assertCapable(t, id, true)

		again := register(t, "")
		if again != id {
			t.Fatalf("expected the same runtime row on re-register, got %s then %s", id, again)
		}
		assertCapable(t, id, false)
	})
}
