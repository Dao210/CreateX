// Package gameadmin controls world game availability and navigation discovery.
package gameadmin

import (
	"errors"
	"math"
	"sort"
	"time"

	"github.com/auro-ai/auro/server/internal/util"
)

var ErrInvalid = errors.New("invalid_game_policy")
var ErrNotFound = errors.New("game_not_found")
var ErrConflict = errors.New("revision_conflict")

var GameIDs = []string{"siege", "life", "tanks"}

func known(id string) bool { return id == "siege" || id == "tanks" || id == "life" }

type World struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
}
type Override struct {
	WorkspaceID string `json:"workspaceId"`
	Access      string `json:"access"`
	Visibility  string `json:"visibility"`
}
type Policy struct {
	GameID         string     `json:"gameId"`
	Scope          string     `json:"scope"`
	DefaultVisible bool       `json:"defaultVisible"`
	Overrides      []Override `json:"overrides"`
	Revision       int        `json:"revision"`
	UpdatedBy      string     `json:"updatedBy,omitempty"`
	UpdatedAt      *time.Time `json:"updatedAt,omitempty"`
}
type PolicyInput struct {
	ExpectedRevision int        `json:"expectedRevision"`
	Scope            string     `json:"scope"`
	DefaultVisible   *bool      `json:"defaultVisible"`
	Overrides        []Override `json:"overrides"`
}
type Effective struct {
	GameID    string `json:"gameId"`
	Available bool   `json:"available"`
	Visible   bool   `json:"visible"`
	Reason    string `json:"reason"`
}
type Impact struct {
	Total     int64 `json:"total"`
	Available int64 `json:"available"`
	Visible   int64 `json:"visible"`
}
type Binding struct {
	World     World     `json:"world"`
	UpdatedAt time.Time `json:"updatedAt"`
}
type Overview struct {
	Policy  Policy   `json:"policy"`
	Worlds  []World  `json:"worlds"`
	Impact  Impact   `json:"impact"`
	Binding *Binding `json:"binding"`
}

func defaultPolicy(id string) Policy {
	scope := "all"
	if id == "life" {
		scope = "bound"
	}
	return Policy{GameID: id, Scope: scope, DefaultVisible: true, Overrides: []Override{}}
}

func Resolve(id, scope string, defaultVisible bool, access, visibility string, bound bool) Effective {
	out := Effective{GameID: id, Reason: "scope"}
	if scope == "disabled" {
		out.Reason = "disabled"
		return out
	}
	if id == "life" && !bound {
		out.Reason = "unbound"
		return out
	}
	if access == "deny" {
		out.Reason = "world_denied"
		return out
	}
	out.Available = scope == "all" || scope == "bound" || scope == "selected" && access == "allow"
	if !out.Available {
		return out
	}
	out.Visible = visibility == "show" || visibility != "hide" && defaultVisible
	out.Reason = "available"
	return out
}

func normalize(id string, in PolicyInput) (Policy, error) {
	if !known(id) {
		return Policy{}, ErrNotFound
	}
	if in.DefaultVisible == nil || in.Overrides == nil || len(in.Overrides) > 500 || in.ExpectedRevision < 0 || in.ExpectedRevision >= math.MaxInt32 {
		return Policy{}, ErrInvalid
	}
	if id == "life" {
		if in.Scope != "bound" && in.Scope != "disabled" {
			return Policy{}, ErrInvalid
		}
	} else if in.Scope != "all" && in.Scope != "selected" && in.Scope != "disabled" {
		return Policy{}, ErrInvalid
	}
	out := defaultPolicy(id)
	out.Scope, out.DefaultVisible, out.Revision = in.Scope, *in.DefaultVisible, in.ExpectedRevision
	seen := map[string]bool{}
	for _, override := range in.Overrides {
		parsed, err := util.ParseUUID(override.WorkspaceID)
		if err != nil {
			return Policy{}, ErrInvalid
		}
		override.WorkspaceID = util.UUIDToString(parsed)
		if seen[override.WorkspaceID] || (override.Access != "inherit" && override.Access != "allow" && override.Access != "deny") || (override.Visibility != "inherit" && override.Visibility != "show" && override.Visibility != "hide") {
			return Policy{}, ErrInvalid
		}
		seen[override.WorkspaceID] = true
		if override.Access != "inherit" || override.Visibility != "inherit" {
			out.Overrides = append(out.Overrides, override)
		}
	}
	sort.Slice(out.Overrides, func(i, j int) bool { return out.Overrides[i].WorkspaceID < out.Overrides[j].WorkspaceID })
	return out, nil
}
