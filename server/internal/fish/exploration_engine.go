package fish

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/auro-ai/auro/server/internal/worldinbox"
)

const explorationMemoryLimit = 128
const explorationPendingLimit = 8

type explorationState struct {
	Version  int                       `json:"version"`
	Position [3]float64                `json:"position"`
	Velocity [3]float64                `json:"velocity"`
	Known    map[string]int64          `json:"known"`
	Pending  []worldinbox.FishSighting `json:"pending"`
}

type explorer struct {
	Resident        Resident
	Workspace, User string
	State           explorationState
}

func newExploration(resident Resident) explorationState {
	random := func(n float64) float64 {
		v := math.Sin(float64(resident.Seed)*0.01+n*78.233) * 43758.5453
		return v - math.Floor(v)
	}
	angle, speed := random(1)*math.Pi*2, float64(resident.Fish.Draft.Motion.Speed)/1000
	return explorationState{Version: 1, Position: [3]float64{(random(2) - 0.5) * 16, 1.5 + float64(resident.Fish.Draft.Behavior.Depth)/1000*5, (random(3) - 0.5) * 10}, Velocity: [3]float64{math.Cos(angle) * speed, 0, math.Sin(angle) * speed}, Known: map[string]int64{}}
}

func validExploration(s explorationState) bool {
	if s.Version != 1 || s.Known == nil || len(s.Known) > explorationMemoryLimit || len(s.Pending) > explorationPendingLimit {
		return false
	}
	for i, v := range s.Position {
		if math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > []float64{12, 8, 8}[i] {
			return false
		}
	}
	for _, v := range s.Velocity {
		if math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > 2 {
			return false
		}
	}
	return true
}

// Movement is a coarse, authoritative exploration simulation. Browser poses remain presentation.
func advanceExplorers(fish []*explorer, tick int64, at time.Time) {
	for _, f := range fish {
		s := &f.State
		spec := f.Resident.Fish.Draft
		t := float64(tick)
		seed := float64(f.Resident.Seed)
		force := [3]float64{math.Sin(t*0.13+seed) * 0.18, (1.5 + float64(spec.Behavior.Depth)*0.005 - s.Position[1]) * 0.35, math.Cos(t*0.11+seed) * 0.18}
		for _, i := range []int{0, 2} {
			limit := 12.0
			if i == 2 {
				limit = 8
			}
			if math.Abs(s.Position[i]) > limit-2.5 {
				force[i] -= math.Copysign((math.Abs(s.Position[i])-limit+2.5)*0.65, s.Position[i])
			}
		}
		for _, rock := range [][3]float64{{-5, 0.9, -2}, {5, 0.7, -4}} {
			dx, dy, dz := s.Position[0]-rock[0], s.Position[1]-rock[1], s.Position[2]-rock[2]
			d := math.Max(0.1, math.Sqrt(dx*dx+dy*dy+dz*dz))
			if d < 3 {
				for i, v := range [3]float64{dx, dy, dz} {
					force[i] += v / d * (3 - d) * 0.6
				}
			}
		}
		var magnitude float64
		for i := range s.Velocity {
			s.Velocity[i] += force[i]
			magnitude += s.Velocity[i] * s.Velocity[i]
		}
		magnitude = math.Sqrt(magnitude)
		if magnitude < 0.001 {
			s.Velocity = [3]float64{1, 0, 0}
			magnitude = 1
		}
		for i := range s.Position {
			s.Velocity[i] = s.Velocity[i] / magnitude * float64(spec.Motion.Speed) / 1000
			s.Position[i] += s.Velocity[i]
		}
		s.Position[0] = math.Max(-12, math.Min(12, s.Position[0]))
		s.Position[1] = math.Max(0.7, math.Min(7.5, s.Position[1]))
		s.Position[2] = math.Max(-8, math.Min(8, s.Position[2]))
	}
	observeExplorers(fish, at)
}

func remember(f *explorer, key string, sighting worldinbox.FishSighting) {
	if previous, ok := f.State.Known[key]; ok && (sighting.Kind == "discovery" || sighting.OccurredAt.Unix()-previous < 7*24*60*60) {
		return
	}
	if len(f.State.Pending) >= explorationPendingLimit {
		return
	}
	if len(f.State.Known) >= explorationMemoryLimit {
		oldest := ""
		for k, at := range f.State.Known {
			if strings.HasPrefix(k, "peer/") && (oldest == "" || at < f.State.Known[oldest] || at == f.State.Known[oldest] && k < oldest) {
				oldest = k
			}
		}
		if oldest == "" {
			return
		}
		delete(f.State.Known, oldest)
	}
	f.State.Known[key] = sighting.OccurredAt.Unix()
	f.State.Pending = append(f.State.Pending, sighting)
}

func observeExplorers(fish []*explorer, at time.Time) {
	cell := func(p [3]float64) [3]int {
		return [3]int{int(math.Floor(p[0] / 3)), int(math.Floor(p[1] / 3)), int(math.Floor(p[2] / 3))}
	}
	grid := map[[3]int][]*explorer{}
	for _, f := range fish {
		c := cell(f.State.Position)
		grid[c] = append(grid[c], f)
	}
	for _, f := range fish {
		if len(f.State.Pending) >= explorationPendingLimit {
			continue
		}
		p := f.State.Position
		places := []string{}
		if math.Hypot(p[0]+5, p[2]+2) < 3.5 {
			places = append(places, "west_reef")
		}
		if math.Hypot(p[0]-5, p[2]+4) < 3.2 {
			places = append(places, "east_reef")
		}
		if p[1] > 5.7 {
			places = append(places, "upper_water")
		}
		if p[1] < 2.6 {
			places = append(places, "deep_water")
		}
		for _, place := range places {
			remember(f, "area/"+place, worldinbox.FishSighting{Kind: "discovery", Place: place, Position: p, OccurredAt: at})
		}
		c := cell(p)
		for x := -1; x <= 1; x++ {
			for y := -1; y <= 1; y++ {
				for z := -1; z <= 1; z++ {
					for _, other := range grid[[3]int{c[0] + x, c[1] + y, c[2] + z}] {
						if len(f.State.Pending) >= explorationPendingLimit {
							break
						}
						if other == f {
							continue
						}
						q := other.State.Position
						if math.Sqrt(math.Pow(p[0]-q[0], 2)+math.Pow(p[1]-q[1], 2)+math.Pow(p[2]-q[2], 2)) > 2.5 {
							continue
						}
						draft := other.Resident.Fish.Draft
						remember(f, "peer/"+other.Resident.ID, worldinbox.FishSighting{Kind: "encounter", PeerID: other.Resident.ID, PeerName: draft.Name, Pattern: draft.Appearance.Pattern, Glow: draft.Appearance.Glow > 0, Position: p, OccurredAt: at})
					}
				}
			}
		}
	}
}

func letterCandidates(fish []*explorer) []*explorer {
	candidates := []*explorer{}
	for _, f := range fish {
		if len(f.State.Pending) > 0 {
			candidates = append(candidates, f)
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		a, b := candidates[i], candidates[j]
		if a.State.Pending[0].OccurredAt.Equal(b.State.Pending[0].OccurredAt) {
			return a.Resident.ID < b.Resident.ID
		}
		return a.State.Pending[0].OccurredAt.Before(b.State.Pending[0].OccurredAt)
	})
	return candidates
}

func explorationLetterKey(user string, at time.Time) string {
	return fmt.Sprintf("fish-letter/%s/%s", user, worldinbox.FishLetterDay(at))
}
