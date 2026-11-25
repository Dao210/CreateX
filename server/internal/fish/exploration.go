package fish

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/auro-ai/auro/server/internal/gameadmin"
	"github.com/auro-ai/auro/server/internal/util"
	"github.com/auro-ai/auro/server/internal/worldinbox"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) RunExploration(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		callCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		err := s.Explore(callCtx, time.Now().UTC())
		cancel()
		if err != nil && ctx.Err() == nil {
			slog.Error("fish exploration tick failed; state and letters rolled back", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Explore commits all movement, memories, the clock and letter facts together.
func (s *Service) Explore(ctx context.Context, now time.Time) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := db.New(tx)
	// Follow workspace deletion's lock order before the global tick fence.
	workspaces, err := q.LockFishExplorationWorkspaces(ctx)
	if err != nil {
		return err
	}
	var locked bool
	if err = tx.QueryRow(ctx, "SELECT pg_try_advisory_xact_lock(19648,hashtext(current_schema()))").Scan(&locked); err != nil || !locked {
		return err
	}
	clock, err := q.GetFishExplorationClock(ctx)
	steps := 0
	var tick int64
	if err == nil {
		tick = clock.Tick
		elapsed := now.Sub(clock.LastTick.Time)
		if elapsed < 0 {
			return fmt.Errorf("fish exploration clock moved backwards")
		}
		// Never reconstruct encounters during an outage or rush through old time.
		if elapsed <= 30*time.Second {
			steps = int(elapsed / time.Second)
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	rows, err := q.ListFishExplorers(ctx, workspaces)
	if err != nil {
		return err
	}
	fish := make([]*explorer, 0, len(rows))
	moving := make([]*explorer, 0, len(rows))
	for _, row := range rows {
		f := &explorer{Workspace: util.UUIDToString(row.WorkspaceID), User: util.UUIDToString(row.UserID)}
		if err = json.Unmarshal(row.Payload, &f.Resident); err != nil {
			return err
		}
		if string(row.Exploration) == "null" {
			f.State = newExploration(f.Resident)
		} else {
			if err = json.Unmarshal(row.Exploration, &f.State); err != nil {
				return err
			}
			if !validExploration(f.State) {
				return fmt.Errorf("invalid exploration state for %s", f.Resident.ID)
			}
			moving = append(moving, f)
		}
		fish = append(fish, f)
	}
	for step := 0; step < steps; step++ {
		tick++
		advanceExplorers(moving, tick, now.Add(-time.Duration(steps-step-1)*time.Second))
	}
	// One narrator per owner/world/day. Other fish retain their unseen memories.
	allowed := map[string]bool{}
	finished := map[string]bool{}
	for _, f := range letterCandidates(fish) {
		group := f.Workspace + "/" + f.User
		w, err := util.ParseUUID(f.Workspace)
		if err != nil {
			return err
		}
		u, err := util.ParseUUID(f.User)
		if err != nil {
			return err
		}
		open, checked := allowed[group]
		if !checked {
			var member string
			err = tx.QueryRow(ctx, `SELECT m.id::text FROM member m WHERE m.workspace_id=$1 AND m.user_id=$2 AND NOT EXISTS (
			 SELECT 1 FROM notification_preference p WHERE p.workspace_id=m.workspace_id AND p.user_id=m.user_id AND p.preferences->>'creation_updates'='muted'
			) FOR KEY SHARE OF m`, w, u).Scan(&member)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			open = err == nil
			if open {
				policy, err := q.GetEffectiveGamePolicy(ctx, db.GetEffectiveGamePolicyParams{GameID: "fish", WorkspaceID: w})
				if err != nil {
					return err
				}
				open = gameadmin.Resolve("fish", policy.Scope, policy.DefaultVisible, policy.Access, policy.Visibility).Available
			}
			allowed[group] = open
		}
		if !open {
			// Remember the encounter, but never backfill observations made while muted or closed.
			f.State.Pending = nil
			continue
		}
		if finished[group] {
			continue
		}
		key := explorationLetterKey(f.User, now)
		id, err := util.ParseUUID(worldinbox.FactID(f.Workspace, key))
		if err != nil {
			return err
		}
		exists, err := q.HasWorldInboxEvent(ctx, id)
		if err != nil {
			return err
		}
		if exists {
			finished[group] = true
			continue
		}
		rid, err := util.ParseUUID(f.Resident.ID)
		if err != nil {
			return err
		}
		count := min(3, len(f.State.Pending))
		sightings := append([]worldinbox.FishSighting(nil), f.State.Pending[:count]...)
		if err = worldinbox.Record(ctx, q, w, u, rid, "fish_letter", key, worldinbox.Entry{Name: f.Resident.Fish.Draft.Name, Revision: f.Resident.Revision, Sightings: sightings}); err != nil {
			return err
		}
		f.State.Pending = f.State.Pending[count:]
		finished[group] = true
	}
	for _, f := range fish {
		raw, err := json.Marshal(f.State)
		if err != nil {
			return err
		}
		rid, err := util.ParseUUID(f.Resident.ID)
		if err != nil {
			return err
		}
		w, err := util.ParseUUID(f.Workspace)
		if err != nil {
			return err
		}
		u, err := util.ParseUUID(f.User)
		if err != nil {
			return err
		}
		if err = q.PutFishExplorationState(ctx, db.PutFishExplorationStateParams{ResidentID: rid, WorkspaceID: w, UserID: u, State: raw}); err != nil {
			return err
		}
	}
	if err = q.PruneFishExplorationStates(ctx); err != nil {
		return err
	}
	if err = q.PutFishExplorationClock(ctx, db.PutFishExplorationClockParams{Tick: tick, LastTick: pgtype.Timestamptz{Time: now, Valid: true}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
