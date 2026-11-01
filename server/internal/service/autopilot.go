package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/auro-ai/auro/server/internal/analytics"
	"github.com/auro-ai/auro/server/internal/attribution"
	"github.com/auro-ai/auro/server/internal/dispatch"
	"github.com/auro-ai/auro/server/internal/entitlement"
	"github.com/auro-ai/auro/server/internal/events"
	obsmetrics "github.com/auro-ai/auro/server/internal/metrics"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/auro-ai/auro/server/pkg/dbid"
	"github.com/auro-ai/auro/server/pkg/protocol"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// TxStarter abstracts transaction creation (satisfied by pgxpool.Pool).
type TxStarter interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

type AutopilotService struct {
	Queries      *db.Queries
	TxStarter    TxStarter
	Bus          *events.Bus
	TaskSvc      *TaskService
	Entitlements entitlement.Provider
	QuotaMetrics AutopilotQuotaMetrics
}

func NewAutopilotService(q *db.Queries, tx TxStarter, bus *events.Bus, taskSvc *TaskService) *AutopilotService {
	return &AutopilotService{Queries: q, TxStarter: tx, Bus: bus, TaskSvc: taskSvc}
}

// autopilotRuleConfigSummary captures the substantive (accountability-bearing)
// config of an autopilot at publish time, stored on each rule-version snapshot for
// audit display (MUL-4302 §7). Cosmetic fields (title / description / issue title
// template) are intentionally excluded — changing them does not transfer
// accountability. Trigger config (cron / webhook / event_filters) lives in a
// separate table and is not inlined here; a trigger edit still republishes the
// rule (recording the editing member + timestamp), the summary just carries the
// autopilot row's core config.
type autopilotRuleConfigSummary struct {
	AssigneeType  string `json:"assignee_type"`
	AssigneeID    string `json:"assignee_id"`
	Status        string `json:"status"`
	ExecutionMode string `json:"execution_mode"`
}

// RecordAutopilotRuleVersion appends one rule-version snapshot for a substantive
// publish (MUL-4302 §3.4), recording the publisher and the effective config. Shared
// by the handler publish paths (create / update / trigger edits / archive, run in
// their tx) and the failure monitor's system-pause (a different package). q is the
// caller's *db.Queries (tx-scoped where the caller wants atomicity). publishedByType
// is "member" (with the acting member id) or "system" (with an invalid id, e.g. the
// auto-pause monitor).
func RecordAutopilotRuleVersion(ctx context.Context, q *db.Queries, ap db.Autopilot, publishedByType string, publishedByID pgtype.UUID) error {
	summary, err := json.Marshal(autopilotRuleConfigSummary{
		AssigneeType:  ap.AssigneeType,
		AssigneeID:    util.UUIDToString(ap.AssigneeID),
		Status:        ap.Status,
		ExecutionMode: ap.ExecutionMode,
	})
	if err != nil {
		return fmt.Errorf("marshal rule version config summary: %w", err)
	}
	if _, err := q.CreateAutopilotRuleVersion(ctx, db.CreateAutopilotRuleVersionParams{
		AutopilotID:     ap.ID,
		WorkspaceID:     ap.WorkspaceID,
		PublishedByType: publishedByType,
		PublishedByID:   publishedByID,
		ConfigSummary:   summary,
	}); err != nil {
		return fmt.Errorf("create autopilot rule version: %w", err)
	}
	return nil
}

// DispatchAutopilotManualWithKey preserves a caller-supplied request key so
// retrying the same HTTP request cannot reserve or execute twice.
func (s *AutopilotService) DispatchAutopilotManualWithKey(
	ctx context.Context,
	autopilot db.Autopilot,
	triggerID pgtype.UUID,
	payload []byte,
	actorUserID pgtype.UUID,
	idempotencyKey string,
) (*db.AutopilotRun, dispatch.ReasonCode, error) {
	// The manual path is the one surface that shows a per-run outcome to a human,
	// so it returns the typed reason code decided at the admission source. No
	// webhook delivery on the manual path.
	key := "manual:" + util.UUIDToString(autopilot.ID) + ":" + idempotencyKey
	return s.dispatchAutopilot(ctx, autopilot, triggerID, "manual", payload, pgtype.Timestamptz{}, pgtype.UUID{}, actorUserID, key)
}

// AdmitAutopilotWebhookDelivery creates or reuses the idempotent run for a
// durable webhook delivery without executing its downstream issue/task side
// effect. The HTTP ingress calls this synchronously so the public webhook
// response can retain its 200 accepted/skipped + run_id contract while the
// database-backed worker still owns recoverable dispatch.
func (s *AutopilotService) AdmitAutopilotWebhookDelivery(
	ctx context.Context,
	autopilot db.Autopilot,
	triggerID pgtype.UUID,
	payload []byte,
	deliveryID pgtype.UUID,
) (*db.AutopilotRun, error) {
	if !deliveryID.Valid {
		return nil, fmt.Errorf("admit webhook delivery: delivery_id is required")
	}

	existing, err := s.Queries.GetAutopilotRunByWebhookDelivery(ctx, deliveryID)
	switch {
	case err == nil:
		return &existing, nil
	case !errors.Is(err, pgx.ErrNoRows):
		return nil, fmt.Errorf("admit webhook delivery: lookup existing run: %w", err)
	}

	// Webhook admission has no member actor → the automation principal is this
	// trigger's created_by (MUL-6951; see ResolveAutopilotTriggerPrincipal); the
	// per-run reason code is not surfaced to a human here, so it is dropped.
	if reason, _, skip := s.shouldSkipDispatch(ctx, autopilot, pgtype.UUID{}, triggerID); skip {
		run, err := s.recordSkippedRun(
			ctx,
			autopilot,
			triggerID,
			"webhook",
			payload,
			pgtype.Timestamptz{},
			deliveryID,
			reason,
		)
		if err != nil {
			return s.recoverConcurrentWebhookAdmission(
				ctx,
				deliveryID,
				fmt.Errorf("admit webhook delivery: create skipped run: %w", err),
			)
		}
		return run, nil
	}

	initialStatus := "running"
	run, _, err := s.createAutopilotRunWithQuota(ctx, autopilot.WorkspaceID, "webhook", "webhook:"+util.UUIDToString(deliveryID), db.CreateAutopilotRunParams{
		ID:             dbid.NewV7(),
		AutopilotID:    autopilot.ID,
		TriggerID:      triggerID,
		Source:         "webhook",
		Status:         initialStatus,
		TriggerPayload: payload,

		WebhookDeliveryID: deliveryID,
	})
	if err != nil {
		return s.recoverConcurrentWebhookAdmission(
			ctx,
			deliveryID,
			fmt.Errorf("admit webhook delivery: create run: %w", err),
		)
	}
	s.captureAutopilotRunStarted(autopilot, run, "webhook")
	return &run, nil
}

func (s *AutopilotService) recoverConcurrentWebhookAdmission(
	ctx context.Context,
	deliveryID pgtype.UUID,
	cause error,
) (*db.AutopilotRun, error) {
	// Another server replica may have claimed the durable delivery after
	// ingress persisted it but before the admission lookup. The unique
	// delivery/run index chooses one winner; the loser reuses that run.
	var pgErr *pgconn.PgError
	if !errors.As(cause, &pgErr) || pgErr.Code != "23505" {
		return nil, cause
	}
	existing, err := s.Queries.GetAutopilotRunByWebhookDelivery(ctx, deliveryID)
	if err == nil {
		return &existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("admit webhook delivery: reload concurrent run: %w", err)
	}
	return nil, cause
}

// DispatchAutopilotForWebhookDelivery is the durable webhook worker entry
// point. webhook_delivery_id is persisted on the run and protected by a
// partial unique index, so reclaiming a queued delivery after a process crash
// reuses the original run instead of creating a second issue or task.
func (s *AutopilotService) DispatchAutopilotForWebhookDelivery(
	ctx context.Context,
	autopilot db.Autopilot,
	triggerID pgtype.UUID,
	payload []byte,
	deliveryID pgtype.UUID,
) (*db.AutopilotRun, error) {
	run, err := s.AdmitAutopilotWebhookDelivery(ctx, autopilot, triggerID, payload, deliveryID)
	if err != nil {
		return nil, err
	}
	if isAutopilotRunComplete(*run) {

		return run, nil
	}

	// A run_only task may have committed immediately before the process died
	// while linking task_id back to the run. Repair that linkage and wake the
	// daemon; otherwise continue the same partial run below.
	if autopilot.ExecutionMode == "run_only" && !run.TaskID.Valid {
		repaired, found, repairErr := s.repairAutopilotRunTaskLink(ctx, *run)
		if repairErr != nil {
			return run, fmt.Errorf("dispatch for webhook delivery: %w", repairErr)
		}
		if found {
			return repaired, nil
		}
	}
	// Webhook worker dispatch has no member actor and no human reason-code
	// surface, so actorUserID is invalid and the reason code is dropped.
	dispatched, _, err := s.dispatchAutopilotRun(ctx, autopilot, triggerID, "webhook", run, pgtype.UUID{})
	return dispatched, err
}

// repairAutopilotRunTaskLink closes the run_only crash window where task
// creation committed but autopilot_run.task_id did not. Finding any task is
// proof that downstream ownership already moved; active work is re-woken and
// terminal work is replayed through the normal finalizer instead of duplicated.
func (s *AutopilotService) repairAutopilotRunTaskLink(ctx context.Context, run db.AutopilotRun) (*db.AutopilotRun, bool, error) {
	task, err := s.Queries.GetAutopilotTaskByRun(ctx, run.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("lookup linked task: %w", err)
	}
	updated, err := s.Queries.UpdateAutopilotRunRunning(ctx, db.UpdateAutopilotRunRunningParams{
		ID:     run.ID,
		TaskID: task.ID,
	})
	if err != nil {
		return nil, false, fmt.Errorf("repair task linkage: %w", err)
	}
	switch task.Status {
	case "completed", "failed", "cancelled":
		s.SyncRunFromTask(ctx, task)
		updated, err = s.Queries.GetAutopilotRun(ctx, run.ID)
		if err != nil {
			return nil, false, fmt.Errorf("reload terminal repaired run: %w", err)
		}
	default:
		s.TaskSvc.NotifyTaskEnqueued(ctx, task)
	}
	return &updated, true, nil
}

// DispatchAutopilotForPlan is the entry point for scheduled triggers that
// already know the canonical UTC plan_time of the occurrence they are
// firing. The plan_time is persisted on autopilot_run.planned_at, and the
// (trigger_id, planned_at) partial unique index — combined with this
// method's idempotent lookup — guarantees that the SAME planned occurrence
// cannot produce two SUCCESSFUL runs even if a stale-steal in
// sys_cron_executions re-enters this method after a prior attempt.
//
// Semantics for an already-existing run at (trigger_id, planned_at):
//
//   - If the existing run is COMPLETE (terminal status, or in-flight
//     with the appropriate downstream linkage — issue_id for
//     create_issue, task_id for run_only), it is returned unchanged.
//     The handler then writes SUCCESS in sys_cron_executions; no
//     duplicate issue/task is produced.
//   - If the existing run is in a PARTIAL state (a prior attempt
//     wrote the run row but crashed before creating its downstream
//     issue/task), it is marked FAILED with a recovery reason and
//     its planned_at is cleared, releasing the partial-unique slot.
//     Dispatch then proceeds normally and creates a fresh run at the
//     same plan_time. Without this branch, a crash-during-dispatch
//     would let a subsequent retry see the in-flight run, return it
//     unchanged, and let the scheduler mark the occurrence SUCCESS
//     without an actual issue/task ever being created (#4443 review).
//
// triggerID and plannedAt MUST both be valid; passing zero values
// would silently disable the idempotency guard. Manual / webhook /
// api callers should use DispatchAutopilot instead.
func (s *AutopilotService) DispatchAutopilotForPlan(
	ctx context.Context,
	autopilot db.Autopilot,
	triggerID pgtype.UUID,
	source string,
	payload []byte,
	plannedAt time.Time,
) (*db.AutopilotRun, error) {
	if !triggerID.Valid {
		return nil, fmt.Errorf("dispatch for plan: trigger_id is required")
	}
	if plannedAt.IsZero() {
		return nil, fmt.Errorf("dispatch for plan: planned_at is required")
	}
	plannedTS := pgtype.Timestamptz{Time: plannedAt.UTC(), Valid: true}

	// Fast path: prior attempt already created a run for this exact
	// occurrence. The partial unique index uq_autopilot_run_trigger_planned
	// would also reject a duplicate INSERT, but doing the lookup up
	// front lets us short-circuit on a complete run and gives us a
	// chance to recover a partial run before retrying.
	existing, err := s.Queries.GetAutopilotRunByTriggerAndPlanned(ctx, db.GetAutopilotRunByTriggerAndPlannedParams{
		TriggerID: triggerID,
		PlannedAt: plannedTS,
	})
	switch {
	case err == nil && isAutopilotRunComplete(existing):
		// A prior attempt produced a complete run. Hand it back so the
		// handler can record SUCCESS in sys_cron_executions without
		// duplicating any downstream side effect.
		return &existing, nil

	case err == nil:
		if autopilot.ExecutionMode == "run_only" && !existing.TaskID.Valid {
			repaired, found, repairErr := s.repairAutopilotRunTaskLink(ctx, existing)
			if repairErr != nil {
				return nil, fmt.Errorf("dispatch for plan: %w", repairErr)
			}
			if found {
				return repaired, nil
			}
		}
		// Partial-state run from a crashed attempt. Mark it failed
		// (with a recovery reason) and release its partial-unique
		// slot so the fresh dispatch below can create a new row.
		slog.Warn("autopilot dispatch for plan: recovering partial run",
			"run_id", util.UUIDToString(existing.ID),
			"trigger_id", util.UUIDToString(triggerID),
			"planned_at", plannedAt.UTC().Format(time.RFC3339),
			"status", existing.Status,
			"task_set", existing.TaskID.Valid,
		)
		recovered, err := s.recoverPartialAutopilotRun(ctx, existing)
		if err != nil {
			return nil, fmt.Errorf("dispatch for plan: recover partial run: %w", err)
		}
		if !recovered {
			return nil, fmt.Errorf("dispatch for plan: partial run changed concurrently; retry")
		}
		// Fall through to a fresh dispatch below.

	case !errors.Is(err, pgx.ErrNoRows):
		return nil, fmt.Errorf("dispatch for plan: lookup existing run: %w", err)
	}

	// Scheduled dispatch has no member actor → it acts as the trigger's created_by
	// principal (trigger_owner, MUL-6951), and has no human surface for a per-run reason
	// code, so it is dropped. No webhook delivery on the scheduled-plan path.
	key := "schedule:" + util.UUIDToString(triggerID) + ":" + plannedAt.UTC().Format(time.RFC3339Nano)
	run, _, err := s.dispatchAutopilot(ctx, autopilot, triggerID, source, payload, plannedTS, pgtype.UUID{}, pgtype.UUID{}, key)
	return run, err
}

// isAutopilotRunComplete decides whether an existing autopilot_run row
// for (trigger_id, planned_at) is safe to reuse on a stale-steal retry.
//
// A run is "complete" if either:
//
//   - It is in a terminal state (completed / failed / skipped). Nothing
//     more to do downstream; the caller can return it as-is.
//
//   - It is in-flight in a state whose downstream side effect is
//     observable:
//
//   - issue_created with a valid issue_id — the issue exists and
//     the issue-event listener owns task creation from here.
//
//   - running with a valid task_id — the task is queued, the
//     listener will close the run when the task terminates.
//
// Anything else — most importantly issue_created/running with NULL
// issue_id/task_id, or the brief 'pending' state — is a partial run:
// the run row was inserted before the dispatch path could create the
// downstream resource, and a stale-steal retry MUST NOT treat it as
// complete (#4443 review).
func isAutopilotRunComplete(run db.AutopilotRun) bool {
	switch run.Status {
	case "completed", "failed", "skipped":
		return true
	case "running":
		return run.TaskID.Valid
	default:
		return false
	}
}

// dispatchAutopilot is the shared core of the two public Dispatch entry
// points. plannedAt is the canonical UTC plan_time for scheduled triggers;
// for manual / webhook / api dispatch it is the zero pgtype.Timestamptz and
// the resulting autopilot_run row has planned_at IS NULL. webhookDeliveryID
// is set only by the durable webhook worker.
func (s *AutopilotService) dispatchAutopilot(
	ctx context.Context,
	autopilot db.Autopilot,
	triggerID pgtype.UUID,
	source string,
	payload []byte,
	plannedAt pgtype.Timestamptz,
	webhookDeliveryID pgtype.UUID,
	actorUserID pgtype.UUID,
	idempotencyKey string,
) (*db.AutopilotRun, dispatch.ReasonCode, error) {
	if reason, code, skip := s.shouldSkipDispatch(ctx, autopilot, actorUserID, triggerID); skip {
		run, err := s.recordSkippedRun(ctx, autopilot, triggerID, source, payload, plannedAt, webhookDeliveryID, reason)
		return run, code, err
	}

	// Determine initial status based on execution mode.
	initialStatus := "running"

	run, reused, err := s.createAutopilotRunWithQuota(ctx, autopilot.WorkspaceID, source, idempotencyKey, db.CreateAutopilotRunParams{
		ID:             dbid.NewV7(),
		AutopilotID:    autopilot.ID,
		TriggerID:      triggerID,
		Source:         source,
		Status:         initialStatus,
		TriggerPayload: payload,

		PlannedAt:         plannedAt,
		WebhookDeliveryID: webhookDeliveryID,
	})
	if err != nil {
		var quotaErr *AutopilotQuotaExceededError
		if errors.As(err, &quotaErr) && source == "schedule" {
			skipped, skipErr := s.recordSkippedRun(ctx, autopilot, triggerID, source, payload, plannedAt, webhookDeliveryID, quotaErr.Error(), dispatch.ReasonQuotaExceeded)
			return skipped, dispatch.ReasonQuotaExceeded, skipErr
		}
		return nil, dispatch.ReasonInternalError, fmt.Errorf("create run: %w", err)
	}
	if reused {
		return &run, dispatch.ReasonCode(run.ReasonCode.String), nil
	}
	s.captureAutopilotRunStarted(autopilot, run, source)
	return s.dispatchAutopilotRun(ctx, autopilot, triggerID, source, &run, actorUserID)
}

// dispatchAutopilotRun performs the downstream side effect for an already
// persisted run. Keeping creation separate lets the webhook worker resume the
// same idempotency-anchored run after a crash between run creation and issue
// or task creation.
func (s *AutopilotService) dispatchAutopilotRun(
	ctx context.Context,
	autopilot db.Autopilot,
	triggerID pgtype.UUID,
	source string,
	run *db.AutopilotRun,
	actorUserID pgtype.UUID,
) (*db.AutopilotRun, dispatch.ReasonCode, error) {
	switch autopilot.ExecutionMode {

	case "run_only":
		if err := s.dispatchRunOnly(ctx, autopilot, run, actorUserID); err != nil {
			if skipped, code := s.handleDispatchSkip(ctx, autopilot, run, err); skipped != nil {
				return skipped, code, nil
			}
			s.failRun(ctx, run.ID, err.Error())
			s.captureAutopilotRunFailed(autopilot, *run, source, err.Error())
			return run, dispatchFailReasonCode(err), fmt.Errorf("dispatch run_only: %w", err)
		}
	default:
		s.failRun(ctx, run.ID, "unknown execution_mode: "+autopilot.ExecutionMode)
		s.captureAutopilotRunFailed(autopilot, *run, source, "unknown execution_mode: "+autopilot.ExecutionMode)
		return run, dispatch.ReasonInternalError, fmt.Errorf("unknown execution_mode: %s", autopilot.ExecutionMode)
	}

	// Update last_run_at on the autopilot.
	s.Queries.UpdateAutopilotLastRunAt(ctx, autopilot.ID)

	// Publish run start event.
	s.Bus.Publish(events.Event{
		Type:        protocol.EventAutopilotRunStart,
		WorkspaceID: util.UUIDToString(autopilot.WorkspaceID),
		ActorType:   "system",
		Payload: map[string]any{
			"run_id":       util.UUIDToString(run.ID),
			"autopilot_id": util.UUIDToString(autopilot.ID),
			"source":       source,
			"status":       run.Status,
		},
	})

	return run, "", nil
}

// dispatchFailReasonCode types a dispatch error that fell through to failRun.
// It inspects the error with typed checks (never substring matching): a
// fail-closed attribution refusal is attribution_blocked; everything else is an
// unclassified internal error.
func dispatchFailReasonCode(err error) dispatch.ReasonCode {
	if errors.Is(err, ErrAttributionFailClosed) {
		return dispatch.ReasonAttributionBlocked
	}
	return dispatch.ReasonInternalError
}

// errDispatchSkipped wraps a readiness failure encountered after the
// admission gate has already passed. dispatchRunOnly returns this when a
// resolved leader has gone offline / been archived between admission and
// task creation; DispatchAutopilot recognises it and records a `skipped`
// run (with the wrapped reason) instead of a `failed` run.
//
// Without the sentinel, the existing failRun path would mark these races as
// failures and bubble a 500 out of the manual-trigger handler — both wrong
// (the work was never attempted, no one is at fault) and noisy (the failure
// monitor would auto-pause autopilots whose only crime was a flaky runtime).
type errDispatchSkipped struct {
	reason string
	// code is the stable, typed admission reason decided at THIS branch and
	// carried through to the response (MUL-4525) — never reverse-engineered from
	// the human-readable reason string above.
	code dispatch.ReasonCode
}

func (e *errDispatchSkipped) Error() string { return e.reason }

// dispatchRunOnly enqueues a direct agent task without creating an issue.
//
// For squad autopilots, the executing agent is the squad leader resolved at
// trigger time (Path A from MUL-2429). The same archived / runtime-bound /
// runtime-online gates that the upstream admission check (shouldSkipDispatch)
// applies also run here as belt-and-braces: if the leader changed between
// admission and dispatch, or the runtime went offline in the gap, we still
// fail closed instead of enqueueing a doomed task.
func (s *AutopilotService) dispatchRunOnly(ctx context.Context, ap db.Autopilot, run *db.AutopilotRun, actorUserID pgtype.UUID) error {
	agent, err := s.resolveAutopilotAgent(ctx, ap)
	if err != nil {
		// Same admission-vs-failure classification as shouldSkipDispatch:
		// if the row disappeared or the squad was archived between
		// admission and dispatch, that is a skip, not a failure.
		if errors.Is(err, pgx.ErrNoRows) {
			return &errDispatchSkipped{reason: formatAdmissionReason(ap, "assignee no longer resolvable"), code: dispatch.ReasonTargetUnavailable}
		}
		return fmt.Errorf("resolve leader: %w", err)
	}
	verdict, err := AgentReadiness(ctx, s.runtimeLookup(), agent)
	if err != nil {
		return fmt.Errorf("check agent readiness: %w", err)
	}
	if !verdict.Ready() {
		return &errDispatchSkipped{reason: formatAdmissionReason(ap, verdict.Detail), code: verdict.Reason}
	}

	// Attribution splits on the trigger only to pick WHICH human and which source
	// label; both branches now produce a real originator. A MANUAL trigger is a
	// direct human action: the triggering member is direct_human (MUL-4302 §4). A
	// schedule / webhook trigger resolves the firing trigger's created_by principal —
	// trigger_owner, from run.TriggerID (MUL-4302; MUL-6951; for a legacy trigger a
	// backfilled inference, see ResolveAutopilotTriggerPrincipal) — degrading to the
	// rule version publisher (rule_owner, audit-only) when it has none, then to
	// unattributed. An edit of the trigger does NOT move this: published_by
	// transfers, created_by does not. Since MUL-6951 that human is the originator
	// too, so an armed autopilot runs with its created_by principal's authorization
	// instead of borrowing narrowly-scoped capabilities per surface; the source
	// label is what keeps "fired on a schedule" distinguishable from "a human
	// clicked run". Either way evidence points at the autopilot run and the row is
	// never a NULL-source bypass.
	var autopilotAttr attribution.Result
	if actorUserID.Valid {
		autopilotAttr = attribution.DirectHumanRun(actorUserID, attribution.EvidenceAutopilotRun, run.ID)
	} else {
		autopilotAttr = triggerOwnerAttribution(ctx, s.Queries, run.TriggerID, ap.WorkspaceID, ap.ID, attribution.EvidenceAutopilotRun, run.ID)
	}
	// If no precise human resolved (a version-less autopilot), degrade to
	// owner_fallback (accountable = agent owner), or skip the dispatch when the
	// workspace is fail-closed (MUL-4302 §3.5).
	autopilotAttr, err = s.TaskSvc.applyAttributionFallback(ctx, autopilotAttr, agent)
	if err != nil {
		return &errDispatchSkipped{reason: formatAdmissionReason(ap, "workspace fail-closed: no accountable human for autopilot run"), code: dispatch.ReasonAttributionBlocked}
	}
	apSource, _, apEvidenceKind, apEvidenceRef := attributionCreateParams(autopilotAttr)
	task, err := s.Queries.CreateAutopilotTask(ctx, db.CreateAutopilotTaskParams{
		ID:             dbid.NewV7(),
		AgentID:        agent.ID,
		RuntimeID:      agent.RuntimeID,
		Priority:       0,
		AutopilotRunID: run.ID,
		// Snapshot the autopilot title so task rows self-describe later
		// without joining back to autopilot. Truncated for the same
		// transmission-cost reason as comment-driven summaries.
		TriggerSummary: pgtype.Text{
			String: truncateForSummary(ap.Title, triggerSummaryMaxLen),
			Valid:  ap.Title != "",
		},
		OriginatorUserID:     autopilotAttr.UserID,
		AccountableUserID:    autopilotAttr.AccountableUserID,
		RuleVersionID:        autopilotAttr.RuleVersionID,
		OriginatorSource:     apSource,
		TriggerEvidenceKind:  apEvidenceKind,
		TriggerEvidenceRefID: apEvidenceRef,
	})
	if err != nil {
		return fmt.Errorf("create autopilot task: %w", err)
	}

	// Update run with task reference.
	updatedRun, err := s.Queries.UpdateAutopilotRunRunning(ctx, db.UpdateAutopilotRunRunningParams{
		ID:     run.ID,
		TaskID: task.ID,
	})
	if err != nil {
		slog.Warn("failed to update run with task_id", "run_id", util.UUIDToString(run.ID), "error", err)
	} else {
		*run = updatedRun
	}

	// Drop the empty-claim cache and wake the daemon. dispatchRunOnly
	// inserts the task row directly via Queries.CreateAutopilotTask
	// (bypassing TaskService.Enqueue*), so without this the runtime
	// would not get a wakeup and any cached "empty" verdict would
	// stall the task until the TTL expired.
	s.TaskSvc.NotifyTaskEnqueued(ctx, task)

	slog.Info("autopilot dispatched (run_only)",
		"autopilot_id", util.UUIDToString(ap.ID),
		"task_id", util.UUIDToString(task.ID),
		"run_id", util.UUIDToString(run.ID),
	)
	return nil
}

// SyncRunFromTask updates the autopilot run when a run_only task completes or fails.
func (s *AutopilotService) SyncRunFromTask(ctx context.Context, task db.AgentTaskQueue) {
	if !task.AutopilotRunID.Valid {
		return
	}

	run, err := s.Queries.GetAutopilotRun(ctx, task.AutopilotRunID)
	if err != nil {
		return
	}

	autopilot, err := s.Queries.GetAutopilot(ctx, run.AutopilotID)
	if err != nil {
		return
	}
	wsID := util.UUIDToString(autopilot.WorkspaceID)

	switch task.Status {
	case "completed":
		updatedRun, err := s.completeAutopilotRun(ctx, db.UpdateAutopilotRunCompletedParams{
			ID:     run.ID,
			Result: task.Result,
		})
		if err != nil {
			slog.Warn("failed to complete autopilot run from task", "run_id", util.UUIDToString(run.ID), "error", err)
			return
		}
		s.captureAutopilotRunCompleted(autopilot, updatedRun)
		s.publishRunDone(wsID, updatedRun, "completed")
	case "failed", "cancelled":
		reason := "task " + task.Status
		if task.Error.Valid {
			reason = task.Error.String
		}
		updatedRun, err := s.failAutopilotRun(ctx, db.UpdateAutopilotRunFailedParams{
			ID:            run.ID,
			FailureReason: pgtype.Text{String: reason, Valid: true},
		})
		if err != nil {
			slog.Warn("failed to fail autopilot run from task", "run_id", util.UUIDToString(run.ID), "error", err)
			return
		}
		s.captureAutopilotRunFailed(autopilot, updatedRun, updatedRun.Source, reason)
		s.publishRunDone(wsID, updatedRun, "failed")
	}
}

// handleDispatchSkip recognises an errDispatchSkipped returned from a
// dispatch function and rewrites the in-flight run to `skipped` (instead of
// `failed`). Returns the updated run on a real skip, nil otherwise — callers
// fall through to the failure path on nil.
//
// Lives here, not inside dispatchRunOnly, because the run row was created by
// DispatchAutopilot up the stack and the failure-vs-skip distinction is
// owned by the dispatcher entry point. Keeps dispatchRunOnly free of
// state-mutation helpers.
func (s *AutopilotService) handleDispatchSkip(ctx context.Context, ap db.Autopilot, run *db.AutopilotRun, err error) (*db.AutopilotRun, dispatch.ReasonCode) {
	var skipErr *errDispatchSkipped
	if !errors.As(err, &skipErr) {
		return nil, ""
	}
	updated, uerr := s.skipAutopilotRun(ctx, db.UpdateAutopilotRunSkippedParams{
		ID:            run.ID,
		FailureReason: pgtype.Text{String: skipErr.reason, Valid: true},
		ReasonCode:    pgtype.Text{String: string(skipErr.code), Valid: skipErr.code != ""},
	})
	if uerr != nil {
		slog.Warn("failed to mark dispatch as skipped",
			"run_id", util.UUIDToString(run.ID), "error", uerr)
		// Leave the run in its current (running/issue_created) state if
		// the update failed; the failure monitor will eventually fail it
		// out, but at least we didn't pretend it succeeded.
		return nil, ""
	}
	*run = updated
	slog.Info("autopilot dispatch skipped post-admission",
		"autopilot_id", util.UUIDToString(ap.ID),
		"run_id", util.UUIDToString(run.ID),
		"reason", skipErr.reason,
	)
	// Bump last_run_at on parity with recordSkippedRun (pre-flight skip) and
	// the success path: from the scheduler's / UI's point of view we did
	// evaluate the trigger this tick, even though the post-admission gate
	// caught a late readiness regression.
	s.Queries.UpdateAutopilotLastRunAt(ctx, ap.ID)
	s.publishRunDone(util.UUIDToString(ap.WorkspaceID), updated, "skipped")
	return run, skipErr.code
}

func (s *AutopilotService) failRun(ctx context.Context, runID pgtype.UUID, reason string) {
	if _, err := s.failAutopilotRun(ctx, db.UpdateAutopilotRunFailedParams{
		ID:            runID,
		FailureReason: pgtype.Text{String: reason, Valid: true},
		ReasonCode:    pgtype.Text{String: string(dispatch.ReasonInternalError), Valid: true},
	}); err != nil {
		slog.Warn("failed to mark autopilot run as failed", "run_id", util.UUIDToString(runID), "error", err)
	}
}

// shouldSkipDispatch is the pre-flight admission check from MUL-1899.
// Returns (reason, true) when dispatching now would only enqueue a doomed
// task — i.e. the assignee (or, for squad autopilots, the squad leader) is
// gone, archived, has no runtime bound, or its runtime is not currently
// online. Returns ("", false) on the happy path.
//
// Errors are split into two classes:
//   - pgx.ErrNoRows / errSquadArchived (the row truly doesn't exist or is
//     archived) → hard skip. Retrying won't change anything; piling failed
//     runs would pollute the failure-rate auto-pause monitor.
//   - Anything else (connection drop, statement timeout, etc.) → fail-open:
//     log + do not skip, so a transient DB hiccup never silently swallows a
//     scheduled run. Migration 096 removed the agent FK on autopilot, so an
//     agent assignee being missing is now a real condition the gate must
//     handle (previously cascade-deleted).
func (s *AutopilotService) shouldSkipDispatch(ctx context.Context, ap db.Autopilot, actorUserID, triggerID pgtype.UUID) (string, dispatch.ReasonCode, bool) {
	if !ap.AssigneeID.Valid {
		return "autopilot has no assignee", dispatch.ReasonTargetUnavailable, true
	}
	agent, err := s.resolveAutopilotAgent(ctx, ap)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "assignee agent no longer exists", dispatch.ReasonTargetUnavailable, true
		}
		slog.Warn("autopilot admission: failed to load agent", "error", err)
		return "", "", false
	}
	verdict, err := AgentReadiness(ctx, s.runtimeLookup(), agent)
	if err != nil {
		slog.Warn("autopilot admission: failed to load runtime",
			"autopilot_id", util.UUIDToString(ap.ID),
			"runtime_id", util.UUIDToString(agent.RuntimeID),
			"error", err,
		)
		return "", "", false
	}
	if !verdict.Ready() {
		return formatAdmissionReason(ap, verdict.Detail), verdict.Reason, true
	}

	// Invocation gate at the autopilot layer (MUL-3963 / MUL-4525). The
	// admission principal depends on how the dispatch was triggered: a MANUAL
	// "run now" (actorUserID valid) is a direct human action gated by the human
	// who ORDERED it — the clicking member, or the originator an agent acts for,
	// resolved by the handler (requireAutopilotTriggerInvoker) — not the
	// autopilot creator's, so admission and attribution credit the same human and
	// never fork. Automation (schedule / webhook, actorUserID invalid) preserves
	// that same property by resolving the trigger's created_by principal
	// (ResolveAutopilotTriggerPrincipal), which is also the human the run will act
	// as (MUL-6951). Admins do NOT bypass a private agent
	// they do not own, and no branch admits a principal-less dispatch. For squad
	// autopilots the gate runs against the resolved leader.
	if !s.autopilotAdmitInvoke(ctx, ap, agent, actorUserID, triggerID) {
		if actorUserID.Valid {
			return "you are not allowed to trigger this autopilot's assignee agent", dispatch.ReasonInvocationNotAllowed, true
		}
		if !triggerID.Valid {
			// No actor AND no trigger: there is no trigger row whose owner could be
			// at fault, so the trigger phrasing below would name a thing that does
			// not exist. That message on the manual path is what sent #8078 hunting
			// for a broken trigger owner for a day.
			return "this dispatch resolved no authorizing human and carries no trigger to resolve one from", dispatch.ReasonInvocationNotAllowed, true
		}
		return "this trigger's owner lacks access to the private assignee agent, or the trigger records no owner", dispatch.ReasonInvocationNotAllowed, true
	}
	return "", "", false
}

// formatAdmissionReason rewrites the generic AgentReadiness reason into the
// admission-gate phrasing the failure monitor and existing alerting are tuned
// for. Keeping the prefix stable matters: dashboards group skip reasons by
// substring ("offline at dispatch time" is how the MUL-1899 alert fires).
//
// For squad autopilots the message names the squad so an operator looking at
// the failure_reason field knows which squad's leader is down without
// joining back to autopilot_run.squad_id.
func formatAdmissionReason(ap db.Autopilot, raw string) string {
	prefix := "assignee "
	switch raw {
	case "agent is archived":
		return prefix + "agent is archived"
	case "agent has no runtime bound":
		return prefix + "agent has no runtime bound"
	default:
		// raw is "agent runtime is X" — surface the runtime status while
		// preserving the legacy "at dispatch time" suffix from MUL-1899
		// so alert queries do not need to change.
		return raw + " at dispatch time"
	}
}

// errSquadArchived signals that an autopilot's squad assignee has been
// archived. Distinct from a missing/loadable-but-failed squad so the
// admission gate can phrase the skip reason precisely and the failure
// monitor does not see "cannot be resolved" wear noise for what is a
// known, expected post-archive condition.

// resolveAutopilotLeader returns the agent that will actually execute the
// autopilot's work. For assignee_type='agent' the agent is the assignee
// itself; for assignee_type='squad' it is the squad's leader_id. The second
// return is true when the resolver took the squad branch — callers use this
// to distinguish "failed loading an agent" from "failed loading a squad", so
// the admission gate can choose between fail-open (transient DB error on a
// known-good agent) and fail-closed (squad row gone, no point retrying).
//
// Archived squads are rejected here too: TransferSquadAutopilotsToLeader
// flips surviving autopilots to assignee_type='agent' on DeleteSquad, but
// the gate still has to fail closed for any row that slips through that
// transfer (e.g. squad archived through a code path that bypasses the
// handler) so an archived squad never produces work.
//
// Unknown assignee_type values return an error. assignee_type is gated by a
// CHECK constraint at the DB layer, so this only fires if a future code path
// inserts a row that bypasses the check.
func (s *AutopilotService) resolveAutopilotAgent(ctx context.Context, ap db.Autopilot) (db.Agent, error) {
	return s.Queries.GetAgent(ctx, ap.AssigneeID)
}

// autopilotSquadAttribution returns the squad_id attribution hook for an
// autopilot_run row. Only populated when assignee_type='squad'. First-version
// reports do not consume this; it exists so a future squad-cost view does not
// need to backfill — see RFC §4.e (MUL-2429).

// recordSkippedRun persists a `skipped` autopilot_run with the given reason
// and emits the same WS / analytics signals that a normal terminal transition
// would. Returns the run + nil error so callers (scheduler tick, manual
// trigger handler) treat this as a successful — but no-op — dispatch.
func (s *AutopilotService) recordSkippedRun(
	ctx context.Context,
	autopilot db.Autopilot,
	triggerID pgtype.UUID,
	source string,
	payload []byte,
	plannedAt pgtype.Timestamptz,
	webhookDeliveryID pgtype.UUID,
	reason string,
	reasonCode ...dispatch.ReasonCode,
) (*db.AutopilotRun, error) {
	code := pgtype.Text{}
	if len(reasonCode) > 0 && reasonCode[0] != "" {
		code = pgtype.Text{String: string(reasonCode[0]), Valid: true}
	}
	run, err := s.Queries.CreateAutopilotRun(ctx, db.CreateAutopilotRunParams{
		ID:             dbid.NewV7(),
		AutopilotID:    autopilot.ID,
		TriggerID:      triggerID,
		Source:         source,
		Status:         "skipped",
		TriggerPayload: payload,

		PlannedAt:         plannedAt,
		WebhookDeliveryID: webhookDeliveryID,
		ReasonCode:        code,
	})
	if err != nil {
		return nil, fmt.Errorf("create skipped run: %w", err)
	}

	updated, err := s.Queries.UpdateAutopilotRunSkipped(ctx, db.UpdateAutopilotRunSkippedParams{
		ID:            run.ID,
		FailureReason: pgtype.Text{String: reason, Valid: true},
		ReasonCode:    code,
	})
	if err == nil {
		run = updated
	} else {
		slog.Warn("failed to set skip reason on autopilot run",
			"run_id", util.UUIDToString(run.ID), "error", err)
	}

	slog.Info("autopilot dispatch skipped",
		"autopilot_id", util.UUIDToString(autopilot.ID),
		"run_id", util.UUIDToString(run.ID),
		"source", source,
		"reason", reason,
	)

	// Bump last_run_at so scheduler advancement and "last seen" UI both
	// reflect that we did evaluate the trigger this tick.
	s.Queries.UpdateAutopilotLastRunAt(ctx, autopilot.ID)

	s.publishRunDone(util.UUIDToString(autopilot.WorkspaceID), run, "skipped")
	return &run, nil
}

func (s *AutopilotService) publishRunDone(workspaceID string, run db.AutopilotRun, status string) {
	s.Bus.Publish(events.Event{
		Type:        protocol.EventAutopilotRunDone,
		WorkspaceID: workspaceID,
		ActorType:   "system",
		Payload: map[string]any{
			"run_id":       util.UUIDToString(run.ID),
			"autopilot_id": util.UUIDToString(run.AutopilotID),
			"status":       status,
		},
	})
}

func (s *AutopilotService) captureAutopilotRunStarted(ap db.Autopilot, run db.AutopilotRun, triggerSource string) {
	if s.TaskSvc == nil || s.TaskSvc.Analytics == nil {
		return
	}
	obsmetrics.RecordEvent(s.TaskSvc.Analytics, s.TaskSvc.Metrics, analytics.AutopilotRunStarted(
		autopilotActorID(ap),
		util.UUIDToString(ap.WorkspaceID),
		util.UUIDToString(ap.ID),
		util.UUIDToString(run.ID),
		triggerSource, // cadence proxy: see autopilot cadence note in metrics/labels_pr3.go
		s.autopilotAssigneeAnalytics(ap),
		triggerSource,
	))
}

func (s *AutopilotService) captureAutopilotRunCompleted(ap db.Autopilot, run db.AutopilotRun) {
	if s.TaskSvc == nil || s.TaskSvc.Analytics == nil {
		return
	}
	obsmetrics.RecordEvent(s.TaskSvc.Analytics, s.TaskSvc.Metrics, analytics.AutopilotRunCompleted(
		autopilotActorID(ap),
		util.UUIDToString(ap.WorkspaceID),
		util.UUIDToString(ap.ID),
		util.UUIDToString(run.ID),
		run.Source,
		s.autopilotAssigneeAnalytics(ap),
		run.Source,
		autopilotRunDurationMS(run),
	))
}

func (s *AutopilotService) captureAutopilotRunFailed(ap db.Autopilot, run db.AutopilotRun, triggerSource, reason string) {
	if s.TaskSvc == nil || s.TaskSvc.Analytics == nil {
		return
	}
	if reason == "" {
		reason = "unknown"
	}
	obsmetrics.RecordEvent(s.TaskSvc.Analytics, s.TaskSvc.Metrics, analytics.AutopilotRunFailed(
		autopilotActorID(ap),
		util.UUIDToString(ap.WorkspaceID),
		util.UUIDToString(ap.ID),
		util.UUIDToString(run.ID),
		triggerSource,
		s.autopilotAssigneeAnalytics(ap),
		triggerSource,
		reason,
		autopilotErrorType(reason),
		false,
		autopilotRunDurationMS(run),
	))
}

// autopilotAssigneeAnalytics builds the PostHog assignee descriptor for an
// autopilot. For squad autopilots agent_id is best-effort the resolved
// leader (so per-agent funnels stay consistent); a resolve error degrades
// to the raw assignee_id rather than dropping the event — incomplete data
// in the dashboard is preferable to silent attribution gaps.
func (s *AutopilotService) autopilotAssigneeAnalytics(ap db.Autopilot) analytics.AutopilotAssignee {
	return analytics.AutopilotAssignee{AssigneeType: "agent", AgentID: util.UUIDToString(ap.AssigneeID)}
}

func autopilotErrorType(reason string) string {
	switch {
	case strings.Contains(reason, "unknown execution_mode"):
		return "configuration"
	case strings.HasPrefix(reason, "issue "):
		return "issue_terminal"
	case strings.Contains(reason, "create issue"), strings.Contains(reason, "enqueue task"), strings.Contains(reason, "dispatch"):
		return "dispatch_error"
	case strings.HasPrefix(reason, "task "):
		return "task_error"
	default:
		return "autopilot_error"
	}
}

func autopilotActorID(ap db.Autopilot) string {
	id := util.UUIDToString(ap.CreatedByID)
	if ap.CreatedByType == "agent" && id != "" {
		return "agent:" + id
	}
	if id != "" {
		return id
	}
	return "system"
}

func autopilotRunDurationMS(run db.AutopilotRun) int64 {
	if !run.CompletedAt.Valid {
		return 0
	}
	start := run.TriggeredAt
	if !start.Valid {
		start = run.CreatedAt
	}
	if !start.Valid {
		return 0
	}
	ms := run.CompletedAt.Time.Sub(start.Time).Milliseconds()
	if ms < 0 {
		return 0
	}
	return ms
}

// issueTitleTemplateTokenRE matches any {{...}} token in an issue-title
// template. We deliberately permit whitespace inside the braces ({{ date }})
// so users can format templates either way; the canonical token is still
// {{date}}.
var issueTitleTemplateTokenRE = regexp.MustCompile(`\{\{\s*([^{}]*?)\s*\}\}`)

// SupportedIssueTitleTemplateVariables enumerates the placeholders that
// interpolateTemplate will substitute. Keep this in sync with the
// substitution logic above and with the docs in autopilots.mdx /
// autopilots.zh.mdx.
var SupportedIssueTitleTemplateVariables = []string{"date"}

// autopilotAdmitInvoke decides whether the dispatch's admission principal may
// invoke the target agent (MUL-4525). A MANUAL "run now" (actorUserID valid) is
// a direct human action gated by the CURRENT clicker's access, so admission and
// attribution credit the same member. Automation (schedule / webhook / api,
// actorUserID invalid) resolves the trigger's created_by principal — the same
// human the run itself will act as (MUL-6951; legacy semantics in
// ResolveAutopilotTriggerPrincipal). Both branches fail closed and never grant an
// admin bypass.
func (s *AutopilotService) autopilotAdmitInvoke(ctx context.Context, ap db.Autopilot, agent db.Agent, actorUserID, triggerID pgtype.UUID) bool {
	if actorUserID.Valid {
		return s.canMemberInvokeAgent(ctx, agent, actorUserID, ap.WorkspaceID)
	}
	// Automation admits as the SAME human the run will act as (MUL-6951). Before
	// that, admission used the autopilot CREATOR while the run took its identity
	// from the trigger, so A creating an autopilot over A's private agent and B
	// owning the trigger produced a dispatch admitted as A but running as B —
	// rights neither of them holds alone. Resolving both from
	// ResolveAutopilotTriggerPrincipal makes that fork unrepresentable.
	principal := ResolveAutopilotTriggerPrincipal(ctx, s.Queries, triggerID, ap.ID, ap.WorkspaceID)
	if !principal.Valid {
		return false
	}
	return s.canMemberInvokeAgent(ctx, agent, principal, ap.WorkspaceID)
}

// canMemberInvokeAgent checks whether a specific member may invoke the agent
// under the invocation-permission model (MUL-3963). It mirrors
// handler.canInvokeAgent with a member effective user — used for a manual
// autopilot "run now" where the clicker, not the creator, is the admission
// principal. Fail-closed on any lookup error; no admin bypass.
func (s *AutopilotService) canMemberInvokeAgent(ctx context.Context, agent db.Agent, memberUserID pgtype.UUID, workspaceID pgtype.UUID) bool {
	return CanMemberInvokeAgent(ctx, s.Queries, agent, memberUserID, workspaceID)
}
