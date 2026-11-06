package life

import (
	"errors"
	"unicode/utf8"

	"github.com/google/uuid"
)

type StoragePrototype struct {
	ID          string  `json:"id"`
	AuthorID    *string `json:"authorId"`
	Name        string  `json:"name"`
	Variant     string  `json:"variant"`
	CreatedTick int64   `json:"createdTick"`
}
type ProjectMember struct {
	ResidentID      string `json:"residentId"`
	JoinedTick      int64  `json:"joinedTick"`
	Wood            int    `json:"wood"`
	Labor           int    `json:"labor"`
	Deposited       int    `json:"deposited"`
	Withdrawn       int    `json:"withdrawn"`
	WithdrawalDay   int64  `json:"withdrawalDay"`
	TodayWithdrawn  int    `json:"todayWithdrawn"`
	LastMaintenance int64  `json:"lastMaintenance"`
}
type CivicRule struct {
	Revision     int      `json:"revision"`
	Distribution string   `json:"distribution"`
	Maintenance  string   `json:"maintenance"`
	EnactedTick  int64    `json:"enactedTick"`
	Supporters   []string `json:"supporters"`
}
type CivicProject struct {
	DeclinedBy          []string        `json:"declinedBy,omitempty"`
	ID                  string          `json:"id"`
	OrganizerID         string          `json:"organizerId"`
	PrototypeID         string          `json:"prototypeId"`
	Variant             string          `json:"variant"`
	Position            Position        `json:"position"`
	Status              string          `json:"status"`
	CreatedTick         int64           `json:"createdTick"`
	CompletedTick       *int64          `json:"completedTick"`
	KnownBy             []string        `json:"knownBy"`
	Members             []ProjectMember `json:"members"`
	Wood                int             `json:"wood"`
	Labor               int             `json:"labor"`
	Food                int             `json:"food"`
	Condition           int             `json:"condition"`
	Rule                CivicRule       `json:"rule"`
	LastReviewTick      int64           `json:"lastReviewTick"`
	LastGatheringDay    int64           `json:"lastGatheringDay"`
	GatheringIDs        []string        `json:"gatheringIds"`
	GatheringsCompleted int             `json:"gatheringsCompleted"`
}
type CivicVote struct {
	ResidentID string `json:"residentId"`
	Approve    bool   `json:"approve"`
	Tick       int64  `json:"tick"`
}
type CivicDebate struct {
	ID           string      `json:"id"`
	ProjectID    string      `json:"projectId"`
	ProposerID   string      `json:"proposerId"`
	Distribution string      `json:"distribution"`
	Maintenance  string      `json:"maintenance"`
	CreatedTick  int64       `json:"createdTick"`
	ExpiresTick  int64       `json:"expiresTick"`
	Status       string      `json:"status"`
	KnownBy      []string    `json:"knownBy"`
	Votes        []CivicVote `json:"votes"`
}
type CivicNews struct {
	Rule       *CivicRule `json:"rule"`
	ID         string     `json:"id"`
	ProjectID  string     `json:"projectId"`
	ResidentID string     `json:"residentId"`
	OtherID    *string    `json:"otherId"`
	Tick       int64      `json:"tick"`
	Kind       string     `json:"kind"`
	Amount     int        `json:"amount"`
	SourceID   *string    `json:"sourceId"`
	Evidence   []string   `json:"evidence"`
}
type PrototypeSuggestion struct {
	ID          string `json:"id"`
	PrototypeID string `json:"prototypeId"`
	ResidentID  string `json:"residentId"`
	CreatedTick int64  `json:"createdTick"`
	Status      string `json:"status"`
}
type Civilization struct {
	Version     int                   `json:"version"`
	Prototypes  []StoragePrototype    `json:"prototypes"`
	Projects    []CivicProject        `json:"projects"`
	Debates     []CivicDebate         `json:"debates"`
	News        []CivicNews           `json:"news"`
	Suggestions []PrototypeSuggestion `json:"suggestions"`
}

func ensureCivilization(town *Town) *Civilization {
	if town.Civilization == nil {
		town.Civilization = &Civilization{Version: 1, Prototypes: []StoragePrototype{}, Projects: []CivicProject{}, Debates: []CivicDebate{}, News: []CivicNews{}, Suggestions: []PrototypeSuggestion{}}
	}
	return town.Civilization
}

func validateCivilization(c *Civilization, agents map[string]bool, tick int64) error {
	if c == nil {
		return nil
	}
	invalid := errors.New("invalid civilization state")
	validID := func(id string) bool { _, err := uuid.Parse(id); return err == nil }
	if c.Version != 1 || len(c.Prototypes) > 24 || len(c.Projects) > 3 || len(c.Debates) > 24 || len(c.News) > 96 || len(c.Suggestions) > 24 {
		return invalid
	}
	prototypes, projects := map[string]bool{}, map[string]bool{}
	variants := map[string]string{}
	projectMembers := map[string]map[string]bool{}
	for _, p := range c.Prototypes {
		if !validID(p.ID) || prototypes[p.ID] || !contains([]string{"light", "sturdy", "large"}, p.Variant) || utf8.RuneCountInString(p.Name) > 60 || p.CreatedTick < 0 || p.CreatedTick > tick {
			return invalid
		}
		if p.AuthorID != nil && !validID(*p.AuthorID) {
			return invalid
		}
		prototypes[p.ID] = true
		variants[p.ID] = p.Variant
	}
	for _, p := range c.Projects {
		if !validID(p.ID) || projects[p.ID] || !agents[p.OrganizerID] || !prototypes[p.PrototypeID] || variants[p.PrototypeID] != p.Variant || !contains([]string{"light", "sturdy", "large"}, p.Variant) || !contains([]string{"proposed", "gathering", "building", "active", "paused", "abandoned"}, p.Status) || p.CreatedTick < 0 || p.CreatedTick > tick || len(p.KnownBy) > 60 || len(p.DeclinedBy) > 60 || len(p.Members) < 1 || len(p.Members) > 60 || p.Wood < 0 || p.Wood > 10000 || p.Labor < 0 || p.Labor > 10000 || p.Food < 0 || p.Food > 1000 || p.Condition < 0 || p.Condition > 100 || len(p.GatheringIDs) > 30 || p.LastGatheringDay < -1 || p.GatheringsCompleted < 0 || p.GatheringsCompleted > 100000 || p.LastReviewTick < 0 || p.LastReviewTick > tick || p.Rule.EnactedTick < 0 || p.Rule.EnactedTick > tick || p.Rule.Revision > 100000 {
			return invalid
		}
		if p.Position.X < 0 || p.Position.X > 11 || p.Position.Y < 0 || p.Position.Y > 7 || p.Rule.Revision < 1 || !contains([]string{"equal", "contribution"}, p.Rule.Distribution) || !contains([]string{"volunteer", "rotation"}, p.Rule.Maintenance) {
			return invalid
		}
		if p.CompletedTick != nil && (*p.CompletedTick < p.CreatedTick || *p.CompletedTick > tick) {
			return invalid
		}
		known, members := map[string]bool{}, map[string]bool{}
		for _, id := range p.KnownBy {
			if !agents[id] || known[id] {
				return invalid
			}
			known[id] = true
		}
		for _, m := range p.Members {
			if !agents[m.ResidentID] || members[m.ResidentID] || !known[m.ResidentID] || m.JoinedTick < 0 || m.JoinedTick > tick || m.WithdrawalDay < 0 || m.LastMaintenance < 0 || m.LastMaintenance > tick || m.Wood > 10000 || m.Labor > 10000 || m.Deposited > 100000 || m.Withdrawn > 100000 || m.Wood < 0 || m.Labor < 0 || m.Deposited < 0 || m.Withdrawn < 0 || m.TodayWithdrawn < 0 || m.TodayWithdrawn > 100 {
				return invalid
			}
			members[m.ResidentID] = true
		}
		declined := map[string]bool{}
		for _, id := range p.DeclinedBy {
			if !known[id] || members[id] || declined[id] {
				return invalid
			}
			declined[id] = true
		}
		supporters := map[string]bool{}
		for _, id := range p.Rule.Supporters {
			if supporters[id] || !members[id] {
				return invalid
			}
			supporters[id] = true
		}
		for _, id := range p.GatheringIDs {
			if !validID(id) {
				return invalid
			}
		}
		projectMembers[p.ID] = members
		projects[p.ID] = true
	}
	debates := map[string]bool{}
	for _, d := range c.Debates {
		if !validID(d.ID) || debates[d.ID] || !projects[d.ProjectID] || !projectMembers[d.ProjectID][d.ProposerID] || d.CreatedTick < 0 || d.CreatedTick > tick || d.ExpiresTick <= d.CreatedTick || len(d.Votes) > 60 || len(d.KnownBy) > 60 || !contains([]string{"open", "adopted", "rejected"}, d.Status) || !contains([]string{"equal", "contribution"}, d.Distribution) || !contains([]string{"volunteer", "rotation"}, d.Maintenance) {
			return invalid
		}
		debates[d.ID] = true
		known := map[string]bool{}
		for _, id := range d.KnownBy {
			if !agents[id] || known[id] {
				return invalid
			}
			known[id] = true
		}
		voters := map[string]bool{}
		for _, v := range d.Votes {
			if !projectMembers[d.ProjectID][v.ResidentID] || voters[v.ResidentID] || !contains(d.KnownBy, v.ResidentID) || v.Tick < d.CreatedTick || v.Tick > tick {
				return invalid
			}
			voters[v.ResidentID] = true
		}
	}
	newsIDs := map[string]bool{}
	for _, n := range c.News {
		if !validID(n.ID) || newsIDs[n.ID] || !projects[n.ProjectID] || !agents[n.ResidentID] || n.Tick < 0 || n.Tick > tick || len(n.Evidence) > 6 || n.Amount < 0 || n.Amount > 100000 {
			return invalid
		}
		newsIDs[n.ID] = true
		if n.Rule != nil {
			if n.Rule.Revision < 1 || n.Rule.EnactedTick < 0 || n.Rule.EnactedTick > tick || !contains([]string{"equal", "contribution"}, n.Rule.Distribution) || !contains([]string{"volunteer", "rotation"}, n.Rule.Maintenance) || len(n.Rule.Supporters) > 60 {
				return invalid
			}
			for _, id := range n.Rule.Supporters {
				if !agents[id] {
					return invalid
				}
			}
		}
		if n.OtherID != nil && !agents[*n.OtherID] {
			return invalid
		}
		if n.SourceID != nil && !validID(*n.SourceID) {
			return invalid
		}
		for _, id := range n.Evidence {
			if !validID(id) {
				return invalid
			}
		}
		if !contains([]string{"proposed", "discovered", "joined", "declined", "delivered", "construction", "completed", "deposited", "withdrawn", "maintenance", "rule_proposed", "rule_voted", "rule_adopted", "rule_rejected", "gathering", "tradition"}, n.Kind) {
			return invalid
		}
	}
	suggestions := map[string]bool{}
	for _, s := range c.Suggestions {
		if !validID(s.ID) || suggestions[s.ID] || !prototypes[s.PrototypeID] || !agents[s.ResidentID] || s.CreatedTick < 0 || s.CreatedTick > tick || !contains([]string{"pending", "accepted", "declined"}, s.Status) {
			return invalid
		}
		suggestions[s.ID] = true
	}
	return nil
}
