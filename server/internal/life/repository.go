package life

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrStaleTick = errors.New("life tick changed before commit")
var ErrBindingMismatch = errors.New("life world is bound to a different workspace")

type Repository struct{ Pool *pgxpool.Pool }

func (r *Repository) Binding(ctx context.Context) (db.LifeWorld, error) {
	return db.New(r.Pool).GetLifeBinding(ctx)
}

func (r *Repository) CheckWriterCutover(ctx context.Context) error {
	// System-view introspection is outside the application schema parsed by sqlc.
	var legacy bool
	if err := r.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='weavea-agent-life')").Scan(&legacy); err != nil {
		return err
	}
	if legacy {
		return errors.New("stop the standalone Life writer before starting the integrated service")
	}
	return nil
}

func (r *Repository) Due(ctx context.Context, binding db.LifeWorld) (bool, error) {
	return db.New(r.Pool).IsLifeTickDue(ctx, binding.ID)
}

func (r *Repository) Initialize(ctx context.Context, workspaceID string, seed Seed) (db.LifeWorld, error) {
	var empty db.LifeWorld
	workspace, err := util.ParseUUID(workspaceID)
	if err != nil {
		return empty, err
	}
	if len(seed.Agents) != 20 || seed.TickMS < 100 || seed.TickMS > 60000 {
		return empty, errors.New("invalid life seed")
	}
	if err = validateState(Simulation{Agents: seed.Agents, Resources: seed.Resources, Actions: []Action{}}); err != nil {
		return empty, err
	}
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return empty, err
	}
	defer tx.Rollback(ctx)
	q := db.New(tx)
	if err = q.LockLifeInitialization(ctx); err != nil {
		return empty, err
	}
	if _, err = q.LockLifeWorkspace(ctx, workspace); err != nil {
		return empty, fmt.Errorf("life workspace missing: %w", err)
	}
	existing, err := q.GetLifeBinding(ctx)
	if err == nil {
		if existing.WorkspaceID != workspace {
			return empty, ErrBindingMismatch
		}
		return existing, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return empty, err
	}
	id := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	if err = q.CreateLifeWorld(ctx, db.CreateLifeWorldParams{ID: id, WorkspaceID: workspace, TickMs: int32(seed.TickMS)}); err != nil {
		return empty, err
	}
	for _, a := range seed.Agents {
		aid, e := util.ParseUUID(a.ID)
		if e != nil {
			return empty, e
		}
		personality, e := json.Marshal(a.Personality)
		if e != nil {
			return empty, e
		}
		goal, e := json.Marshal(a.Goal)
		if e != nil {
			return empty, e
		}
		err = q.CreateLifeResident(ctx, db.CreateLifeResidentParams{WorldID: id, ID: aid, Name: a.Name, X: int32(a.Position.X), Y: int32(a.Position.Y), Energy: int32(a.Energy), Fullness: int32(a.Fullness), Social: int32(a.Social), Personality: personality, Goal: goal})
		if err != nil {
			return empty, err
		}
	}
	for _, v := range seed.Resources {
		if err = q.CreateLifeResource(ctx, db.CreateLifeResourceParams{WorldID: id, Owner: v.Owner, Kind: v.Kind, Amount: int32(v.Amount)}); err != nil {
			return empty, err
		}
	}
	if err = q.AppendLifeEvent(ctx, db.AppendLifeEventParams{WorldID: id, ID: pgtype.UUID{Bytes: uuid.New(), Valid: true}, Kind: "world_created", Payload: []byte(`{"residents":20,"rulesVersion":1}`)}); err != nil {
		return empty, err
	}
	binding, err := q.GetLifeBinding(ctx)
	if err != nil {
		return empty, err
	}
	return binding, tx.Commit(ctx)
}

func (r *Repository) Load(ctx context.Context, binding db.LifeWorld) (Simulation, error) {
	var snapshot struct {
		Town  *Town `json:"town"`
		World *struct {
			ID   string `json:"id"`
			Tick int64  `json:"tick"`
		} `json:"world"`
		Agents    []Resident `json:"agents"`
		Resources []Resource `json:"resources"`
		Actions   []Action   `json:"actions"`
	}
	raw, err := db.New(r.Pool).GetLifeSnapshot(ctx, binding.WorkspaceID)
	if err != nil {
		return Simulation{}, err
	}
	if err = json.Unmarshal(raw, &snapshot); err != nil {
		return Simulation{}, err
	}
	if snapshot.World == nil || snapshot.World.ID != util.UUIDToString(binding.ID) {
		return Simulation{}, ErrStaleTick
	}
	state := Simulation{Tick: snapshot.World.Tick, Agents: snapshot.Agents, Resources: snapshot.Resources, Actions: snapshot.Actions, Town: snapshot.Town}
	return state, validateState(state)
}

func oneRow(n int64, err error) error {
	if err != nil {
		return err
	}
	if n != 1 {
		return errors.New("life row missing or already settled")
	}
	return nil
}

func (r *Repository) Commit(ctx context.Context, binding db.LifeWorld, before Simulation, result TickResult) error {
	if err := validateResult(before, result); err != nil {
		return err
	}
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := db.New(tx)
	// Match workspace deletion: workspace fence, world row, then inbox source lock.
	if _, err = q.LockLifeWorkspace(ctx, binding.WorkspaceID); err != nil {
		return err
	}
	current, err := q.LockLifeWorld(ctx, binding.ID)
	if err != nil {
		return err
	}
	if current.WorkspaceID != binding.WorkspaceID || current.Tick != before.Tick {
		return ErrStaleTick
	}
	var currentTown *Town
	if err = json.Unmarshal(current.Town, &currentTown); err != nil {
		return err
	}
	if (currentTown == nil) != (before.Town == nil) || (currentTown != nil && currentTown.Revision != before.Town.Revision) {
		return ErrStaleTick
	}
	due, err := q.IsLifeTickDue(ctx, binding.ID)
	if err != nil {
		return err
	}
	if !due {
		return ErrStaleTick
	}
	for _, a := range result.Completed {
		id, e := util.ParseUUID(a.ID)
		if e != nil {
			return e
		}
		if err = oneRow(q.CompleteLifeAction(ctx, db.CompleteLifeActionParams{WorldID: binding.ID, ID: id, Status: a.Status, CompletedTick: pgtype.Int8{Int64: result.State.Tick, Valid: true}})); err != nil {
			return err
		}
	}
	for _, a := range result.State.Agents {
		id, e := util.ParseUUID(a.ID)
		if e != nil {
			return e
		}
		if err = oneRow(q.SaveLifeResident(ctx, db.SaveLifeResidentParams{WorldID: binding.ID, ID: id, X: int32(a.Position.X), Y: int32(a.Position.Y), Energy: int32(a.Energy), Fullness: int32(a.Fullness), Social: int32(a.Social)})); err != nil {
			return err
		}
	}
	for _, v := range result.State.Resources {
		if err = oneRow(q.SaveLifeResource(ctx, db.SaveLifeResourceParams{WorldID: binding.ID, Owner: v.Owner, Kind: v.Kind, Amount: int32(v.Amount)})); err != nil {
			return err
		}
	}
	for _, a := range result.Started {
		id, e := util.ParseUUID(a.ID)
		if e != nil {
			return e
		}
		aid, e := util.ParseUUID(a.AgentID)
		if e != nil {
			return e
		}
		intent, e := json.Marshal(a.Intent)
		if e != nil {
			return e
		}
		if err = q.StartLifeAction(ctx, db.StartLifeActionParams{WorldID: binding.ID, ID: id, AgentID: aid, Intent: intent, Reason: a.Reason, StartedTick: a.StartedTick, DueTick: a.DueTick}); err != nil {
			return err
		}
	}
	for _, event := range result.Events {
		var actionID, agentID pgtype.UUID
		if event.ActionID != nil {
			actionID, err = util.ParseUUID(*event.ActionID)
			if err != nil {
				return err
			}
		}
		if event.AgentID != nil {
			agentID, err = util.ParseUUID(*event.AgentID)
			if err != nil {
				return err
			}
		}
		if err = q.AppendLifeEvent(ctx, db.AppendLifeEventParams{WorldID: binding.ID, ID: pgtype.UUID{Bytes: uuid.New(), Valid: true}, Tick: result.State.Tick, ActionID: actionID, AgentID: agentID, Kind: event.Kind, Payload: event.Payload}); err != nil {
			return err
		}
		if event.Kind == "goal_reached" {
			if err = recordGoal(ctx, q, binding, before, result.State, event); err != nil {
				return err
			}
		}
	}
	if err = oneRow(q.SaveLifeTown(ctx, db.SaveLifeTownParams{ID: binding.ID, Town: rawJSON(result.State.Town)})); err != nil {
		return err
	}
	if err = q.CommitLifeTick(ctx, db.CommitLifeTickParams{ID: binding.ID, Tick: result.State.Tick}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func recordGoal(ctx context.Context, q *db.Queries, binding db.LifeWorld, before, after Simulation, event EngineEvent) error {
	if event.AgentID == nil {
		return errors.New("goal owner missing")
	}
	var goal struct {
		Name   string `json:"name"`
		Kind   string `json:"goalKind"`
		Target int    `json:"target"`
	}
	if err := strictJSON(event.Payload, &goal); err != nil {
		return err
	}
	var resident *Resident
	for i := range after.Agents {
		if after.Agents[i].ID == *event.AgentID {
			resident = &after.Agents[i]
			break
		}
	}
	if resident == nil || resident.Name != goal.Name || resident.Goal.Kind != goal.Kind || resident.Goal.Target != goal.Target {
		return errors.New("invalid goal source fact")
	}
	amount := func(state Simulation) int {
		for _, v := range state.Resources {
			if v.Owner == resident.ID && v.Kind == goal.Kind {
				return v.Amount
			}
		}
		return 0
	}
	if amount(before) >= goal.Target || amount(after) < goal.Target {
		return errors.New("goal milestone was not crossed")
	}
	if err := q.LockWorldInboxWrites(ctx, util.UUIDToString(binding.WorkspaceID)); err != nil {
		return err
	}
	// Preserve the existing resident milestone identity across the writer cutover.
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s/%s/%s/%d", util.UUIDToString(binding.ID), resident.ID, goal.Kind, goal.Target)))
	var id uuid.UUID
	copy(id[:], sum[:16])
	id[6] = (id[6] & 0x0f) | 0x50
	id[8] = (id[8] & 0x3f) | 0x80
	actor, err := util.ParseUUID(resident.ID)
	if err != nil {
		return err
	}
	content, err := json.Marshal(map[string]any{"id": id.String(), "kind": "resident_goal_reached", "subjectId": resident.ID, "name": goal.Name, "goalKind": goal.Kind, "target": goal.Target})
	if err != nil {
		return err
	}
	return q.RecordWorldInboxEvent(ctx, db.RecordWorldInboxEventParams{ID: pgtype.UUID{Bytes: id, Valid: true}, WorkspaceID: binding.WorkspaceID, SubjectID: actor, Kind: "resident_goal_reached", Content: content})
}
