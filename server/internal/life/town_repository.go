package life

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type TownCommand struct {
	RequestID  string   `json:"requestId"`
	Kind       string   `json:"kind"`
	ResidentID string   `json:"residentId,omitempty"`
	Text       string   `json:"text,omitempty"`
	Title      string   `json:"title,omitempty"`
	Interest   string   `json:"interest,omitempty"`
	Place      string   `json:"place,omitempty"`
	StartsIn   int64    `json:"startsIn,omitempty"`
	Duration   int64    `json:"duration,omitempty"`
	Name       string   `json:"name,omitempty"`
	Occupation string   `json:"occupation,omitempty"`
	Background string   `json:"background,omitempty"`
	Interests  []string `json:"interests,omitempty"`
}
type CommandResult struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
}
type TownError struct {
	Code   string
	Status int
}

func (e *TownError) Error() string            { return e.Code }
func townError(code string, status int) error { return &TownError{code, status} }
func cleanText(s string, min, max int) bool {
	return s == strings.TrimSpace(s) && utf8.RuneCountInString(s) >= min && utf8.RuneCountInString(s) <= max && strings.IndexFunc(s, func(r rune) bool { return unicode.IsControl(r) && r != '\n' && r != '\t' }) < 0
}

// All town mutations share the Tick and workspace-deletion fences.
func (r *Repository) mutateTown(ctx context.Context, workspace pgtype.UUID, fn func(*Simulation, db.LifeWorld, *db.Queries) error) error {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := db.New(tx)
	if _, err = q.LockLifeWorkspace(ctx, workspace); err != nil {
		return err
	}
	binding, err := q.GetLifeBinding(ctx)
	if err != nil {
		return err
	}
	if binding.WorkspaceID != workspace {
		return townError("life_uninitialized", 409)
	}
	binding, err = q.LockLifeWorld(ctx, binding.ID)
	if err != nil {
		return err
	}
	raw, err := q.GetLifeSnapshot(ctx, workspace)
	if err != nil {
		return err
	}
	var state Simulation
	if err = json.Unmarshal(raw, &state); err != nil {
		return err
	}
	state.Tick = binding.Tick
	hadTown := state.Town != nil
	initialTown := rawJSON(ensureTown(&state))
	if err = fn(&state, binding, q); err != nil {
		return err
	}
	if err = validateState(state); err != nil {
		return err
	}
	finalTown := rawJSON(state.Town)
	if !hadTown || !bytes.Equal(initialTown, finalTown) {
		if err = oneRow(q.SaveLifeTown(ctx, db.SaveLifeTownParams{ID: binding.ID, Town: finalTown})); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
func validateCommand(c TownCommand) error {
	if _, err := uuid.Parse(c.RequestID); err != nil {
		return townError("invalid_request", 400)
	}
	switch c.Kind {
	case "message":
		if !cleanText(c.Text, 1, 1000) || c.Title != "" || c.Name != "" {
			return townError("invalid_request", 400)
		}
	case "activity":
		_, ok := places[c.Place]
		if !ok || c.Place == "home" || !contains(interests, c.Interest) || !cleanText(c.Title, 1, 80) || c.StartsIn < 30 || c.StartsIn > 1200 || c.Duration < 15 || c.Duration > 180 || c.Text != "" || c.Name != "" {
			return townError("invalid_request", 400)
		}
	case "resident":
		if !cleanText(c.Name, 1, 40) || strings.IndexFunc(c.Name, unicode.IsControl) >= 0 || !cleanText(c.Background, 0, 400) || !contains(occupations, c.Occupation) || len(c.Interests) < 1 || len(c.Interests) > 3 || c.ResidentID != "" || c.Text != "" || c.Title != "" {
			return townError("invalid_request", 400)
		}
		seen := map[string]bool{}
		for _, i := range c.Interests {
			if !contains(interests, i) || seen[i] {
				return townError("invalid_request", 400)
			}
			seen[i] = true
		}
	default:
		return townError("invalid_request", 400)
	}
	if c.Kind != "resident" {
		if _, err := uuid.Parse(c.ResidentID); err != nil {
			return townError("invalid_request", 400)
		}
	}
	return nil
}
func (r *Repository) Command(ctx context.Context, workspaceID, userID string, c TownCommand, modelReady bool) (CommandResult, error) {
	var out CommandResult
	if err := validateCommand(c); err != nil {
		return out, err
	}
	workspace, err := util.ParseUUID(workspaceID)
	if err != nil {
		return out, townError("invalid_workspace", 400)
	}
	user, err := util.ParseUUID(userID)
	if err != nil {
		return out, townError("unauthenticated", 401)
	}
	request, _ := util.ParseUUID(c.RequestID)
	sum := sha256.Sum256(rawJSON(c))
	hash := hex.EncodeToString(sum[:])
	err = r.mutateTown(ctx, workspace, func(state *Simulation, binding db.LifeWorld, q *db.Queries) error {
		// Recheck membership after obtaining the same workspace fence used by deletion.
		var member bool
		var memberErr error
		member, memberErr = q.IsLifeMember(ctx, db.IsLifeMemberParams{WorkspaceID: workspace, UserID: user})
		if memberErr != nil {
			return memberErr
		}
		if !member {
			return townError("workspace_forbidden", 403)
		}
		old, e := q.GetLifeRequest(ctx, db.GetLifeRequestParams{WorldID: binding.ID, UserID: user, RequestID: request})
		if e == nil {
			if old.BodyHash != hash {
				return townError("idempotency_key_reused", 409)
			}
			return json.Unmarshal(old.Response, &out)
		}
		if !errors.Is(e, pgx.ErrNoRows) {
			return e
		}
		t := state.Town
		if c.Kind != "resident" {
			found := false
			for _, a := range state.Agents {
				if a.ID == c.ResidentID {
					found = true
				}
			}
			if !found {
				return townError("resident_not_found", 404)
			}
		}
		id := uuid.NewString()
		out = CommandResult{id, c.Kind}
		switch c.Kind {
		case "message":
			if !modelReady {
				return townError("life_model_unavailable", 503)
			}
			j := newJob("message", c.ResidentID, state.Tick, c.Text)
			j.ID = id
			if e = queueJob(t, j); e != nil {
				return townError("town_busy", 429)
			}
		case "activity":
			if t.Model.Mode == "llm" && !modelReady {
				return townError("life_model_unavailable", 503)
			}
			start := int((state.Tick + c.StartsIn) % 1440)
			opens, closes := placeHours(c.Place)
			if start < opens || start+int(c.Duration) > closes {
				return townError("place_closed", 400)
			}
			if len(t.Activities) >= 32 {
				index := -1
				for i, a := range t.Activities {
					if a.Status == "completed" || a.Status == "declined" || a.Status == "failed" {
						index = i
						break
					}
				}
				if index < 0 {
					return townError("activity_capacity", 409)
				}
				oldID := t.Activities[index].ID
				t.Activities = append(t.Activities[:index], t.Activities[index+1:]...)
				jobs := t.Jobs[:0]
				for _, j := range t.Jobs {
					if j.ActivityID == nil || *j.ActivityID != oldID {
						jobs = append(jobs, j)
					}
				}
				t.Jobs = jobs
			}
			for _, existing := range t.Activities {
				if existing.OrganizerID == c.ResidentID && contains([]string{"proposed", "scheduled", "active"}, existing.Status) && state.Tick+c.StartsIn < existing.EndTick && state.Tick+c.StartsIn+c.Duration > existing.StartTick {
					return townError("activity_conflict", 409)
				}
			}
			a := Activity{ID: id, OrganizerID: c.ResidentID, Title: c.Title, Interest: c.Interest, Place: c.Place, StartTick: state.Tick + c.StartsIn, EndTick: state.Tick + c.StartsIn + c.Duration, Status: "proposed", Attendees: []string{}}
			if modelReady {
				j := newJob("activity", c.ResidentID, state.Tick, c.Title)
				j.ActivityID = &a.ID
				if e = queueJob(t, j); e != nil {
					return townError("town_busy", 429)
				}
			} else {
				interested := false
				for _, p := range t.Profiles {
					if p.ResidentID == c.ResidentID {
						interested = contains(p.Interests, c.Interest)
					}
				}
				if interested {
					a.Status = "scheduled"
					a.Decision = "shared_interest"
				} else {
					a.Status = "declined"
					a.Decision = "different_interest"
				}
			}
			t.Activities = append(t.Activities, a)
		case "resident":
			if len(state.Agents) >= 60 {
				return townError("resident_capacity", 409)
			}
			a := Resident{ID: id, Name: c.Name, Position: Position{3, 6}, Energy: 85, Fullness: 85, Social: 65, Personality: Personality{60, 60, 60}, Goal: Goal{"coins", 20}}
			aid, _ := util.ParseUUID(id)
			if e = q.CreateLifeResident(ctx, db.CreateLifeResidentParams{WorldID: binding.ID, ID: aid, Name: a.Name, X: 3, Y: 6, Energy: 85, Fullness: 85, Social: 65, Personality: rawJSON(a.Personality), Goal: rawJSON(a.Goal)}); e != nil {
				return e
			}
			for _, v := range []Resource{{id, "food", 4}, {id, "wood", 0}, {id, "coins", 0}} {
				if e = q.CreateLifeResource(ctx, db.CreateLifeResourceParams{WorldID: binding.ID, Owner: v.Owner, Kind: v.Kind, Amount: int32(v.Amount)}); e != nil {
					return e
				}
				state.Resources = append(state.Resources, v)
			}
			state.Agents = append(state.Agents, a)
			t.Profiles = append(t.Profiles, Profile{ResidentID: id, Occupation: c.Occupation, Background: c.Background, Interests: c.Interests, Home: (len(state.Agents) - 1) % 4})
		}
		t.Revision++
		if e = q.AppendLifeEvent(ctx, db.AppendLifeEventParams{WorldID: binding.ID, ID: pgtype.UUID{Bytes: uuid.New(), Valid: true}, Tick: state.Tick, Kind: "town_command", Payload: rawJSON(map[string]any{"id": id, "kind": c.Kind, "residentId": c.ResidentID})}); e != nil {
			return e
		}
		return q.SaveLifeRequest(ctx, db.SaveLifeRequestParams{WorldID: binding.ID, UserID: user, RequestID: request, BodyHash: hash, Response: rawJSON(out)})
	})
	if errors.Is(err, pgx.ErrNoRows) {
		err = townError("life_uninitialized", 409)
	}
	return out, err
}
