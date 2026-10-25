package mcpadmin

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/mail"
	"strings"
	"time"

	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrForbidden = errors.New("admin_forbidden")
var ErrNotFound = errors.New("mcp_service_not_found")
var ErrInvalid = errors.New("invalid_admin_request")
var ErrConflict = errors.New("revision_conflict")

type Service struct {
	Pool        *pgxpool.Pool
	Definitions []Definition
	emails      map[string]bool
}

func New(pool *pgxpool.Pool, rawEmails string, definitions []Definition) (*Service, error) {
	s := &Service{Pool: pool, Definitions: definitions, emails: map[string]bool{}}
	for _, value := range strings.FieldsFunc(rawEmails, func(r rune) bool { return r == ',' || r == ';' || r == '\n' }) {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == "" {
			continue
		}
		parsed, e := mail.ParseAddress(value)
		if e != nil || parsed.Address != value {
			return nil, fmt.Errorf("AURO_ADMIN_EMAILS must contain comma-separated login email addresses")
		}
		s.emails[value] = true
	}
	return s, nil
}
func (s *Service) Configured() bool { return len(s.emails) > 0 }
func (s *Service) IsAdmin(ctx context.Context, userID string) (bool, error) {
	if !s.Configured() {
		return false, nil
	}
	u, e := util.ParseUUID(userID)
	if e != nil {
		return false, ErrForbidden
	}
	user, e := db.New(s.Pool).GetUser(ctx, u)
	if errors.Is(e, pgx.ErrNoRows) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	return s.emails[strings.ToLower(strings.TrimSpace(user.Email))], nil
}
func (s *Service) definition(id string) (Definition, error) {
	for _, definition := range s.Definitions {
		if definition.ID == id {
			return definition, nil
		}
	}
	return Definition{}, ErrNotFound
}
func policyFromRow(row db.McpServicePolicy) Policy {
	p := Policy{ServiceID: row.ServiceID, Enabled: row.Enabled, DisabledTools: row.DisabledTools, Revision: int(row.Revision), UpdatedBy: util.UUIDToString(row.UpdatedBy)}
	if p.DisabledTools == nil {
		p.DisabledTools = []string{}
	}
	if row.UpdatedAt.Valid {
		t := row.UpdatedAt.Time
		p.UpdatedAt = &t
	}
	return p
}
func (s *Service) Policy(ctx context.Context, id string) (Policy, error) {
	if _, e := s.definition(id); e != nil {
		return Policy{}, e
	}
	row, e := db.New(s.Pool).GetMCPServicePolicy(ctx, id)
	if errors.Is(e, pgx.ErrNoRows) {
		return DefaultPolicy(id), nil
	}
	if e != nil {
		return Policy{}, e
	}
	return policyFromRow(row), nil
}
func (s *Service) Overview(ctx context.Context) ([]Overview, error) {
	out := make([]Overview, 0, len(s.Definitions))
	q := db.New(s.Pool)
	for _, definition := range s.Definitions {
		policy, e := s.Policy(ctx, definition.ID)
		if e != nil {
			return nil, e
		}
		rows, e := q.MCPToolStats(ctx, definition.ID)
		if e != nil {
			return nil, e
		}
		item := Overview{Definition: definition, Policy: policy, ToolStats: map[string]Stats{}}
		var weighted float64
		for _, row := range rows {
			stat := Stats{Calls: row.Calls, Errors: row.Errors, Blocked: row.Blocked, AverageMS: row.AverageMs}
			if row.LastCalledAt.Valid {
				t := row.LastCalledAt.Time
				stat.LastCalledAt = &t
				if item.Stats.LastCalledAt == nil || t.After(*item.Stats.LastCalledAt) {
					item.Stats.LastCalledAt = &t
				}
			}
			item.ToolStats[row.ToolName] = stat
			item.Stats.Calls += stat.Calls
			item.Stats.Errors += stat.Errors
			item.Stats.Blocked += stat.Blocked
			weighted += float64(stat.Calls) * stat.AverageMS
		}
		if item.Stats.Calls > 0 {
			item.Stats.AverageMS = weighted / float64(item.Stats.Calls)
		}
		out = append(out, item)
	}
	return out, nil
}
func normalizePolicy(input PolicyInput, definition Definition) ([]string, error) {
	if input.Enabled == nil || input.DisabledTools == nil || input.ExpectedRevision < 0 || input.ExpectedRevision > math.MaxInt32 {
		return nil, ErrInvalid
	}
	wanted := map[string]bool{}
	for _, name := range input.DisabledTools {
		if wanted[name] {
			return nil, ErrInvalid
		}
		wanted[name] = true
	}
	out := []string{}
	for _, tool := range definition.Tools {
		if wanted[tool.Name] {
			out = append(out, tool.Name)
			delete(wanted, tool.Name)
		}
	}
	if len(wanted) > 0 {
		return nil, ErrInvalid
	}
	return out, nil
}
func (s *Service) UpdatePolicy(ctx context.Context, userID, id string, input PolicyInput) (Policy, error) {
	definition, e := s.definition(id)
	if e != nil {
		return Policy{}, e
	}
	disabled, e := normalizePolicy(input, definition)
	if e != nil {
		return Policy{}, e
	}
	actor, e := util.ParseUUID(userID)
	if e != nil {
		return Policy{}, ErrForbidden
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Policy{}, e
	}
	defer tx.Rollback(ctx)
	q := db.New(tx)
	email, e := q.LockMCPAdminUser(ctx, actor)
	if e != nil || !s.emails[strings.ToLower(strings.TrimSpace(email))] {
		return Policy{}, ErrForbidden
	}
	row, e := q.PutMCPServicePolicy(ctx, db.PutMCPServicePolicyParams{ServiceID: id, Enabled: *input.Enabled, DisabledTools: disabled, UpdatedBy: actor, ExpectedRevision: int32(input.ExpectedRevision)})
	if errors.Is(e, pgx.ErrNoRows) {
		return Policy{}, ErrConflict
	}
	if e != nil {
		return Policy{}, e
	}
	policy := policyFromRow(row)
	details, _ := json.Marshal(map[string]any{"previousRevision": input.ExpectedRevision, "revision": policy.Revision, "enabled": policy.Enabled, "disabledTools": policy.DisabledTools})
	activityID, e := util.ParseUUID(uuid.NewString())
	if e != nil {
		return Policy{}, e
	}
	if e = q.InsertMCPActivity(ctx, db.InsertMCPActivityParams{ID: activityID, ServiceID: id, ActorID: actor, Kind: "policy_change", Outcome: "updated", Details: details}); e != nil {
		return Policy{}, e
	}
	if e = tx.Commit(ctx); e != nil {
		return Policy{}, e
	}
	return policy, nil
}
func (s *Service) RecordCall(ctx context.Context, call Call) error {
	definition, e := s.definition(call.ServiceID)
	if e != nil {
		return e
	}
	known := false
	for _, tool := range definition.Tools {
		if tool.Name == call.ToolName {
			known = true
		}
	}
	if !known || (call.Outcome != "success" && call.Outcome != "error" && call.Outcome != "blocked") || call.DurationMS < 0 || len(call.ErrorCode) > 80 {
		return ErrInvalid
	}
	w, e := util.ParseUUID(call.WorkspaceID)
	if e != nil {
		return ErrInvalid
	}
	a, e := util.ParseUUID(call.ActorID)
	if e != nil {
		return ErrInvalid
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	q := db.New(tx)
	// Coordinate audit insertion with application-owned workspace deletion.
	if _, e = q.LockWorkspaceForChatSessionCreate(ctx, w); e != nil {
		return e
	}
	id, _ := util.ParseUUID(uuid.NewString())
	if e = q.InsertMCPActivity(ctx, db.InsertMCPActivityParams{ID: id, ServiceID: call.ServiceID, WorkspaceID: w, ActorID: a, Kind: "call", ToolName: call.ToolName, Outcome: call.Outcome, ErrorCode: call.ErrorCode, DurationMs: call.DurationMS, Details: []byte(`{}`)}); e != nil {
		return e
	}
	if e = q.PruneMCPActivity(ctx, call.ServiceID); e != nil {
		return e
	}
	return tx.Commit(ctx)
}

type activityCursor struct {
	Time time.Time `json:"time"`
	ID   string    `json:"id"`
}

func (s *Service) Activity(ctx context.Context, id, tool, outcome, workspaceID, cursor string) (ActivityPage, error) {
	definition, e := s.definition(id)
	if e != nil {
		return ActivityPage{}, e
	}
	if outcome != "" && outcome != "success" && outcome != "error" && outcome != "blocked" && outcome != "updated" {
		return ActivityPage{}, ErrInvalid
	}
	if tool != "" {
		known := false
		for _, t := range definition.Tools {
			if t.Name == tool {
				known = true
			}
		}
		if !known {
			return ActivityPage{}, ErrInvalid
		}
	}
	params := db.ListMCPActivityParams{ServiceID: id, ToolName: tool, Outcome: outcome}
	if workspaceID != "" {
		params.WorkspaceID, e = util.ParseUUID(workspaceID)
		if e != nil {
			return ActivityPage{}, ErrInvalid
		}
	}
	if cursor != "" {
		if len(cursor) > 300 {
			return ActivityPage{}, ErrInvalid
		}
		raw, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil {
			return ActivityPage{}, ErrInvalid
		}
		var before activityCursor
		if json.Unmarshal(raw, &before) != nil || before.Time.IsZero() {
			return ActivityPage{}, ErrInvalid
		}
		params.BeforeID, e = util.ParseUUID(before.ID)
		if e != nil {
			return ActivityPage{}, ErrInvalid
		}
		params.BeforeTime = pgtype.Timestamptz{Time: before.Time, Valid: true}
	}
	rows, e := db.New(s.Pool).ListMCPActivity(ctx, params)
	if e != nil {
		return ActivityPage{}, e
	}
	page := ActivityPage{Items: []Activity{}}
	if len(rows) > 50 {
		rows = rows[:50]
		last := rows[49]
		raw, _ := json.Marshal(activityCursor{Time: last.OccurredAt.Time, ID: util.UUIDToString(last.ID)})
		page.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	for _, row := range rows {
		page.Items = append(page.Items, Activity{ID: util.UUIDToString(row.ID), ServiceID: row.ServiceID, WorkspaceID: util.UUIDToString(row.WorkspaceID), WorkspaceName: row.WorkspaceName, WorkspaceSlug: row.WorkspaceSlug, ActorID: util.UUIDToString(row.ActorID), ActorName: row.ActorName, ActorEmail: row.ActorEmail, Kind: row.Kind, ToolName: row.ToolName, Outcome: row.Outcome, ErrorCode: row.ErrorCode, DurationMS: row.DurationMs, Details: row.Details, OccurredAt: row.OccurredAt.Time})
	}
	return page, nil
}
