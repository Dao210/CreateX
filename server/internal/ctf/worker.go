package ctf

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"log/slog"
	"time"
)

func (s *Service) publish(ctx context.Context, q *db.Queries, w, bid pgtype.UUID) error {
	if e := q.MarkCTFBatchPublished(ctx, db.MarkCTFBatchPublishedParams{WorkspaceID: w, ID: bid}); e != nil {
		return e
	}
	rows, e := q.CTFRatedMatches(ctx, w)
	if e != nil {
		return e
	}
	records := []map[string]any{}
	matches := []map[string]any{}
	seen := map[string]bool{}
	revisions := map[string]int{}
	type participation struct {
		At           time.Time
		BatchID, Key string
	}
	latest := map[string]participation{}
	for _, row := range rows {
		var m Match
		var out Outcome
		if e = json.Unmarshal(row.Payload, &m); e != nil {
			return e
		}
		if e = json.Unmarshal(row.Result, &out); e != nil {
			return e
		}
		if out.Result == nil {
			return errors.New("missing_ctf_result")
		}
		for _, c := range []Strategy{m.Red, m.Blue} {
			key := revisionKey(c)
			previous, exists := latest[c.OwnerID]
			periodID := util.UUIDToString(row.PeriodID)
			if !exists || row.PeriodAt.Time.After(previous.At) || (row.PeriodAt.Time.Equal(previous.At) && periodID > previous.BatchID) {
				latest[c.OwnerID] = participation{row.PeriodAt.Time, periodID, key}
			}
			if !seen[key] {
				seen[key] = true
				revisions[key] = c.Revision
				records = append(records, map[string]any{"team_id": key, "team_name": c.OwnerName + " · " + c.Name})
			}
		}
		matches = append(matches, map[string]any{"arena_run_id": util.UUIDToString(row.PeriodID), "uploaded_at": stamp(row.PeriodAt), "red_strategy_id": revisionKey(m.Red), "blue_strategy_id": revisionKey(m.Blue), "red_strategy_name": m.Red.Name, "blue_strategy_name": m.Blue.Name, "series_result": out.Result.Winner})
	}
	var board struct {
		Entries []map[string]any `json:"entries"`
	}
	if e = s.Engine.Call(ctx, "rate", map[string]any{"records": records, "matches": matches}, &board); e != nil {
		return e
	}
	active := map[string]bool{}
	for _, entry := range latest {
		active[entry.Key] = true
	}
	filtered := []map[string]any{}
	for _, entry := range board.Entries {
		key, ok := entry["strategy_id"].(string)
		if ok && active[key] {
			entry["rank"] = len(filtered) + 1
			entry["revision"] = revisions[key]
			filtered = append(filtered, entry)
		}
	}
	if e = q.PersistCTFBatchBoard(ctx, db.PersistCTFBatchBoardParams{WorkspaceID: w, ID: bid, Payload: encode(filtered)}); e != nil {
		return e
	}
	return q.PutCTFLeaderboard(ctx, db.PutCTFLeaderboardParams{WorkspaceID: w, Payload: encode(filtered)})
}
func (s *Service) Step(ctx context.Context) error {
	q := db.New(s.Pool)
	if e := q.ExpireCTFMatches(ctx); e != nil {
		return e
	}
	lease, _ := id(uuid.NewString())
	job, e := q.ClaimCTFMatch(ctx, lease)
	if e == nil {
		w := util.UUIDToString(job.WorkspaceID)
		var m Match
		if e = json.Unmarshal(job.Payload, &m); e != nil {
			return e
		}
		var out Outcome
		if e = s.available(ctx, w); e == nil {
			_, e = s.member(ctx, q, Actor{w, m.Red.OwnerID})
		}
		if e == nil {
			_, e = s.member(ctx, q, Actor{w, m.Blue.OwnerID})
		}
		if e == nil {
			e = s.Engine.Run(ctx, map[string]any{"red": m.Red.Strategy, "blue": m.Blue.Strategy, "seed": m.Seed}, &out, func(frame json.RawMessage) error {
				return q.PreviewCTFMatch(ctx, db.PreviewCTFMatchParams{WorkspaceID: job.WorkspaceID, ID: job.ID, LeaseID: lease, Result: encode(Outcome{Frames: []json.RawMessage{frame}})})
			})
		}
		if e == nil && (out.Result == nil || (out.Result.Winner != "red" && out.Result.Winner != "blue" && out.Result.Winner != "draw") || out.Ticks < 1 || out.Ticks > 1920 || len(out.Frames) < 2 || len(out.Frames) > 482) {
			e = errors.New("invalid_ctf_outcome")
		}
		if e != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return q.ReleaseCTFMatch(ctx, db.ReleaseCTFMatchParams{WorkspaceID: job.WorkspaceID, ID: job.ID, LeaseID: lease, Error: "compute_failed"})
		}
		tx, err := s.Pool.Begin(ctx)
		if err != nil {
			return err
		}
		defer tx.Rollback(ctx)
		tq := db.New(tx)
		if err = tq.LockCTFWorld(ctx, w); err != nil {
			return err
		}
		if _, err = tq.LockCTFWorkspace(ctx, job.WorkspaceID); err != nil {
			return missing(err)
		}
		b, err := tq.GetCTFBatch(ctx, db.GetCTFBatchParams{WorkspaceID: job.WorkspaceID, ID: job.BatchID})
		if err != nil {
			return missing(err)
		}
		if b.Status != "running" && b.Status != "paused" {
			if err = tq.ReleaseCTFMatch(ctx, db.ReleaseCTFMatchParams{WorkspaceID: job.WorkspaceID, ID: job.ID, LeaseID: lease, Error: "batch_stopped"}); err != nil {
				return err
			}
			return tx.Commit(ctx)
		}
		if err = s.available(ctx, w); err != nil {
			return err
		}
		if _, err = s.member(ctx, tq, Actor{w, m.Red.OwnerID}); err != nil {
			return err
		}
		if _, err = s.member(ctx, tq, Actor{w, m.Blue.OwnerID}); err != nil {
			return err
		}
		if _, err = tq.FinishCTFMatch(ctx, db.FinishCTFMatchParams{WorkspaceID: job.WorkspaceID, ID: job.ID, LeaseID: lease, Result: encode(out)}); err != nil {
			return err
		}
		if err = tx.Commit(ctx); err != nil {
			return err
		}
	} else if !errors.Is(e, pgx.ErrNoRows) {
		return e
	}
	batches, e := q.ListCTFUnpublishedBatches(ctx)
	if e != nil {
		return e
	}
	for _, b := range batches {
		tx, e := s.Pool.Begin(ctx)
		if e != nil {
			return e
		}
		tq := db.New(tx)
		err := func() error {
			if e := tq.LockCTFWorld(ctx, util.UUIDToString(b.WorkspaceID)); e != nil {
				return e
			}
			current, e := tq.GetCTFBatch(ctx, db.GetCTFBatchParams{WorkspaceID: b.WorkspaceID, ID: b.ID})
			if e != nil {
				return e
			}
			if current.Published || current.Status == "stopped" || current.Status == "paused" {
				return nil
			}
			if e = s.available(ctx, util.UUIDToString(b.WorkspaceID)); e != nil {
				return e
			}
			failed, e := tq.CTFBatchHasFailures(ctx, b.ID)
			if e != nil {
				return e
			}
			status := "completed"
			message := ""
			if failed {
				status = "failed"
				message = "compute_failed"
			}
			if e = tq.SetCTFBatchStatus(ctx, db.SetCTFBatchStatusParams{WorkspaceID: b.WorkspaceID, ID: b.ID, Status: status, Error: message}); e != nil {
				return e
			}
			if !failed {
				if e = s.publish(ctx, tq, b.WorkspaceID, b.ID); e != nil {
					return e
				}
			}
			return tx.Commit(ctx)
		}()
		_ = tx.Rollback(ctx)
		if err != nil {
			return err
		}
	}
	return nil
}
func (s *Service) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		if e := s.Step(ctx); e != nil && ctx.Err() == nil {
			slog.Warn("ctf worker", "error", e)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
