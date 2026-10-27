package tanks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Problem struct {
	Code    string  `json:"code"`
	Message string  `json:"message"`
	Issues  []Issue `json:"issues,omitempty"`
	Status  int     `json:"-"`
}

func (p *Problem) Error() string { return p.Code }
func problem(code string, status int) *Problem {
	return &Problem{Code: code, Message: code, Status: status}
}

type Actor struct {
	WorkspaceID string
	UserID      string
}
type actorKey struct{}

func WithActor(ctx context.Context, a Actor) context.Context {
	return context.WithValue(ctx, actorKey{}, a)
}
func actorFromContext(ctx context.Context) (Actor, bool) {
	a, ok := ctx.Value(actorKey{}).(Actor)
	return a, ok && a.WorkspaceID != "" && a.UserID != ""
}

type Character struct {
	ID              string    `json:"id"`
	Revision        int       `json:"revision"`
	WorkspaceID     string    `json:"workspaceId"`
	OwnerID         string    `json:"ownerId"`
	RulesVersion    int       `json:"rulesVersion"`
	CompilerVersion int       `json:"compilerVersion"`
	ContentHash     string    `json:"contentHash"`
	Draft           Draft     `json:"draft"`
	Blueprint       Blueprint `json:"blueprint"`
	Cost            int       `json:"cost"`
	Origin          string    `json:"origin"`
	CreatedAt       string    `json:"createdAt"`
}
type SaveInput struct {
	RequestID        string `json:"requestId"`
	Draft            Draft  `json:"draft"`
	CharacterID      string `json:"characterId,omitempty"`
	ExpectedRevision int    `json:"expectedRevision,omitempty"`
	// Origin is set by the serving endpoint, never by the client.
	Origin string `json:"-"`
}

const (
	OriginManual = "manual"
	OriginMCP    = "mcp"
)

func normalizeCharacter(c *Character) {
	if c.Origin != OriginMCP {
		c.Origin = OriginManual
	}
}

type SessionInput struct {
	RequestID   string `json:"requestId"`
	CharacterID string `json:"characterId"`
	Revision    int    `json:"revision"`
	ContentHash string `json:"contentHash"`
	MapID       string `json:"mapId"`
	Mode        string `json:"mode,omitempty"`
}
type Session struct {
	ID           string    `json:"id"`
	WorkspaceID  string    `json:"workspaceId"`
	OwnerID      string    `json:"ownerId"`
	RulesVersion int       `json:"rulesVersion"`
	MapID        string    `json:"mapId"`
	Mode         string    `json:"mode"`
	MapVersion   int       `json:"mapVersion"`
	LevelID      int       `json:"levelId"`
	Character    Character `json:"character"`
	CreatedAt    string    `json:"createdAt"`
	ExpiresAt    string    `json:"expiresAt"`
	PlayPath     string    `json:"playPath"`
	PlayURL      string    `json:"playUrl"`
}
type Service struct {
	Pool   *pgxpool.Pool
	AppURL string
}

func scope(a Actor) (pgtype.UUID, pgtype.UUID, error) {
	w, e := util.ParseUUID(a.WorkspaceID)
	if e != nil {
		return w, pgtype.UUID{}, problem("unauthenticated", 401)
	}
	u, e := util.ParseUUID(a.UserID)
	if e != nil {
		return w, u, problem("unauthenticated", 401)
	}
	return w, u, nil
}
func inputUUID(s string) (pgtype.UUID, error) {
	v, e := util.ParseUUID(s)
	if e != nil {
		return v, problem("invalid_request", 400)
	}
	return v, nil
}
func storedError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return problem("not_found", 404)
	}
	return err
}

func (s *Service) List(ctx context.Context, a Actor, mine bool) ([]Character, error) {
	w, _, e := scope(a)
	if e != nil {
		return nil, e
	}
	rows, e := db.New(s.Pool).ListTankCharacters(ctx, w)
	if e != nil {
		return nil, e
	}
	out := make([]Character, 0, len(rows))
	for _, raw := range rows {
		var c Character
		if e = json.Unmarshal(raw, &c); e != nil {
			return nil, e
		}
		normalizeCharacter(&c)
		if mine && c.OwnerID != a.UserID {
			continue
		}
		out = append(out, c)
	}
	return out, nil
}
func readCharacter(ctx context.Context, q *db.Queries, w pgtype.UUID, id string, revision int) (Character, error) {
	var c Character
	i, e := inputUUID(id)
	if e != nil {
		return c, e
	}
	var raw []byte
	if revision > 0 {
		raw, e = q.GetTankCharacterRevision(ctx, db.GetTankCharacterRevisionParams{WorkspaceID: w, CharacterID: i, Revision: int32(revision)})
	} else {
		var row db.TankCharacter
		row, e = q.GetTankCharacter(ctx, db.GetTankCharacterParams{WorkspaceID: w, ID: i})
		raw = row.Payload
	}
	if e != nil {
		return c, storedError(e)
	}
	e = json.Unmarshal(raw, &c)
	if e == nil {
		normalizeCharacter(&c)
	}
	return c, e
}
func (s *Service) GetCharacter(ctx context.Context, a Actor, id string, revision int) (Character, error) {
	w, _, e := scope(a)
	if e != nil {
		return Character{}, e
	}
	if revision < 0 || revision > 50 {
		return Character{}, problem("invalid_request", 400)
	}
	return readCharacter(ctx, db.New(s.Pool), w, id, revision)
}

// The workspace fence coordinates with deletion; the advisory lock makes receipts
// and capacity checks atomic across processes. Membership is rechecked in the tx.
func (s *Service) write(ctx context.Context, a Actor, operation, requestID string, input any, build func(*db.Queries, pgtype.UUID, pgtype.UUID) (any, error)) (json.RawMessage, error) {
	w, u, e := scope(a)
	if e != nil {
		return nil, e
	}
	rid, e := inputUUID(requestID)
	if e != nil {
		return nil, e
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	q := db.New(tx)
	if _, e = q.LockWorkspaceForChatSessionCreate(ctx, w); e != nil {
		return nil, storedError(e)
	}
	var member string
	if e = tx.QueryRow(ctx, `SELECT id::text FROM member WHERE workspace_id=$1 AND user_id=$2 FOR SHARE`, w, u).Scan(&member); e != nil {
		return nil, problem("workspace_forbidden", 403)
	}
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(19644,hashtext($1))`, a.WorkspaceID); e != nil {
		return nil, e
	}
	if e = q.PruneTankRequests(ctx, w); e != nil {
		return nil, e
	}
	if e = q.PruneTankSessions(ctx, w); e != nil {
		return nil, e
	}
	fingerprint := digest(input)
	receipt, e := q.GetTankRequest(ctx, db.GetTankRequestParams{WorkspaceID: w, UserID: u, Operation: operation, RequestID: rid})
	if e == nil {
		if receipt.BodyHash != fingerprint {
			return nil, problem("idempotency_key_reused", 409)
		}
		return receipt.Response, nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return nil, e
	}
	result, e := build(q, w, u)
	if e != nil {
		return nil, e
	}
	raw, e := json.Marshal(result)
	if e != nil {
		return nil, e
	}
	if e = q.InsertTankRequest(ctx, db.InsertTankRequestParams{WorkspaceID: w, UserID: u, Operation: operation, RequestID: rid, BodyHash: fingerprint, Response: raw}); e != nil {
		return nil, e
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	return raw, nil
}

func (s *Service) Save(ctx context.Context, a Actor, in SaveInput) (Character, error) {
	var out Character
	if in.Origin != OriginMCP {
		in.Origin = OriginManual
	}
	validation := Validate(in.Draft, "custom")
	if !validation.Valid {
		return out, &Problem{Code: "character_invalid", Message: "The tank character is invalid.", Issues: validation.Errors, Status: 422}
	}
	if (in.CharacterID == "") != (in.ExpectedRevision == 0) || in.ExpectedRevision < 0 || in.ExpectedRevision >= 50 {
		return out, problem("invalid_request", 400)
	}
	if in.CharacterID != "" {
		if _, e := inputUUID(in.CharacterID); e != nil {
			return out, e
		}
	}
	raw, e := s.write(ctx, a, "save_character", in.RequestID, in, func(q *db.Queries, w, u pgtype.UUID) (any, error) {
		id, revision := in.CharacterID, 1
		if id == "" {
			count, e := q.CountTankCharacters(ctx, w)
			if e != nil {
				return nil, e
			}
			if count >= 128 {
				return nil, problem("capacity_reached", 429)
			}
			id = uuid.NewString()
		} else {
			current, e := readCharacter(ctx, q, w, id, 0)
			if e != nil {
				return nil, e
			}
			if current.OwnerID != a.UserID {
				return nil, problem("not_found", 404)
			}
			id = current.ID
			if current.Revision != in.ExpectedRevision {
				return nil, problem("revision_conflict", 409)
			}
			revision = current.Revision + 1
		}
		v := Validate(in.Draft, fmt.Sprintf("%s@%d", id, revision))
		c := Character{ID: id, Revision: revision, WorkspaceID: a.WorkspaceID, OwnerID: a.UserID, RulesVersion: Rules.RulesVersion, CompilerVersion: Rules.CompilerVersion, Draft: in.Draft, Blueprint: *v.Blueprint, Cost: v.Cost, Origin: in.Origin, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
		c.ContentHash = digest(struct {
			Draft     Draft     `json:"draft"`
			Blueprint Blueprint `json:"blueprint"`
			Rules     int       `json:"rulesVersion"`
			Compiler  int       `json:"compilerVersion"`
		}{c.Draft, c.Blueprint, c.RulesVersion, c.CompilerVersion})
		payload, _ := json.Marshal(c)
		cid, e := inputUUID(id)
		if e != nil {
			return nil, e
		}
		if e = q.PutTankCharacter(ctx, db.PutTankCharacterParams{ID: cid, WorkspaceID: w, UserID: u, Revision: int32(revision), Payload: payload}); e != nil {
			return nil, e
		}
		if e = q.InsertTankCharacterRevision(ctx, db.InsertTankCharacterRevisionParams{CharacterID: cid, Revision: int32(revision), WorkspaceID: w, Payload: payload}); e != nil {
			return nil, e
		}
		return c, nil
	})
	if e != nil {
		return out, e
	}
	e = json.Unmarshal(raw, &out)
	return out, e
}

func (s *Service) Compatibility(ctx context.Context, a Actor, in SessionInput) (Character, Map, error) {
	w, _, e := scope(a)
	if e != nil {
		return Character{}, Map{}, e
	}
	return compatibility(ctx, db.New(s.Pool), w, in)
}
func compatibility(ctx context.Context, q *db.Queries, w pgtype.UUID, in SessionInput) (Character, Map, error) {
	if in.Mode != "" && in.Mode != "campaign" && in.Mode != "blitz" && in.Mode != "survival" {
		return Character{}, Map{}, problem("character_incompatible", 422)
	}
	var m Map
	for _, candidate := range Rules.Maps {
		if candidate.ID == in.MapID {
			m = candidate
		}
	}
	if m.ID == "" || in.Revision < 1 || in.Revision > 50 {
		return Character{}, m, problem("character_incompatible", 422)
	}
	c, e := readCharacter(ctx, q, w, in.CharacterID, in.Revision)
	if e != nil {
		return c, m, e
	}
	if c.ContentHash != in.ContentHash {
		return c, m, problem("character_hash_mismatch", 409)
	}
	if c.RulesVersion != Rules.RulesVersion || c.CompilerVersion != Rules.CompilerVersion || !Validate(c.Draft, c.Blueprint.ID).Valid {
		return c, m, problem("rules_version_unsupported", 422)
	}
	return c, m, nil
}
func (s *Service) CreateSession(ctx context.Context, a Actor, in SessionInput) (Session, error) {
	if in.Mode == "" {
		in.Mode = "campaign"
	}
	var out Session
	base, e := url.Parse(s.AppURL)
	if e != nil || base.Host == "" || (base.Scheme != "http" && base.Scheme != "https") || base.User != nil {
		return out, problem("launch_unavailable", 503)
	}
	if _, e = inputUUID(in.CharacterID); e != nil {
		return out, e
	}
	raw, e := s.write(ctx, a, "create_session", in.RequestID, in, func(q *db.Queries, w, u pgtype.UUID) (any, error) {
		c, m, e := compatibility(ctx, q, w, in)
		if e != nil {
			return nil, e
		}
		count, e := q.CountTankPlaySessions(ctx, db.CountTankPlaySessionsParams{WorkspaceID: w, UserID: u})
		if e != nil {
			return nil, e
		}
		if count >= 100 {
			return nil, problem("capacity_reached", 429)
		}
		workspace, e := q.GetWorkspace(ctx, w)
		if e != nil {
			return nil, storedError(e)
		}
		now := time.Now().UTC()
		expires := now.Add(24 * time.Hour)
		id := uuid.NewString()
		path := "/" + url.PathEscape(workspace.Slug) + "/tanks?session=" + id
		playURL := strings.TrimRight(s.AppURL, "/") + path
		out := Session{ID: id, WorkspaceID: a.WorkspaceID, OwnerID: a.UserID, RulesVersion: Rules.RulesVersion, MapID: m.ID, Mode: in.Mode, MapVersion: m.Version, LevelID: m.LevelID, Character: c, CreatedAt: now.Format(time.RFC3339), ExpiresAt: expires.Format(time.RFC3339), PlayPath: path, PlayURL: playURL}
		payload, _ := json.Marshal(out)
		sid, e := inputUUID(id)
		if e != nil {
			return nil, e
		}
		if e = q.InsertTankPlaySession(ctx, db.InsertTankPlaySessionParams{ID: sid, WorkspaceID: w, UserID: u, Payload: payload, ExpiresAt: pgtype.Timestamptz{Time: expires, Valid: true}}); e != nil {
			return nil, e
		}
		return out, nil
	})
	if e != nil {
		return out, e
	}
	e = json.Unmarshal(raw, &out)
	if e == nil {
		normalizeCharacter(&out.Character)
	}
	return out, e
}
func (s *Service) GetSession(ctx context.Context, a Actor, id string) (Session, error) {
	var out Session
	w, u, e := scope(a)
	if e != nil {
		return out, e
	}
	sid, e := inputUUID(id)
	if e != nil {
		return out, e
	}
	raw, e := db.New(s.Pool).GetTankPlaySession(ctx, db.GetTankPlaySessionParams{WorkspaceID: w, UserID: u, ID: sid})
	if e != nil {
		return out, storedError(e)
	}
	if e = json.Unmarshal(raw, &out); e != nil {
		return out, e
	}
	normalizeCharacter(&out.Character)
	expires, e := time.Parse(time.RFC3339, out.ExpiresAt)
	if e != nil {
		return out, e
	}
	if !expires.After(time.Now()) {
		return out, problem("session_expired", 410)
	}
	return out, nil
}
