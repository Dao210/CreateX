package ctf

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/auro-ai/auro/server/internal/gameadmin"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"strings"
	"time"
	"unicode/utf16"
)

type Actor struct{ WorkspaceID, UserID string }
type actorKey struct{}

func WithActor(ctx context.Context, a Actor) context.Context {
	return context.WithValue(ctx, actorKey{}, a)
}

type Problem struct {
	Code   string
	Status int
}

func (p *Problem) Error() string            { return p.Code }
func problem(code string, status int) error { return &Problem{code, status} }

type Strategy struct {
	ID          string          `json:"id"`
	WorkspaceID string          `json:"workspaceId"`
	OwnerID     string          `json:"ownerId"`
	OwnerName   string          `json:"ownerName"`
	Name        string          `json:"name"`
	Revision    int             `json:"revision"`
	Hash        string          `json:"hash"`
	Strategy    json.RawMessage `json:"strategy,omitempty"`
	Archived    bool            `json:"archived"`
	Published   bool            `json:"published"`
	CreatedAt   string          `json:"createdAt"`
}
type Batch struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspaceId"`
	Status      string `json:"status"`
	CreatedAt   string `json:"createdAt"`
	Total       int    `json:"total"`
	Completed   int    `json:"completed"`
	Error       string `json:"error"`
}
type Result struct {
	Winner string `json:"winner"`
	Method string `json:"method"`
	Text   string `json:"text"`
}
type Match struct {
	Fingerprint string            `json:"fingerprint"`
	ID          string            `json:"id"`
	WorkspaceID string            `json:"workspaceId"`
	BatchID     string            `json:"batchId"`
	Status      string            `json:"status"`
	Red         Strategy          `json:"red"`
	Blue        Strategy          `json:"blue"`
	Seed        int               `json:"seed"`
	Result      *Result           `json:"result"`
	Duration    float64           `json:"duration"`
	Frames      []json.RawMessage `json:"frames"`
	CreatedAt   string            `json:"createdAt"`
	Error       string            `json:"error"`
}
type Outcome struct {
	Result   *Result           `json:"result"`
	Duration float64           `json:"duration"`
	Ticks    int               `json:"ticks"`
	Frames   []json.RawMessage `json:"frames"`
}
type SaveInput struct {
	RequestID        string          `json:"requestId"`
	ID               string          `json:"id"`
	ExpectedRevision int             `json:"expectedRevision"`
	Name             string          `json:"name"`
	Strategy         json.RawMessage `json:"strategy"`
}
type EnrollInput struct {
	RequestID string `json:"requestId"`
	ID        string `json:"id"`
	Revision  int    `json:"revision"`
	Hash      string `json:"hash"`
	Publish   bool   `json:"publish"`
}
type State struct {
	WorkspaceID string          `json:"workspaceId"`
	CanManage   bool            `json:"canManage"`
	Mine        []Strategy      `json:"mine"`
	Library     []Strategy      `json:"library"`
	Entries     []Strategy      `json:"entries"`
	Batches     []Batch         `json:"batches"`
	Matches     []Match         `json:"matches"`
	Leaderboard json.RawMessage `json:"leaderboard"`
}
type Service struct {
	Pool   *pgxpool.Pool
	Engine Engine
}

func encode(v any) []byte { raw, _ := json.Marshal(v); return raw }
func hash(v any) string   { sum := sha256.Sum256(encode(v)); return hex.EncodeToString(sum[:]) }
func id(s string) (pgtype.UUID, error) {
	v, e := util.ParseUUID(s)
	if e != nil {
		return v, problem("invalid_request", 400)
	}
	return v, nil
}
func missing(e error) error {
	if errors.Is(e, pgx.ErrNoRows) {
		return problem("not_found", 404)
	}
	return e
}
func stamp(t pgtype.Timestamptz) string { return t.Time.UTC().Format(time.RFC3339Nano) }
func (s *Service) available(ctx context.Context, w string) error {
	p, e := (&gameadmin.Service{Pool: s.Pool}).Effective(ctx, w, "ctf")
	if e != nil {
		return e
	}
	if !p.Available {
		return problem("game_closed", 403)
	}
	return nil
}
func (s *Service) member(ctx context.Context, q *db.Queries, a Actor) (db.CTFMemberRow, error) {
	w, e := id(a.WorkspaceID)
	if e != nil {
		return db.CTFMemberRow{}, e
	}
	u, e := id(a.UserID)
	if e != nil {
		return db.CTFMemberRow{}, e
	}
	m, e := q.CTFMember(ctx, db.CTFMemberParams{WorkspaceID: w, UserID: u})
	if errors.Is(e, pgx.ErrNoRows) {
		return m, problem("forbidden", 403)
	}
	return m, e
}
func (s *Service) write(ctx context.Context, a Actor, operation, requestID string, input any, fn func(*db.Queries, db.CTFMemberRow) (any, error)) (any, error) {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	q := db.New(tx)
	if e = q.LockCTFWorld(ctx, a.WorkspaceID); e != nil {
		return nil, e
	}
	workspaceID, parseErr := id(a.WorkspaceID)
	if parseErr != nil {
		return nil, parseErr
	}
	if _, e = q.LockCTFWorkspace(ctx, workspaceID); e != nil {
		return nil, missing(e)
	}
	m, e := s.member(ctx, q, a)
	if e != nil {
		return nil, e
	}
	if e = s.available(ctx, a.WorkspaceID); e != nil {
		return nil, e
	}
	w, _ := id(a.WorkspaceID)
	u, _ := id(a.UserID)
	var req pgtype.UUID
	bodyHash := hash(map[string]any{"operation": operation, "input": input})
	if requestID != "" {
		req, e = id(requestID)
		if e != nil {
			return nil, e
		}
		old, err := q.GetCTFRequest(ctx, db.GetCTFRequestParams{WorkspaceID: w, UserID: u, RequestID: req})
		if err == nil {
			if old.BodyHash != bodyHash {
				return nil, problem("idempotency_key_reused", 409)
			}
			return json.RawMessage(old.Response), nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	out, e := fn(q, m)
	if e != nil {
		return nil, e
	}
	if requestID != "" {
		if e = q.InsertCTFRequest(ctx, db.InsertCTFRequestParams{WorkspaceID: w, UserID: u, RequestID: req, BodyHash: bodyHash, Response: encode(out)}); e != nil {
			return nil, e
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	return out, nil
}
func (s *Service) Save(ctx context.Context, a Actor, in SaveInput) (any, error) {
	if in.RequestID == "" || len(in.Strategy) > 256*1024 || len(utf16.Encode([]rune(in.Name))) > 128 || strings.TrimSpace(in.Name) == "" || in.ExpectedRevision < 0 || in.ExpectedRevision >= 128 {
		return nil, problem("invalid_request", 400)
	}
	var validation struct {
		Errors []string `json:"errors"`
	}
	if e := s.Engine.Call(ctx, "validate", map[string]any{"strategy": in.Strategy}, &validation); e != nil {
		return nil, e
	}
	if len(validation.Errors) > 0 {
		return nil, problem("invalid_strategy", 400)
	}
	return s.write(ctx, a, "save", in.RequestID, in, func(q *db.Queries, m db.CTFMemberRow) (any, error) {
		w, _ := id(a.WorkspaceID)
		u, _ := id(a.UserID)
		sid, e := id(in.ID)
		if in.ID == "" {
			sid, _ = id(uuid.NewString())
			if in.ExpectedRevision != 0 {
				return nil, problem("revision_conflict", 409)
			}
		} else {
			if e != nil {
				return nil, e
			}
			old, e := q.GetCTFStrategy(ctx, db.GetCTFStrategyParams{WorkspaceID: w, UserID: u, ID: sid})
			if e != nil {
				return nil, missing(e)
			}
			var c Strategy
			if e = json.Unmarshal(old.Payload, &c); e != nil {
				return nil, e
			}
			if c.Revision != in.ExpectedRevision || old.Archived {
				return nil, problem("revision_conflict", 409)
			}
		}
		if in.ID == "" {
			rows, e := q.ListCTFStrategies(ctx, db.ListCTFStrategiesParams{WorkspaceID: w, UserID: u})
			if e != nil {
				return nil, e
			}
			if len(rows) >= 128 {
				return nil, problem("strategy_limit", 409)
			}
		}
		var normalized any
		if e = json.Unmarshal(in.Strategy, &normalized); e != nil {
			return nil, problem("invalid_strategy", 400)
		}
		c := Strategy{ID: util.UUIDToString(sid), WorkspaceID: a.WorkspaceID, OwnerID: a.UserID, OwnerName: m.Name, Name: strings.TrimSpace(in.Name), Revision: in.ExpectedRevision + 1, Hash: hash(normalized), Strategy: encode(normalized), CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
		if e = q.PutCTFStrategy(ctx, db.PutCTFStrategyParams{ID: sid, WorkspaceID: w, UserID: u, Revision: int32(c.Revision), Payload: encode(c)}); e != nil {
			return nil, e
		}
		if e = q.InsertCTFRevision(ctx, db.InsertCTFRevisionParams{StrategyID: sid, WorkspaceID: w, UserID: u, Revision: int32(c.Revision), Payload: encode(c)}); e != nil {
			return nil, e
		}
		return c, nil
	})
}
func (s *Service) Enroll(ctx context.Context, a Actor, in EnrollInput) (any, error) {
	if !in.Publish || in.RequestID == "" || in.Revision < 1 || in.Revision > 128 {
		return nil, problem("publication_required", 400)
	}
	return s.write(ctx, a, "enroll", in.RequestID, in, func(q *db.Queries, m db.CTFMemberRow) (any, error) {
		w, _ := id(a.WorkspaceID)
		u, _ := id(a.UserID)
		sid, e := id(in.ID)
		if e != nil {
			return nil, e
		}
		row, e := q.GetCTFRevision(ctx, db.GetCTFRevisionParams{WorkspaceID: w, UserID: u, StrategyID: sid, Revision: int32(in.Revision)})
		if e != nil {
			return nil, missing(e)
		}
		current, e := q.GetCTFStrategy(ctx, db.GetCTFStrategyParams{WorkspaceID: w, UserID: u, ID: sid})
		if e != nil {
			return nil, missing(e)
		}
		if current.Archived {
			return nil, problem("archived_strategy", 409)
		}
		var c Strategy
		if e = json.Unmarshal(row.Payload, &c); e != nil {
			return nil, e
		}
		if c.Hash != in.Hash {
			return nil, problem("revision_conflict", 409)
		}
		c.Published = true
		c.OwnerName = m.Name
		entries, e := q.ListCTFEntries(ctx, w)
		if e != nil {
			return nil, e
		}
		found := false
		for _, raw := range entries {
			var entry Strategy
			if e = json.Unmarshal(raw, &entry); e != nil {
				return nil, e
			}
			if entry.OwnerID == a.UserID {
				found = true
			}
		}
		if !found && len(entries) >= 48 {
			return nil, problem("entry_limit", 409)
		}
		if e = q.PublishCTFRevision(ctx, db.PublishCTFRevisionParams{WorkspaceID: w, UserID: u, StrategyID: sid, Revision: int32(in.Revision)}); e != nil {
			return nil, e
		}
		if e = q.PutCTFEntry(ctx, db.PutCTFEntryParams{WorkspaceID: w, UserID: u, Payload: encode(c)}); e != nil {
			return nil, e
		}
		return c, nil
	})
}
func (s *Service) Simple(ctx context.Context, a Actor, operation, sid string, archived bool) (any, error) {
	return s.write(ctx, a, operation, "", nil, func(q *db.Queries, _ db.CTFMemberRow) (any, error) {
		w, _ := id(a.WorkspaceID)
		u, _ := id(a.UserID)
		if operation == "withdraw" {
			if e := q.WithdrawCTFEntry(ctx, db.WithdrawCTFEntryParams{WorkspaceID: w, UserID: u}); e != nil {
				return nil, e
			}
		} else {
			v, e := id(sid)
			if e != nil {
				return nil, e
			}
			if _, e = q.GetCTFStrategy(ctx, db.GetCTFStrategyParams{WorkspaceID: w, UserID: u, ID: v}); e != nil {
				return nil, missing(e)
			}
			if e = q.ArchiveCTFStrategy(ctx, db.ArchiveCTFStrategyParams{WorkspaceID: w, UserID: u, ID: v, Archived: archived}); e != nil {
				return nil, e
			}
		}
		return map[string]bool{"ok": true}, nil
	})
}
func batchView(r db.GetCTFBatchRow) Batch {
	return Batch{ID: util.UUIDToString(r.ID), WorkspaceID: util.UUIDToString(r.WorkspaceID), Status: r.Status, CreatedAt: stamp(r.CreatedAt), Total: int(r.Total), Completed: int(r.Completed), Error: r.Error}
}
func (s *Service) Start(ctx context.Context, a Actor, requestID string) (any, error) {
	if requestID == "" {
		return nil, problem("invalid_request", 400)
	}
	return s.write(ctx, a, "start", requestID, nil, func(q *db.Queries, m db.CTFMemberRow) (any, error) {
		if m.Role != "owner" && m.Role != "admin" {
			return nil, problem("forbidden", 403)
		}
		w, _ := id(a.WorkspaceID)
		u, _ := id(a.UserID)
		batches, e := q.ListCTFBatches(ctx, w)
		if e != nil {
			return nil, e
		}
		for _, b := range batches {
			if b.Status == "running" || b.Status == "paused" {
				return nil, problem("batch_active", 409)
			}
		}
		rows, e := q.ListCTFEntries(ctx, w)
		if e != nil {
			return nil, e
		}
		if len(rows) < 2 || len(rows) > 48 {
			return nil, problem("need_opponents", 409)
		}
		entries := make([]Strategy, 0, len(rows))
		for _, raw := range rows {
			var c Strategy
			if e = json.Unmarshal(raw, &c); e != nil {
				return nil, e
			}
			entries = append(entries, c)
		}
		bid, _ := id(uuid.NewString())

		played, e := q.CTFPlayedPairs(ctx, w)
		if e != nil {
			return nil, e
		}
		seen := map[string]bool{}
		for _, key := range played {
			if key == "" {
				return nil, errors.New("missing_ctf_fingerprint")
			}
			seen[key] = true
		}
		matches := []Match{}
		for i, red := range entries {
			for _, blue := range entries[i+1:] {
				fingerprint := hash(map[string]any{"red": revisionKey(red), "redHash": red.Hash, "blue": revisionKey(blue), "blueHash": blue.Hash, "seed": 12027, "gameVersion": "12-rts-1.0"})
				if seen[fingerprint] {
					continue
				}
				mid := uuid.NewString()
				matches = append(matches, Match{ID: mid, WorkspaceID: a.WorkspaceID, BatchID: util.UUIDToString(bid), Status: "queued", Red: red, Blue: blue, Seed: 12027, Frames: []json.RawMessage{}, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Fingerprint: fingerprint})
			}
		}
		if len(matches) == 0 {
			return nil, problem("no_new_pairs", 409)
		}
		if e = q.InsertCTFBatch(ctx, db.InsertCTFBatchParams{ID: bid, WorkspaceID: w, UserID: u, Total: int32(len(matches))}); e != nil {
			return nil, e
		}
		for _, match := range matches {
			mid, _ := id(match.ID)
			if e = q.InsertCTFMatch(ctx, db.InsertCTFMatchParams{ID: mid, WorkspaceID: w, BatchID: bid, Payload: encode(match)}); e != nil {
				return nil, e
			}
		}

		b, e := q.GetCTFBatch(ctx, db.GetCTFBatchParams{WorkspaceID: w, ID: bid})
		if e != nil {
			return nil, e
		}
		return batchView(b), nil
	})
}
func (s *Service) Control(ctx context.Context, a Actor, batchID, action string) (any, error) {
	return s.write(ctx, a, "control", "", nil, func(q *db.Queries, m db.CTFMemberRow) (any, error) {
		if m.Role != "owner" && m.Role != "admin" {
			return nil, problem("forbidden", 403)
		}
		w, _ := id(a.WorkspaceID)
		bid, e := id(batchID)
		if e != nil {
			return nil, e
		}
		b, e := q.GetCTFBatch(ctx, db.GetCTFBatchParams{WorkspaceID: w, ID: bid})
		if e != nil {
			return nil, missing(e)
		}
		next := ""
		switch {
		case action == "pause" && b.Status == "running":
			next = "paused"
		case action == "resume" && b.Status == "paused":
			next = "running"
		case action == "stop" && (b.Status == "running" || b.Status == "paused"):
			next = "stopped"
		case action == "publish" && (b.Status == "stopped" || b.Status == "completed"):
			if e = s.publish(ctx, q, w, bid); e != nil {
				return nil, e
			}
			return batchView(b), nil
		default:
			return nil, problem("invalid_batch_state", 409)
		}
		if e = q.SetCTFBatchStatus(ctx, db.SetCTFBatchStatusParams{WorkspaceID: w, ID: bid, Status: next}); e != nil {
			return nil, e
		}
		b.Status = next
		return batchView(b), nil
	})
}
func decodeMatch(payload, result []byte, status, err string) (Match, error) {
	var m Match
	if e := json.Unmarshal(payload, &m); e != nil {
		return m, e
	}
	m.Red.Strategy = nil
	m.Blue.Strategy = nil
	m.Status = status
	m.Error = err
	m.Frames = []json.RawMessage{}
	if len(result) > 0 {
		var out Outcome
		if e := json.Unmarshal(result, &out); e != nil {
			return m, e
		}
		m.Result = out.Result
		m.Duration = out.Duration
		if out.Frames != nil {
			m.Frames = out.Frames
		}
	}
	return m, nil
}
func (s *Service) GetMatch(ctx context.Context, a Actor, matchID string) (Match, error) {
	q := db.New(s.Pool)
	if _, e := s.member(ctx, q, a); e != nil {
		return Match{}, e
	}
	w, _ := id(a.WorkspaceID)
	mid, e := id(matchID)
	if e != nil {
		return Match{}, e
	}
	row, e := q.GetCTFMatch(ctx, db.GetCTFMatchParams{WorkspaceID: w, ID: mid})
	if e != nil {
		return Match{}, missing(e)
	}
	return decodeMatch(row.Payload, row.Result, row.Status, row.Error)
}
func (s *Service) State(ctx context.Context, a Actor) (State, error) {
	out := State{WorkspaceID: a.WorkspaceID, Mine: []Strategy{}, Library: []Strategy{}, Entries: []Strategy{}, Batches: []Batch{}, Matches: []Match{}, Leaderboard: json.RawMessage("[]")}
	q := db.New(s.Pool)
	member, e := s.member(ctx, q, a)
	if e != nil {
		return out, e
	}
	out.CanManage = member.Role == "owner" || member.Role == "admin"
	w, _ := id(a.WorkspaceID)
	u, _ := id(a.UserID)
	mine, e := q.ListCTFStrategies(ctx, db.ListCTFStrategiesParams{WorkspaceID: w, UserID: u})
	if e != nil {
		return out, e
	}
	for _, row := range mine {
		var c Strategy
		if e = json.Unmarshal(row.Payload, &c); e != nil {
			return out, e
		}
		c.Archived = row.Archived
		c.Published = row.Published
		out.Mine = append(out.Mine, c)
	}
	library, e := q.ListCTFLibrary(ctx, w)
	if e != nil {
		return out, e
	}
	for _, raw := range library {
		var c Strategy
		if e = json.Unmarshal(raw, &c); e != nil {
			return out, e
		}
		c.Published = true
		out.Library = append(out.Library, c)
	}
	entries, e := q.ListCTFEntries(ctx, w)
	if e != nil {
		return out, e
	}
	for _, raw := range entries {
		var c Strategy
		if e = json.Unmarshal(raw, &c); e != nil {
			return out, e
		}
		c.Strategy = nil
		out.Entries = append(out.Entries, c)
	}
	batches, e := q.ListCTFBatches(ctx, w)
	if e != nil {
		return out, e
	}
	for _, b := range batches {
		out.Batches = append(out.Batches, Batch{ID: util.UUIDToString(b.ID), WorkspaceID: a.WorkspaceID, Status: b.Status, CreatedAt: stamp(b.CreatedAt), Total: int(b.Total), Completed: int(b.Completed), Error: b.Error})
	}
	matches, e := q.ListCTFMatches(ctx, w)
	if e != nil {
		return out, e
	}
	for _, row := range matches {
		m, e := decodeMatch(row.Payload, row.Result, row.Status, row.Error)
		if e != nil {
			return out, e
		}
		out.Matches = append(out.Matches, m)
	}
	board, e := q.GetCTFLeaderboard(ctx, w)
	if e == nil {
		out.Leaderboard = board
	} else if !errors.Is(e, pgx.ErrNoRows) {
		return out, e
	}
	return out, nil
}
func revisionKey(c Strategy) string { return fmt.Sprintf("%s:%d", c.ID, c.Revision) }

func (s *Service) ReadStrategy(ctx context.Context, a Actor, strategyID string, revision int) (Strategy, error) {
	q := db.New(s.Pool)
	if _, e := s.member(ctx, q, a); e != nil {
		return Strategy{}, e
	}
	w, _ := id(a.WorkspaceID)
	u, _ := id(a.UserID)
	sid, e := id(strategyID)
	if e != nil {
		return Strategy{}, e
	}
	if revision < 1 || revision > 128 {
		return Strategy{}, problem("invalid_request", 400)
	}
	row, e := q.ReadCTFRevision(ctx, db.ReadCTFRevisionParams{WorkspaceID: w, StrategyID: sid, Revision: int32(revision), UserID: u})
	if e != nil {
		return Strategy{}, missing(e)
	}
	var c Strategy
	e = json.Unmarshal(row.Payload, &c)
	c.Published = row.Published
	return c, e
}
