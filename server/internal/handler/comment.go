package handler

import (
	"context"
	"errors"
	"log/slog"
	"sort"
	"strings"
	"unicode"

	obsmetrics "github.com/auro-ai/auro/server/internal/metrics"
	"github.com/auro-ai/auro/server/internal/service"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

type CommentResponse struct {
	ID             string  `json:"id"`
	IssueID        string  `json:"issue_id"`
	AuthorType     string  `json:"author_type"`
	AuthorID       string  `json:"author_id"`
	Content        string  `json:"content"`
	Type           string  `json:"type"`
	ParentID       *string `json:"parent_id"`
	CreatedAt      string  `json:"created_at"`
	UpdatedAt      string  `json:"updated_at"`
	Revision       int64   `json:"revision"`
	IssueRevision  int64   `json:"issue_revision,omitempty"`
	ResolvedAt     *string `json:"resolved_at"`
	ResolvedByType *string `json:"resolved_by_type"`
	ResolvedByID   *string `json:"resolved_by_id"`
	SourceTaskID   *string `json:"source_task_id,omitempty"`
	// DeletedAt marks a tombstone: a comment deleted while it still had
	// replies (#8296). Its content is empty and it carries no attachments or
	// reactions; it stays only so the replies keep their direct parent.
	// Omitted for every live comment.
	DeletedAt *string `json:"deleted_at,omitempty"`
	// QuickActionID marks a comment produced by a quick action run (MUL-5465).
	// The timeline renders those as a collapsed one-line card instead of the
	// raw prompt body. It is NOT settable through this endpoint — there is no
	// request field for it — which is exactly why the card keys off this id
	// rather than a `type` value the client controls.
	QuickActionID *string              `json:"quick_action_id,omitempty"`
	Reactions     []ReactionResponse   `json:"reactions"`
	Attachments   []AttachmentResponse `json:"attachments"`
	// Orientation stats — populated only on the roots_only path and omitted in
	// every other mode, so the default response shape stays byte-identical for
	// existing callers. ReplyCount is the number of descendants in the thread;
	// LastActivityAt is the MAX(created_at) across the whole subtree. Together
	// they let an agent triage which thread to drill into without fetching any
	// replies.
	ReplyCount     *int    `json:"reply_count,omitempty"`
	LastActivityAt *string `json:"last_activity_at,omitempty"`
	// ContentTruncated is set only under summary=true: true when Content was
	// clipped to the summary budget, false when it fit. nil (omitted) means the
	// caller did not request a summary projection, so Content is verbatim.
	ContentTruncated *bool `json:"content_truncated,omitempty"`
	// Fold projection fields — populated only under fold=true, and only on the
	// thread ROOT of a resolved thread (mirrors the human timeline fold; see
	// foldResolvedThreads). Both are nil/omitted everywhere else: every comment
	// under an unresolved thread, and every non-root comment. ThreadResolved
	// marks a thread whose discussion was collapsed to its conclusion;
	// FoldedCount is how many comments in that thread were dropped from the
	// response (0 when the thread was already at root + conclusion). The reader
	// pulls the folded comments back with `comment list --full`.
	ThreadResolved *bool `json:"thread_resolved,omitempty"`
	FoldedCount    *int  `json:"folded_count,omitempty"`
	// TriggerOutcomes is the per-target result of every EXPLICIT @agent / @squad
	// mention in this comment (MUL-4525 §2). It is additive and populated only on
	// create/edit responses: old clients ignore it. A saved comment whose mention
	// was blocked (no invoke permission, target unavailable, runtime offline) now
	// reports that here instead of silently dropping the trigger, so the client
	// can show "comment posted, but N targets were not triggered".
	TriggerOutcomes []CommentTriggerOutcome `json:"trigger_outcomes,omitempty"`
	// Supplements lists every running turn this comment steered, one receipt
	// per run. The single supplement_* fields mirror the first receipt for
	// clients that predate multi-run steering.
	Supplements             []CommentSupplementResponse `json:"supplements,omitempty"`
	SupplementTaskID        string                      `json:"supplement_task_id,omitempty"`
	SupplementStatus        string                      `json:"supplement_status,omitempty"`
	SupplementFailureReason *string                     `json:"supplement_failure_reason,omitempty"`
	SupplementDeliveredAt   *string                     `json:"supplement_delivered_at,omitempty"`
}

// CommentTriggerOutcome is the per-target result of an explicit @agent / @squad
// mention (MUL-4525 §2). target_id is the id the user mentioned — the agent id,
// or the SQUAD id for a squad mention — so the client correlates it back to the
// mention it rendered without the server echoing a private target's name/owner.
// reason_code is the stable, enumeration-safe admission reason.
type CommentTriggerOutcome struct {
	TargetType string             `json:"target_type"` // "agent" | "squad"
	TargetID   string             `json:"target_id"`
	Status     DispatchStatus     `json:"status"` // queued | coalesced | deferred | blocked
	ReasonCode DispatchReasonCode `json:"reason_code"`
}

func commentToResponse(c db.Comment, reactions []ReactionResponse, attachments []AttachmentResponse) CommentResponse {
	if reactions == nil {
		reactions = []ReactionResponse{}
	}
	if attachments == nil {
		attachments = []AttachmentResponse{}
	}
	return CommentResponse{
		ID:             uuidToString(c.ID),
		IssueID:        uuidToString(c.IssueID),
		AuthorType:     c.AuthorType,
		AuthorID:       uuidToString(c.AuthorID),
		Content:        c.Content,
		Type:           c.Type,
		ParentID:       uuidToPtr(c.ParentID),
		CreatedAt:      timestampToString(c.CreatedAt),
		UpdatedAt:      timestampToString(c.UpdatedAt),
		Revision:       c.Revision,
		ResolvedAt:     timestampToPtr(c.ResolvedAt),
		ResolvedByType: textToPtr(c.ResolvedByType),
		ResolvedByID:   uuidToPtr(c.ResolvedByID),
		SourceTaskID:   uuidToPtr(c.SourceTaskID),
		DeletedAt:      timestampToPtr(c.DeletedAt),
		QuickActionID:  uuidToPtr(c.QuickActionID),
		Reactions:      reactions,
		Attachments:    attachments,
	}
}

// commentHardCap bounds the comments returned per issue. Sized as a defensive
// safety net rather than a UX paging window: prod p99 is ~30 comments and
// the all-time max observed is ~1.1k, so 2000 leaves ~2x headroom while still
// preventing a runaway response if some user manages to accumulate a wild
// number of rows on a single issue.
//
// This and the thread-completion budgets below are variables only so the cap
// tests can run the same windowing without seeding thousands of rows per
// scenario; nothing outside tests assigns them.
var commentHardCap = 2000

// HeaderCommentsTruncated tells browser and CLI callers that a defensive
// comment-list cap omitted rows. It is deliberately separate from the timeline
// header: /comments has several projections (roots, one thread, since) whose
// truncation cannot be described as a timeline activity kind.
const HeaderCommentsTruncated = "X-Comments-Truncated"

// Budgets for thread completion (completeCommentThreads).
//
// commentThreadContextBudget caps ALL context added outside the newest window:
// ancestors first, then missing siblings/descendants for any thread whose root
// had to be restored. A response is therefore bounded by commentHardCap +
// commentThreadContextBudget comments regardless of thread shape.
// commentThreadMaxDepth bounds each direction of the walk.
//
// Both are needed because reply depth is genuinely unbounded in stored data: the
// general write path saves the exact comment being replied to, so chains can run
// far deeper than the two levels the UI usually renders. Without a budget the
// completion pass would defeat the row cap it is meant to preserve.
var (
	commentThreadContextBudget = 2000
	commentThreadMaxDepth      = 64
)

var (
	errCommentThreadNotFound = &commentFetchError{"thread anchor not found"}
	errCommentThreadBadID    = &commentFetchError{"invalid thread anchor id"}
)

type commentFetchError struct{ msg string }

func (e *commentFetchError) Error() string { return e.msg }

type commentAgentTriggerSource string

const (
	commentTriggerSourceIssueAssignee      commentAgentTriggerSource = "issue_assignee"
	commentTriggerSourceMentionAgent       commentAgentTriggerSource = "mention_agent"
	commentTriggerSourceMentionSquadLeader commentAgentTriggerSource = "mention_squad_leader"
	commentTriggerSourceThreadParent       commentAgentTriggerSource = "thread_parent"
	commentTriggerSourceConversation       commentAgentTriggerSource = "conversation_continuation"
)

type commentAgentTrigger struct {
	Agent          db.Agent
	Source         commentAgentTriggerSource
	Squad          *db.Squad
	AlreadyPending bool
	// NonLeaderAgentReply marks an agent comment routed back to a squad leader
	// from worker context. The worker need not be a squad member. Completion may
	// replay it only if creation recorded it as a planned input.
	NonLeaderAgentReply bool
}

type commentTriggerComputeOptions struct {
	ThreadCommentID         pgtype.UUID
	ExcludeTriggerCommentID pgtype.UUID
	// AuthoringTaskID is the server-trusted task that wrote an agent comment.
	// It lets a worker result continue the exact guest squad-leader delegation
	// without guessing from squad membership or the issue assignee.
	AuthoringTaskID pgtype.UUID
	// OriginatorUserID is the top-of-chain human user id for this trigger
	// (MUL-3963). Only consulted for AGENT actors — canInvokeAgent judges A2A
	// by the originator, not the immediate agent principal. Members are their
	// own originator so this may be empty for member-authored triggers.
	OriginatorUserID string
}

// taskCoversReplyParent reports whether parentID is a comment this task is
// authorized to reply under. A comment-triggered task may reply to its trigger
// comment OR to any earlier comment that was folded into the same run while it
// was still queued (coalesced_comment_ids). A coalesced run answers each root
// thread it covered inside that thread, so its replies legitimately target
// those threads' comments — not just the trigger (MUL-4348 per-thread fan-out).
//
// Every other parent on the task's own issue is still rejected: this is the
// defense against resumed-session --parent drift and cross-thread misplacement.
// The allow-list is exactly the set the run was given to answer, so it cannot
// reach arbitrary comments.
func taskCoversReplyParent(task db.AgentTaskQueue, parentID pgtype.UUID) bool {
	if !parentID.Valid {
		return false
	}
	target := uuidToString(parentID)
	if task.TriggerCommentID.Valid && uuidToString(task.TriggerCommentID) == target {
		return true
	}
	for _, id := range task.CoalescedCommentIds {
		if id.Valid && uuidToString(id) == target {
			return true
		}
	}
	return false
}

// clientAuthorableCommentTypes is what POST /comments accepts. `status_change`
// and `system` are platform-generated narration, so a client claiming them
// would be forging system output; they are deliberately absent.
var clientAuthorableCommentTypes = map[string]struct{}{
	"comment":         {},
	"progress_update": {},
}

// noteCommentPrefix marks a comment as a human-only note. A comment whose first
// whitespace-delimited token is this prefix (case-insensitive) is stored like
// any other comment but never triggers an agent.
const noteCommentPrefix = "/note"

// isNoteComment reports whether content opts out of agent triggering via the
// reserved /note prefix. The prefix must be the comment's first token, so
// "/note check expiry", "  /NOTE", and "/note" all match, while "/notes",
// "/ note", and "see foo/note" do not.
func isNoteComment(content string) bool {
	trimmed := strings.TrimLeft(content, " \t\r\n")
	firstToken := trimmed
	if i := strings.IndexFunc(trimmed, unicode.IsSpace); i >= 0 {
		firstToken = trimmed[:i]
	}
	return strings.EqualFold(firstToken, noteCommentPrefix)
}

// commentEnqueueResult is the domain outcome of enqueuing ONE executing agent.
// execSquadID is the squad whose leader context the run actually carries (set
// only for a squad-leader execution), so a DIFFERENT squad that shares this
// leader can be reported honestly as coalesced rather than as if its own leader
// context ran.
type commentEnqueueResult struct {
	status      DispatchStatus
	reason      DispatchReasonCode
	execSquadID string
}

// enqueueCommentAgentTriggers enqueues each resolved trigger (already deduped by
// executing agent) and returns the result keyed by executing agent id
// (MUL-4525 §2). Outcomes are later fanned from these to every explicit mention
// target that resolved to the agent, so coalescing a run never drops a named
// target's outcome. queued / coalesced / deferred are success-shaped (the run
// was handled, no duplicate task); only a real enqueue failure is blocked.
func (h *Handler) enqueueCommentAgentTriggers(ctx context.Context, issue db.Issue, triggerCommentID pgtype.UUID, triggers []commentAgentTrigger) map[string]commentEnqueueResult {
	results := make(map[string]commentEnqueueResult, len(triggers))
	record := func(trigger commentAgentTrigger, status DispatchStatus, reason DispatchReasonCode) {
		execSquadID := ""
		if trigger.Squad != nil {
			execSquadID = uuidToString(trigger.Squad.ID)
		}
		results[uuidToString(trigger.Agent.ID)] = commentEnqueueResult{status: status, reason: reason, execSquadID: execSquadID}
	}
	for _, trigger := range triggers {
		status, reason := h.resolveCommentTriggerEnqueue(ctx, issue, trigger, triggerCommentID)
		record(trigger, status, reason)
	}
	return results
}

// resolveCommentTriggerEnqueue resolves ONE trigger into its final dispatch
// outcome, folding the comment into an existing pending task rather than
// dropping it (MUL-4195). It handles the two ways the (issue, agent) pair can
// already hold a pending task:
//
//   - resolution pre-flagged AlreadyPending, or
//   - a fresh enqueue LOST the race to a concurrent sibling and the
//     idx_one_pending_task_per_issue_agent unique index rejected the insert
//     (service.ErrDuplicatePendingTask, #5914).
//
// Both mean "a task now exists". INVARIANT: a success-shaped outcome (coalesced /
// deferred / queued) is returned only when the comment is provably attached to a
// run that will address it:
//
//   - coalesced — an atomic head-scoped merge folded it into a queued task;
//   - queued    — a fresh task was created for it;
//   - deferred  — an active task's completion reconcile will replay it, either
//     because a planned-id write landed on a claim-receipt task
//     (worker reply, or lost enqueue race where the comment may predate the task) or
//     because the comment is newer than that task and therefore
//     inside reconcile's `created_at > since` window (AlreadyPending
//     path for member/explicit-mention routes, where the task existed first).
//
// The deferral is not a one-shot prediction: if a replay is later blocked by a
// task that cannot cover the comment, reconcileCommentsOnCompletion hands the
// obligation on (propagateUncoveredCommentObligation) instead of discarding it,
// and that hand-off retries across the blocker's state changes (#5914, Elon
// rounds 8–9). It is best-effort in exactly one shape — a DIFFERENT-head QUEUED
// blocker, which can neither cover the comment nor accept it without violating
// TEN-356 — and that case is logged at error rather than hidden; closing it needs
// a durable obligation record, which is deliberately out of scope here.
// It never defers off a mere classification of the current active tasks — a
// snapshot cannot prove anything about state after it is read (round 7).
// A duplicate that cannot yet be resolved re-loops (bounded by maxAttempts); on
// genuine non-convergence it returns a truthful internal_error, never a fabricated
// deferred that would silently drop the comment.
func (h *Handler) resolveCommentTriggerEnqueue(ctx context.Context, issue db.Issue, trigger commentAgentTrigger, triggerCommentID pgtype.UUID) (DispatchStatus, DispatchReasonCode) {
	pending := trigger.AlreadyPending
	lostRace := false
	// Resolve the reviewed HEAD lazily and at most once — the common
	// non-pending path enqueues without ever needing it, so it stays off the
	// hot path. It keys both the head-scoped merge and the planned-comment
	// registration, matching the AlreadyPending pre-check's head (TEN-356).
	var headSha pgtype.Text
	headShaLoaded := false
	getHeadSha := func() pgtype.Text {
		if !headShaLoaded {
			headSha = h.TaskService.ResolveIssueReviewSHAParam(ctx, issue.ID)
			headShaLoaded = true
		}
		return headSha
	}
	// Bounded retry (#5914, Elon round 3). INVARIANT: never return a
	// success-shaped outcome (coalesced / deferred / queued) without a COMPLETED
	// merge, planned-id registration, fresh enqueue, or a confirmed different-head
	// deferral. A duplicate that cannot be durably resolved re-loops; on genuine
	// non-convergence we return a truthful internal_error below, never a
	// fabricated deferred that would silently drop the comment. maxAttempts is a
	// concurrent-churn backstop — each duplicate is followed by a merge/register
	// attempt, so the loop only spins while a sibling keeps flipping state.
	const maxAttempts = 4
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if pending {
			// (a) Fold into a same-head QUEUED task. This is the ONLY path that
			// ATOMICALLY re-attributes the run (trigger / originator / accountable
			// / overlay / connected apps) to the folded comment, so a queued
			// winner must always come through here, never a bare planned append
			// (MUL-4302). HEAD-scoped so a DIFFERENT-head task is never folded
			// (TEN-356) — the merge misses and this falls through. The merge
			// reports HOW it resolved: coalesced on success; blocked on a
			// fail-closed / failed merge — never mislabeled as success (MUL-4525 §2).
			if status, reason, terminal := commentMergeTerminalOutcome(
				h.mergeCommentIntoPendingTask(ctx, issue, trigger, triggerCommentID, getHeadSha()),
			); terminal {
				return status, reason
			}
			// No same-head QUEUED row to fold into (merge missed). The two paths
			// resolve differently.
			if !lostRace && !trigger.NonLeaderAgentReply {
				// (b) AlreadyPending path: this comment arrived AFTER its task, so
				// it is newer than the task and completion reconcile covers it by
				// timestamp; MUL-4195 leaves the claimed task untouched. Defer to
				// the active task, or enqueue fresh if it has since finished.
				active, activeErr := h.hasActiveTaskForIssueAndAgent(ctx, issue.ID, trigger.Agent.ID, triggerCommentID)
				if status, reason, enqueueFresh := decidePostMergeMiss(active, activeErr); !enqueueFresh {
					return status, reason
				}
				// enqueueFresh → fall through to the enqueue below.
			} else {
				// (c) A worker reply needs a recorded obligation: unlike explicit
				// mentions, timestamp-only agent replies are not replayed (loop
				// safety). The same registration also covers a lost INSERT race,
				// where the losing comment can PREDATE the winner,
				// which completion reconcile's `created_at > since` window cannot
				// see. Register it as a planned (undelivered) input on a same-head
				// CLAIM-RECEIPT task (dispatched/running/waiting; queued is excluded
				// — it must fold through the atomic merge above), turning the drop
				// into a bounded follow-up (#5914, Elon round 2).
				registered, err := h.registerPlannedCommentForActiveTask(ctx, issue, trigger.Agent.ID, triggerCommentID, getHeadSha())
				if err != nil {
					slog.Warn("register planned comment failed",
						"issue_id", uuidToString(issue.ID), "agent_id", uuidToString(trigger.Agent.ID), "error", err)
					return DispatchBlocked, ReasonInternalError
				}
				if registered {
					return DispatchDeferred, ReasonDeferred
				}
				// (d) No same-head QUEUED task to fold (merge missed) and no
				// same-head CLAIM-RECEIPT task to register on. Do NOT try to defer
				// off a classification of the current active tasks: a snapshot only
				// proves state NOW, and a DIFFERENT-head task's reconcile covering
				// this comment can be defeated by a newer blocker that appears after
				// the snapshot but before that task completes (its replay collides
				// with the blocker and completion reconcile discards the failure —
				// Elon round 7). Every success-shaped outcome must be backed by a
				// COMPLETED write, never a prediction. So just fall through to a
				// fresh enqueue: if the unique slot is still occupied — necessarily
				// by a different-head task we can neither fold into nor durably cover
				// — the insert re-raises ErrDuplicatePendingTask and we re-loop,
				// converging to a truthful non-success; if the slot is free, the
				// enqueue creates the covering task. (The occupant's own completion
				// reconcile still replays this comment best-effort in the common
				// no-blocker case; we simply never PROMISE it.)
			}
		}
		if err := h.enqueueSingleCommentTrigger(ctx, issue, triggerCommentID, trigger); err != nil {
			// Lost the enqueue race: a sibling task for this (issue, agent) now
			// exists. Re-resolve as pending so the next attempt folds this
			// comment into that sibling (queued) or durably registers it
			// (dispatched) instead of dropping it (#5914).
			if errors.Is(err, service.ErrDuplicatePendingTask) {
				pending = true
				lostRace = true
				continue
			}
			return DispatchBlocked, commentEnqueueFailureReason(err)
		}
		return DispatchQueued, ReasonQueued
	}
	// Non-convergence after the bounded retries (only reachable under sustained
	// concurrent churn where a sibling keeps flipping state under us): surface a
	// truthful non-success — NEVER a fabricated deferred/coalesced that would
	// report the comment covered when no task provably covers it (#5914, Elon
	// round 3). The comment row persists; a later trigger/edit can still cover it.
	slog.Warn("comment trigger enqueue did not converge; reporting non-success",
		"issue_id", uuidToString(issue.ID), "agent_id", uuidToString(trigger.Agent.ID))
	return DispatchBlocked, ReasonInternalError
}

// commentEnqueueFailureReason types an enqueue error that reached the response
// (MUL-4525 §2). The admission gate (canInvokeAgent / archived / runtime) already
// ran during resolution, so a failure here is either a fail-closed attribution
// refusal (attribution_blocked, typed via errors.Is) or a rare race /
// infrastructure error that stays an unclassified internal error rather than
// leaking the raw message.
func commentEnqueueFailureReason(err error) DispatchReasonCode {
	if errors.Is(err, service.ErrAttributionFailClosed) {
		return ReasonAttributionBlocked
	}
	return ReasonInternalError
}

// hasActiveTaskForIssueAndAgent reports whether the (issue, agent) pair has any
// non-terminal task whose completion will drive completion reconciliation. It
// returns the query error rather than swallowing it (MUL-4525, Elon round 4):
// callers must fail closed on error (never enqueue a possibly-colliding
// duplicate) AND must not report a success — "cannot confirm whether a run is
// active" is never the same as "a run is active". See decidePostMergeMiss /
// decideSuppressedLeaderOutcome for the two decisions.
func (h *Handler) hasActiveTaskForIssueAndAgent(ctx context.Context, issueID, agentID, threadCommentID pgtype.UUID) (bool, error) {
	active, err := h.Queries.HasActiveTaskForIssueAndAgentInThread(ctx, db.HasActiveTaskForIssueAndAgentInThreadParams{
		ThreadCommentID: threadCommentID,
		IssueID:         issueID,
		AgentID:         agentID,
	})
	if err != nil {
		slog.Warn("has active task for issue+agent check failed",
			"issue_id", uuidToString(issueID), "agent_id", uuidToString(agentID), "error", err)
		return false, err
	}
	return active, nil
}

// decidePostMergeMiss decides what to do after a comment merge missed on a
// target that had a pending task (MUL-4525, Elon round 4). On a query failure
// (activeErr != nil) it FAILS CLOSED: never enqueue a fresh task — a duplicate
// concurrent run risk — and report a non-success internal_error, since we cannot
// confirm a run is active. A confirmed active task defers to that run's
// reconcile; only a confirmed-none enqueues a fresh follow-up.
func decidePostMergeMiss(active bool, activeErr error) (status DispatchStatus, reason DispatchReasonCode, enqueueFresh bool) {
	switch {
	case activeErr != nil:
		return DispatchBlocked, ReasonInternalError, false
	case active:
		return DispatchDeferred, ReasonDeferred, false
	default:
		return "", "", true
	}
}

// decideSuppressedLeaderOutcome maps the self-trigger-suppressed squad leader's
// active-task check to an honest outcome (MUL-4525, Elon round 4). A query
// failure is never success — it is internal_error, not a fabricated deferred.
// A confirmed active run defers (its reconcile covers the comment); otherwise
// nothing runs and the outcome is self_trigger_suppressed.
func decideSuppressedLeaderOutcome(active bool, activeErr error) (DispatchStatus, DispatchReasonCode) {
	switch {
	case activeErr != nil:
		return DispatchBlocked, ReasonInternalError
	case active:
		return DispatchDeferred, ReasonAlreadyActive
	default:
		return DispatchBlocked, ReasonSelfTriggerSuppressed
	}
}

// commentMergeResult distinguishes how a pending-task merge attempt resolved so
// the caller can report an HONEST outcome (MUL-4525, Elon round 5). A real merge
// is coalesced, but a REFUSED or FAILED merge — even when we correctly fail
// closed by keeping the original task and not enqueuing a duplicate — must NOT
// be reported as a success-shaped coalesced.
type commentMergeResult int

const (
	// commentMergeSucceeded: the comment folded into the queued task → coalesced.
	commentMergeSucceeded commentMergeResult = iota
	// commentMergeNoPendingTask: no queued task to merge into anymore (it was
	// claimed/started between the dedup check and now). The caller runs the
	// active-task decision (defer vs fresh enqueue).
	commentMergeNoPendingTask
	// commentMergeAttributionBlocked: fail-closed attribution refused re-stamping
	// the merge. The original task is kept and no fresh task is enqueued, but the
	// re-attribution did NOT happen → outcome attribution_blocked, not success.
	commentMergeAttributionBlocked
	// commentMergeError: an unknown attribution/DB error. Fail closed (keep the
	// task, no duplicate enqueue), but the merge did not complete → outcome
	// internal_error, not success.
	commentMergeError
)

// commentMergeTerminalOutcome maps a merge result that carries its own final
// outcome (everything except commentMergeNoPendingTask, which needs the
// active-task decision) to the reported (status, reason). terminal=false only
// for commentMergeNoPendingTask.
func commentMergeTerminalOutcome(result commentMergeResult) (status DispatchStatus, reason DispatchReasonCode, terminal bool) {
	switch result {
	case commentMergeSucceeded:
		return DispatchCoalesced, ReasonCoalesced, true
	case commentMergeAttributionBlocked:
		return DispatchBlocked, ReasonAttributionBlocked, true
	case commentMergeError:
		return DispatchBlocked, ReasonInternalError, true
	default: // commentMergeNoPendingTask
		return "", "", false
	}
}

// mergeCommentIntoPendingTask folds a newly-arrived comment into the existing
// pre-claim task for (issue, agent) instead of dropping it
// (MUL-4195). It reports HOW it resolved via commentMergeResult so the caller
// never mislabels a refused/failed merge as success (MUL-4525 §2). No path here
// enqueues a duplicate: on any failure the original task is kept intact, so the
// comment is still read by that run and its instruction is not lost — only the
// re-attribution / merge bookkeeping is declined, and that is surfaced honestly.
//
// Recompute-on-merge (MUL-4195 review must-fix #1): on success the run's
// originator_user_id, runtime_mcp_overlay and runtime_connected_apps are
// re-stamped to the NEW trigger comment's originator, and trigger_summary is
// refreshed — so a different member's comment safely folds into a task another
// member created, the coalescing run carrying the latest instruction's
// originator and matching connected-app overlay.
func (h *Handler) mergeCommentIntoPendingTask(ctx context.Context, issue db.Issue, trigger commentAgentTrigger, newTriggerCommentID pgtype.UUID, headSha pgtype.Text) commentMergeResult {
	// Re-attribute the coalescing run to the new comment's human atomically: the
	// whole attribution snapshot moves, not just the person columns (MUL-4302). An
	// issue-assignee reaction is comment_source; a mention / thread-parent /
	// conversation hop is delegation.
	isMention := trigger.Source != commentTriggerSourceIssueAssignee
	attr, err := h.TaskService.AttributionForMergedComment(ctx, issue.WorkspaceID, newTriggerCommentID, isMention, trigger.Agent)
	if err != nil {
		// The new comment cannot be re-attributed. REFUSE the merge — keep the
		// existing queued task on its original (precise) snapshot rather than
		// re-stamp it to a degraded owner_fallback, and never spawn a duplicate.
		// A fail-closed refusal is a distinct, honest outcome (attribution_blocked);
		// any other error is unclassified (internal_error) — neither is success.
		slog.Warn("refused comment merge: attribution failed, keeping original task snapshot",
			"issue_id", uuidToString(issue.ID),
			"agent_id", uuidToString(trigger.Agent.ID),
			"new_trigger_comment_id", uuidToString(newTriggerCommentID),
			"error", err)
		if errors.Is(err, service.ErrAttributionFailClosed) {
			return commentMergeAttributionBlocked
		}
		return commentMergeError
	}
	overlay, connectedApps := h.TaskService.BuildRuntimeMCPOverlayForMerge(ctx, attr.UserID, trigger.Agent)
	row, err := h.Queries.MergeCommentIntoPendingTask(ctx, db.MergeCommentIntoPendingTaskParams{
		IssueID:                 issue.ID,
		AgentID:                 trigger.Agent.ID,
		NewTriggerCommentID:     newTriggerCommentID,
		NewOriginatorUserID:     attr.UserID,
		NewAccountableUserID:    attr.AccountableUserID,
		NewOriginatorSource:     pgtype.Text{String: attr.Source.String(), Valid: true},
		NewDelegatedFromTaskID:  attr.DelegatedFromTaskID,
		NewRuleVersionID:        attr.RuleVersionID,
		NewTriggerEvidenceKind:  pgtype.Text{String: string(attr.EvidenceKind), Valid: attr.EvidenceKind != ""},
		NewTriggerEvidenceRefID: attr.EvidenceRefID,
		NewTriggerSummary:       h.TaskService.BuildCommentTriggerSummary(ctx, issue.WorkspaceID, newTriggerCommentID),
		NewRuntimeMcpOverlay:    overlay,
		NewRuntimeConnectedApps: connectedApps,
		HeadSha:                 headSha,
	})
	if err != nil {
		if isNotFound(err) {
			// No pre-claim (queued/deferred) task to merge into. The caller
			// defers to completion reconcile when an active task exists, or
			// enqueues fresh when none does.
			return commentMergeNoPendingTask
		}
		// Unknown error: the pending task most likely still exists, so do NOT
		// risk enqueuing a duplicate — but the merge did not happen, so this is
		// not a success.
		slog.Warn("merge comment into pending task failed",
			"issue_id", uuidToString(issue.ID),
			"agent_id", uuidToString(trigger.Agent.ID),
			"error", err)
		return commentMergeError
	}
	slog.Info("merged comment into pending task",
		"task_id", uuidToString(row.ID),
		"issue_id", uuidToString(issue.ID),
		"agent_id", uuidToString(trigger.Agent.ID),
		"new_trigger_comment_id", uuidToString(newTriggerCommentID),
		"coalesced_count", len(row.CoalescedCommentIds))
	return commentMergeSucceeded
}

// registerPlannedCommentForActiveTask durably folds an accepted comment into the
// same-head active task's planned (coalesced) set when the queued merge could no
// longer target it (the winner was already claimed → dispatched/running). It
// returns true when a same-head active task absorbed the comment; (false, nil)
// means no same-head active task exists (a DIFFERENT-head task holds the slot, or
// the task just terminated), so the caller falls back to the active-task
// decision. Delivered ids are untouched, so completion reconcile replays the
// comment as a single bounded follow-up (#5914). See the query doc.
func (h *Handler) registerPlannedCommentForActiveTask(ctx context.Context, issue db.Issue, agentID, commentID pgtype.UUID, headSha pgtype.Text) (bool, error) {
	row, err := h.Queries.RegisterPlannedCommentForActiveTask(ctx, db.RegisterPlannedCommentForActiveTaskParams{
		CommentID: commentID,
		IssueID:   issue.ID,
		AgentID:   agentID,
		HeadSha:   headSha,
	})
	if err != nil {
		if isNotFound(err) {
			return false, nil
		}
		return false, err
	}
	slog.Info("registered comment as planned follow-up input",
		"task_id", uuidToString(row.ID),
		"issue_id", uuidToString(issue.ID),
		"agent_id", uuidToString(agentID),
		"comment_id", uuidToString(commentID),
		"coalesced_count", len(row.CoalescedCommentIds))
	return true, nil
}

// propagateUncoveredCommentObligation hands an UNCOVERED comment's replay
// obligation to whichever active task now occupies the (issue, agent) slot, so a
// blocked completion replay is never silently dropped (#5914, Elon round 8).
//
// Without this, a deferral is only ever consumed ONCE: task A's completion
// reconcile replays comment C, the enqueue collides with a newer blocker B, the
// failure is discarded, and B never sees C (C predates B and is not in its
// planned ids) — so C is lost even though the original response promised it would
// be handled. Propagating turns "consumed once" into "handed along" until some
// task provably covers C.
//
// Each attempt tries, in order, the three writes that can durably cover the
// comment, and RETRIES when the slot's occupant changes state under us — the
// hand-off is not one atomic statement, so a blocker that completes or gets
// claimed between two steps must be re-observed rather than lost (Elon round 9):
//
//  1. a CLAIM-RECEIPT task (dispatched/running/waiting), ANY head: a planned id
//     added after the claim is never delivered to that run, so it cannot consume
//     the comment under the wrong head — it purely schedules the comment for that
//     task's own completion reconcile, which re-enqueues at the head current then;
//  2. a SAME-HEAD queued task: the atomic merge, which re-stamps trigger /
//     originator / overlay (MUL-4302). This is HEAD-SCOPED on purpose: merging
//     into a different-head queued task would make the comment that run's trigger
//     and mark it delivered at claim time, so an old-head run would consume a
//     new-head request and no new-head follow-up would ever be created — the
//     TEN-356 violation (Elon round 9, must-fix 2);
//  3. a fresh enqueue: correct precisely when the blocker has finished and freed
//     the unique slot, which is the state a mid-hand-off completion leaves behind.
//
// A duplicate-key error from (3) means the slot is still held, so the loop
// re-observes and tries again. Returns false only when every attempt found the
// slot held by a task that can neither cover nor accept the comment (a
// different-head QUEUED blocker); the caller logs that loudly — it is the one
// shape today's schema has no safe place to park, and closing it needs a durable
// obligation record rather than an in-request hand-off.
func (h *Handler) propagateUncoveredCommentObligation(ctx context.Context, issue db.Issue, trigger commentAgentTrigger, commentID pgtype.UUID, headSha pgtype.Text) bool {
	const maxAttempts = 3
	for attempt := 0; attempt < maxAttempts; attempt++ {
		registered, err := h.registerPlannedCommentForActiveTask(ctx, issue, trigger.Agent.ID, commentID, pgtype.Text{})
		if err != nil {
			slog.Warn("propagate comment obligation: register on active task failed",
				"issue_id", uuidToString(issue.ID), "agent_id", uuidToString(trigger.Agent.ID),
				"comment_id", uuidToString(commentID), "error", err)
		} else if registered {
			return true
		}
		if h.mergeCommentIntoPendingTask(ctx, issue, trigger, commentID, headSha) == commentMergeSucceeded {
			return true
		}
		err = h.enqueueSingleCommentTrigger(ctx, issue, commentID, trigger)
		if err == nil {
			return true
		}
		if !errors.Is(err, service.ErrDuplicatePendingTask) {
			return false
		}
		// The slot is still occupied; its occupant may have changed state between
		// the steps above, so re-observe and try again.
	}
	return false
}

// logCommentEnqueueFailure logs a failed comment-trigger enqueue. A benign
// duplicate-pending-task race (service.ErrDuplicatePendingTask) is not a fault —
// resolveCommentTriggerEnqueue folds the comment into the winning task — so it
// is logged at debug and never surfaces as a warning, keeping the raw Postgres
// constraint name out of warn/error logs (#5914, Elon review). Any other error
// stays a warning with the error attached.
func logCommentEnqueueFailure(msg string, err error, attrs ...any) {
	if errors.Is(err, service.ErrDuplicatePendingTask) {
		slog.Debug(msg+": duplicate pending task, coalescing into the sibling run", attrs...)
		return
	}
	slog.Warn(msg, append(attrs, "error", err)...)
}

// enqueueSingleCommentTrigger creates a fresh task for one computed trigger.
// Split out of enqueueCommentAgentTriggers so the merge-not-drop path
// (MUL-4195) can fall back to it when a pending task vanished mid-flight.
// enqueueSingleCommentTrigger enqueues one resolved trigger and returns the
// enqueue error (nil on success) so the caller can surface a
// trigger_outcome (MUL-4525 §2).
func (h *Handler) enqueueSingleCommentTrigger(ctx context.Context, issue db.Issue, triggerCommentID pgtype.UUID, trigger commentAgentTrigger) error {
	switch trigger.Source {
	case commentTriggerSourceIssueAssignee:
		if trigger.Squad != nil {
			if _, err := h.TaskService.EnqueueTaskForSquadLeader(ctx, issue, trigger.Agent.ID, trigger.Squad.ID, triggerCommentID, service.OriginDerived); err != nil {
				logCommentEnqueueFailure("enqueue squad leader task failed", err,
					"issue_id", uuidToString(issue.ID),
					"squad_id", uuidToString(trigger.Squad.ID),
					"leader_id", uuidToString(trigger.Agent.ID))
				return err
			}
			return nil
		}
		if _, err := h.TaskService.EnqueueTaskForIssue(ctx, issue, triggerCommentID); err != nil {
			// EnqueueTaskForIssue now returns ErrDuplicatePendingTask on the
			// benign duplicate-pending-task race, so use the shared helper that
			// downgrades that case to debug — matching the squad-leader and
			// mention cases and letting resolveCommentTriggerEnqueue coalesce
			// instead of surfacing a warning (#5914).
			logCommentEnqueueFailure("enqueue agent task on comment failed", err,
				"issue_id", uuidToString(issue.ID))
			return err
		}
	case commentTriggerSourceMentionSquadLeader:
		if _, err := h.TaskService.EnqueueTaskForSquadLeader(ctx, issue, trigger.Agent.ID, trigger.Squad.ID, triggerCommentID, service.OriginNamed); err != nil {
			logCommentEnqueueFailure("enqueue squad leader mention task failed", err,
				"issue_id", uuidToString(issue.ID),
				"agent_id", uuidToString(trigger.Agent.ID))
			return err
		}
	case commentTriggerSourceMentionAgent:
		if _, err := h.TaskService.EnqueueTaskForMention(ctx, issue, trigger.Agent.ID, triggerCommentID, service.OriginNamed); err != nil {
			logCommentEnqueueFailure("enqueue mention agent task failed", err,
				"issue_id", uuidToString(issue.ID),
				"agent_id", uuidToString(trigger.Agent.ID))
			return err
		}
	case commentTriggerSourceThreadParent, commentTriggerSourceConversation:
		var err error
		// Squad is set on these two sources only when the routing already
		// proved a leader role to continue: the thread root's prior task for
		// the conversation path, the replied-to comment's own authoring task
		// for the thread-parent path. Gating on the source as well would keep
		// the thread-parent path demoted for no reason (MUL-7006).
		if trigger.Squad != nil {
			_, err = h.TaskService.EnqueueTaskForSquadLeader(ctx, issue, trigger.Agent.ID, trigger.Squad.ID, triggerCommentID, service.OriginNamed)
		} else {
			_, err = h.TaskService.EnqueueTaskForThreadParent(ctx, issue, trigger.Agent.ID, triggerCommentID)
		}
		if err != nil {
			logCommentEnqueueFailure("enqueue routed comment agent task failed", err,
				"issue_id", uuidToString(issue.ID),
				"agent_id", uuidToString(trigger.Agent.ID),
				"source", trigger.Source)
			return err
		}
	}
	return nil
}

// computeCommentAgentTriggers resolves which agents a comment triggers (deduped
// by executing agent), plus the per-target list for every EXPLICIT @agent /
// @squad mention (MUL-4525 §2). Targets come only from the explicit-mention path
// — the implicit routing fallbacks (assignee, thread parent, conversation) were
// never named by the user, so a no-route there is not a silent no-op.
func (h *Handler) computeCommentAgentTriggers(ctx context.Context, issue db.Issue, content string, parentComment *db.Comment, actorType, actorID string, opts commentTriggerComputeOptions) ([]commentAgentTrigger, []commentMentionTarget) {
	// A persisted comment determines its thread; previews use the parent.
	// A new top-level preview has no thread yet and cannot merge with a queue.
	opts.ThreadCommentID = opts.ExcludeTriggerCommentID
	if !opts.ThreadCommentID.Valid && parentComment != nil {
		opts.ThreadCommentID = parentComment.ID
	}

	if isNoteComment(content) {
		return nil, nil
	}

	// Autopilot delegation authority (MUL-4857) is applied by the gate via
	// opts.OriginatorUserID: when a run carried no human originator, the gate
	// falls back to opts.AutopilotDelegationAuthorityUserID, which the caller has
	// already resolved from a server-trusted, lineage-verified speaking task (see
	// autopilotDelegationAuthority). Nothing is re-derived from issue provenance
	// here, so an unrelated unattributed run cannot borrow a stranger autopilot
	// creator's authority by commenting on that autopilot's issue.

	mentions := util.ParseMentions(content)

	// EXPLICIT @agent / @squad mentions are a direct request and win over the
	// @all broadcast (MUL-5411). @all only suppresses the IMPLICIT routing
	// fallbacks (assignee / thread parent / conversation) below — it must not
	// swallow a target the author named by hand. Before this ordering, a
	// comment carrying both `@all` and `@Preflight` enqueued nothing at all.
	// `all` is neither "agent" nor "squad", so it is skipped inside
	// resolveMentionedAgentCommentTriggers and never enqueues a run of its own.
	if hasAgentOrSquadMention(mentions) {
		return h.resolveMentionedAgentCommentTriggers(ctx, issue, mentions, actorType, actorID, opts)
	}
	if util.HasMentionAll(mentions) {
		return nil, nil
	}
	if hasMemberMention(mentions) {
		return nil, nil
	}

	if actorType != "member" {
		// Agent-authored comments do not participate in the member-driven
		// conversation routing (parent-author / thread-root continuation) or
		// the member assignee fallback. Worker-result comments retain the
		// leader→worker→leader loop: the assigned squad is resolved from the
		// issue (MUL-3879), while a guest squad is resolved from the exact
		// covered leader delegation (GH-8301). Explicit @agent / @squad mentions
		// are already handled above, so neither fallback double-enqueues a
		// mentioned target.
		if actorType == "agent" {
			if triggers, handled := h.routeGuestSquadLeaderFallback(ctx, issue, parentComment, actorID, opts); handled {
				return triggers, nil
			}
		}
		if issue.AssigneeType.Valid && issue.AssigneeType.String == "squad" {
			if trigger, ok := h.routeAssignedSquadLeaderFallback(ctx, issue, actorType, actorID, opts); ok {
				trigger.NonLeaderAgentReply = actorType == "agent" && actorID != uuidToString(trigger.Agent.ID)
				return []commentAgentTrigger{trigger}, nil
			}
		}
		return nil, nil
	}

	// A deleted parent no longer speaks for its agent author (#8296).
	if parentComment != nil && parentComment.AuthorType == "agent" && !parentComment.DeletedAt.Valid {
		trigger, ok := h.routeReplyToParentAuthor(ctx, issue, parentComment, actorType, actorID, opts)
		if !ok {
			return nil, nil
		}
		return []commentAgentTrigger{trigger}, nil
	}

	if parentComment != nil {
		triggers, handled := h.routeThreadRootOwners(ctx, issue, parentComment, actorID, opts)
		if handled {
			if len(triggers) == 0 {
				return nil, nil
			}
			return triggers, nil
		}
		// A plain member-to-member reply must not start the issue assignee just
		// because the thread has no agent owner. Explicit mentions and existing
		// conversation owners were already resolved above. The same holds for a
		// reply under a deleted comment: it is still a reply, not a new request.
		if parentComment.AuthorType == "member" || parentComment.DeletedAt.Valid {
			return nil, nil
		}
	}

	if trigger, ok := h.routeAssigneeFallback(ctx, issue, actorType, actorID, opts); ok {
		return []commentAgentTrigger{trigger}, nil
	}
	return nil, nil
}

func hasAgentOrSquadMention(mentions []util.Mention) bool {
	for _, m := range mentions {
		if m.Type == "agent" || m.Type == "squad" {
			return true
		}
	}
	return false
}

func hasMemberMention(mentions []util.Mention) bool {
	for _, m := range mentions {
		if m.Type == "member" {
			return true
		}
	}
	return false
}

func (h *Handler) routeReplyToParentAuthor(ctx context.Context, issue db.Issue, parent *db.Comment, authorType, authorID string, opts commentTriggerComputeOptions) (commentAgentTrigger, bool) {
	if parent == nil || parent.AuthorType != "agent" || !parent.AuthorID.Valid {
		return commentAgentTrigger{}, false
	}
	agent, err := h.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{
		ID:          parent.AuthorID,
		WorkspaceID: issue.WorkspaceID,
	})
	if err != nil || !agent.RuntimeID.Valid || agent.ArchivedAt.Valid {
		return commentAgentTrigger{}, false
	}
	if !h.canInvokeAgent(ctx, agent, authorType, authorID, opts.OriginatorUserID, uuidToString(issue.WorkspaceID)) {
		return commentAgentTrigger{}, false
	}
	hasPending, err := h.hasPendingTaskForIssueAndAgent(ctx, issue.ID, parent.AuthorID, opts)
	if err != nil {
		return commentAgentTrigger{}, false
	}
	trigger := commentAgentTrigger{Agent: agent, Source: commentTriggerSourceThreadParent, AlreadyPending: hasPending}
	if squad, ok := h.squadLeaderRoleOfAuthoringTask(ctx, issue, *parent, agent); ok {
		trigger.Squad = squad
	}
	return trigger, true
}

// squadLeaderRoleOfAuthoringTask reports the squad a reply should continue
// under, when the comment being replied to was itself written by a run of that
// squad's leader acting IN the leader role.
//
// Without it, replying directly to a leader's comment demoted the next run to
// a generic direct-agent task (MUL-4024's thread-parent gap): no squad
// briefing at claim time, `auro squad activity` rejected, and — on a
// project with a local_directory resource — the coordinator dragged into the
// user's own directory, queued behind its path mutex and stripped of the
// prior session it was still holding a workdir for (MUL-7006). Replying to a
// MEMBER comment in the same thread already restores the role this way
// (routeConversationOwnersForRoot); this closes the asymmetry.
//
// The role is read from the replied-to comment's OWN authoring run
// (source_task_id), not from the agent's latest task on the issue. An agent
// that is both leader and worker of the same squad posts in both roles, and a
// reply continues the role of the comment it answers — the latest-task read
// would hand a reply to a worker comment the leader's coordinator role.
//
// Fails closed to today's direct-agent routing on every uncertainty: a comment
// with no recorded authoring run (pre-migration-120 rows, or an agent write
// without the X-Task-ID header), a task that did not run as leader, a squad
// since deleted, or leadership that has moved to another agent. The claim
// handler downgrades the wire role again if the briefing cannot be injected,
// so an is_leader_task row whose squad went missing later still cannot deliver
// a leader run.
//
// Deleting a squad ARCHIVES it (DeleteSquad soft-archives after transferring
// its issues to the leader agent), so its rows and the leader's old comments
// both outlive the deletion. GetSquadInWorkspace does not filter archived_at —
// reviving a deleted squad from a stale comment would be a role this issue no
// longer has any assignment for — so the archived check belongs here.
func (h *Handler) squadLeaderRoleOfAuthoringTask(ctx context.Context, issue db.Issue, parent db.Comment, agent db.Agent) (*db.Squad, bool) {
	if !parent.SourceTaskID.Valid {
		return nil, false
	}
	task, err := h.Queries.GetAgentTask(ctx, parent.SourceTaskID)
	if err != nil || !task.IsLeaderTask || !task.SquadID.Valid {
		return nil, false
	}
	squad, err := h.Queries.GetSquadInWorkspace(ctx, db.GetSquadInWorkspaceParams{
		ID:          task.SquadID,
		WorkspaceID: issue.WorkspaceID,
	})
	if err != nil || squad.ArchivedAt.Valid || uuidToString(squad.LeaderID) != uuidToString(agent.ID) {
		return nil, false
	}
	return &squad, true
}

// routeGuestSquadLeaderFallback closes the leader→worker→leader loop when the
// squad was @mentioned as a guest instead of assigned to the issue. The
// authoring worker task must cover the replied-to delegation comment; that
// comment's own task then proves the exact squad and current leader role. Once
// that historical leader role is identified, a now-invalid squad or leader
// fails closed instead of falling through to an unrelated assigned squad.
func (h *Handler) routeGuestSquadLeaderFallback(ctx context.Context, issue db.Issue, parent *db.Comment, authorID string, opts commentTriggerComputeOptions) ([]commentAgentTrigger, bool) {
	if parent == nil || !parent.ID.Valid {
		return nil, false
	}
	// A tombstone preserves only the reply tree, not the guest delegation's
	// routing authority (#8323). The issue's assignment remains an independent
	// source of authority for the assigned-squad fallback.
	if parent.DeletedAt.Valid {
		return nil, false
	}
	if !opts.AuthoringTaskID.Valid {
		return nil, false
	}
	workerTask, err := h.Queries.GetAgentTask(ctx, opts.AuthoringTaskID)
	if err != nil || workerTask.IsLeaderTask || !workerTask.AgentID.Valid ||
		uuidToString(workerTask.AgentID) != authorID || !workerTask.IssueID.Valid ||
		uuidToString(workerTask.IssueID) != uuidToString(issue.ID) || !taskCoversReplyParent(workerTask, parent.ID) {
		return nil, false
	}
	if !parent.SourceTaskID.Valid {
		return nil, false
	}
	leaderTask, err := h.Queries.GetAgentTask(ctx, parent.SourceTaskID)
	if err != nil || !leaderTask.IsLeaderTask || !leaderTask.SquadID.Valid ||
		!leaderTask.AgentID.Valid || leaderTask.AgentID != parent.AuthorID {
		return nil, false
	}
	// Preserve the established assigned-squad path when this delegation came
	// from that same squad. This fallback is only for a distinct guest squad.
	if issue.AssigneeType.Valid && issue.AssigneeType.String == "squad" &&
		issue.AssigneeID.Valid && issue.AssigneeID == leaderTask.SquadID {
		return nil, false
	}
	trigger, ok := h.routeReplyToParentAuthor(ctx, issue, parent, "agent", authorID, opts)
	if !ok || trigger.Squad == nil {
		return nil, true
	}
	trigger.NonLeaderAgentReply = true
	return []commentAgentTrigger{trigger}, true
}

func (h *Handler) routeThreadRootOwners(ctx context.Context, issue db.Issue, parent *db.Comment, memberID string, opts commentTriggerComputeOptions) ([]commentAgentTrigger, bool) {
	if parent == nil || !parent.ID.Valid {
		return nil, false
	}
	root, err := h.Queries.GetThreadRoot(ctx, db.GetThreadRootParams{
		CommentID:   parent.ID,
		WorkspaceID: issue.WorkspaceID,
	})
	if err != nil || !root.ID.Valid || root.AuthorType != "member" {
		return nil, false
	}
	return h.routeConversationOwnersForRoot(ctx, issue, root, memberID, opts)
}

func (h *Handler) routeConversationOwnersForRoot(ctx context.Context, issue db.Issue, root db.Comment, memberID string, opts commentTriggerComputeOptions) ([]commentAgentTrigger, bool) {
	if !root.ID.Valid || root.AuthorType != "member" {
		return nil, false
	}
	if trigger, hasExplicitOwner, ok := h.routeFirstExplicitRootMentionOwner(ctx, issue, root, memberID, opts); hasExplicitOwner {
		if !ok {
			return nil, true
		}
		return []commentAgentTrigger{trigger}, true
	}

	if opts.ExcludeTriggerCommentID == root.ID {
		return nil, false
	}
	owners, err := h.Queries.ListConversationRootOwners(ctx, db.ListConversationRootOwnersParams{
		IssueID: issue.ID, TriggerCommentID: root.ID,
	})
	if err != nil {
		return nil, false
	}
	if len(owners) == 0 {
		return nil, false
	}

	triggers := make([]commentAgentTrigger, 0, len(owners))
	for _, owner := range owners {
		trigger, ok := h.routeConversationContinuationToAgent(ctx, issue, owner.AgentID, owner.SquadID, memberID, opts)
		if ok {
			triggers = append(triggers, trigger)
		}
	}
	return triggers, true
}

func (h *Handler) routeFirstExplicitRootMentionOwner(ctx context.Context, issue db.Issue, root db.Comment, memberID string, opts commentTriggerComputeOptions) (commentAgentTrigger, bool, bool) {
	for _, mention := range util.ParseMentions(root.Content) {
		switch mention.Type {
		case "agent":
			agentID, err := util.ParseUUID(mention.ID)
			if err != nil {
				return commentAgentTrigger{}, true, false
			}
			trigger, ok := h.routeConversationContinuationToAgent(ctx, issue, agentID, pgtype.UUID{}, memberID, opts)
			return trigger, true, ok
		case "squad":
			squadID, err := util.ParseUUID(mention.ID)
			if err != nil {
				return commentAgentTrigger{}, true, false
			}
			squad, err := h.Queries.GetSquadInWorkspace(ctx, db.GetSquadInWorkspaceParams{
				ID:          squadID,
				WorkspaceID: issue.WorkspaceID,
			})
			if err != nil {
				return commentAgentTrigger{}, true, false
			}
			trigger, ok := h.routeConversationContinuationToAgent(ctx, issue, squad.LeaderID, squadID, memberID, opts)
			return trigger, true, ok
		}
	}
	return commentAgentTrigger{}, false, false
}

func (h *Handler) routeConversationContinuationToAgent(ctx context.Context, issue db.Issue, agentID, squadID pgtype.UUID, memberID string, opts commentTriggerComputeOptions) (commentAgentTrigger, bool) {
	if !agentID.Valid {
		return commentAgentTrigger{}, false
	}
	agent, err := h.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{
		ID:          agentID,
		WorkspaceID: issue.WorkspaceID,
	})
	if err != nil || !agent.RuntimeID.Valid || agent.ArchivedAt.Valid {
		return commentAgentTrigger{}, false
	}
	if !h.canInvokeAgent(ctx, agent, "member", memberID, memberID, uuidToString(issue.WorkspaceID)) {
		return commentAgentTrigger{}, false
	}
	hasPending, err := h.hasPendingTaskForIssueAndAgent(ctx, issue.ID, agentID, opts)
	if err != nil {
		return commentAgentTrigger{}, false
	}
	trigger := commentAgentTrigger{Agent: agent, Source: commentTriggerSourceConversation, AlreadyPending: hasPending}
	if squadID.Valid {
		if squad, err := h.Queries.GetSquadInWorkspace(ctx, db.GetSquadInWorkspaceParams{
			ID:          squadID,
			WorkspaceID: issue.WorkspaceID,
		}); err == nil {
			trigger.Squad = &squad
		}
	}
	return trigger, true
}

func (h *Handler) routeAssigneeFallback(ctx context.Context, issue db.Issue, authorType, authorID string, opts commentTriggerComputeOptions) (commentAgentTrigger, bool) {
	if !issue.AssigneeType.Valid || !issue.AssigneeID.Valid {
		return commentAgentTrigger{}, false
	}
	// In Triage the assignee is a proposal the triager is still making, not an
	// owner, so there is nobody to fall back TO (MUL-7189 §2.3). This route and
	// the squad-leader one below are the two that derive an executor from the
	// issue; a comment naming an agent by hand is routed above and still runs.
	//
	// The queue door refuses these anyway. Stopping here is what keeps the
	// server from attempting an enqueue it already knows will be refused, and
	// logging a failure for every comment on a Triage entry.
	if issue.TriageState.Valid {
		return commentAgentTrigger{}, false
	}
	switch issue.AssigneeType.String {
	case "agent":
		agent, hasPending, ok := h.assigneeFallbackAgent(ctx, issue, authorType, authorID, opts)
		if !ok {
			return commentAgentTrigger{}, false
		}
		return commentAgentTrigger{Agent: agent, Source: commentTriggerSourceIssueAssignee, AlreadyPending: hasPending}, true
	case "squad":
		return h.routeAssignedSquadLeaderFallback(ctx, issue, authorType, authorID, opts)
	default:
		return commentAgentTrigger{}, false
	}
}

func (h *Handler) routeAssignedSquadLeaderFallback(ctx context.Context, issue db.Issue, authorType, authorID string, opts commentTriggerComputeOptions) (commentAgentTrigger, bool) {
	// Checked here as well as in routeAssigneeFallback: an agent-authored
	// comment reaches this one directly, without passing through that caller.
	if issue.TriageState.Valid {
		return commentAgentTrigger{}, false
	}
	squad, err := h.Queries.GetSquadInWorkspace(ctx, db.GetSquadInWorkspaceParams{
		ID:          issue.AssigneeID,
		WorkspaceID: issue.WorkspaceID,
	})
	if err != nil {
		return commentAgentTrigger{}, false
	}
	if authorType == "agent" && authorID == uuidToString(squad.LeaderID) &&
		h.shouldSuppressSquadLeaderSelfTrigger(ctx, issue.ID, squad.LeaderID, squad.ID) {
		return commentAgentTrigger{}, false
	}
	agent, err := h.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{
		ID:          squad.LeaderID,
		WorkspaceID: issue.WorkspaceID,
	})
	if err != nil || !agent.RuntimeID.Valid || agent.ArchivedAt.Valid {
		return commentAgentTrigger{}, false
	}
	if !h.canInvokeAgent(ctx, agent, authorType, authorID, opts.OriginatorUserID, uuidToString(issue.WorkspaceID)) {
		return commentAgentTrigger{}, false
	}
	hasPending, err := h.hasPendingTaskForIssueAndAgent(ctx, issue.ID, squad.LeaderID, opts)
	if err != nil {
		return commentAgentTrigger{}, false
	}
	return commentAgentTrigger{Agent: agent, Source: commentTriggerSourceIssueAssignee, Squad: &squad, AlreadyPending: hasPending}, true
}

func (h *Handler) hasPendingTaskForIssueAndAgent(ctx context.Context, issueID, agentID pgtype.UUID, opts commentTriggerComputeOptions) (bool, error) {
	if !opts.ThreadCommentID.Valid {
		return false, nil
	}
	// Key dedup on the reviewed head so re-pushing to the PR mid-review
	// invalidates dedup and a fresh run enqueues against the new HEAD (TEN-356).
	headSha := h.TaskService.ResolveIssueReviewSHAParam(ctx, issueID)
	if opts.ExcludeTriggerCommentID.Valid {
		return h.Queries.HasPendingTaskForIssueAndAgentExcludingTriggerCommentInThread(ctx, db.HasPendingTaskForIssueAndAgentExcludingTriggerCommentInThreadParams{
			ThreadCommentID:         opts.ThreadCommentID,
			IssueID:                 issueID,
			AgentID:                 agentID,
			ExcludeTriggerCommentID: opts.ExcludeTriggerCommentID,
			HeadSha:                 headSha,
		})
	}
	return h.Queries.HasPendingTaskForIssueAndAgentInThread(ctx, db.HasPendingTaskForIssueAndAgentInThreadParams{
		ThreadCommentID: opts.ThreadCommentID,
		IssueID:         issueID,
		AgentID:         agentID,
		HeadSha:         headSha,
	})
}

// resolveMentionedAgentCommentTriggers parses explicit @agent and @squad
// mentions from the current comment and returns the runnable agent recipients.
// Skips agents with on_mention trigger disabled, and private agents mentioned
// by non-owner members (only the agent owner or workspace admin/owner can
// mention a private agent). Self-mentions are intentionally allowed so an
// agent running in one issue can explicitly enqueue itself on another (e.g.
// a child-issue run notifying the parent issue whose assignee is the same
// agent); runaway loops are prevented by HasPendingTaskForIssueAndAgent
// dedupe and the natural queued/dispatched coalescing of the task queue.
// Note: no issue status gate here — @mention is an explicit action and should
// work even on done/cancelled issues (the agent can reopen the issue if needed).
// commentMentionTarget is one EXPLICIT @agent / @squad mention and how it
// resolved (MUL-4525 §2). This is tracked separately from the execution
// triggers: several mentions can resolve to the same executing agent (e.g.
// @Agent A and @Squad S whose leader is A), and each still needs its own
// outcome even though the run is coalesced. Exactly one of the resolution
// fields is set:
//   - ExecAgentID non-empty → the mention runs via that executing agent; its
//     outcome mirrors the agent's enqueue status (queued/coalesced/deferred).
//   - Status set (with ReasonCode) → a terminal, non-executing outcome
//     (blocked, or an A2A self-suppressed squad leader that is deferred).
type commentMentionTarget struct {
	TargetType  string // "agent" | "squad"
	TargetID    string
	ExecAgentID string
	Status      DispatchStatus
	ReasonCode  DispatchReasonCode
	// unusable carries the refused agent and its verdict for the reasons that
	// need a durable trace (runtime_unusable or runtime_access_denied). Internal
	// to the handler:
	// the resolver runs for the composer PREVIEW as well, so it only records
	// what happened — writing the notice is the trigger path's job.
	unusable *blockedRuntimeNotice
}

// blockedRuntimeNotice is a refusal worth leaving on the issue: which agent, and
// the verdict that names the repair.
type blockedRuntimeNotice struct {
	agent   db.Agent
	verdict service.AgentVerdict
}

func (h *Handler) resolveMentionedAgentCommentTriggers(ctx context.Context, issue db.Issue, mentions []util.Mention, authorType, authorID string, opts commentTriggerComputeOptions) ([]commentAgentTrigger, []commentMentionTarget) {
	wsID := uuidToString(issue.WorkspaceID)
	triggers := make([]commentAgentTrigger, 0, len(mentions))
	// seen dedups EXECUTION by resolved agent id: two mentions resolving to the
	// same agent enqueue only one task. Mapping to the trigger's index lets a
	// squad-leader mention UPGRADE an already-added plain @agent trigger for the
	// same agent — the leader task is a strict superset (it sets is_leader_task
	// and squad_id so the daemon injects the squad briefing), so the merged run
	// must carry that role regardless of mention order.
	seen := make(map[string]int, len(mentions))
	add := func(trigger commentAgentTrigger) {
		id := uuidToString(trigger.Agent.ID)
		if idx, ok := seen[id]; ok {
			if triggers[idx].Source != commentTriggerSourceMentionSquadLeader &&
				trigger.Source == commentTriggerSourceMentionSquadLeader {
				triggers[idx] = trigger
			}
			return
		}
		seen[id] = len(triggers)
		triggers = append(triggers, trigger)
	}
	// targets record one outcome per EXPLICIT mention — deduped by the target
	// the user named (type:id), NOT by executing agent — so no explicitly-named
	// target is silently dropped even when its run coalesces with another's.
	var targets []commentMentionTarget
	targetSeen := make(map[string]struct{}, len(mentions))
	addTarget := func(t commentMentionTarget) {
		key := t.TargetType + ":" + t.TargetID
		if _, ok := targetSeen[key]; ok {
			return
		}
		targetSeen[key] = struct{}{}
		targets = append(targets, t)
	}
	// blockTarget records a mention that will not fire. The invoke gate is
	// evaluated BEFORE any archived/runtime state is read, so a caller who
	// cannot invoke a private target learns only the generic
	// invocation_not_allowed and can never enumerate the target's existence or
	// state from the reason code.
	blockTarget := func(targetType, targetID string, reason DispatchReasonCode) {
		addTarget(commentMentionTarget{TargetType: targetType, TargetID: targetID, Status: DispatchBlocked, ReasonCode: reason})
	}
	// blockUnusableTarget is blockTarget for the verdicts that also need a
	// durable trace. Every author gets it, including a human: the chip and toast
	// carry the reason code but not the repair command, and an agent-authored
	// mention has nobody watching a response at all.
	blockUnusableTarget := func(targetType, targetID string, agent db.Agent, verdict service.AgentVerdict) {
		notice := &blockedRuntimeNotice{agent: agent, verdict: verdict}
		if !service.RuntimeBlockedNeedsNotice(verdict.Reason) {
			notice = nil
		}
		addTarget(commentMentionTarget{
			TargetType: targetType, TargetID: targetID,
			Status: DispatchBlocked, ReasonCode: verdict.Reason, unusable: notice,
		})
	}
	for _, m := range mentions {
		if m.Type == "squad" {
			// @squad mention → trigger the squad's leader agent.
			// The mention id comes from untrusted comment text and MentionRe
			// accepts any hex/dash run (`mention://squad/-`), so it is parsed
			// with the error-returning ParseUUID — the Must* variant would
			// panic the request, and on the create path the comment row is
			// already committed by then. A malformed id is indistinguishable
			// from a well-formed id that owns no squad: same target_unavailable
			// outcome, no run.
			squadUUID, err := util.ParseUUID(m.ID)
			if err != nil {
				blockTarget("squad", m.ID, ReasonTargetUnavailable)
				continue
			}
			squad, err := h.Queries.GetSquadInWorkspace(ctx, db.GetSquadInWorkspaceParams{
				ID:          squadUUID,
				WorkspaceID: issue.WorkspaceID,
			})
			if err != nil {
				blockTarget("squad", m.ID, ReasonTargetUnavailable)
				continue
			}
			leaderID := squad.LeaderID
			// A2A self-suppression: the author IS this squad's leader and its
			// most recent task on this issue was a leader/generic role (NOT a
			// fresh same-squad worker→leader handoff), so we do not re-fire the
			// leader from its own @mention. The outcome must reflect reality, not
			// assume success (MUL-4525): `deferred` only when a real non-terminal
			// task is still active (its reconcile covers this comment); a query
			// failure is a non-success internal_error, never a fabricated
			// deferred; otherwise nothing runs → self_trigger_suppressed.
			if authorType == "agent" && authorID == uuidToString(leaderID) &&
				h.shouldSuppressSquadLeaderSelfTrigger(ctx, issue.ID, leaderID, squad.ID) {
				active, activeErr := h.hasActiveTaskForIssueAndAgent(ctx, issue.ID, leaderID, opts.ThreadCommentID)
				status, reason := decideSuppressedLeaderOutcome(active, activeErr)
				addTarget(commentMentionTarget{TargetType: "squad", TargetID: m.ID, Status: status, ReasonCode: reason})
				continue
			}
			agent, err := h.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{
				ID:          leaderID,
				WorkspaceID: issue.WorkspaceID,
			})
			if err != nil {
				blockTarget("squad", m.ID, ReasonTargetUnavailable)
				continue
			}
			// Private-leader gate first (enumeration-safe: a caller who cannot
			// invoke the leader never learns its archived/runtime state).
			if !h.canInvokeAgent(ctx, agent, authorType, authorID, opts.OriginatorUserID, wsID) {
				blockTarget("squad", m.ID, ReasonInvocationNotAllowed)
				continue
			}
			if agent.ArchivedAt.Valid {
				blockTarget("squad", m.ID, ReasonTargetUnavailable)
				continue
			}
			// Same shared verdict as the direct-agent branch below.
			if verdict, err := service.AgentReadiness(ctx, h.runtimeLookup(obsmetrics.RuntimeLookupSourceComment), agent); err == nil && verdict.Blocked() {
				blockUnusableTarget("squad", m.ID, agent, verdict)
				continue
			}
			hasPending, err := h.hasPendingTaskForIssueAndAgent(ctx, issue.ID, leaderID, opts)
			if err != nil {
				blockTarget("squad", m.ID, ReasonInternalError)
				continue
			}
			add(commentAgentTrigger{Agent: agent, Source: commentTriggerSourceMentionSquadLeader, Squad: &squad, AlreadyPending: hasPending})
			addTarget(commentMentionTarget{TargetType: "squad", TargetID: m.ID, ExecAgentID: uuidToString(leaderID)})
			continue
		}
		if m.Type != "agent" {
			continue
		}
		agentUUID, err := util.ParseUUID(m.ID)
		if err != nil {
			// Untrusted comment text: MentionRe matches any hex/dash run, so a
			// malformed id must not reach the panicking Must* parser. A string
			// that is not a UUID at all cannot name an entity in ANY workspace,
			// so there is no existence to conceal here and the invoke-permission
			// code would be a false cause (MUL-5548): report the same
			// target_unavailable the squad path above already uses. Only the
			// well-formed-but-unresolved case below stays enumeration-safe.
			blockTarget("agent", m.ID, ReasonTargetUnavailable)
			continue
		}
		// Load the agent scoped to the current issue's workspace. Using the
		// bare GetAgent here would let a mention resolve to an agent in a
		// different workspace, and the visibility check below would then be
		// applied against the wrong workspace's roles (a workspace owner in
		// THIS workspace would pass the gate for a private agent that lives
		// in someone else's workspace).
		agent, err := h.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{
			ID:          agentUUID,
			WorkspaceID: issue.WorkspaceID,
		})
		if err != nil {
			// Do not reveal whether the id exists (it may be a private agent in
			// another workspace): the generic invocation_not_allowed is returned.
			blockTarget("agent", m.ID, ReasonInvocationNotAllowed)
			continue
		}
		// Private-agent gate first, before any archived/runtime state is read.
		if !h.canInvokeAgent(ctx, agent, authorType, authorID, opts.OriginatorUserID, wsID) {
			blockTarget("agent", m.ID, ReasonInvocationNotAllowed)
			continue
		}
		if agent.ArchivedAt.Valid {
			blockTarget("agent", m.ID, ReasonTargetUnavailable)
			continue
		}
		// One readiness verdict for every admission path (service.AgentReadiness).
		// Only a BLOCKED verdict refuses the mention: an unbound agent has no
		// machine to bring back (MUL-5559), and a machine whose CLI cannot run
		// will not start doing so on its own (MUL-6164). A merely offline
		// runtime keeps queueing — that wait ends by itself when the machine
		// returns, and taking it away would remove a behaviour people rely on.
		if verdict, err := service.AgentReadiness(ctx, h.runtimeLookup(obsmetrics.RuntimeLookupSourceComment), agent); err == nil && verdict.Blocked() {
			blockUnusableTarget("agent", m.ID, agent, verdict)
			continue
		}
		hasPending, err := h.hasPendingTaskForIssueAndAgent(ctx, issue.ID, agentUUID, opts)
		if err != nil {
			blockTarget("agent", m.ID, ReasonInternalError)
			continue
		}
		add(commentAgentTrigger{Agent: agent, Source: commentTriggerSourceMentionAgent, AlreadyPending: hasPending})
		addTarget(commentMentionTarget{TargetType: "agent", TargetID: m.ID, ExecAgentID: uuidToString(agentUUID)})
	}
	return triggers, targets
}

// withLiveCommentLock runs write in a transaction that first locks the
// comment's issue and then the comment — the order every comment mutation
// takes — and only while the comment is live. Writes to a comment's children
// (reactions, attachments) go through it so none can land on a tombstone, even
// when the delete commits while this waits. Returns pgx.ErrNoRows when the
// comment is gone or deleted.
func (h *Handler) withLiveCommentLock(ctx context.Context, commentID, workspaceID pgtype.UUID, write func(*db.Queries) error) error {
	tx, err := h.beginWakeupWrite(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	qtx := h.Queries.WithTx(tx)
	if _, err := qtx.LockLiveComment(ctx, db.LockLiveCommentParams{ID: commentID, WorkspaceID: workspaceID}); err != nil {
		return err
	}
	if err := write(qtx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

var errTaskSupplementInFlight = errors.New("additional message is still being delivered")

// retriggerCancelledTaskSurvivors repairs the surviving inputs from a
// batch containing a comment that was edited or deleted. Cancellation releases
// the one-pending-task constraint; every other comment is replayed through the
// normal authorization/routing path, scoped to the agent whose task carried
// it. Chronological replay makes those survivors coalesce back into one batch
// and lets the latest real comment restamp originator + connected-app context.
func (h *Handler) retriggerCancelledTaskSurvivors(ctx context.Context, issue db.Issue, cancelled []db.AgentTaskQueue, excludedCommentID pgtype.UUID) {
	if len(cancelled) == 0 {
		return
	}
	targetsByComment := make(map[string]map[string]pgtype.UUID)
	for _, task := range cancelled {
		if !task.AgentID.Valid {
			continue
		}
		plannedCommentIDs := append([]pgtype.UUID{}, task.CoalescedCommentIds...)
		if task.TriggerCommentID.Valid {
			plannedCommentIDs = append(plannedCommentIDs, task.TriggerCommentID)
		}
		for _, commentID := range plannedCommentIDs {
			if !commentID.Valid || (excludedCommentID.Valid && commentID == excludedCommentID) {
				continue
			}
			commentKey := uuidToString(commentID)
			if targetsByComment[commentKey] == nil {
				targetsByComment[commentKey] = make(map[string]pgtype.UUID)
			}
			targetsByComment[commentKey][uuidToString(task.AgentID)] = task.AgentID
		}
	}

	comments := make([]db.Comment, 0, len(targetsByComment))
	for commentID := range targetsByComment {
		comment, err := h.Queries.GetComment(ctx, parseUUID(commentID))
		if err != nil {
			slog.Warn("retrigger cancelled comment batch: load survivor failed",
				"issue_id", uuidToString(issue.ID), "comment_id", commentID, "error", err)
			continue
		}
		// A tombstone is a deleted input, not a survivor.
		if comment.IssueID != issue.ID || comment.DeletedAt.Valid {
			continue
		}
		comments = append(comments, comment)
	}
	sort.Slice(comments, func(i, j int) bool {
		if !comments[i].CreatedAt.Time.Equal(comments[j].CreatedAt.Time) {
			return comments[i].CreatedAt.Time.Before(comments[j].CreatedAt.Time)
		}
		return uuidToString(comments[i].ID) < uuidToString(comments[j].ID)
	})

	for i := range comments {
		comment := comments[i]
		if isNoteComment(comment.Content) {
			continue
		}
		// Platform recovery comments bypass generic member/agent routing. If
		// editing or deleting another comment cancelled the queued batch that
		// carried one, replay it through the durable delegated-failure path so
		// the cancelled, undelivered task cannot swallow the obligation.
		if service.IsDelegatedFailureRecoveryComment(comment) {
			if err := h.TaskService.DispatchDelegatedFailureRecoveryComment(ctx, comment, pgtype.UUID{}); err != nil {
				slog.Warn("retrigger cancelled comment batch: delegated failure recovery replay failed",
					"issue_id", uuidToString(issue.ID),
					"comment_id", uuidToString(comment.ID),
					"error", err,
				)
			}
			continue
		}
		var parentComment *db.Comment
		if comment.ParentID.Valid {
			if parent, err := h.Queries.GetComment(ctx, comment.ParentID); err == nil {
				parentComment = &parent
			}
		}
		actorType := comment.AuthorType
		actorID := uuidToString(comment.AuthorID)
		originatorUserID := actorID
		if actorType != "member" {
			originatorUserID = uuidToString(h.TaskService.ResolveOriginatorFromTriggerComment(ctx, issue.WorkspaceID, comment.ID))
		}
		triggers, _ := h.computeCommentAgentTriggers(ctx, issue, comment.Content, parentComment, actorType, actorID, commentTriggerComputeOptions{
			ExcludeTriggerCommentID: comment.ID,
			AuthoringTaskID:         comment.SourceTaskID,
			OriginatorUserID:        originatorUserID,
		})
		targets := targetsByComment[uuidToString(comment.ID)]
		scoped := make([]commentAgentTrigger, 0, len(targets))
		for _, trigger := range triggers {
			if _, ok := targets[uuidToString(trigger.Agent.ID)]; ok {
				scoped = append(scoped, trigger)
			}
		}
		if len(scoped) > 0 {
			h.enqueueCommentAgentTriggers(ctx, issue, comment.ID, scoped)
		}
	}
}
