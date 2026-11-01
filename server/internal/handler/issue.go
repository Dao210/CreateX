package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"regexp"
	"strconv"
	"strings"

	"github.com/auro-ai/auro/server/internal/issuestatus"
	obsmetrics "github.com/auro-ai/auro/server/internal/metrics"
	"github.com/auro-ai/auro/server/internal/service"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

// IssueResponse is the JSON response for an issue.
type IssueResponse struct {
	ID          string  `json:"id"`
	WorkspaceID string  `json:"workspace_id"`
	Number      int32   `json:"number"`
	Identifier  string  `json:"identifier"`
	Title       string  `json:"title"`
	Description *string `json:"description"`
	Status      string  `json:"status"`
	// StatusCategory encodes lifecycle using the legacy seven-value wire enum. It is
	// omitted when an endpoint cannot resolve a custom status, so consumers must
	// fall back to their catalog rather than treat a blank as "no category".
	StatusCategory string `json:"status_category,omitempty"`
	// StatusName is a CUSTOM status's display name, carried beside the key so a
	// consumer that only ever sees `status` is not left holding a bare handle.
	// A key derived from a non-Latin name is opaque by construction
	// (`in_review_2`), and an agent reading an issue has nothing else to match
	// against the status a human named for it.
	//
	// Always emitted, unlike StatusCategory. Empty is a MEANING here — "this is
	// a built-in, localize it from the key" — not the "this endpoint did not
	// resolve it" that an absent status_category signals. Keeping the key
	// present is also what lets TestIssueToMap_KeysMatchIssueResponse see the
	// field at all: with omitempty a built-in fixture hides it from BOTH
	// renderings, and the drift guard goes green on a payload that has drifted.
	// (MUL-6749)
	StatusName    string  `json:"status_name"`
	Priority      string  `json:"priority"`
	AssigneeType  *string `json:"assignee_type"`
	AssigneeID    *string `json:"assignee_id"`
	CreatorType   string  `json:"creator_type"`
	CreatorID     string  `json:"creator_id"`
	ParentIssueID *string `json:"parent_issue_id"`
	// DuplicateOf is the original this issue duplicates (MUL-7349), set only
	// while the mark counts: the issue is cancelled and the original still
	// exists. newStatusCategoryFiller resolves it from duplicateOfIssueID;
	// an endpoint that skips the filler emits null rather than a bare pointer.
	DuplicateOf *IssueRefResponse `json:"duplicate_of"`
	ProjectID   *string           `json:"project_id"`
	Position    float64           `json:"position"`
	// Stage groups sub-issues under the same parent into ordered barrier
	// groups (null = unstaged). See service/issue_wakeup_system.go for how a
	// closed stage wakes the parent's assignee.
	Stage     *int32  `json:"stage"`
	StartDate *string `json:"start_date"`
	DueDate   *string `json:"due_date"`
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
	Revision  int64   `json:"revision"`
	// LastActivityAt is the latest semantic issue activity. It stays nullable
	// while the operator-run historical backfill is incomplete.
	LastActivityAt *string `json:"last_activity_at"`
	// Metadata is the per-issue KV map (see issue_metadata.go). Always emitted
	// (empty object when unset) so frontend code can `issue.metadata[key]`
	// without nil-guarding the parent field.
	Metadata map[string]any `json:"metadata"`
	// Properties is the custom-property value bag keyed by property definition
	// UUID (see property.go). Always emitted, mirroring Metadata.
	Properties  map[string]any          `json:"properties"`
	Reactions   []IssueReactionResponse `json:"reactions,omitempty"`
	Attachments []AttachmentResponse    `json:"attachments,omitempty"`
	// Labels are bulk-attached by list/detail endpoints so the client can render
	// chips without an N+1 round-trip per row. Pointer + omitempty so paths that
	// don't load labels (e.g. UpdateIssue, batch UpdateIssues, the issue:updated
	// WS broadcast) emit no `labels` field at all — the client merge then
	// preserves whatever labels are already in cache. nil pointer = "field
	// absent, do not touch"; non-nil (incl. empty slice) = authoritative list.
	Labels *[]LabelResponse `json:"labels,omitempty"`
	// SourceContext is detail-only. List, board, search, and children responses
	// deliberately omit the potentially large immutable snapshot.
	SourceContext *sourceContextDetailResponse `json:"source_context,omitempty"`
	// duplicateOfIssueID is the raw mark, kept off the wire; see DuplicateOf.
	duplicateOfIssueID pgtype.UUID
}

// IssueRefResponse names another issue inside a response: enough to render
// a link and its status without a second request.
type IssueRefResponse struct {
	ID         string `json:"id"`
	Identifier string `json:"identifier"`
	Title      string `json:"title"`
	Status     string `json:"status"`
}

// validIssuePriorities mirrors the CHECK constraint on the issue table. Write
// handlers pre-validate it so callers get a clean 400 with the allowed values
// instead of a database CHECK violation bubbling up as a 500.
var validIssuePriorities = []string{"urgent", "high", "medium", "low", "none"}

// validIssueStatuses is the 7 BUILT-IN status keys. Since MUL-6243 it is no
// longer the set of writable statuses — write paths validate against the
// workspace's catalog via validateIssueStatusKey — and it survives only for the
// issue-table grouping/filtering paths, which key their group descriptors and
// compound cells off a fixed status list.
//
// KNOWN LIMITATION: a custom status is therefore not yet selectable as an
// issue-table group or filter value. That is a self-contained follow-up (the
// table's group descriptors and compound cell keys need to become catalog
// driven); it is scoped out here so this change cannot alter the table view for
// workspaces that have no custom statuses.
var validIssueStatuses = issuestatus.Canonical()
var validIssueStatusCategories = issuestatus.Categories()

// errIssueStatusArchivedRace signals that the target custom status was archived
// between the request's pre-flight validation and the write itself. Callers map
// it to 409: the request was valid when it arrived, and retrying against the
// refreshed catalog is the right remedy.
var errIssueStatusArchivedRace = errors.New("issue status was archived while the write was in flight")

func (h *Handler) broadcastCancelledWakeups(ctx context.Context, workspaceID pgtype.UUID, cancelled []db.AgentTaskQueue) {
	if len(cancelled) > 0 {
		h.TaskService.BroadcastCancelledTasks(ctx, uuidToString(workspaceID), cancelled)
	}
}

// newStatusCategoryFiller returns a request-scoped filler backed by ONE
// Resolver. Reuse it across every response a request builds: the Resolver reads
// the catalog at most once, so a page of custom-status rows costs one query
// rather than one per row. Creating a filler per row would reintroduce the N+1
// this exists to avoid. (MUL-6243)
//
// originals are the duplicate originals the caller's rows point at, collected
// with appendDuplicateOriginal. A page passes them so they resolve in one read
// up front, the way labelsByIssue loads a page's labels; an original that was
// not passed still resolves, one read per distinct original. (MUL-7349)
func (h *Handler) newStatusCategoryFiller(ctx context.Context, wsID pgtype.UUID, originals ...pgtype.UUID) func(*IssueResponse) {
	resolver := issuestatus.NewResolver(wsID)
	refs := duplicateOriginals{}
	h.loadDuplicateOriginals(ctx, wsID, refs, originals)
	return func(resp *IssueResponse) {
		if resp == nil {
			return
		}
		// Every response that resolves its status also resolves its duplicate
		// mark, so the two never disagree about which endpoints carry them.
		h.fillDuplicateOf(ctx, wsID, resp, refs)
		if resp.StatusCategory != "" {
			return
		}
		resp.StatusCategory = issuestatus.WireCategory(resp.Status, resolver.Category(ctx, h.Queries, resp.Status))
		// Same Resolver, same single catalog read, so the name rides along for
		// free. Built-ins return "" and stay omitted. (MUL-6749)
		resp.StatusName = resolver.Name(ctx, h.Queries, resp.Status)
	}
}

// fillStatusCategory is the single-response form. Only for endpoints that build
// exactly ONE response; anything looping must use newStatusCategoryFiller.
func (h *Handler) fillStatusCategory(ctx context.Context, wsID pgtype.UUID, resp *IssueResponse) {
	h.newStatusCategoryFiller(ctx, wsID)(resp)
}

// duplicateOfPointer keeps a duplicate mark only while the issue is
// cancelled. Whether the original still exists is checked when the response
// is filled (fillDuplicateOf), so a pointer an older server left behind
// never surfaces. Same rule as IssueHasDuplicates in issue.sql.
func duplicateOfPointer(status string, id pgtype.UUID) pgtype.UUID {
	if status != issuestatus.Cancelled {
		return pgtype.UUID{}
	}
	return id
}

// duplicateOriginals memoises the originals a request's duplicates point at,
// by id. A nil entry is an original that no longer exists (or could not be
// read), so it is looked up once and then left off every response.
type duplicateOriginals map[pgtype.UUID]*db.ListIssueRefsInWorkspaceRow

// loadDuplicateOriginals reads every id not yet in refs in one query.
func (h *Handler) loadDuplicateOriginals(ctx context.Context, wsID pgtype.UUID, refs duplicateOriginals, ids []pgtype.UUID) {
	var missing []pgtype.UUID
	for _, id := range ids {
		if _, seen := refs[id]; !seen {
			refs[id] = nil
			missing = append(missing, id)
		}
	}
	if len(missing) == 0 {
		return
	}
	rows, err := h.Queries.ListIssueRefsInWorkspace(ctx, db.ListIssueRefsInWorkspaceParams{
		WorkspaceID: wsID,
		Ids:         missing,
	})
	if err != nil {
		slog.Warn("resolve duplicate originals failed", "error", err, "count", len(missing))
		return
	}
	for i := range rows {
		refs[rows[i].ID] = &rows[i]
	}
}

// fillDuplicateOf resolves a duplicate mark to its original (MUL-7349),
// through refs so a page's originals cost one read (see
// newStatusCategoryFiller). A missing original leaves DuplicateOf unset.
func (h *Handler) fillDuplicateOf(ctx context.Context, wsID pgtype.UUID, resp *IssueResponse, refs duplicateOriginals) {
	id := resp.duplicateOfIssueID
	if !id.Valid {
		return
	}
	h.loadDuplicateOriginals(ctx, wsID, refs, []pgtype.UUID{id})
	row := refs[id]
	if row == nil {
		return
	}
	// The response already rendered its own identifier with the workspace
	// prefix; the original shares it.
	prefix := strings.TrimSuffix(resp.Identifier, "-"+strconv.Itoa(int(resp.Number)))
	resp.DuplicateOf = &IssueRefResponse{
		ID:         uuidToString(row.ID),
		Identifier: prefix + "-" + strconv.Itoa(int(row.Number)),
		Title:      row.Title,
		Status:     row.Status,
	}
}

func issueToResponse(i db.Issue, issuePrefix string) IssueResponse {
	identifier := issuePrefix + "-" + strconv.Itoa(int(i.Number))
	// Built-ins map to public categories without a catalog lookup. A custom
	// status is filled by endpoints that resolve the workspace catalog.
	statusCategory := ""
	if issuestatus.IsBuiltIn(i.Status) {
		statusCategory = i.Status
	}
	return IssueResponse{
		ID:                 uuidToString(i.ID),
		WorkspaceID:        uuidToString(i.WorkspaceID),
		Number:             i.Number,
		Identifier:         identifier,
		Title:              i.Title,
		Description:        textToPtr(i.Description),
		Status:             i.Status,
		StatusCategory:     statusCategory,
		Priority:           i.Priority,
		AssigneeType:       textToPtr(i.AssigneeType),
		AssigneeID:         uuidToPtr(i.AssigneeID),
		CreatorType:        i.CreatorType,
		CreatorID:          uuidToString(i.CreatorID),
		ParentIssueID:      uuidToPtr(i.ParentIssueID),
		duplicateOfIssueID: duplicateOfPointer(i.Status, i.DuplicateOfIssueID),
		ProjectID:          uuidToPtr(i.ProjectID),
		Position:           i.Position,
		Stage:              int4ToPtr(i.Stage),
		StartDate:          dateToPtr(i.StartDate),
		DueDate:            dateToPtr(i.DueDate),
		CreatedAt:          timestampToString(i.CreatedAt),
		UpdatedAt:          timestampToString(i.UpdatedAt),
		Revision:           i.Revision,
		LastActivityAt:     timestampToNanoPtr(i.LastActivityAt),
		Metadata:           parseIssueMetadata(i.Metadata),
		Properties:         parseIssueProperties(i.Properties),
	}
}

// identifierNumberRe matches patterns like "MUL-123" or "ABC-45".
var identifierNumberRe = regexp.MustCompile(`(?i)^[a-z]+-(\d+)$`)

type CreateIssueRequest struct {
	Title         string   `json:"title"`
	Description   *string  `json:"description"`
	Status        string   `json:"status"`
	Priority      string   `json:"priority"`
	AssigneeType  *string  `json:"assignee_type"`
	AssigneeID    *string  `json:"assignee_id"`
	ParentIssueID *string  `json:"parent_issue_id"`
	ProjectID     *string  `json:"project_id"`
	Stage         *int32   `json:"stage,omitempty"`
	StartDate     *string  `json:"start_date"`
	DueDate       *string  `json:"due_date"`
	AttachmentIDs []string `json:"attachment_ids,omitempty"`
	// LabelIDs are issue-scoped labels to attach to the new issue in the same
	// transaction as the create. Unknown or non-issue ids are rejected with
	// 400 (service.ErrIssueLabelNotFound) rather than silently dropped.
	LabelIDs []string `json:"label_ids,omitempty"`
	// Properties is an ID-keyed bag whose values use the same typed wire shape
	// as Issue.properties and the standalone property PUT endpoint.
	Properties map[string]json.RawMessage `json:"properties,omitempty"`
	// OriginType / OriginID stamp the new issue with its provenance so
	// platform-internal flows can deterministically locate it later. Only
	// trusted callers should set these — currently the daemon CLI passes
	// them through for quick-create tasks (origin_type=quick_create,
	// origin_id=agent_task_queue.id).
	OriginType *string `json:"origin_type,omitempty"`
	OriginID   *string `json:"origin_id,omitempty"`

	AllowDuplicate bool `json:"allow_duplicate,omitempty"`
}

// UnmarshalJSON rejects duplicate object members before Go's ordinary map
// decoding can silently apply last-wins semantics. This is especially
// important for properties: two values for one definition must reject the
// whole create, never choose one implicitly.
func (r *CreateIssueRequest) UnmarshalJSON(data []byte) error {
	if err := rejectDuplicateJSONKeys(data); err != nil {
		return err
	}
	type createIssueRequestAlias CreateIssueRequest
	var decoded createIssueRequestAlias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*r = CreateIssueRequest(decoded)
	return nil
}

func rejectDuplicateJSONKeys(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := rejectDuplicateJSONValue(decoder); err != nil {
		return err
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request body must contain one JSON value")
		}
		return err
	}
	return nil
}

func rejectDuplicateJSONValue(decoder *json.Decoder) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delimiter, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	switch delimiter {
	case '{':
		seen := make(map[string]struct{})
		for decoder.More() {
			keyToken, err := decoder.Token()
			if err != nil {
				return err
			}
			key, ok := keyToken.(string)
			if !ok {
				return errors.New("object key must be a string")
			}
			if _, duplicate := seen[key]; duplicate {
				return fmt.Errorf("duplicate JSON key %q", key)
			}
			seen[key] = struct{}{}
			if err := rejectDuplicateJSONValue(decoder); err != nil {
				return err
			}
		}
		_, err = decoder.Token()
		return err
	case '[':
		for decoder.More() {
			if err := rejectDuplicateJSONValue(decoder); err != nil {
				return err
			}
		}
		_, err = decoder.Token()
		return err
	default:
		return errors.New("invalid JSON delimiter")
	}
}

var errIssueFieldConflict = errors.New("issue text field conflict")

// shouldEnqueueAgentTask returns true when an issue creation or assignment
// should trigger the assigned agent. Backlog issues are skipped — backlog
// acts as a parking lot where issues can be pre-assigned without immediately
// triggering execution. Moving out of backlog is handled separately in
// UpdateIssue.
func (h *Handler) shouldEnqueueAgentTask(ctx context.Context, issue db.Issue) bool {
	// Only the fixed backlog key parks work; custom unstarted statuses do not.
	// An issue in Triage is not parked but refused: it produces no run from any
	// entry point until it is accepted (MUL-7189 §2.3).
	if issue.TriageState.Valid || issuestatus.Effective(ctx, h.Queries, issue.WorkspaceID, issue.Status) == "backlog" {
		return false
	}
	return h.isAgentAssigneeReady(ctx, issue)
}

func (h *Handler) assigneeFallbackAgent(ctx context.Context, issue db.Issue, actorType, actorID string, opts commentTriggerComputeOptions) (db.Agent, bool, bool) {
	if !issue.AssigneeType.Valid || issue.AssigneeType.String != "agent" || !issue.AssigneeID.Valid {
		return db.Agent{}, false, false
	}
	agent, err := h.Queries.GetAgent(ctx, issue.AssigneeID)
	if err != nil || !agent.RuntimeID.Valid || agent.ArchivedAt.Valid {
		return db.Agent{}, false, false
	}
	if !h.canInvokeAgent(ctx, agent, actorType, actorID, opts.OriginatorUserID, uuidToString(issue.WorkspaceID)) {
		return db.Agent{}, false, false
	}
	// Coalescing queue: pending is still a valid route target, but callers
	// that actually enqueue tasks use this flag to avoid piling on duplicates.
	hasPending, err := h.hasPendingTaskForIssueAndAgent(ctx, issue.ID, issue.AssigneeID, opts)
	if err != nil {
		return db.Agent{}, false, false
	}
	return agent, hasPending, true
}

// isAgentAssigneeReady checks if an issue is assigned to an active agent
// with a valid runtime.
func (h *Handler) isAgentAssigneeReady(ctx context.Context, issue db.Issue) bool {
	if !issue.AssigneeType.Valid || issue.AssigneeType.String != "agent" || !issue.AssigneeID.Valid {
		return false
	}

	agent, err := h.Queries.GetAgent(ctx, issue.AssigneeID)
	if err != nil {
		return false
	}
	// The shared verdict, not a local re-check (service.AgentReadiness). Only a
	// BLOCKED verdict stops the enqueue: an offline machine still queues,
	// because that work runs when the machine comes back.
	verdict, err := service.AgentReadiness(ctx, h.runtimeLookup(obsmetrics.RuntimeLookupSourceIssue), agent)
	if err != nil || !verdict.Blocked() {
		return err == nil
	}
	// Assignment has no response the assigner reads for this outcome, so a
	// refusal that needs human repair leaves the explanation on the issue
	// (MUL-6164). An unbound agent keeps its silent skip: the agent list
	// already shows it has no runtime, and nothing about it is new here.
	if service.RuntimeBlockedNeedsNotice(verdict.Reason) {
		h.noteRuntimeUnusable(ctx, issue, agent, verdict)
	}
	return false
}

// ---------------------------------------------------------------------------
// Batch operations
// ---------------------------------------------------------------------------
