package fish

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/url"
	"strings"
	"time"
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
func storedError(e error) error {
	if errors.Is(e, pgx.ErrNoRows) {
		return problem("not_found", 404)
	}
	return e
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
	ID              string `json:"id"`
	WorkspaceID     string `json:"workspaceId"`
	OwnerID         string `json:"ownerId"`
	Revision        int    `json:"revision"`
	ContentHash     string `json:"contentHash"`
	CompilerVersion int    `json:"compilerVersion"`
	RulesVersion    int    `json:"rulesVersion"`
	Draft           Draft  `json:"draft"`
	Origin          string `json:"origin"`
	Archived        bool   `json:"archived"`
	CreatedAt       string `json:"createdAt"`
}
type Resident struct {
	ID       string    `json:"id"`
	OceanID  string    `json:"oceanId"`
	Revision int       `json:"revision"`
	Seed     int       `json:"seed"`
	Fish     Character `json:"fish"`
}
type Ocean struct {
	ID          string     `json:"id"`
	WorkspaceID string     `json:"workspaceId"`
	OwnerID     string     `json:"ownerId"`
	Visibility  string     `json:"visibility"`
	Revision    int        `json:"revision"`
	Capacity    int        `json:"capacity"`
	Residents   []Resident `json:"residents"`
}
type SaveInput struct {
	RequestID        string `json:"requestId"`
	Draft            Draft  `json:"draft"`
	FishID           string `json:"fishId,omitempty"`
	ExpectedRevision int    `json:"expectedRevision,omitempty"`
	Origin           string `json:"-"`
}
type ReleaseInput struct {
	RequestID   string `json:"requestId"`
	OceanID     string `json:"oceanId"`
	FishID      string `json:"fishId"`
	Revision    int    `json:"revision"`
	ContentHash string `json:"contentHash"`
}
type ApplyInput struct {
	ReleaseInput
	ResidentID               string `json:"residentId"`
	ExpectedResidentRevision int    `json:"expectedResidentRevision"`
}
type RecallInput struct {
	RequestID                string `json:"requestId"`
	ResidentID               string `json:"residentId"`
	ExpectedResidentRevision int    `json:"expectedResidentRevision"`
}
type ReleaseResult struct {
	Resident Resident `json:"resident"`
	OceanURL string   `json:"oceanUrl"`
}
type Service struct {
	Pool     *pgxpool.Pool
	AppURL   string
	OnChange func(workspaceID, userID string)
}

func inputUUID(s string) (pgtype.UUID, error) {
	v, e := util.ParseUUID(s)
	if e != nil {
		return v, problem("invalid_request", 400)
	}
	return v, nil
}
func scope(a Actor) (pgtype.UUID, pgtype.UUID, error) {
	w, e := inputUUID(a.WorkspaceID)
	if e != nil {
		return w, pgtype.UUID{}, problem("unauthenticated", 401)
	}
	u, e := inputUUID(a.UserID)
	return w, u, e
}
func readCharacter(ctx context.Context, q *db.Queries, w, u pgtype.UUID, id string, revision int) (Character, error) {
	var c Character
	fid, e := inputUUID(id)
	if e != nil {
		return c, e
	}
	if revision < 0 || revision > Rules.MaxRevisions {
		return c, problem("invalid_request", 400)
	}
	if revision > 0 {
		raw, e := q.GetFishRevision(ctx, db.GetFishRevisionParams{WorkspaceID: w, UserID: u, FishID: fid, Revision: int32(revision)})
		if e != nil {
			return c, storedError(e)
		}
		e = json.Unmarshal(raw, &c)
		return c, e
	}
	row, e := q.GetFish(ctx, db.GetFishParams{WorkspaceID: w, UserID: u, ID: fid})
	if e != nil {
		return c, storedError(e)
	}
	e = json.Unmarshal(row.Payload, &c)
	c.Archived = row.Archived
	return c, e
}
func (s *Service) List(ctx context.Context, a Actor) ([]Character, error) {
	w, u, e := scope(a)
	if e != nil {
		return nil, e
	}
	rows, e := db.New(s.Pool).ListFish(ctx, db.ListFishParams{WorkspaceID: w, UserID: u})
	if e != nil {
		return nil, e
	}
	out := []Character{}
	for _, row := range rows {
		var c Character
		if e = json.Unmarshal(row.Payload, &c); e != nil {
			return nil, e
		}
		c.Archived = row.Archived
		out = append(out, c)
	}
	return out, nil
}
func (s *Service) Get(ctx context.Context, a Actor, id string, revision int) (Character, error) {
	w, u, e := scope(a)
	if e != nil {
		return Character{}, e
	}
	return readCharacter(ctx, db.New(s.Pool), w, u, id, revision)
}

// All writes share workspace deletion's fence and serialize only this member's aquarium.
func (s *Service) write(ctx context.Context, a Actor, op, rid string, input any, build func(*db.Queries, pgtype.UUID, pgtype.UUID) (any, error)) (json.RawMessage, error) {
	w, u, e := scope(a)
	if e != nil {
		return nil, e
	}
	request, e := inputUUID(rid)
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
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(19645,hashtext($1))`, a.WorkspaceID+":"+a.UserID); e != nil {
		return nil, e
	}
	if e = q.PruneFishRequests(ctx, db.PruneFishRequestsParams{WorkspaceID: w, UserID: u}); e != nil {
		return nil, e
	}
	hash := digest(input)
	receipt, e := q.GetFishRequest(ctx, db.GetFishRequestParams{WorkspaceID: w, UserID: u, Operation: op, RequestID: request})
	if e == nil {
		if receipt.BodyHash != hash {
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
	if e = q.InsertFishRequest(ctx, db.InsertFishRequestParams{WorkspaceID: w, UserID: u, Operation: op, RequestID: request, BodyHash: hash, Response: raw}); e != nil {
		return nil, e
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	if s.OnChange != nil {
		s.OnChange(a.WorkspaceID, a.UserID)
	}
	return raw, nil
}
func (s *Service) Save(ctx context.Context, a Actor, in SaveInput) (Character, error) {
	var out Character
	v := Validate(in.Draft)
	if !v.Valid {
		return out, &Problem{Code: "fish_invalid", Message: "The fish description is invalid.", Issues: v.Errors, Status: 422}
	}
	if (in.FishID == "") != (in.ExpectedRevision == 0) || in.ExpectedRevision < 0 || in.ExpectedRevision >= Rules.MaxRevisions {
		return out, problem("invalid_request", 400)
	}
	raw, e := s.write(ctx, a, "save", in.RequestID, in, func(q *db.Queries, w, u pgtype.UUID) (any, error) {
		id, revision := in.FishID, 1
		if id == "" {
			count, e := q.CountFish(ctx, db.CountFishParams{WorkspaceID: w, UserID: u})
			if e != nil {
				return nil, e
			}
			if count >= int64(Rules.MaxCharacters) {
				return nil, problem("capacity_reached", 429)
			}
			id = uuid.NewString()
		} else {
			current, e := readCharacter(ctx, q, w, u, id, 0)
			if e != nil {
				return nil, e
			}
			if current.Revision != in.ExpectedRevision {
				return nil, problem("revision_conflict", 409)
			}
			if current.Archived {
				return nil, problem("fish_archived", 409)
			}
			revision = current.Revision + 1
		}
		origin := in.Origin
		if origin != "mcp" {
			origin = "manual"
		}
		c := Character{ID: id, WorkspaceID: a.WorkspaceID, OwnerID: a.UserID, Revision: revision, CompilerVersion: 1, RulesVersion: 1, Draft: in.Draft, Origin: origin, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
		c.ContentHash = digest(struct {
			Draft    Draft `json:"draft"`
			Compiler int   `json:"compilerVersion"`
			Rules    int   `json:"rulesVersion"`
		}{c.Draft, 1, 1})
		payload, _ := json.Marshal(c)
		fid, err := inputUUID(id)
		if err != nil {
			return nil, err
		}
		if e := q.PutFish(ctx, db.PutFishParams{ID: fid, WorkspaceID: w, UserID: u, Revision: int32(revision), Payload: payload}); e != nil {
			return nil, e
		}
		if e := q.InsertFishRevision(ctx, db.InsertFishRevisionParams{FishID: fid, WorkspaceID: w, UserID: u, Revision: int32(revision), Payload: payload}); e != nil {
			return nil, e
		}
		return c, nil
	})
	if e == nil {
		e = json.Unmarshal(raw, &out)
	}
	return out, e
}
func readOcean(ctx context.Context, q *db.Queries, w pgtype.UUID, row db.FishOcean) (Ocean, error) {
	out := Ocean{ID: util.UUIDToString(row.ID), WorkspaceID: util.UUIDToString(row.WorkspaceID), OwnerID: util.UUIDToString(row.UserID), Visibility: row.Visibility, Revision: int(row.Revision), Capacity: Rules.Capacity, Residents: []Resident{}}
	rows, e := q.ListFishResidents(ctx, db.ListFishResidentsParams{WorkspaceID: w, OceanID: row.ID})
	if e != nil {
		return out, e
	}
	for _, raw := range rows {
		var r Resident
		if e = json.Unmarshal(raw, &r); e != nil {
			return out, e
		}
		out.Residents = append(out.Residents, r)
	}
	return out, nil
}
func (s *Service) Ocean(ctx context.Context, a Actor, id string) (Ocean, error) {
	w, u, e := scope(a)
	if e != nil {
		return Ocean{}, e
	}
	q := db.New(s.Pool)
	var row db.FishOcean
	if id == "" {
		row, e = q.GetMyFishOcean(ctx, db.GetMyFishOceanParams{WorkspaceID: w, UserID: u})
		if errors.Is(e, pgx.ErrNoRows) {
			return Ocean{WorkspaceID: a.WorkspaceID, OwnerID: a.UserID, Visibility: "private", Capacity: Rules.Capacity, Residents: []Resident{}}, nil
		}
	} else {
		oid, err := inputUUID(id)
		if err != nil {
			return Ocean{}, err
		}
		row, e = q.GetFishOcean(ctx, db.GetFishOceanParams{WorkspaceID: w, ID: oid})
	}
	if e != nil {
		return Ocean{}, storedError(e)
	}
	if row.UserID != u {
		if row.Visibility != "world" {
			return Ocean{}, problem("not_found", 404)
		}
		var member bool
		if e = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM member WHERE workspace_id=$1 AND user_id=$2)`, w, row.UserID).Scan(&member); e != nil {
			return Ocean{}, e
		}
		if !member {
			return Ocean{}, problem("not_found", 404)
		}
	}
	return readOcean(ctx, q, w, row)
}
func (s *Service) EnsureOcean(ctx context.Context, a Actor, rid string) (Ocean, error) {
	var out Ocean
	in := struct {
		RequestID string `json:"requestId"`
	}{rid}
	raw, e := s.write(ctx, a, "create_ocean", rid, in, func(q *db.Queries, w, u pgtype.UUID) (any, error) {
		id, err := inputUUID(uuid.NewString())
		if err != nil {
			return nil, err
		}
		if e := q.EnsureFishOcean(ctx, db.EnsureFishOceanParams{ID: id, WorkspaceID: w, UserID: u}); e != nil {
			return nil, e
		}
		row, e := q.GetMyFishOcean(ctx, db.GetMyFishOceanParams{WorkspaceID: w, UserID: u})
		if e != nil {
			return nil, e
		}
		return readOcean(ctx, q, w, row)
	})
	if e == nil {
		e = json.Unmarshal(raw, &out)
	}
	return out, e
}
func (s *Service) release(ctx context.Context, a Actor, in ReleaseInput, residentID string, expected int) (ReleaseResult, error) {
	var out ReleaseResult
	if in.Revision < 1 || in.Revision > Rules.MaxRevisions {
		return out, problem("invalid_request", 400)
	}
	oid, e := inputUUID(in.OceanID)
	if e != nil {
		return out, e
	}
	op := "release"
	if residentID != "" {
		op = "apply"
	}
	intent := struct {
		ReleaseInput
		ResidentID string `json:"residentId"`
		Expected   int    `json:"expectedResidentRevision"`
	}{in, residentID, expected}
	raw, e := s.write(ctx, a, op, in.RequestID, intent, func(q *db.Queries, w, u pgtype.UUID) (any, error) {
		o, e := q.GetFishOcean(ctx, db.GetFishOceanParams{WorkspaceID: w, ID: oid})
		if e != nil || o.UserID != u {
			return nil, problem("not_found", 404)
		}
		current, e := readCharacter(ctx, q, w, u, in.FishID, 0)
		if e != nil {
			return nil, e
		}
		if current.Archived {
			return nil, problem("fish_archived", 409)
		}
		c, e := readCharacter(ctx, q, w, u, in.FishID, in.Revision)
		if e != nil {
			return nil, e
		}
		if c.CompilerVersion != 1 || c.RulesVersion != 1 || !Validate(c.Draft).Valid {
			return nil, problem("fish_incompatible", 409)
		}
		if c.ContentHash != in.ContentHash {
			return nil, problem("fish_hash_mismatch", 409)
		}
		fid, err := inputUUID(c.ID)
		if err != nil {
			return nil, err
		}
		old, e := q.FindFishResident(ctx, db.FindFishResidentParams{WorkspaceID: w, OceanID: oid, FishID: fid})
		exists := e == nil
		if e != nil && !errors.Is(e, pgx.ErrNoRows) {
			return nil, e
		}
		seedBytes := uuid.New()
		id, revision, seed := uuid.NewString(), 1, int(binary.BigEndian.Uint32(seedBytes[:4])&0x7fffffff)
		if exists {
			id = util.UUIDToString(old.ID)
			revision = int(old.Revision) + 1
			var previous Resident
			if e = json.Unmarshal(old.Payload, &previous); e != nil {
				return nil, e
			}
			seed = previous.Seed
		}
		if op == "apply" {
			if !exists || !old.Active || id != residentID {
				return nil, problem("not_found", 404)
			}
			if int(old.Revision) != expected {
				return nil, problem("resident_revision_conflict", 409)
			}
		} else {
			if exists && old.Active {
				return nil, problem("already_released", 409)
			}
			rows, e := q.ListFishResidents(ctx, db.ListFishResidentsParams{WorkspaceID: w, OceanID: oid})
			if e != nil {
				return nil, e
			}
			if len(rows) >= Rules.Capacity {
				return nil, problem("capacity_reached", 429)
			}
		}
		if revision > 10000 {
			return nil, problem("revision_limit", 409)
		}
		resident := Resident{ID: id, OceanID: in.OceanID, Revision: revision, Seed: seed, Fish: c}
		payload, _ := json.Marshal(resident)
		rID, err := inputUUID(id)
		if err != nil {
			return nil, err
		}
		if e = q.PutFishResident(ctx, db.PutFishResidentParams{ID: rID, WorkspaceID: w, UserID: u, OceanID: oid, FishID: fid, Revision: int32(revision), Payload: payload}); e != nil {
			return nil, e
		}
		if e = q.UpdateFishOcean(ctx, db.UpdateFishOceanParams{WorkspaceID: w, ID: oid, Visibility: o.Visibility}); e != nil {
			return nil, e
		}
		ws, e := q.GetWorkspace(ctx, w)
		if e != nil {
			return nil, e
		}
		path := "/" + url.PathEscape(ws.Slug) + "/fish?ocean=" + url.QueryEscape(in.OceanID) + "&resident=" + url.QueryEscape(id)
		return ReleaseResult{Resident: resident, OceanURL: strings.TrimRight(s.AppURL, "/") + path}, nil
	})
	if e == nil {
		e = json.Unmarshal(raw, &out)
	}
	return out, e
}
func (s *Service) Release(ctx context.Context, a Actor, in ReleaseInput) (ReleaseResult, error) {
	return s.release(ctx, a, in, "", 0)
}
func (s *Service) Apply(ctx context.Context, a Actor, in ApplyInput) (ReleaseResult, error) {
	if in.ResidentID == "" || in.ExpectedResidentRevision < 1 {
		return ReleaseResult{}, problem("invalid_request", 400)
	}
	return s.release(ctx, a, in.ReleaseInput, in.ResidentID, in.ExpectedResidentRevision)
}
func (s *Service) Recall(ctx context.Context, a Actor, in RecallInput) (json.RawMessage, error) {
	id, e := inputUUID(in.ResidentID)
	if e != nil {
		return nil, e
	}
	return s.write(ctx, a, "recall", in.RequestID, in, func(q *db.Queries, w, u pgtype.UUID) (any, error) {
		row, e := q.GetFishResident(ctx, db.GetFishResidentParams{WorkspaceID: w, UserID: u, ID: id})
		if e != nil {
			return nil, storedError(e)
		}
		if !row.Active || int(row.Revision) != in.ExpectedResidentRevision {
			return nil, problem("resident_revision_conflict", 409)
		}
		if e = q.RecallFishResident(ctx, db.RecallFishResidentParams{WorkspaceID: w, UserID: u, ID: id}); e != nil {
			return nil, e
		}
		o, e := q.GetFishOcean(ctx, db.GetFishOceanParams{WorkspaceID: w, ID: row.OceanID})
		if e != nil {
			return nil, e
		}
		if e = q.UpdateFishOcean(ctx, db.UpdateFishOceanParams{WorkspaceID: w, ID: row.OceanID, Visibility: o.Visibility}); e != nil {
			return nil, e
		}
		return map[string]any{"recalled": true, "residentId": in.ResidentID}, nil
	})
}
func (s *Service) Settings(ctx context.Context, a Actor, rid, id, visibility string, expected int) (json.RawMessage, error) {
	if visibility != "private" && visibility != "world" {
		return nil, problem("invalid_request", 400)
	}
	oid, e := inputUUID(id)
	if e != nil {
		return nil, e
	}
	in := struct {
		ID, Visibility string
		Expected       int
	}{id, visibility, expected}
	return s.write(ctx, a, "settings", rid, in, func(q *db.Queries, w, u pgtype.UUID) (any, error) {
		row, e := q.GetFishOcean(ctx, db.GetFishOceanParams{WorkspaceID: w, ID: oid})
		if e != nil || row.UserID != u {
			return nil, problem("not_found", 404)
		}
		if int(row.Revision) != expected {
			return nil, problem("revision_conflict", 409)
		}
		if e = q.UpdateFishOcean(ctx, db.UpdateFishOceanParams{WorkspaceID: w, ID: oid, Visibility: visibility}); e != nil {
			return nil, e
		}
		row.Visibility = visibility
		row.Revision++
		return readOcean(ctx, q, w, row)
	})
}
func (s *Service) Archive(ctx context.Context, a Actor, rid, id string, archived bool) (json.RawMessage, error) {
	fid, e := inputUUID(id)
	if e != nil {
		return nil, e
	}
	in := struct {
		ID       string
		Archived bool
	}{id, archived}
	return s.write(ctx, a, "archive", rid, in, func(q *db.Queries, w, u pgtype.UUID) (any, error) {
		c, e := readCharacter(ctx, q, w, u, id, 0)
		if e != nil {
			return nil, e
		}
		if e = q.SetFishArchived(ctx, db.SetFishArchivedParams{WorkspaceID: w, UserID: u, ID: fid, Archived: archived}); e != nil {
			return nil, e
		}
		c.Archived = archived
		return c, nil
	})
}
