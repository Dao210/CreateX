package life

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

type Profile struct {
	ResidentID string   `json:"residentId"`
	Occupation string   `json:"occupation"`
	Background string   `json:"background"`
	Interests  []string `json:"interests"`
	Home       int      `json:"home"`
}
type Memory struct {
	ID         string   `json:"id"`
	ResidentID string   `json:"residentId"`
	Tick       int64    `json:"tick"`
	Kind       string   `json:"kind"`
	SourceID   string   `json:"sourceId"`
	OtherID    *string  `json:"otherId"`
	Text       string   `json:"text"`
	Importance int      `json:"importance"`
	Evidence   []string `json:"evidence"`
}
type Relationship struct {
	ResidentID  string `json:"residentId"`
	OtherID     string `json:"otherId"`
	Familiarity int    `json:"familiarity"`
	Trust       int    `json:"trust"`
	LastTick    int64  `json:"lastTick"`
}
type PlanSlot struct {
	Start   int    `json:"start"`
	End     int    `json:"end"`
	Place   string `json:"place"`
	Purpose string `json:"purpose"`
	Reason  string `json:"reason"`
}
type Plan struct {
	ResidentID string     `json:"residentId"`
	Day        int64      `json:"day"`
	Source     string     `json:"source"`
	Slots      []PlanSlot `json:"slots"`
}
type Activity struct {
	ID          string   `json:"id"`
	OrganizerID string   `json:"organizerId"`
	Title       string   `json:"title"`
	Interest    string   `json:"interest"`
	Place       string   `json:"place"`
	StartTick   int64    `json:"startTick"`
	EndTick     int64    `json:"endTick"`
	Status      string   `json:"status"`
	Decision    string   `json:"decision"`
	Attendees   []string `json:"attendees"`
}
type Line struct {
	SpeakerID *string `json:"speakerId"`
	Text      string  `json:"text"`
}
type Conversation struct {
	ID          string   `json:"id"`
	Tick        int64    `json:"tick"`
	ResidentID  string   `json:"residentId"`
	OtherID     *string  `json:"otherId"`
	Source      string   `json:"source"`
	Lines       []Line   `json:"lines"`
	ActivityIDs []string `json:"activityIds"`
}
type ModelJob struct {
	ID          string  `json:"id"`
	ResidentID  string  `json:"residentId"`
	OtherID     *string `json:"otherId"`
	ActivityID  *string `json:"activityId"`
	Kind        string  `json:"kind"`
	Status      string  `json:"status"`
	CreatedTick int64   `json:"createdTick"`
	Day         int64   `json:"day"`
	Text        string  `json:"text"`
	Lease       string  `json:"lease"`
	LeaseUntil  int64   `json:"leaseUntil"`
	Error       string  `json:"error"`
}
type ModelStatus struct {
	Mode          string `json:"mode"`
	State         string `json:"state"`
	ResidentLimit int    `json:"residentLimit"`
	DailyLimit    int    `json:"dailyLimit"`
	BudgetDay     string `json:"budgetDay"`
	Calls         int    `json:"calls"`
}
type Town struct {
	Version       int            `json:"version"`
	Revision      int64          `json:"revision"`
	Profiles      []Profile      `json:"profiles"`
	Memories      []Memory       `json:"memories"`
	Relationships []Relationship `json:"relationships"`
	Plans         []Plan         `json:"plans"`
	Activities    []Activity     `json:"activities"`
	Conversations []Conversation `json:"conversations"`
	Jobs          []ModelJob     `json:"jobs"`
	Model         ModelStatus    `json:"model"`
}

var places = map[string]Position{"home": {2, 2}, "farm": {9, 2}, "forest": {9, 6}, "square": {3, 6}, "cafe": {6, 5}, "library": {6, 2}, "shop": {10, 4}}
var occupations = []string{"librarian", "farmer", "artist", "builder", "baker", "merchant"}
var interests = []string{"reading", "nature", "art", "community", "cooking"}

func contains(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}
func residentProfile(a Resident, i int) Profile {
	return Profile{ResidentID: a.ID, Occupation: occupations[i%len(occupations)], Background: "", Interests: []string{interests[i%len(interests)]}, Home: i % 4}
}
func ensureTown(state *Simulation) *Town {
	if state.Town != nil {
		return state.Town
	}
	t := &Town{Version: 1, Profiles: []Profile{}, Memories: []Memory{}, Relationships: []Relationship{}, Plans: []Plan{}, Activities: []Activity{}, Conversations: []Conversation{}, Jobs: []ModelJob{}, Model: ModelStatus{Mode: "rules", State: "rules", ResidentLimit: 5, DailyLimit: 100}}
	for i, a := range state.Agents {
		t.Profiles = append(t.Profiles, residentProfile(a, i))
	}
	state.Town = t
	return t
}
func validateTown(t *Town, agents map[string]bool, tick int64) error {
	if t == nil {
		return nil
	}
	if t.Version != 1 || t.Revision < 0 || len(t.Profiles) != len(agents) || len(t.Memories) > 1200 || len(t.Relationships) > 720 || len(t.Plans) > 60 || len(t.Activities) > 32 || len(t.Conversations) > 80 || len(t.Jobs) > 64 {
		return errors.New("invalid town bounds")
	}
	seen := map[string]bool{}
	for _, p := range t.Profiles {
		if !agents[p.ResidentID] || seen[p.ResidentID] || !contains(occupations, p.Occupation) || len(p.Interests) < 1 || len(p.Interests) > 3 || p.Home < 0 || p.Home > 3 || utf8.RuneCountInString(p.Background) > 400 {
			return errors.New("invalid town profile")
		}
		seen[p.ResidentID] = true
		for _, i := range p.Interests {
			if !contains(interests, i) {
				return errors.New("invalid profile interest")
			}
		}
	}
	validID := func(id string) bool { _, err := uuid.Parse(id); return err == nil }
	for _, m := range t.Memories {
		if !validID(m.ID) || !validID(m.SourceID) || !agents[m.ResidentID] || m.Tick < 0 || m.Tick > tick || m.Importance < 1 || m.Importance > 10 || len(m.Evidence) > 12 || utf8.RuneCountInString(m.Text) > 500 {
			return errors.New("invalid resident memory")
		}
		if m.OtherID != nil && !agents[*m.OtherID] {
			return errors.New("invalid memory contact")
		}
	}
	for _, r := range t.Relationships {
		if !agents[r.ResidentID] || !agents[r.OtherID] || r.ResidentID == r.OtherID || r.Familiarity < 0 || r.Familiarity > 100 || r.Trust < -100 || r.Trust > 100 || r.LastTick > tick {
			return errors.New("invalid resident relationship")
		}
	}
	for _, p := range t.Plans {
		if !agents[p.ResidentID] || p.Day < 0 || !contains([]string{"rules", "model"}, p.Source) || validateSlots(p.Slots) != nil {
			return errors.New("invalid resident plan")
		}
	}
	acts := map[string]bool{}
	for _, a := range t.Activities {
		if !validID(a.ID) || acts[a.ID] || !agents[a.OrganizerID] || utf8.RuneCountInString(a.Title) < 1 || utf8.RuneCountInString(a.Title) > 80 || !contains(interests, a.Interest) || a.StartTick < 0 || a.EndTick <= a.StartTick || a.EndTick-a.StartTick > 180 || len(a.Attendees) > 60 || !contains([]string{"proposed", "scheduled", "active", "completed", "declined", "failed"}, a.Status) {
			return errors.New("invalid town activity")
		}
		if _, ok := places[a.Place]; !ok {
			return errors.New("invalid activity place")
		}
		acts[a.ID] = true
		attended := map[string]bool{}
		for _, id := range a.Attendees {
			if !agents[id] || attended[id] {
				return errors.New("invalid attendee")
			}
			attended[id] = true
		}
	}
	for _, c := range t.Conversations {
		if !validID(c.ID) || !agents[c.ResidentID] || c.Tick < 0 || c.Tick > tick || len(c.Lines) < 1 || len(c.Lines) > 3 || len(c.ActivityIDs) > 3 || !contains([]string{"rules", "model", "user"}, c.Source) {
			return errors.New("invalid conversation")
		}
		if c.OtherID != nil && !agents[*c.OtherID] {
			return errors.New("invalid conversation contact")
		}
		for _, l := range c.Lines {
			if utf8.RuneCountInString(l.Text) > 1000 {
				return errors.New("invalid conversation line")
			}
		}
	}
	jobs := map[string]bool{}
	for _, j := range t.Jobs {
		if !validID(j.ID) || jobs[j.ID] || !agents[j.ResidentID] || j.CreatedTick < 0 || j.CreatedTick > tick || j.Day < 0 || utf8.RuneCountInString(j.Text) > 1000 || !contains([]string{"plan", "dialogue", "message", "activity"}, j.Kind) || !contains([]string{"queued", "running", "done", "error"}, j.Status) {
			return errors.New("invalid model job")
		}
		jobs[j.ID] = true
		if j.OtherID != nil && !agents[*j.OtherID] {
			return errors.New("invalid job contact")
		}
		if j.ActivityID != nil && !acts[*j.ActivityID] {
			return errors.New("invalid job activity")
		}
	}
	if !contains([]string{"rules", "llm"}, t.Model.Mode) || !contains([]string{"rules", "ready", "unconfigured", "budget", "error"}, t.Model.State) || t.Model.ResidentLimit < 1 || t.Model.ResidentLimit > 60 || t.Model.DailyLimit < 1 || t.Model.DailyLimit > 1000 || t.Model.Calls < 0 || t.Model.Calls > 1000 {
		return errors.New("invalid model status")
	}
	return nil
}
func validateSlots(slots []PlanSlot) error {
	if len(slots) < 1 || len(slots) > 10 {
		return errors.New("invalid plan size")
	}
	last := 0
	for _, s := range slots {
		_, ok := places[s.Place]
		if !ok || s.Start < last || s.End <= s.Start || s.End > 1440 || !contains([]string{"sleep", "work", "read", "shop", "socialize", "rest"}, s.Purpose) || !cleanText(s.Reason, 0, 200) {
			return errors.New("invalid plan slot")
		}
		last = s.End
	}
	return nil
}
func remember(t *Town, m Memory) {
	for _, old := range t.Memories {
		if old.ResidentID == m.ResidentID && old.Kind == m.Kind && old.SourceID == m.SourceID {
			return
		}
	}
	t.Memories = append(t.Memories, m)
	owned := []int{}
	for i, row := range t.Memories {
		if row.ResidentID == m.ResidentID {
			owned = append(owned, i)
		}
	}
	if len(owned) > 20 {
		sort.SliceStable(owned, func(i, j int) bool {
			a, b := t.Memories[owned[i]], t.Memories[owned[j]]
			if a.Importance == b.Importance {
				return a.Tick < b.Tick
			}
			return a.Importance < b.Importance
		})
		i := owned[0]
		t.Memories = append(t.Memories[:i], t.Memories[i+1:]...)
	}
}
func knows(t *Town, id, activity string) bool {
	for _, a := range t.Activities {
		if a.ID == activity && a.OrganizerID == id {
			return true
		}
	}
	for _, m := range t.Memories {
		if m.ResidentID == id && m.Kind == "invitation" && m.SourceID == activity {
			return true
		}
	}
	return false
}
func queueJob(t *Town, j ModelJob) error {
	if len(t.Jobs) >= 64 {
		index := -1
		for i, old := range t.Jobs {
			if old.Status == "done" || old.Status == "error" {
				index = i
				break
			}
		}
		if index < 0 {
			return fmt.Errorf("town_busy")
		}
		t.Jobs = append(t.Jobs[:index], t.Jobs[index+1:]...)
	}
	t.Jobs = append(t.Jobs, j)
	return nil
}
func newJob(kind, id string, tick int64, text string) ModelJob {
	return ModelJob{ID: uuid.NewString(), ResidentID: id, Kind: kind, Status: "queued", CreatedTick: tick, Day: tick / 1440, Text: text}
}
func rawJSON(value any) json.RawMessage { b, _ := json.Marshal(value); return b }
func today() string                     { return time.Now().UTC().Format("2006-01-02") }

func placeHours(place string) (int, int) {
	switch place {
	case "cafe":
		return 420, 1320
	case "library":
		return 480, 1260
	case "shop":
		return 480, 1200
	case "farm":
		return 360, 1080
	case "forest":
		return 360, 1140
	}
	return 0, 1440
}
