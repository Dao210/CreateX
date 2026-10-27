package gameprogress

import (
	"context"
	"encoding/json"
	"time"
)

const (
	GameSiege   = "siege"
	GameTanks   = "tanks"
	SiegeLevels = 8
	TankLevels  = 6
)

type Actor struct {
	WorkspaceID string
	UserID      string
}

type actorKey struct{}

func WithActor(ctx context.Context, a Actor) context.Context {
	return context.WithValue(ctx, actorKey{}, a)
}

func ActorFromContext(ctx context.Context) (Actor, bool) {
	a, ok := ctx.Value(actorKey{}).(Actor)
	return a, ok && a.WorkspaceID != "" && a.UserID != ""
}

type Problem struct {
	Code   string
	Status int
}

func (p *Problem) Error() string { return p.Code }

func problem(code string, status int) *Problem { return &Problem{Code: code, Status: status} }

type SiegeProgress struct {
	Stars []int `json:"stars"`
}

type TankProgress struct {
	Best     int `json:"best"`
	Unlocked int `json:"unlocked"`
}

func validateSiege(p SiegeProgress) error {
	if len(p.Stars) != SiegeLevels {
		return problem("invalid_input", 400)
	}
	for _, stars := range p.Stars {
		if stars < 0 || stars > 3 {
			return problem("invalid_input", 400)
		}
	}
	return nil
}

func validateTanks(p TankProgress) error {
	if p.Best < 0 || p.Best > 1_000_000 || p.Unlocked < 1 || p.Unlocked > TankLevels {
		return problem("invalid_input", 400)
	}
	return nil
}

func mergeSiege(current []byte, candidate SiegeProgress) ([]byte, error) {
	merged := make([]int, SiegeLevels)
	if len(current) > 0 {
		var stored SiegeProgress
		if json.Unmarshal(current, &stored) == nil && validateSiege(stored) == nil {
			copy(merged, stored.Stars)
		}
	}
	for i, stars := range candidate.Stars {
		if stars > merged[i] {
			merged[i] = stars
		}
	}
	return json.Marshal(SiegeProgress{Stars: merged})
}

func mergeTanks(current []byte, candidate TankProgress) ([]byte, error) {
	merged := TankProgress{Best: 0, Unlocked: 1}
	if len(current) > 0 {
		var stored TankProgress
		if json.Unmarshal(current, &stored) == nil && validateTanks(stored) == nil {
			merged = stored
		}
	}
	if candidate.Best > merged.Best {
		merged.Best = candidate.Best
	}
	if candidate.Unlocked > merged.Unlocked {
		merged.Unlocked = candidate.Unlocked
	}
	return json.Marshal(merged)
}

type siegeView struct {
	Stars     []int  `json:"stars"`
	UpdatedAt string `json:"updatedAt"`
}

type tankView struct {
	Best      int    `json:"best"`
	Unlocked  int    `json:"unlocked"`
	UpdatedAt string `json:"updatedAt"`
}

func viewSiege(stored Stored) siegeView {
	progress := SiegeProgress{Stars: make([]int, SiegeLevels)}
	if json.Unmarshal(stored.Payload, &progress) != nil || validateSiege(progress) != nil {
		progress = SiegeProgress{Stars: make([]int, SiegeLevels)}
	}
	return siegeView{Stars: progress.Stars, UpdatedAt: stored.UpdatedAt.UTC().Format(time.RFC3339)}
}

func viewTanks(stored Stored) tankView {
	progress := TankProgress{Best: 0, Unlocked: 1}
	if json.Unmarshal(stored.Payload, &progress) != nil || validateTanks(progress) != nil {
		progress = TankProgress{Best: 0, Unlocked: 1}
	}
	return tankView{Best: progress.Best, Unlocked: progress.Unlocked, UpdatedAt: stored.UpdatedAt.UTC().Format(time.RFC3339)}
}
