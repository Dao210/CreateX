package life

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"reflect"

	"github.com/google/uuid"
)

const protocolVersion = 2
const maxFrame = 4 * 1024 * 1024

type Position struct {
	X int `json:"x"`
	Y int `json:"y"`
}
type Personality struct {
	Diligence   int `json:"diligence"`
	Sociability int `json:"sociability"`
	Curiosity   int `json:"curiosity"`
}
type Goal struct {
	Kind   string `json:"kind"`
	Target int    `json:"target"`
}
type Resident struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Position    Position    `json:"position"`
	Energy      int         `json:"energy"`
	Fullness    int         `json:"fullness"`
	Social      int         `json:"social"`
	Personality Personality `json:"personality"`
	Goal        Goal        `json:"goal"`
}
type Resource struct {
	Owner  string `json:"owner"`
	Kind   string `json:"kind"`
	Amount int    `json:"amount"`
}
type Intent struct {
	Kind     string    `json:"kind"`
	To       *Position `json:"to,omitempty"`
	TargetID string    `json:"targetId,omitempty"`
}
type Action struct {
	ID          string `json:"id"`
	AgentID     string `json:"agentId"`
	Intent      Intent `json:"intent"`
	Reason      string `json:"reason"`
	StartedTick int64  `json:"startedTick"`
	DueTick     int64  `json:"dueTick"`
	Status      string `json:"status"`
}
type Simulation struct {
	Town      *Town      `json:"town,omitempty"`
	Tick      int64      `json:"tick"`
	Agents    []Resident `json:"agents"`
	Resources []Resource `json:"resources"`
	Actions   []Action   `json:"actions"`
}
type Seed struct {
	Agents    []Resident `json:"agents"`
	Resources []Resource `json:"resources"`
	TickMS    int        `json:"tickMs"`
}
type EngineEvent struct {
	ActionID *string         `json:"actionId"`
	AgentID  *string         `json:"agentId"`
	Kind     string          `json:"kind"`
	Payload  json.RawMessage `json:"payload"`
}
type TickResult struct {
	State     Simulation    `json:"state"`
	Completed []Action      `json:"completed"`
	Started   []Action      `json:"started"`
	Events    []EngineEvent `json:"events"`
}

func strictJSON(raw []byte, value any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(value); err != nil {
		return err
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return errors.New("unexpected trailing engine data")
	}
	return nil
}

func validateState(s Simulation) error {
	if s.Tick < 0 || s.Tick > 9007199254740991 || len(s.Agents) < 1 || len(s.Agents) > 60 || len(s.Resources) != len(s.Agents)*3+2 || len(s.Actions) > len(s.Agents) {
		return errors.New("invalid simulation size or clock")
	}
	agents := map[string]bool{}
	for _, a := range s.Agents {
		if _, e := uuid.Parse(a.ID); e != nil || agents[a.ID] {
			return errors.New("invalid resident identity")
		}
		agents[a.ID] = true
		if a.Position.X < 0 || a.Position.X > 11 || a.Position.Y < 0 || a.Position.Y > 7 || a.Energy < 0 || a.Energy > 100 || a.Fullness < 0 || a.Fullness > 100 || a.Social < 0 || a.Social > 100 || a.Goal.Target <= 0 || a.Goal.Target > math.MaxInt32 || (a.Goal.Kind != "wood" && a.Goal.Kind != "coins") {
			return errors.New("invalid resident state")
		}
	}
	resources := map[string]bool{}
	for _, r := range s.Resources {
		key := r.Owner + "/" + r.Kind
		if resources[key] || r.Amount < 0 || r.Amount > math.MaxInt32 || (!agents[r.Owner] && r.Owner != "forest" && r.Owner != "farm") || (r.Kind != "food" && r.Kind != "wood" && r.Kind != "coins") {
			return errors.New("invalid resource balance")
		}
		resources[key] = true
	}
	if !resources["forest/wood"] || !resources["farm/food"] {
		return errors.New("missing world resources")
	}
	for id := range agents {
		for _, kind := range []string{"food", "wood", "coins"} {
			if !resources[id+"/"+kind] {
				return errors.New("missing resident inventory")
			}
		}
	}
	ids, owners := map[string]bool{}, map[string]bool{}
	for _, a := range s.Actions {
		if _, err := uuid.Parse(a.ID); err != nil || ids[a.ID] || owners[a.AgentID] || !agents[a.AgentID] || a.Status != "running" || a.StartedTick < 0 || a.StartedTick > s.Tick || a.DueTick <= a.StartedTick {
			return errors.New("invalid running action")
		}
		ids[a.ID] = true
		owners[a.AgentID] = true
	}
	return validateTown(s.Town, agents, s.Tick)
}

func validateResult(before Simulation, result TickResult) error {
	after := result.State
	if err := validateState(after); err != nil {
		return err
	}
	if after.Tick != before.Tick+1 || len(after.Agents) != len(before.Agents) || len(after.Actions) != len(after.Agents) || len(result.Events) > 300 {
		return errors.New("invalid tick transition")
	}
	if before.Town != nil && (after.Town == nil || before.Town.Revision != after.Town.Revision) {
		return errors.New("engine changed town revision")
	}
	oldAgents := map[string]Resident{}
	for _, a := range before.Agents {
		oldAgents[a.ID] = a
	}
	for _, a := range after.Agents {
		old, ok := oldAgents[a.ID]
		if !ok || old.Name != a.Name || old.Goal != a.Goal || old.Personality != a.Personality {
			return errors.New("engine changed resident identity")
		}
	}
	oldResources := map[string]bool{}
	for _, r := range before.Resources {
		oldResources[r.Owner+"/"+r.Kind] = true
	}
	for _, r := range after.Resources {
		if !oldResources[r.Owner+"/"+r.Kind] {
			return errors.New("engine changed inventory identity")
		}
	}
	pending := map[string]Action{}
	for _, a := range before.Actions {
		pending[a.ID] = a
	}
	terminal := map[string]Action{}
	for _, a := range result.Completed {
		old, ok := pending[a.ID]
		status := a.Status
		a.Status = old.Status
		if !ok || terminal[a.ID].ID != "" || !reflect.DeepEqual(a, old) || old.DueTick > after.Tick || (status != "completed" && status != "failed") {
			return errors.New("invalid action settlement")
		}
		a.Status = status
		terminal[a.ID] = a
	}
	next := map[string]Action{}
	for _, a := range before.Actions {
		if terminal[a.ID].ID == "" {
			if a.DueTick <= after.Tick {
				return errors.New("due action not settled")
			}
			next[a.ID] = a
		}
	}
	for _, a := range result.Started {
		if pending[a.ID].ID != "" || next[a.ID].ID != "" || a.StartedTick != after.Tick || a.Status != "running" || a.DueTick <= after.Tick {
			return errors.New("invalid new action")
		}
		next[a.ID] = a
	}
	if len(next) != len(after.Actions) {
		return errors.New("action projection differs")
	}
	for _, a := range after.Actions {
		if !reflect.DeepEqual(a, next[a.ID]) {
			return errors.New("action projection differs")
		}
	}
	traced := map[string]bool{}
	for _, e := range result.Events {
		if e.ActionID != nil {
			a, ok := terminal[*e.ActionID]
			want := "action_" + a.Status
			if !ok || traced[a.ID] || e.AgentID == nil || *e.AgentID != a.AgentID || e.Kind != want {
				return errors.New("invalid terminal event")
			}
			traced[a.ID] = true
		} else if e.Kind != "resources_replenished" && e.Kind != "goal_reached" && e.Kind != "town_conversation" && e.Kind != "town_activity" {
			return errors.New("invalid world event")
		}
		if !json.Valid(e.Payload) {
			return errors.New("invalid event payload")
		}
	}
	if len(traced) != len(terminal) {
		return fmt.Errorf("missing terminal events: %d/%d", len(traced), len(terminal))
	}
	return nil
}
