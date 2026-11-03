package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/auro-ai/auro/server/internal/attribution"
	"github.com/auro-ai/auro/server/internal/events"
	"github.com/auro-ai/auro/server/internal/testutil"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestAttributionInvariantCheck_RejectsBypass verifies the DB-level cross-column
// CHECK (MUL-4302): a write in the ENFORCED regime (originator_source non-NULL — every
// real enqueue / coalesce path stamps it) that sets originator_user_id but leaves
// accountable_user_id NULL — or different — is rejected at the database, so a future
// code path that bypasses finalizeAttribution fails loudly instead of silently
// mis-attributing an audited run (the #5192 comment-merge bug class). The strict
// post-backfill handling of source-NULL rows is covered by
// TestAttributionInvariantCheck_RejectsUnbackfilledLegacyRows.
func TestAttributionInvariantCheck_RejectsBypass(t *testing.T) {
	pool := newResolveOriginatorPool(t)
	ctx := context.Background()
	_, userA, agentID, _ := seedAttributionFixture(t, pool)

	// originator set, accountable NULL, source set (enforced) → must violate the check.
	if _, err := pool.Exec(ctx, `
		INSERT INTO agent_task_queue (agent_id, runtime_id, status, priority, originator_user_id, originator_source)
		VALUES ($1, (SELECT runtime_id FROM agent WHERE id = $1), 'queued', 0, $2, 'comment_source')`, agentID, userA); err == nil {
		t.Fatal("expected the CHECK to reject originator set with NULL accountable, but insert succeeded")
	}

	// originator != accountable → also rejected.
	var userB string
	if err := pool.QueryRow(ctx, `INSERT INTO "user" (name, email) VALUES ('Check B', $1) RETURNING id`,
		fmt.Sprintf("check-b-%d@auro.test", time.Now().UnixNano())).Scan(&userB); err != nil {
		t.Fatalf("seed user B: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM "user" WHERE id = $1`, userB) })
	if _, err := pool.Exec(ctx, `
		INSERT INTO agent_task_queue (agent_id, runtime_id, status, priority, originator_user_id, accountable_user_id, originator_source)
		VALUES ($1, (SELECT runtime_id FROM agent WHERE id = $1), 'queued', 0, $2, $3, 'comment_source')`, agentID, userA, userB); err == nil {
		t.Fatal("expected the CHECK to reject originator != accountable, but insert succeeded")
	}

	// The legitimate shape (equal) is accepted.
	var okTaskID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO agent_task_queue (agent_id, runtime_id, status, priority, originator_user_id, accountable_user_id, originator_source)
		VALUES ($1, (SELECT runtime_id FROM agent WHERE id = $1), 'queued', 0, $2, $2, 'direct_human') RETURNING id`, agentID, userA).Scan(&okTaskID); err != nil {
		t.Fatalf("equal originator/accountable must be accepted, got %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM agent_task_queue WHERE id = $1`, okTaskID) })
}

// TestAttributionInvariantCheck_RejectsUnbackfilledLegacyRows verifies the second
// phase of the two-phase rollout (MUL-4302). Once the out-of-band backfill is complete,
// originator_source=NULL no longer exempts a row from the one-way invariant. A stale
// writer or missed backfill that tries to persist originator set with accountable NULL
// must fail loudly instead of recreating the legacy shape.
func TestAttributionInvariantCheck_RejectsUnbackfilledLegacyRows(t *testing.T) {
	pool := newResolveOriginatorPool(t)
	ctx := context.Background()
	_, userA, agentID, _ := seedAttributionFixture(t, pool)

	if _, err := pool.Exec(ctx, `
		INSERT INTO agent_task_queue (agent_id, runtime_id, status, priority, originator_user_id)
		VALUES ($1, (SELECT runtime_id FROM agent WHERE id = $1), 'queued', 0, $2)`, agentID, userA); err == nil {
		t.Fatal("expected the strict CHECK to reject an unbackfilled legacy row, but insert succeeded")
	}
}

// TestTriggerOwnerAttribution_ScheduleTriggerCreator is the acceptance test for
// trigger_owner (MUL-4302; Bohan): an autopilot schedule/webhook run is accountable
// to the member who CREATED the firing trigger, with originator NULL (no human
// authorized the autonomous fire).
func TestTriggerOwnerAttribution_ScheduleTriggerCreator(t *testing.T) {
	pool := newResolveOriginatorPool(t)
	ctx := context.Background()
	q := db.New(pool)
	workspaceID, creatorID, agentID, _ := seedAttributionFixture(t, pool)

	var autopilotID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO autopilot (workspace_id, title, assignee_id, execution_mode, created_by_type, created_by_id)
		VALUES ($1, 'trigger-owner-ap', $2, 'run_only', 'member', $3) RETURNING id`,
		workspaceID, agentID, creatorID).Scan(&autopilotID); err != nil {
		t.Fatalf("seed autopilot: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `WITH runs AS MATERIALIZED (SELECT id FROM autopilot_run WHERE autopilot_id=$1),
 removed_deliveries AS (DELETE FROM webhook_delivery WHERE autopilot_id=$1),
 removed_triggers AS (DELETE FROM autopilot_trigger WHERE autopilot_id=$1),
 removed_versions AS (DELETE FROM autopilot_rule_version WHERE autopilot_id=$1),
 removed_collaborators AS (DELETE FROM autopilot_collaborator WHERE autopilot_id=$1),
 detached_tasks AS (UPDATE agent_task_queue SET autopilot_run_id=NULL WHERE autopilot_run_id IN (SELECT id FROM runs)),
 removed_runs AS (DELETE FROM autopilot_run WHERE autopilot_id=$1)
 DELETE FROM autopilot WHERE id=$1`, autopilotID)
	})

	// Schedule trigger whose responsible publisher is the creating member.
	var triggerID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO autopilot_trigger (autopilot_id, kind, enabled, cron_expression,
			published_by_type, published_by_id, created_by_type, created_by_id)
		VALUES ($1, 'schedule', true, '0 * * * *', 'member', $2, 'member', $2) RETURNING id`,
		autopilotID, creatorID).Scan(&triggerID); err != nil {
		t.Fatalf("seed trigger: %v", err)
	}

	got := triggerOwnerAttribution(ctx, q,
		util.MustParseUUID(triggerID), util.MustParseUUID(workspaceID), util.MustParseUUID(autopilotID),
		attribution.EvidenceAutopilotRun, util.MustParseUUID(autopilotID))
	if got.Source != attribution.SourceTriggerOwner {
		t.Fatalf("source = %q, want trigger_owner", got.Source)
	}
	// MUL-6951: the trigger owner is the ORIGINATOR, not an audit-only accountable —
	// arming a trigger authorizes its runs the same way clicking "run now" does.
	if !got.UserID.Valid || got.UserID.Bytes != util.MustParseUUID(creatorID).Bytes {
		t.Errorf("originator = %s, want trigger creator %s", util.UUIDToString(got.UserID), creatorID)
	}
	if !got.AccountableUserID.Valid || got.AccountableUserID.Bytes != util.MustParseUUID(creatorID).Bytes {
		t.Errorf("accountable = %s, want trigger creator %s", util.UUIDToString(got.AccountableUserID), creatorID)
	}
}

// TestTriggerOwnerAttribution_LegacyTriggerFallsBackToRuleOwner verifies the
// backward-compat path Bohan signed off on: a trigger with no recorded creator
// (created before this migration) degrades to the rule publisher (rule_owner),
// never fabricating a human.
func TestTriggerOwnerAttribution_LegacyTriggerFallsBackToRuleOwner(t *testing.T) {
	pool := newResolveOriginatorPool(t)
	ctx := context.Background()
	q := db.New(pool)
	workspaceID, publisherID, agentID, _ := seedAttributionFixture(t, pool)

	var autopilotID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO autopilot (workspace_id, title, assignee_id, execution_mode, created_by_type, created_by_id)
		VALUES ($1, 'legacy-trigger-ap', $2, 'run_only', 'member', $3) RETURNING id`,
		workspaceID, agentID, publisherID).Scan(&autopilotID); err != nil {
		t.Fatalf("seed autopilot: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `WITH runs AS MATERIALIZED (SELECT id FROM autopilot_run WHERE autopilot_id=$1),
 removed_deliveries AS (DELETE FROM webhook_delivery WHERE autopilot_id=$1),
 removed_triggers AS (DELETE FROM autopilot_trigger WHERE autopilot_id=$1),
 removed_versions AS (DELETE FROM autopilot_rule_version WHERE autopilot_id=$1),
 removed_collaborators AS (DELETE FROM autopilot_collaborator WHERE autopilot_id=$1),
 detached_tasks AS (UPDATE agent_task_queue SET autopilot_run_id=NULL WHERE autopilot_run_id IN (SELECT id FROM runs)),
 removed_runs AS (DELETE FROM autopilot_run WHERE autopilot_id=$1)
 DELETE FROM autopilot WHERE id=$1`, autopilotID)
	})

	// Trigger with NO creator recorded (pre-migration style).
	var triggerID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO autopilot_trigger (autopilot_id, kind, enabled, cron_expression)
		VALUES ($1, 'schedule', true, '0 * * * *') RETURNING id`,
		autopilotID).Scan(&triggerID); err != nil {
		t.Fatalf("seed trigger: %v", err)
	}
	// Active rule version so the fallback resolves to rule_owner (the publisher).
	if _, err := pool.Exec(ctx, `
		INSERT INTO autopilot_rule_version (autopilot_id, workspace_id, published_by_type, published_by_id)
		VALUES ($1, $2, 'member', $3)`, autopilotID, workspaceID, publisherID); err != nil {
		t.Fatalf("seed rule version: %v", err)
	}

	got := triggerOwnerAttribution(ctx, q,
		util.MustParseUUID(triggerID), util.MustParseUUID(workspaceID), util.MustParseUUID(autopilotID),
		attribution.EvidenceAutopilotRun, util.MustParseUUID(autopilotID))
	if got.Source != attribution.SourceRuleOwner {
		t.Fatalf("source = %q, want rule_owner (legacy trigger falls back)", got.Source)
	}
	if !got.AccountableUserID.Valid || got.AccountableUserID.Bytes != util.MustParseUUID(publisherID).Bytes {
		t.Errorf("accountable = %s, want rule publisher %s", util.UUIDToString(got.AccountableUserID), publisherID)
	}
}

// seedExtraMember inserts a standalone user + workspace member and returns the
// user id, so a test can model an EDITOR distinct from the trigger creator.
func seedExtraMember(t *testing.T, pool *pgxpool.Pool, workspaceID, label string) string {
	t.Helper()
	ctx := context.Background()
	suffix := time.Now().UnixNano()
	var userID string
	if err := pool.QueryRow(ctx, `INSERT INTO "user" (name, email) VALUES ($1, $2) RETURNING id`,
		label, fmt.Sprintf("%s-%d@auro.test", label, suffix)).Scan(&userID); err != nil {
		t.Fatalf("seed %s user: %v", label, err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM "user" WHERE id = $1`, userID) })
	if _, err := pool.Exec(ctx, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
		workspaceID, userID); err != nil {
		t.Fatalf("seed %s member: %v", label, err)
	}
	return userID
}

// TestTriggerOwnerAttribution_TransfersToSubstantiveEditor is Elon's must-fix
// acceptance test: it drives the REAL triggerOwnerAttribution resolver (not the
// ruleOwnerAttribution helper) across the SAME queries the handlers use, and proves
// the model MUL-6951 settled: the run's human is the trigger's IMMUTABLE creator and
// a substantive edit does NOT move it, while published_by still transfers so the
// trigger row keeps recording who last took responsibility for its config.
//
// Bohan's ruling on the MUL-6951 thread: collaborative editing is an edge case, and
// making an edit silently re-authorize the automation as the editor is worse than
// keeping it on the creator. Note the consequence this locks in — because the DB
// invariant (migrations 190/197) forces accountable == originator whenever the
// originator is set, the TASK row now names the creator on both columns. The
// editor's responsibility is still recorded, on autopilot_trigger.published_by.
func TestTriggerOwnerAttribution_StaysWithTriggerCreator(t *testing.T) {
	pool := newResolveOriginatorPool(t)
	ctx := context.Background()
	q := db.New(pool)
	workspaceID, creatorA, agentID, _ := seedAttributionFixture(t, pool)
	editorB := seedExtraMember(t, pool, workspaceID, "editor-b")
	editorC := seedExtraMember(t, pool, workspaceID, "editor-c")

	var autopilotID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO autopilot (workspace_id, title, assignee_id, execution_mode, created_by_type, created_by_id)
		VALUES ($1, 'transfer-ap', $2, 'run_only', 'member', $3) RETURNING id`,
		workspaceID, agentID, creatorA).Scan(&autopilotID); err != nil {
		t.Fatalf("seed autopilot: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `WITH runs AS MATERIALIZED (SELECT id FROM autopilot_run WHERE autopilot_id=$1),
 removed_deliveries AS (DELETE FROM webhook_delivery WHERE autopilot_id=$1),
 removed_triggers AS (DELETE FROM autopilot_trigger WHERE autopilot_id=$1),
 removed_versions AS (DELETE FROM autopilot_rule_version WHERE autopilot_id=$1),
 removed_collaborators AS (DELETE FROM autopilot_collaborator WHERE autopilot_id=$1),
 detached_tasks AS (UPDATE agent_task_queue SET autopilot_run_id=NULL WHERE autopilot_run_id IN (SELECT id FROM runs)),
 removed_runs AS (DELETE FROM autopilot_run WHERE autopilot_id=$1)
 DELETE FROM autopilot WHERE id=$1`, autopilotID)
	})

	// Two triggers, both initially published by creator A (the create-site default).
	seedTrigger := func(cron string) string {
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO autopilot_trigger (autopilot_id, kind, enabled, cron_expression,
				published_by_type, published_by_id, created_by_type, created_by_id)
			VALUES ($1, 'schedule', true, $2, 'member', $3, 'member', $3) RETURNING id`,
			autopilotID, cron, creatorA).Scan(&id); err != nil {
			t.Fatalf("seed trigger: %v", err)
		}
		return id
	}
	trigger1 := seedTrigger("0 * * * *")
	trigger2 := seedTrigger("0 0 * * *")

	principalOf := func(triggerID string) string {
		got := triggerOwnerAttribution(ctx, q,
			util.MustParseUUID(triggerID), util.MustParseUUID(workspaceID), util.MustParseUUID(autopilotID),
			attribution.EvidenceAutopilotRun, util.MustParseUUID(autopilotID))
		if got.Source != attribution.SourceTriggerOwner {
			t.Fatalf("trigger %s: source = %q, want trigger_owner", triggerID, got.Source)
		}
		if got.UserID != got.AccountableUserID {
			t.Fatalf("trigger %s: originator %s and accountable %s must be the same human",
				triggerID, util.UUIDToString(got.UserID), util.UUIDToString(got.AccountableUserID))
		}
		return util.UUIDToString(got.UserID)
	}

	// Baseline: both triggers run as creator A.
	if a := principalOf(trigger1); a != creatorA {
		t.Fatalf("trigger1 baseline principal = %s, want creator %s", a, creatorA)
	}
	if a := principalOf(trigger2); a != creatorA {
		t.Fatalf("trigger2 baseline principal = %s, want creator %s", a, creatorA)
	}

	// B substantively edits trigger1 — the SAME query UpdateAutopilotTrigger runs.
	if err := q.SetAutopilotTriggerPublisher(ctx, db.SetAutopilotTriggerPublisherParams{
		ID:              util.MustParseUUID(trigger1),
		PublishedByType: pgtype.Text{String: "member", Valid: true},
		PublishedByID:   util.MustParseUUID(editorB),
	}); err != nil {
		t.Fatalf("SetAutopilotTriggerPublisher: %v", err)
	}

	// The edit moves published_by but NOT the run's human: an editor must not be
	// able to re-point the automation at their own rights (MUL-6951).
	var published1 pgtype.UUID
	if err := pool.QueryRow(ctx, `SELECT published_by_id FROM autopilot_trigger WHERE id = $1`,
		util.MustParseUUID(trigger1)).Scan(&published1); err != nil {
		t.Fatalf("read published_by: %v", err)
	}
	if util.UUIDToString(published1) != editorB {
		t.Fatalf("published_by = %s, want editor %s (trigger-level responsibility must still transfer)",
			util.UUIDToString(published1), editorB)
	}
	if a := principalOf(trigger1); a != creatorA {
		t.Fatalf("after edit, trigger1 principal = %s, want creator %s (an edit must not re-authorize)", a, creatorA)
	}
	// Isolation is unchanged: neither trigger's principal moves.
	if a := principalOf(trigger2); a != creatorA {
		t.Fatalf("trigger2 principal = %s, want creator %s", a, creatorA)
	}

	// C makes an autopilot-level substantive edit — the SAME bump-all query
	// UpdateAutopilot runs — which governs every trigger of the autopilot.
	if err := q.SetAutopilotTriggerPublishersByAutopilot(ctx, db.SetAutopilotTriggerPublishersByAutopilotParams{
		AutopilotID:     util.MustParseUUID(autopilotID),
		PublishedByType: pgtype.Text{String: "member", Valid: true},
		PublishedByID:   util.MustParseUUID(editorC),
	}); err != nil {
		t.Fatalf("SetAutopilotTriggerPublishersByAutopilot: %v", err)
	}
	// Same rule at the autopilot level: the bump-all edit moves published_by on both
	// triggers, and neither run's human moves with it.
	if a := principalOf(trigger1); a != creatorA {
		t.Fatalf("after autopilot-level edit, trigger1 principal = %s, want creator %s", a, creatorA)
	}
	if a := principalOf(trigger2); a != creatorA {
		t.Fatalf("after autopilot-level edit, trigger2 principal = %s, want creator %s", a, creatorA)
	}
	_ = editorC
}

// seedRunOnlyAutopilot creates an active run_only autopilot (agent-assigned) plus a
// running autopilot_run for it, and returns their ids. Used to exercise
// dispatchRunOnly's direct CreateAutopilotTask path.
func seedRunOnlyAutopilot(t *testing.T, pool *pgxpool.Pool, workspaceID, agentID, creatorID string) (autopilotID, runID string) {
	t.Helper()
	ctx := context.Background()
	if err := pool.QueryRow(ctx, `
		INSERT INTO autopilot (workspace_id, title, assignee_type, assignee_id, status, execution_mode, created_by_type, created_by_id)
		VALUES ($1, 'run-only ap', 'agent', $2, 'active', 'run_only', 'member', $3) RETURNING id`,
		workspaceID, agentID, creatorID).Scan(&autopilotID); err != nil {
		t.Fatalf("seed autopilot: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `WITH runs AS MATERIALIZED (SELECT id FROM autopilot_run WHERE autopilot_id=$1),
 removed_deliveries AS (DELETE FROM webhook_delivery WHERE autopilot_id=$1),
 removed_triggers AS (DELETE FROM autopilot_trigger WHERE autopilot_id=$1),
 removed_versions AS (DELETE FROM autopilot_rule_version WHERE autopilot_id=$1),
 removed_collaborators AS (DELETE FROM autopilot_collaborator WHERE autopilot_id=$1),
 detached_tasks AS (UPDATE agent_task_queue SET autopilot_run_id=NULL WHERE autopilot_run_id IN (SELECT id FROM runs)),
 removed_runs AS (DELETE FROM autopilot_run WHERE autopilot_id=$1)
 DELETE FROM autopilot WHERE id=$1`, autopilotID)
	})
	if err := pool.QueryRow(ctx, `
		INSERT INTO autopilot_run (autopilot_id, source, status) VALUES ($1, 'manual', 'running') RETURNING id`,
		autopilotID).Scan(&runID); err != nil {
		t.Fatalf("seed autopilot run: %v", err)
	}
	return autopilotID, runID
}

// TestDispatchRunOnlyScheduleStampsRuleOwnerRow is the run_only row assertion Elon
// asked for: the direct CreateAutopilotTask path (no member actor → schedule-like)
// must persist rule_owner on the queue row — originator NULL, accountable = the
// active rule version publisher, rule_version_id set.
func TestDispatchRunOnlyScheduleStampsRuleOwnerRow(t *testing.T) {
	pool := newResolveOriginatorPool(t)
	ctx := context.Background()
	q := db.New(pool)
	workspaceID, publisherID, agentID, _ := seedAttributionFixture(t, pool)
	autopilotID, runID := seedRunOnlyAutopilot(t, pool, workspaceID, agentID, publisherID)

	var ruleVersionID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO autopilot_rule_version (autopilot_id, workspace_id, published_by_type, published_by_id)
		VALUES ($1, $2, 'member', $3) RETURNING id`, autopilotID, workspaceID, publisherID).Scan(&ruleVersionID); err != nil {
		t.Fatalf("seed rule version: %v", err)
	}

	svc := &AutopilotService{Queries: q, TxStarter: pool, Bus: events.New(), TaskSvc: &TaskService{Queries: q, TxStarter: pool, Bus: events.New()}}
	ap, err := q.GetAutopilot(ctx, util.MustParseUUID(autopilotID))
	if err != nil {
		t.Fatalf("get autopilot: %v", err)
	}
	run, err := q.GetAutopilotRun(ctx, util.MustParseUUID(runID))
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	// No member actor → schedule/webhook-style rule_owner attribution.
	if err := svc.dispatchRunOnly(ctx, ap, &run, pgtype.UUID{}); err != nil {
		t.Fatalf("dispatchRunOnly: %v", err)
	}

	var source pgtype.Text
	var originator, accountable, ruleVersion pgtype.UUID
	if err := pool.QueryRow(ctx, `
		SELECT originator_source, originator_user_id, accountable_user_id, rule_version_id
		FROM agent_task_queue WHERE autopilot_run_id = $1`, run.ID).Scan(&source, &originator, &accountable, &ruleVersion); err != nil {
		t.Fatalf("read stored attribution: %v", err)
	}
	if source.String != string(attribution.SourceRuleOwner) {
		t.Errorf("originator_source = %q, want rule_owner", source.String)
	}
	// rule_owner stays AUDIT-ONLY — see the create_issue case above (MUL-6951).
	if originator.Valid {
		t.Errorf("rule_owner must not set originator, got %s", util.UUIDToString(originator))
	}
	if !accountable.Valid || accountable.Bytes != util.MustParseUUID(publisherID).Bytes {
		t.Errorf("accountable_user_id = %s, want publisher %s", util.UUIDToString(accountable), publisherID)
	}
	if !ruleVersion.Valid || ruleVersion.Bytes != util.MustParseUUID(ruleVersionID).Bytes {
		t.Errorf("rule_version_id = %s, want %s", util.UUIDToString(ruleVersion), ruleVersionID)
	}
}

// TestDispatchRunOnlyManualStampsDirectHuman verifies the blocking-finding fix on the
// run_only path: a MANUAL trigger attributes direct_human to the triggering member —
// originator == accountable == actor, no rule_version — even when the autopilot has a
// published rule owned by someone else (MUL-4302 §4).
func TestDispatchRunOnlyManualStampsDirectHuman(t *testing.T) {
	pool := newResolveOriginatorPool(t)
	ctx := context.Background()
	q := db.New(pool)
	workspaceID, publisherID, agentID, _ := seedAttributionFixture(t, pool)
	autopilotID, runID := seedRunOnlyAutopilot(t, pool, workspaceID, agentID, publisherID)

	// A rule version published by the creator exists; the manual actor is a
	// DIFFERENT member, who must win.
	if _, err := pool.Exec(ctx, `
		INSERT INTO autopilot_rule_version (autopilot_id, workspace_id, published_by_type, published_by_id)
		VALUES ($1, $2, 'member', $3)`, autopilotID, workspaceID, publisherID); err != nil {
		t.Fatalf("seed rule version: %v", err)
	}
	var actorID string
	if err := pool.QueryRow(ctx, `INSERT INTO "user" (name, email) VALUES ('Trigger', $1) RETURNING id`,
		fmt.Sprintf("trigger-%d@auro.test", time.Now().UnixNano())).Scan(&actorID); err != nil {
		t.Fatalf("seed actor: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM "user" WHERE id = $1`, actorID) })
	if _, err := pool.Exec(ctx, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
		workspaceID, actorID); err != nil {
		t.Fatalf("seed actor member: %v", err)
	}

	svc := &AutopilotService{Queries: q, TxStarter: pool, Bus: events.New(), TaskSvc: &TaskService{Queries: q, TxStarter: pool, Bus: events.New()}}
	ap, err := q.GetAutopilot(ctx, util.MustParseUUID(autopilotID))
	if err != nil {
		t.Fatalf("get autopilot: %v", err)
	}
	run, err := q.GetAutopilotRun(ctx, util.MustParseUUID(runID))
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if err := svc.dispatchRunOnly(ctx, ap, &run, util.MustParseUUID(actorID)); err != nil {
		t.Fatalf("dispatchRunOnly: %v", err)
	}

	var source pgtype.Text
	var originator, accountable, ruleVersion pgtype.UUID
	if err := pool.QueryRow(ctx, `
		SELECT originator_source, originator_user_id, accountable_user_id, rule_version_id
		FROM agent_task_queue WHERE autopilot_run_id = $1`, run.ID).Scan(&source, &originator, &accountable, &ruleVersion); err != nil {
		t.Fatalf("read stored attribution: %v", err)
	}
	if source.String != string(attribution.SourceDirectHuman) {
		t.Errorf("originator_source = %q, want direct_human", source.String)
	}
	if !originator.Valid || originator.Bytes != util.MustParseUUID(actorID).Bytes {
		t.Errorf("originator_user_id = %s, want triggering member %s", util.UUIDToString(originator), actorID)
	}
	if !accountable.Valid || accountable.Bytes != originator.Bytes {
		t.Errorf("accountable_user_id = %s, want == originator (actor)", util.UUIDToString(accountable))
	}
	if ruleVersion.Valid {
		t.Errorf("manual direct_human must not set rule_version_id, got %s", util.UUIDToString(ruleVersion))
	}
}

// TestDispatchRunOnlyScheduleStaysWithTriggerCreator drives dispatchRunOnly end to
// end (schedule-style, no member actor) and asserts the PERSISTED
// agent_task_queue row names the trigger's CREATOR on both attribution columns even
// after a substantive edit re-stamped published_by to someone else — the run must not
// be re-authorized by an edit (MUL-6951). The resolver-level before/after and
// per-trigger isolation are covered by TestTriggerOwnerAttribution_StaysWithTriggerCreator.
func TestDispatchRunOnlyScheduleStaysWithTriggerCreator(t *testing.T) {
	pool := newResolveOriginatorPool(t)
	ctx := context.Background()
	q := db.New(pool)
	workspaceID, creatorA, agentID, _ := seedAttributionFixture(t, pool)
	editorB := seedExtraMember(t, pool, workspaceID, "dispatch-editor-b")

	var autopilotID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO autopilot (workspace_id, title, assignee_type, assignee_id, status, execution_mode, created_by_type, created_by_id)
		VALUES ($1, 'dispatch-transfer-ap', 'agent', $2, 'active', 'run_only', 'member', $3) RETURNING id`,
		workspaceID, agentID, creatorA).Scan(&autopilotID); err != nil {
		t.Fatalf("seed autopilot: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `WITH runs AS MATERIALIZED (SELECT id FROM autopilot_run WHERE autopilot_id=$1),
 removed_deliveries AS (DELETE FROM webhook_delivery WHERE autopilot_id=$1),
 removed_triggers AS (DELETE FROM autopilot_trigger WHERE autopilot_id=$1),
 removed_versions AS (DELETE FROM autopilot_rule_version WHERE autopilot_id=$1),
 removed_collaborators AS (DELETE FROM autopilot_collaborator WHERE autopilot_id=$1),
 detached_tasks AS (UPDATE agent_task_queue SET autopilot_run_id=NULL WHERE autopilot_run_id IN (SELECT id FROM runs)),
 removed_runs AS (DELETE FROM autopilot_run WHERE autopilot_id=$1)
 DELETE FROM autopilot WHERE id=$1`, autopilotID)
	})

	// Schedule trigger initially published by creator A, then edited by B.
	var triggerID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO autopilot_trigger (autopilot_id, kind, enabled, cron_expression,
			published_by_type, published_by_id, created_by_type, created_by_id)
		VALUES ($1, 'schedule', true, '0 * * * *', 'member', $2, 'member', $2) RETURNING id`,
		autopilotID, creatorA).Scan(&triggerID); err != nil {
		t.Fatalf("seed trigger: %v", err)
	}
	if err := q.SetAutopilotTriggerPublisher(ctx, db.SetAutopilotTriggerPublisherParams{
		ID:              util.MustParseUUID(triggerID),
		PublishedByType: pgtype.Text{String: "member", Valid: true},
		PublishedByID:   util.MustParseUUID(editorB),
	}); err != nil {
		t.Fatalf("SetAutopilotTriggerPublisher: %v", err)
	}

	// A running schedule run bound to that trigger — the shape the scheduler dispatches.
	var runID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO autopilot_run (autopilot_id, trigger_id, source, status)
		VALUES ($1, $2, 'schedule', 'running') RETURNING id`,
		autopilotID, triggerID).Scan(&runID); err != nil {
		t.Fatalf("seed run: %v", err)
	}

	svc := &AutopilotService{Queries: q, TxStarter: pool, Bus: events.New(), TaskSvc: &TaskService{Queries: q, TxStarter: pool, Bus: events.New()}}
	ap, err := q.GetAutopilot(ctx, util.MustParseUUID(autopilotID))
	if err != nil {
		t.Fatalf("get autopilot: %v", err)
	}
	run, err := q.GetAutopilotRun(ctx, util.MustParseUUID(runID))
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	// No member actor → schedule/webhook-style trigger_owner attribution.
	if err := svc.dispatchRunOnly(ctx, ap, &run, pgtype.UUID{}); err != nil {
		t.Fatalf("dispatchRunOnly: %v", err)
	}

	var source pgtype.Text
	var originator, accountable pgtype.UUID
	if err := pool.QueryRow(ctx, `
		SELECT originator_source, originator_user_id, accountable_user_id
		FROM agent_task_queue WHERE autopilot_run_id = $1`, run.ID).Scan(&source, &originator, &accountable); err != nil {
		t.Fatalf("read stored attribution: %v", err)
	}
	if source.String != string(attribution.SourceTriggerOwner) {
		t.Errorf("originator_source = %q, want trigger_owner", source.String)
	}
	// MUL-6951: B's edit re-stamped published_by, but the run still executes with
	// A's rights. An editor changing a cron expression must not be able to hand the
	// automation their own access.
	if !originator.Valid || originator.Bytes != util.MustParseUUID(creatorA).Bytes {
		t.Errorf("originator_user_id = %s, want trigger creator %s (not editor %s)",
			util.UUIDToString(originator), creatorA, editorB)
	}
	if !accountable.Valid || accountable.Bytes != util.MustParseUUID(creatorA).Bytes {
		t.Errorf("accountable_user_id = %s, want trigger creator %s", util.UUIDToString(accountable), creatorA)
	}
}

// TestRecordAutopilotRuleVersionRepublishReattributes verifies the final Phase 1
// item (MUL-4302 §3.4): republishing a rule (as a trigger edit / archive / system
// pause does) appends a new version, the LATEST version is the active one, and
// dispatch attribution follows it. So editing member A's autopilot as member B
// re-attributes subsequent runs to B; a system pause records a 'system' publisher.
func TestRecordAutopilotRuleVersionRepublishReattributes(t *testing.T) {
	pool := newResolveOriginatorPool(t)
	ctx := context.Background()
	q := db.New(pool)
	workspaceID, memberA, agentID, _ := seedAttributionFixture(t, pool)
	autopilotID, _ := seedRunOnlyAutopilot(t, pool, workspaceID, agentID, memberA)

	var memberB string
	if err := pool.QueryRow(ctx, `INSERT INTO "user" (name, email) VALUES ('Editor', $1) RETURNING id`,
		fmt.Sprintf("editor-%d@auro.test", time.Now().UnixNano())).Scan(&memberB); err != nil {
		t.Fatalf("seed member B: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM "user" WHERE id = $1`, memberB) })
	if _, err := pool.Exec(ctx, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
		workspaceID, memberB); err != nil {
		t.Fatalf("seed member B membership: %v", err)
	}

	ap, err := q.GetAutopilot(ctx, util.MustParseUUID(autopilotID))
	if err != nil {
		t.Fatalf("get autopilot: %v", err)
	}
	verParams := db.GetActiveAutopilotRuleVersionParams{WorkspaceID: ap.WorkspaceID, AutopilotID: ap.ID}

	// v1: creator (member A) publishes; active + dispatch attribute to A.
	if err := RecordAutopilotRuleVersion(ctx, q, ap, "member", util.MustParseUUID(memberA)); err != nil {
		t.Fatalf("record v1: %v", err)
	}
	active, err := q.GetActiveAutopilotRuleVersion(ctx, verParams)
	if err != nil || active.PublishedByType != "member" || active.PublishedByID.Bytes != util.MustParseUUID(memberA).Bytes {
		t.Fatalf("v1 active = %+v (err %v), want member A", active, err)
	}

	// v2: member B republishes (e.g. edited a trigger) → latest wins.
	if err := RecordAutopilotRuleVersion(ctx, q, ap, "member", util.MustParseUUID(memberB)); err != nil {
		t.Fatalf("record v2: %v", err)
	}
	attr := ruleOwnerAttribution(ctx, q, ap.WorkspaceID, ap.ID, attribution.EvidenceAutopilotRun, ap.ID)
	if attr.Source != attribution.SourceRuleOwner || attr.AccountableUserID.Bytes != util.MustParseUUID(memberB).Bytes {
		t.Errorf("after republish, dispatch attribution = %+v, want rule_owner accountable = member B", attr)
	}

	// v3: system auto-pause records a 'system' publisher (no member id).
	if err := RecordAutopilotRuleVersion(ctx, q, ap, "system", pgtype.UUID{}); err != nil {
		t.Fatalf("record v3 (system): %v", err)
	}
	active, err = q.GetActiveAutopilotRuleVersion(ctx, verParams)
	if err != nil || active.PublishedByType != "system" || active.PublishedByID.Valid {
		t.Errorf("v3 active = %+v (err %v), want system publisher with NULL id", active, err)
	}
	// A system-published version has no member → dispatch degrades to unattributed
	// (never fabricates a human).
	sysAttr := ruleOwnerAttribution(ctx, q, ap.WorkspaceID, ap.ID, attribution.EvidenceAutopilotRun, ap.ID)
	if sysAttr.Source != attribution.SourceUnattributed || sysAttr.AccountableUserID.Valid {
		t.Errorf("system-published version must yield unattributed, got %+v", sysAttr)
	}
}

// TestApplyAttributionFallbackRefusesOnMissingOwner: an unattributed run in an
// OPEN (non-fail-closed) workspace whose agent has no valid owner cannot resolve an
// accountable human via owner_fallback, so the enqueue is refused rather than
// creating a NULL-accountable task (MUL-4302 §3.5, Elon must-fix 1).
func TestApplyAttributionFallbackRefusesOnMissingOwner(t *testing.T) {
	pool := newResolveOriginatorPool(t)
	ctx := context.Background()
	q := db.New(pool)
	workspaceID, _, _, _ := seedAttributionFixture(t, pool) // default policy = open

	svc := &TaskService{Queries: q, TxStarter: pool, Bus: events.New()}
	unattr := attribution.Unattributed(attribution.EvidenceChat, util.MustParseUUID(workspaceID))
	_, err := svc.applyAttributionFallback(ctx, unattr, db.Agent{WorkspaceID: util.MustParseUUID(workspaceID)}) // OwnerID zero
	if !errors.Is(err, ErrAttributionFailClosed) {
		t.Fatalf("missing owner: err = %v, want ErrAttributionFailClosed", err)
	}
}

// TestApplyAttributionFallbackRefusesOnPolicyReadFailure: if the workspace policy
// cannot be read for an unattributed run, fail CLOSED (refuse) rather than silently
// running an unattributable task — even when a valid owner is present (Elon must-fix 1).
func TestApplyAttributionFallbackRefusesOnPolicyReadFailure(t *testing.T) {
	pool := newResolveOriginatorPool(t)
	ctx := context.Background()
	q := db.New(pool)
	_, ownerID, _, _ := seedAttributionFixture(t, pool)

	svc := &TaskService{Queries: q, TxStarter: pool, Bus: events.New()}
	unattr := attribution.Unattributed(attribution.EvidenceChat, pgtype.UUID{})
	missingWs := pgtype.UUID{Bytes: [16]byte{0xDE, 0xAD, 0xBE, 0xEF}, Valid: true} // no such workspace
	_, err := svc.applyAttributionFallback(ctx, unattr, db.Agent{WorkspaceID: missingWs, OwnerID: util.MustParseUUID(ownerID)})
	if !errors.Is(err, ErrAttributionFailClosed) {
		t.Fatalf("policy read failure: err = %v, want ErrAttributionFailClosed", err)
	}
}

// TestApplyAttributionFallbackPreciseUntouched: a precise attribution never reads
// the policy and passes through unchanged (proven with a nil-Queries service).
func TestApplyAttributionFallbackPreciseUntouched(t *testing.T) {
	svc := &TaskService{} // no Queries: a policy read would panic/error if attempted
	precise := attribution.DirectHumanRun(pgtype.UUID{Bytes: [16]byte{0x11}, Valid: true}, attribution.EvidenceChat, pgtype.UUID{})
	got, err := svc.applyAttributionFallback(context.Background(), precise, db.Agent{})
	if err != nil {
		t.Fatalf("precise attribution must not error: %v", err)
	}
	if got.Source != attribution.SourceDirectHuman || got != precise {
		t.Errorf("precise attribution must pass through unchanged, got %+v", got)
	}
}

// TestEnqueueChatTaskStampsChatEvidence verifies the chat enqueue path is no
// longer a NULL-source bypass and uses the UNIFORM evidence pair: the sender is a
// direct_human originator+accountable, and evidence is (kind=chat,
// ref=chat_session_id) so the attribution UI links to the conversation the same
// way it does for autopilot_run / issue_assignment (MUL-4302 §2, Elon 2nd-round).
func TestEnqueueChatTaskStampsChatEvidence(t *testing.T) {
	pool := newResolveOriginatorPool(t)
	ctx := context.Background()
	q := db.New(pool)
	workspaceID, userID, agentID, _ := seedAttributionFixture(t, pool)

	var chatSessionID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO chat_session (workspace_id, agent_id, creator_id)
		VALUES ($1, $2, $3) RETURNING id`, workspaceID, agentID, userID).Scan(&chatSessionID); err != nil {
		t.Fatalf("seed chat session: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM chat_session WHERE id = $1`, chatSessionID) })
	seedChannelTaskBinding(t, pool, chatSessionID)

	svc := &TaskService{Queries: q, TxStarter: pool, Bus: events.New()}
	task, err := svc.enqueueChatTask(ctx, db.ChatSession{
		ID:      util.MustParseUUID(chatSessionID),
		AgentID: util.MustParseUUID(agentID),
	}, util.MustParseUUID(userID), false, 0, false, pgtype.UUID{}, 0)
	if err != nil {
		t.Fatalf("EnqueueChatTask: %v", err)
	}

	var source, evidenceKind pgtype.Text
	var originator, accountable, evidenceRef pgtype.UUID
	if err := pool.QueryRow(ctx, `
		SELECT originator_source, originator_user_id, accountable_user_id, trigger_evidence_kind, trigger_evidence_ref_id
		FROM agent_task_queue WHERE id = $1`, task.ID).Scan(&source, &originator, &accountable, &evidenceKind, &evidenceRef); err != nil {
		t.Fatalf("read stored attribution: %v", err)
	}

	if source.String != string(attribution.SourceDirectHuman) {
		t.Errorf("originator_source = %q, want direct_human", source.String)
	}
	if !originator.Valid || originator.Bytes != util.MustParseUUID(userID).Bytes {
		t.Errorf("originator_user_id = %s, want sender %s", util.UUIDToString(originator), userID)
	}
	if !accountable.Valid || accountable.Bytes != originator.Bytes {
		t.Errorf("accountable_user_id = %s, want == originator", util.UUIDToString(accountable))
	}
	if evidenceKind.String != string(attribution.EvidenceChat) {
		t.Errorf("trigger_evidence_kind = %q, want chat", evidenceKind.String)
	}
	if !evidenceRef.Valid || evidenceRef.Bytes != util.MustParseUUID(chatSessionID).Bytes {
		t.Errorf("trigger_evidence_ref_id = %s, want chat session %s", util.UUIDToString(evidenceRef), chatSessionID)
	}
}

func TestEnqueueChatTaskDefersForChannelMediaAndPromotesWhenReady(t *testing.T) {
	pool := newResolveOriginatorPool(t)
	ctx := context.Background()
	q := db.New(pool)
	workspaceID, userID, agentID, _ := seedAttributionFixture(t, pool)

	var chatSessionID, priorMessageID, messageID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO chat_session (workspace_id, agent_id, creator_id)
		VALUES ($1, $2, $3) RETURNING id`, workspaceID, agentID, userID).Scan(&chatSessionID); err != nil {
		t.Fatalf("seed chat session: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM chat_session WHERE id = $1`, chatSessionID)
	})
	seedChannelTaskBinding(t, pool, chatSessionID)
	if err := pool.QueryRow(ctx, `
		INSERT INTO chat_message (chat_session_id, role, content)
		VALUES ($1, 'user', 'first') RETURNING id`, chatSessionID).Scan(&priorMessageID); err != nil {
		t.Fatalf("seed prior message: %v", err)
	}

	svc := &TaskService{Queries: q, TxStarter: pool, Bus: events.New()}
	priorTask, err := svc.enqueueChatTask(ctx, db.ChatSession{
		ID:      util.MustParseUUID(chatSessionID),
		AgentID: util.MustParseUUID(agentID),
	}, util.MustParseUUID(userID), false, 0, false, pgtype.UUID{}, 0)
	if err != nil {
		t.Fatalf("enqueue prior chat task: %v", err)
	}
	deadline := time.Now().Add(time.Minute)
	if err := pool.QueryRow(ctx, `
		INSERT INTO chat_message (chat_session_id, role, content, channel_media_pending_until)
		VALUES ($1, 'user', '[Image]', $2) RETURNING id`, chatSessionID, deadline).Scan(&messageID); err != nil {
		t.Fatalf("seed pending media message: %v", err)
	}

	task, err := svc.enqueueChatTask(ctx, db.ChatSession{
		ID:      util.MustParseUUID(chatSessionID),
		AgentID: util.MustParseUUID(agentID),
	}, util.MustParseUUID(userID), false, 0, false, pgtype.UUID{}, 0)
	if err != nil {
		t.Fatalf("EnqueueChatTask: %v", err)
	}
	if task.Status != "deferred" || !task.FireAt.Valid {
		t.Fatalf("task = status %q fire_at %v, want durable deferred task", task.Status, task.FireAt)
	}
	if !task.ChatInputTaskID.Valid || task.ChatInputTaskID.Bytes != task.ID.Bytes {
		t.Fatalf("task input owner = %s, want self %s", util.UUIDToString(task.ChatInputTaskID), util.UUIDToString(task.ID))
	}
	if task.FireAt.Time.Before(deadline.Add(-time.Second)) || task.FireAt.Time.After(deadline.Add(time.Second)) {
		t.Fatalf("task fire_at = %v, want media deadline %v", task.FireAt.Time, deadline)
	}
	var linkedTaskID pgtype.UUID
	if err := pool.QueryRow(ctx, `SELECT task_id FROM chat_message WHERE id = $1`, messageID).Scan(&linkedTaskID); err != nil {
		t.Fatalf("load sealed media message: %v", err)
	}
	if !linkedTaskID.Valid || linkedTaskID.Bytes != task.ID.Bytes {
		t.Fatalf("message task_id = %s, want %s", util.UUIDToString(linkedTaskID), util.UUIDToString(task.ID))
	}
	if err := pool.QueryRow(ctx, `SELECT task_id FROM chat_message WHERE id = $1`, priorMessageID).Scan(&linkedTaskID); err != nil {
		t.Fatalf("load prior sealed message: %v", err)
	}
	if !linkedTaskID.Valid || linkedTaskID.Bytes != priorTask.ID.Bytes {
		t.Fatalf("prior message task_id = %s, want unchanged owner %s", util.UUIDToString(linkedTaskID), util.UUIDToString(priorTask.ID))
	}

	if err := q.ClearChatMessageChannelMediaPending(ctx, db.ClearChatMessageChannelMediaPendingParams{
		ID:            util.MustParseUUID(messageID),
		ChatSessionID: util.MustParseUUID(chatSessionID),
	}); err != nil {
		t.Fatalf("clear pending media: %v", err)
	}
	if err := svc.PromoteChannelChatTasksIfMediaReady(ctx, util.MustParseUUID(chatSessionID)); err != nil {
		t.Fatalf("PromoteChannelChatTasksIfMediaReady: %v", err)
	}
	var status string
	var fireAt pgtype.Timestamptz
	if err := pool.QueryRow(ctx, `SELECT status, fire_at FROM agent_task_queue WHERE id = $1`, task.ID).Scan(&status, &fireAt); err != nil {
		t.Fatalf("load promoted task: %v", err)
	}
	if status != "queued" || fireAt.Valid {
		t.Fatalf("promoted task = status %q fire_at %v, want queued with no deadline", status, fireAt)
	}
}

// seedAttributionFixture creates the minimal user/workspace/member/runtime/agent
// graph plus a member-created issue assigned to the agent, and returns the ids
// needed to enqueue a run. Everything is cleaned up via t.Cleanup.
func seedAttributionFixture(t *testing.T, pool *pgxpool.Pool) (workspaceID, userID, agentID, chatID string) {
	t.Helper()
	ctx := context.Background()
	suffix := time.Now().UnixNano()

	if err := pool.QueryRow(ctx, `INSERT INTO "user" (name, email) VALUES ('Attr User', $1) RETURNING id`,
		fmt.Sprintf("attr-%d@auro.test", suffix)).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM "user" WHERE id = $1`, userID) })

	if err := pool.QueryRow(ctx, `INSERT INTO workspace (name, slug) VALUES ('attr ws', $1) RETURNING id`,
		fmt.Sprintf("attr-%d", suffix)).Scan(&workspaceID); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM workspace WHERE id = $1`, workspaceID) })

	if _, err := pool.Exec(ctx, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
		workspaceID, userID); err != nil {
		t.Fatalf("seed member: %v", err)
	}

	var runtimeID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO agent_runtime (workspace_id, name, runtime_mode, provider, status, device_info, metadata, owner_id)
		VALUES ($1, 'attr-runtime', 'cloud', 'codex', 'online', '', '{}'::jsonb, $2)
		RETURNING id`, workspaceID, userID).Scan(&runtimeID); err != nil {
		t.Fatalf("seed runtime: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO agent (workspace_id, name, runtime_mode, runtime_config, runtime_id, visibility,
			max_concurrent_tasks, owner_id, instructions, custom_env, custom_args)
		VALUES ($1, 'attr-agent', 'cloud', '{}'::jsonb, $2, 'workspace', 1, $3, '', '{}'::jsonb, '[]'::jsonb)
		RETURNING id`, workspaceID, runtimeID, userID).Scan(&agentID); err != nil {
		t.Fatalf("seed agent: %v", err)
	}
	fx := testutil.New(pool, workspaceID, userID)
	chatID = fx.ChatSession(t, agentID)
	return workspaceID, userID, agentID, chatID
}
