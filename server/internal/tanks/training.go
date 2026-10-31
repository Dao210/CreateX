package tanks

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Growth struct {
	XP int `json:"xp"`
}
type GrowthLevel struct {
	XP                    int `json:"xp"`
	Speed                 int `json:"speed"`
	Armor                 int `json:"armor"`
	FireIntervalReduction int `json:"fireIntervalReduction"`
	Evolution             int `json:"evolution"`
}
type ProgressionRules struct {
	Version      int           `json:"version"`
	XPPerKill    int           `json:"xpPerKill"`
	CompletionXP int           `json:"completionXp"`
	MaxRunXP     int           `json:"maxRunXp"`
	Levels       []GrowthLevel `json:"levels"`
}

func applyGrowth(base Blueprint, xp int) Blueprint {
	level := Rules.Progression.Levels[0]
	for _, candidate := range Rules.Progression.Levels {
		if xp >= candidate.XP {
			level = candidate
		}
	}
	base.Speed += level.Speed
	base.Armor += level.Armor
	base.FireInterval = max(1, base.FireInterval-level.FireIntervalReduction)
	base.Evolution = level.Evolution
	return base
}

type TrainingStart struct {
	RequestID string `json:"requestId"`
	LevelID   int    `json:"levelId"`
}
type TrainingRun struct {
	ID          string `json:"id"`
	SessionID   string `json:"sessionId"`
	CharacterID string `json:"characterId"`
	LevelID     int    `json:"levelId"`
}
type TrainingSummary struct {
	Ticks   int    `json:"ticks"`
	Kills   int    `json:"kills"`
	Outcome string `json:"outcome"`
}
type TrainingResult struct {
	RunID       string `json:"runId"`
	CharacterID string `json:"characterId"`
	AwardedXP   int    `json:"awardedXp"`
	Progression Growth `json:"progression"`
}

// Training serializes only one member's runs. It never takes the workspace-wide
// character/request advisory lock or writes per-frame battle state.
func (s *Service) trainingTx(ctx context.Context, a Actor, fn func(*db.Queries, pgtype.UUID, pgtype.UUID) error) error {
	w, u, e := scope(a)
	if e != nil {
		return e
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	q := db.New(tx)
	if _, e = q.LockWorkspaceForChatSessionCreate(ctx, w); e != nil {
		return storedError(e)
	}
	var member string
	if e = tx.QueryRow(ctx, `SELECT id::text FROM member WHERE workspace_id=$1 AND user_id=$2 FOR SHARE`, w, u).Scan(&member); e != nil {
		return problem("workspace_forbidden", 403)
	}
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(19645,hashtext($1))`, a.WorkspaceID+":"+a.UserID); e != nil {
		return e
	}
	if e = fn(q, w, u); e != nil {
		return e
	}
	return tx.Commit(ctx)
}

func (s *Service) StartTraining(ctx context.Context, a Actor, sessionID string, in TrainingStart) (TrainingRun, error) {
	var out TrainingRun
	rid, e := inputUUID(in.RequestID)
	if e != nil {
		return out, e
	}
	if in.LevelID < 1 || in.LevelID > len(Rules.Maps) {
		return out, problem("invalid_request", 400)
	}
	e = s.trainingTx(ctx, a, func(q *db.Queries, w, u pgtype.UUID) error {
		session, e := readSession(ctx, q, a, sessionID)
		if e != nil {
			return e
		}
		if session.Character.OwnerID != a.UserID {
			return problem("training_owner_required", 403)
		}
		if (session.Mode != "campaign" && in.LevelID != session.LevelID) || (session.Mode == "campaign" && in.LevelID < session.LevelID) {
			return problem("invalid_request", 400)
		}
		sid, e := inputUUID(sessionID)
		if e != nil {
			return e
		}
		cid, e := inputUUID(session.Character.ID)
		if e != nil {
			return e
		}
		previous, e := q.GetTankTrainingRun(ctx, db.GetTankTrainingRunParams{WorkspaceID: w, UserID: u, ID: rid})
		if e == nil {
			if previous.SessionID != sid || int(previous.LevelID) != in.LevelID {
				return problem("idempotency_key_reused", 409)
			}
			out = TrainingRun{ID: in.RequestID, SessionID: sessionID, CharacterID: session.Character.ID, LevelID: in.LevelID}
			return nil
		}
		if !errors.Is(e, pgx.ErrNoRows) {
			return e
		}
		if e = q.PruneTankTraining(ctx, db.PruneTankTrainingParams{WorkspaceID: w, UserID: u}); e != nil {
			return e
		}
		count, e := q.CountRecentTankTraining(ctx, db.CountRecentTankTrainingParams{WorkspaceID: w, UserID: u})
		if e != nil {
			return e
		}
		if count >= 500 {
			return problem("capacity_reached", 429)
		}
		if e = q.CancelActiveTankTraining(ctx, db.CancelActiveTankTrainingParams{WorkspaceID: w, UserID: u}); e != nil {
			return e
		}
		if e = q.InsertTankTrainingRun(ctx, db.InsertTankTrainingRunParams{ID: rid, WorkspaceID: w, UserID: u, SessionID: sid, CharacterID: cid, LevelID: int32(in.LevelID)}); e != nil {
			return e
		}
		out = TrainingRun{ID: in.RequestID, SessionID: sessionID, CharacterID: session.Character.ID, LevelID: in.LevelID}
		return nil
	})
	return out, e
}

// Summaries are client-reported personal training, not verified competitive
// results. The server owns rewards, caps, ownership and exactly-once settlement.
func trainingAward(in TrainingSummary, elapsed time.Duration, mode string, level int) (int, error) {
	if in.Ticks < 0 || in.Ticks > 24*60*60*60 || in.Kills < 0 || in.Kills > 10000 || float64(in.Ticks) > elapsed.Seconds()*60+120 || in.Kills > in.Ticks/30 {
		return 0, problem("invalid_training_summary", 422)
	}
	complete := in.Outcome == "cleared" || in.Outcome == "victory"
	switch in.Outcome {
	case "defeat", "abandoned":
	case "cleared":
		if mode != "campaign" || level >= len(Rules.Maps) {
			return 0, problem("invalid_training_summary", 422)
		}
	case "victory":
		if mode == "survival" || (mode == "campaign" && level != len(Rules.Maps)) {
			return 0, problem("invalid_training_summary", 422)
		}
	default:
		return 0, problem("invalid_training_summary", 422)
	}
	reward := in.Kills * Rules.Progression.XPPerKill
	if complete {
		if in.Kills == 0 {
			return 0, problem("invalid_training_summary", 422)
		}
		reward += Rules.Progression.CompletionXP
	}
	return min(reward, Rules.Progression.MaxRunXP), nil
}

func (s *Service) SettleTraining(ctx context.Context, a Actor, sessionID, runID string, in TrainingSummary) (TrainingResult, error) {
	var out TrainingResult
	rid, e := inputUUID(runID)
	if e != nil {
		return out, e
	}
	sid, e := inputUUID(sessionID)
	if e != nil {
		return out, e
	}
	e = s.trainingTx(ctx, a, func(q *db.Queries, w, u pgtype.UUID) error {
		run, e := q.GetTankTrainingRun(ctx, db.GetTankTrainingRunParams{WorkspaceID: w, UserID: u, ID: rid})
		if e != nil {
			return storedError(e)
		}
		if run.SessionID != sid {
			return problem("not_found", 404)
		}
		fingerprint := digest(in)
		if run.SettledAt.Valid {
			if len(run.Result) == 0 {
				return problem("training_superseded", 409)
			}
			if run.BodyHash.String != fingerprint {
				return problem("idempotency_key_reused", 409)
			}
			return json.Unmarshal(run.Result, &out)
		}
		session, e := readSession(ctx, q, a, sessionID)
		if e != nil {
			return e
		}
		if session.Character.OwnerID != a.UserID {
			return problem("training_owner_required", 403)
		}
		award, e := trainingAward(in, time.Since(run.StartedAt.Time), session.Mode, int(run.LevelID))
		if e != nil {
			return e
		}
		maxXP := Rules.Progression.Levels[len(Rules.Progression.Levels)-1].XP
		character, e := q.GetTankCharacter(ctx, db.GetTankCharacterParams{WorkspaceID: w, ID: run.CharacterID})
		if e != nil {
			return storedError(e)
		}
		award = min(award, maxXP-int(character.Experience))
		xp := character.Experience
		if award > 0 {
			xp, e = q.AddTankExperience(ctx, db.AddTankExperienceParams{WorkspaceID: w, UserID: u, ID: run.CharacterID, Award: int32(award), MaxExperience: int32(maxXP)})
			if e != nil {
				return storedError(e)
			}
		}
		out = TrainingResult{RunID: runID, CharacterID: session.Character.ID, AwardedXP: award, Progression: Growth{XP: int(xp)}}
		raw, e := json.Marshal(out)
		if e != nil {
			return e
		}
		return q.SettleTankTrainingRun(ctx, db.SettleTankTrainingRunParams{WorkspaceID: w, UserID: u, ID: rid, BodyHash: pgtype.Text{String: fingerprint, Valid: true}, Result: raw})
	})
	return out, e
}
