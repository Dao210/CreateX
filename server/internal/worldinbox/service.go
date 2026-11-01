// Package worldinbox projects committed game facts into personal messages and
// immutable hourly world digests. PostgreSQL owns delivery progress and deduplication.
package worldinbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/auro-ai/auro/server/internal/events"
	"github.com/auro-ai/auro/server/internal/gameadmin"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/auro-ai/auro/server/pkg/protocol"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Entry struct {
	ID         string    `json:"id"`
	Kind       string    `json:"kind"`
	SubjectID  string    `json:"subjectId"`
	Name       string    `json:"name"`
	AuthorName string    `json:"authorName,omitempty"`
	Revision   int       `json:"revision,omitempty"`
	Level      int       `json:"level,omitempty"`
	Origin     string    `json:"origin,omitempty"`
	GoalKind   string    `json:"goalKind,omitempty"`
	Target     int       `json:"target,omitempty"`
	OccurredAt time.Time `json:"occurredAt"`
}

type Totals struct {
	Created    int `json:"created"`
	Updated    int `json:"updated"`
	Milestones int `json:"milestones"`
	Residents  int `json:"residents"`
}

type Content struct {
	Entries      []Entry    `json:"entries"`
	Totals       Totals     `json:"totals"`
	TotalEntries int        `json:"totalEntries"`
	WindowStart  *time.Time `json:"windowStart,omitempty"`
	WindowEnd    *time.Time `json:"windowEnd,omitempty"`
}

// Record must use the source business transaction. Identity represents a fact,
// not an HTTP attempt, so request replay cannot create another notification.
func Record(ctx context.Context, q *db.Queries, workspace, actor, subject pgtype.UUID, kind, key string, entry Entry) error {
	if err := q.LockWorldInboxWrites(ctx, util.UUIDToString(workspace)); err != nil {
		return err
	}
	entry.ID = uuid.NewSHA1(uuid.NameSpaceOID, []byte("world-event/"+util.UUIDToString(workspace)+"/"+key)).String()
	entry.SubjectID, entry.Kind = util.UUIDToString(subject), kind
	if actor.Valid {
		user, err := q.GetUser(ctx, actor)
		if err != nil {
			return err
		}
		entry.AuthorName = user.Name
	}
	raw, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	id, err := util.ParseUUID(entry.ID)
	if err != nil {
		return err
	}
	return q.RecordWorldInboxEvent(ctx, db.RecordWorldInboxEventParams{ID: id, WorkspaceID: workspace, ActorID: actor, SubjectID: subject, Kind: kind, Content: raw})
}

type Service struct {
	Pool *pgxpool.Pool
	Bus  *events.Bus
}

func (s *Service) Run(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		callCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		err := s.Process(callCtx, time.Now().UTC())
		cancel()
		if err != nil && ctx.Err() == nil {
			slog.Error("world inbox delivery failed; pending facts will retry", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

type fact struct {
	ID, Workspace, Actor string
	At                   time.Time
	Entry                Entry
}
type message struct {
	ID, Workspace, Recipient, Actor, Type, Title string
	Content                                      Content
	At                                           time.Time
}

// Process publishes only after commit. Reconnect/list reads recover a push lost
// between commit and publication; inbox rows, rather than WebSocket frames, are durable.
func (s *Service) Process(ctx context.Context, now time.Time) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var locked bool
	if err = tx.QueryRow(ctx, "SELECT pg_try_advisory_xact_lock(19646,1)").Scan(&locked); err != nil || !locked {
		return err
	}
	rows, err := tx.Query(ctx, `SELECT id::text,workspace_id::text,COALESCE(actor_id::text,''),occurred_at,content
		FROM world_inbox_event WHERE delivered_at IS NULL ORDER BY occurred_at,id LIMIT 50`)
	if err != nil {
		return err
	}
	facts := []fact{}
	for rows.Next() {
		var f fact
		var raw []byte
		if err = rows.Scan(&f.ID, &f.Workspace, &f.Actor, &f.At, &raw); err != nil {
			rows.Close()
			return err
		}
		if err = json.Unmarshal(raw, &f.Entry); err != nil {
			rows.Close()
			return err
		}
		f.Entry.OccurredAt = f.At
		facts = append(facts, f)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	sent := []message{}
	access := map[string]bool{}
	allowed := func(workspace, kind string) (bool, error) {
		game := "tanks"
		if kind == "resident_goal_reached" {
			game = "life"
		}
		key := workspace + "/" + game
		if value, ok := access[key]; ok {
			return value, nil
		}
		id, err := util.ParseUUID(workspace)
		if err != nil {
			return false, err
		}
		policy, err := db.New(tx).GetEffectiveGamePolicy(ctx, db.GetEffectiveGamePolicyParams{GameID: game, WorkspaceID: id})
		if err != nil {
			return false, err
		}
		value := gameadmin.Resolve(game, policy.Scope, policy.DefaultVisible, policy.Access, policy.Visibility, policy.LifeBound).Available
		access[key] = value
		return value, nil
	}
	latest := map[string]string{}
	for _, f := range facts {
		if (f.Entry.Kind == "tank_created" || f.Entry.Kind == "tank_updated") && f.Entry.Origin == "mcp" {
			latest[f.Workspace+"/"+f.Entry.SubjectID+"/creation_ready"] = f.ID
		}
		if f.Entry.Kind == "tank_level_up" {
			latest[f.Workspace+"/"+f.Entry.SubjectID+"/character_milestone"] = f.ID
		}
	}
	for _, f := range facts {
		open, err := allowed(f.Workspace, f.Entry.Kind)
		if err != nil {
			return err
		}
		personalType := ""
		if (f.Entry.Kind == "tank_created" || f.Entry.Kind == "tank_updated") && f.Entry.Origin == "mcp" {
			personalType = "creation_ready"
		}
		if f.Entry.Kind == "tank_level_up" {
			personalType = "character_milestone"
		}
		if open && personalType != "" && latest[f.Workspace+"/"+f.Entry.SubjectID+"/"+personalType] == f.ID {
			m := message{Workspace: f.Workspace, Recipient: f.Actor, Actor: f.Actor, Type: personalType, Title: f.Entry.Name, Content: Content{Entries: []Entry{f.Entry}, TotalEntries: 1}}
			m.ID = messageID(f.ID + "/" + f.Actor)
			inserted, err := insert(ctx, tx, &m)
			if err != nil {
				return err
			}
			if inserted {
				sent = append(sent, m)
			}
		}
		if _, err = tx.Exec(ctx, "UPDATE world_inbox_event SET delivered_at=clock_timestamp() WHERE id=$1::uuid", f.ID); err != nil {
			return err
		}
	}
	// Only closed UTC hours are eligible. Windows have stable identities and
	// contain facts, not a synthesized claim about unimplemented world mechanics.
	cutoff := now.UTC().Truncate(time.Hour)
	windows, err := tx.Query(ctx, `SELECT workspace_id::text,date_trunc('hour',occurred_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS start
		FROM world_inbox_event WHERE summarized_at IS NULL AND occurred_at < $1
		GROUP BY workspace_id,start ORDER BY start,workspace_id LIMIT 8`, cutoff)
	if err != nil {
		return err
	}
	type window struct {
		ws    string
		start time.Time
	}
	queue := []window{}
	for windows.Next() {
		var w window
		if err = windows.Scan(&w.ws, &w.start); err != nil {
			windows.Close()
			return err
		}
		w.start = w.start.UTC()
		queue = append(queue, w)
	}
	err = windows.Err()
	windows.Close()
	if err != nil {
		return err
	}
	for _, w := range queue {
		var existing string
		err := tx.QueryRow(ctx, "SELECT id::text FROM workspace WHERE id=$1::uuid FOR KEY SHARE", w.ws).Scan(&existing)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(19647,hashtext($1))", w.ws); err != nil {
			return err
		}
		end := w.start.Add(time.Hour)
		// Keep the latest fact of each kind for each character. Counts and entries
		// share this set, so repeated design saves do not inflate a world's story.
		r, err := tx.Query(ctx, `SELECT DISTINCT ON (subject_id,kind) content,occurred_at
			FROM world_inbox_event WHERE workspace_id=$1::uuid AND occurred_at >= $2 AND occurred_at < $3
			ORDER BY subject_id,kind,occurred_at DESC,id DESC`, w.ws, w.start, end)
		if err != nil {
			return err
		}
		entries := []Entry{}
		for r.Next() {
			var e Entry
			var raw []byte
			var at time.Time
			if err = r.Scan(&raw, &at); err != nil {
				r.Close()
				return err
			}
			if err = json.Unmarshal(raw, &e); err != nil {
				r.Close()
				return err
			}
			e.OccurredAt = at
			entries = append(entries, e)
		}
		err = r.Err()
		r.Close()
		if err != nil {
			return err
		}
		visible := entries[:0]
		for _, entry := range entries {
			open, err := allowed(w.ws, entry.Kind)
			if err != nil {
				return err
			}
			if open {
				visible = append(visible, entry)
			}
		}
		content := summarize(visible, w.start, end)
		members, err := tx.Query(ctx, `SELECT user_id::text FROM member WHERE workspace_id=$1::uuid AND created_at < $2`, w.ws, end)
		if err != nil {
			return err
		}
		recipients := []string{}
		for members.Next() {
			var id string
			if err = members.Scan(&id); err != nil {
				members.Close()
				return err
			}
			recipients = append(recipients, id)
		}
		err = members.Err()
		members.Close()
		if err != nil {
			return err
		}
		for _, id := range recipients {
			if len(visible) == 0 {
				break
			}
			m := message{ID: messageID(w.ws + "/" + w.start.Format(time.RFC3339) + "/" + id), Workspace: w.ws, Recipient: id, Type: "world_digest", Title: "World digest", Content: content}
			inserted, err := insert(ctx, tx, &m)
			if err != nil {
				return err
			}
			if inserted {
				sent = append(sent, m)
			}
		}
		if _, err = tx.Exec(ctx, `UPDATE world_inbox_event SET summarized_at=clock_timestamp() WHERE workspace_id=$1::uuid AND occurred_at >= $2 AND occurred_at < $3`, w.ws, w.start, end); err != nil {
			return err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	for _, m := range sent {
		s.publish(m)
	}
	return nil
}

func messageID(key string) string {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("world-inbox/"+key)).String()
}

func insert(ctx context.Context, tx pgx.Tx, m *message) (bool, error) {
	// Fence insertion against workspace deletion and membership removal. A
	// departed recipient never receives new messages, including delayed retries.
	var id string
	group := "creation_updates"
	if m.Type == "world_digest" {
		group = "world_digests"
	}
	err := tx.QueryRow(ctx, `SELECT w.id::text FROM workspace w JOIN member m ON m.workspace_id=w.id
        WHERE w.id=$1::uuid AND m.user_id=$2::uuid AND NOT EXISTS (
            SELECT 1 FROM notification_preference p WHERE p.workspace_id=w.id AND p.user_id=m.user_id AND p.preferences->>$3='muted'
        ) FOR KEY SHARE OF w,m`, m.Workspace, m.Recipient, group).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	raw, err := json.Marshal(m.Content)
	if err != nil {
		return false, err
	}
	err = tx.QueryRow(ctx, `INSERT INTO inbox_item(id,workspace_id,recipient_type,recipient_id,type,severity,title,actor_type,actor_id,content)
		VALUES($1::uuid,$2::uuid,'member',$3::uuid,$4,'info',$5,$6,NULLIF($7,'')::uuid,$8)
		ON CONFLICT(id) DO NOTHING RETURNING created_at`, m.ID, m.Workspace, m.Recipient, m.Type, m.Title, actorType(m.Actor), m.Actor, raw).Scan(&m.At)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func actorType(actor string) string {
	if actor == "" {
		return "system"
	}
	return "member"
}

func (s *Service) publish(m message) {
	if s.Bus == nil {
		return
	}
	var actor any
	if m.Actor != "" {
		actor = m.Actor
	}
	s.Bus.Publish(events.Event{Type: protocol.EventInboxNew, WorkspaceID: m.Workspace, ActorType: actorType(m.Actor), ActorID: m.Actor, Payload: map[string]any{"item": map[string]any{
		"id": m.ID, "workspace_id": m.Workspace, "recipient_type": "member", "recipient_id": m.Recipient, "type": m.Type, "severity": "info", "title": m.Title, "body": nil, "issue_id": nil, "issue_status": nil, "issue_priority": nil, "actor_type": actorType(m.Actor), "actor_id": actor, "read": false, "archived": false, "created_at": m.At.Format(time.RFC3339Nano), "details": nil, "content": m.Content,
	}}})
}

func FactKey(subject string, revision int) string {
	return fmt.Sprintf("tank/%s/revision/%d", subject, revision)
}
