package gameadmin

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"

	"github.com/auro-ai/auro/server/internal/adminauth"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	Pool *pgxpool.Pool
	Auth *adminauth.Gate
}

func loadPolicy(ctx context.Context, q *db.Queries, id string) (Policy, []World, error) {
	out := defaultPolicy(id)
	row, err := q.GetGamePolicy(ctx, id)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return out, nil, err
	}
	if err == nil {
		out.Scope, out.DefaultVisible, out.Revision = row.Scope, row.DefaultVisible, int(row.Revision)
		out.UpdatedBy = util.UUIDToString(row.UpdatedBy)
		if row.UpdatedAt.Valid {
			out.UpdatedAt = &row.UpdatedAt.Time
		}
	}
	rows, err := q.ListGameWorldOverrides(ctx, id)
	if err != nil {
		return out, nil, err
	}
	worlds := []World{}
	for _, o := range rows {
		wid := util.UUIDToString(o.WorkspaceID)
		out.Overrides = append(out.Overrides, Override{wid, o.Access, o.Visibility})
		worlds = append(worlds, World{wid, o.WorkspaceName, o.WorkspaceSlug})
	}
	return out, worlds, nil
}

func binding(ctx context.Context, q *db.Queries) (*Binding, error) {
	row, err := q.GetLifeGameBinding(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &Binding{World: World{util.UUIDToString(row.ID), row.Name, row.Slug}, UpdatedAt: row.UpdatedAt.Time}, nil
}

func impact(ctx context.Context, q *db.Queries, p Policy) (Impact, error) {
	ids := []pgtype.UUID{}
	accesses, visibilities := []string{}, []string{}
	for _, o := range p.Overrides {
		id, _ := util.ParseUUID(o.WorkspaceID)
		ids = append(ids, id)
		accesses = append(accesses, o.Access)
		visibilities = append(visibilities, o.Visibility)
	}
	row, err := q.CountGamePolicyImpact(ctx, db.CountGamePolicyImpactParams{OverrideIds: ids, OverrideAccess: accesses, OverrideVisibility: visibilities, Scope: p.Scope, DefaultVisible: p.DefaultVisible})
	return Impact{row.Total, row.Available, row.Visible}, err
}

func (s *Service) Overview(ctx context.Context) ([]Overview, error) {
	// A single snapshot keeps policy, overrides and binding coherent while another admin saves.
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	q := db.New(tx)
	b, err := binding(ctx, q)
	if err != nil {
		return nil, err
	}
	out := []Overview{}
	for _, id := range GameIDs {
		p, worlds, err := loadPolicy(ctx, q, id)
		if err != nil {
			return nil, err
		}
		var current *Binding
		if id == "life" {
			current = b
		}
		counts, err := impact(ctx, q, p)
		if err != nil {
			return nil, err
		}
		out = append(out, Overview{p, worlds, counts, current})
	}
	return out, tx.Commit(ctx)
}

func validateWorlds(ctx context.Context, q *db.Queries, p Policy) error {
	for _, o := range p.Overrides {
		id, _ := util.ParseUUID(o.WorkspaceID)
		if _, err := q.LockWorkspaceForChatSessionCreate(ctx, id); errors.Is(err, pgx.ErrNoRows) {
			return ErrInvalid
		} else if err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) Preview(ctx context.Context, id string, in PolicyInput) (Impact, error) {
	p, err := normalize(id, in)
	if err != nil {
		return Impact{}, err
	}
	q := db.New(s.Pool)
	return impact(ctx, q, p)
}

func (s *Service) Update(ctx context.Context, actorID, id string, in PolicyInput) (Policy, error) {
	p, err := normalize(id, in)
	if err != nil {
		return Policy{}, err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Policy{}, err
	}
	defer tx.Rollback(ctx)
	q := db.New(tx)
	if err = s.Auth.LockActor(ctx, q, actorID); err != nil {
		return Policy{}, err
	}
	if err = validateWorlds(ctx, q, p); err != nil {
		return Policy{}, err
	}
	previous, _, err := loadPolicy(ctx, q, id)
	if err != nil {
		return Policy{}, err
	}
	actor, _ := util.ParseUUID(actorID)
	row, err := q.PutGamePolicy(ctx, db.PutGamePolicyParams{GameID: id, Scope: p.Scope, DefaultVisible: p.DefaultVisible, ExpectedRevision: int32(in.ExpectedRevision), UpdatedBy: actor})
	if errors.Is(err, pgx.ErrNoRows) {
		return Policy{}, ErrConflict
	}
	if err != nil {
		return Policy{}, err
	}
	if err = q.DeleteGameWorldOverrides(ctx, id); err != nil {
		return Policy{}, err
	}
	for _, o := range p.Overrides {
		wid, _ := util.ParseUUID(o.WorkspaceID)
		if err = q.InsertGameWorldOverride(ctx, db.InsertGameWorldOverrideParams{GameID: id, WorkspaceID: wid, Access: o.Access, Visibility: o.Visibility}); err != nil {
			return Policy{}, err
		}
	}
	p.Revision, p.UpdatedBy, p.UpdatedAt = int(row.Revision), actorID, &row.UpdatedAt.Time
	before, _ := json.Marshal(previous)
	after, _ := json.Marshal(p)
	if err = q.InsertGamePolicyAudit(ctx, db.InsertGamePolicyAuditParams{GameID: id, Revision: row.Revision, ActorID: actor, Previous: before, Current: after}); err != nil {
		return Policy{}, err
	}
	return p, tx.Commit(ctx)
}

func (s *Service) Effective(ctx context.Context, workspaceID, gameID string) (Effective, error) {
	if !known(gameID) {
		return Effective{}, ErrNotFound
	}
	wid, err := util.ParseUUID(workspaceID)
	if err != nil {
		return Effective{}, ErrInvalid
	}
	r, err := db.New(s.Pool).GetEffectiveGamePolicy(ctx, db.GetEffectiveGamePolicyParams{GameID: gameID, WorkspaceID: wid})
	if err != nil {
		return Effective{}, err
	}
	return Resolve(gameID, r.Scope, r.DefaultVisible, r.Access, r.Visibility), nil
}

type WorldPage struct {
	Items      []World `json:"items"`
	NextCursor string  `json:"nextCursor,omitempty"`
}

func (s *Service) Worlds(ctx context.Context, search, cursor string) (WorldPage, error) {
	out := WorldPage{Items: []World{}}
	if len(search) > 200 {
		return out, ErrInvalid
	}
	var after pgtype.UUID
	var err error
	if cursor != "" {
		after, err = util.ParseUUID(cursor)
		if err != nil {
			return out, ErrInvalid
		}
	}
	rows, err := db.New(s.Pool).SearchGameAdminWorlds(ctx, db.SearchGameAdminWorldsParams{Search: search, AfterID: after})
	if err != nil {
		return out, err
	}
	if len(rows) > 25 {
		rows = rows[:25]
		out.NextCursor = util.UUIDToString(rows[24].ID)
	}
	for _, w := range rows {
		out.Items = append(out.Items, World{util.UUIDToString(w.ID), w.Name, w.Slug})
	}
	return out, nil
}

type Audit struct {
	Revision   int                `json:"revision"`
	ActorID    string             `json:"actorId"`
	ActorName  string             `json:"actorName"`
	ActorEmail string             `json:"actorEmail"`
	Previous   json.RawMessage    `json:"previous"`
	Current    json.RawMessage    `json:"current"`
	OccurredAt pgtype.Timestamptz `json:"occurredAt"`
}
type AuditPage struct {
	Items      []Audit `json:"items"`
	NextCursor string  `json:"nextCursor,omitempty"`
}

func (s *Service) Activity(ctx context.Context, id, cursor string) (AuditPage, error) {
	out := AuditPage{Items: []Audit{}}
	if !known(id) {
		return out, ErrNotFound
	}
	var before int64
	var err error
	if cursor != "" {
		before, err = strconv.ParseInt(cursor, 10, 32)
		if err != nil || before < 1 {
			return out, ErrInvalid
		}
	}
	rows, err := db.New(s.Pool).ListGamePolicyAudit(ctx, db.ListGamePolicyAuditParams{GameID: id, BeforeRevision: int32(before)})
	if err != nil {
		return out, err
	}
	if len(rows) > 25 {
		rows = rows[:25]
		out.NextCursor = strconv.Itoa(int(rows[24].Revision))
	}
	for _, row := range rows {
		out.Items = append(out.Items, Audit{int(row.Revision), util.UUIDToString(row.ActorID), row.ActorName, row.ActorEmail, row.Previous, row.Current, row.OccurredAt})
	}
	return out, nil
}
