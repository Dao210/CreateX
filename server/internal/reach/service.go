package reach

import (
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Service serializes every mutation of a season. The world is a single
// deterministic machine; letting two requests step it concurrently would make
// replays meaningless.
type Service struct {
	mu    sync.Mutex
	Store *Store
	World *World
	Now   func() time.Time

	receipts     map[string]*Receipt
	fingerprints map[string]string
	maxEntities  int
	// BeatSeconds is the wall-clock length of one beat. It is configurable so a
	// demo can run faster than the shipped 60s, and it is reported by the season
	// endpoint so a client never has to assume.
	BeatSeconds int
}

// Submit is one inbound creation.
type Submit struct {
	Spec           Spec
	IdempotencyKey string
	OwnerHash      string
}

// NewService loads an existing season or seeds a new one. A nil store keeps the
// service in memory, which is what tests and previews use.
func NewService(store *Store, seasonID string, seed uint64) (*Service, error) {
	svc := &Service{Store: store, Now: time.Now, maxEntities: MaxEntitiesPerSeason, BeatSeconds: BeatSeconds}
	if store == nil {
		svc.World = NewWorld(seasonID, seed)
		svc.receipts = map[string]*Receipt{}
		svc.fingerprints = map[string]string{}
		return svc, nil
	}
	world, receipts, fingerprints, err := store.Load(seasonID, seed)
	if err != nil {
		return nil, err
	}
	svc.World = world
	svc.receipts = receipts
	svc.fingerprints = fingerprints
	return svc, nil
}

// Submit validates, deduplicates and enters an entity. A rejected submission is
// a normal outcome: the diagnostics are the contract that lets an agent fix its
// own output and retry once.
func (s *Service) Submit(in Submit) (*Receipt, *Problem) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(in.IdempotencyKey) < 8 || len(in.IdempotencyKey) > 128 {
		return nil, problem("invalid_idempotency_key", 400)
	}
	if receipt, ok := s.receipts[in.IdempotencyKey]; ok {
		return receipt, nil
	}
	if len(s.World.Entities) >= s.maxEntities {
		return nil, problem("capacity_reached", 429)
	}
	if fields := Validate(in.Spec); len(fields) > 0 {
		return nil, invalid(fields...)
	}
	normalized, _ := Normalize(in.Spec)

	fingerprint := fingerprint(in.Spec)
	if existing, ok := s.fingerprints[fingerprint]; ok {
		if e, found := s.World.Find(existing); found {
			receipt := &Receipt{
				EntityID:     e.ID,
				WorldVersion: s.World.Version,
				EnterBeat:    e.EnteredBeat,
				Normalized:   e.Normalized,
				Diagnostics: Diagnostics{
					PowerIndex: Percentile(e.Normalized.Power, s.World.PowerSamples),
					Notes:      []string{"duplicate: this spec is already in the world, returning the original entry"},
				},
			}
			s.receipts[in.IdempotencyKey] = receipt
			return receipt, nil
		}
	}

	e := &Entity{
		ID:        uuid.NewString(),
		Kind:      in.Spec.Kind,
		Name:      strings.TrimSpace(in.Spec.Name),
		Locale:    in.Spec.Locale,
		OwnerHash: in.OwnerHash,
	}
	s.World.Enter(e, normalized, in.Spec)
	s.fingerprints[fingerprint] = e.ID

	index := Percentile(normalized.Power, s.World.PowerSamples)
	receipt := &Receipt{
		EntityID:     e.ID,
		WorldVersion: s.World.Version,
		EnterBeat:    s.World.Beat,
		Normalized:   normalized,
		Diagnostics:  Diagnostics{PowerIndex: index, Notes: powerNotes(index)},
	}
	s.receipts[in.IdempotencyKey] = receipt
	_ = s.persist()
	return receipt, nil
}

// powerNotes is the only place the server editorializes. It never rejects a
// legal build; it tells the author where the build sits.
func powerNotes(index int) []string {
	switch {
	case index >= 95:
		return []string{"top 5% of the season: expect to be hunted first"}
	case index <= 20:
		return []string{"bottom 20%: this build is cheap to keep alive but loses fights"}
	default:
		return nil
	}
}

// Advance moves the world forward. The command layer calls this on a timer; tests
// call it directly. Persistence is the caller's job so a beat never blocks on IO.
func (s *Service) Advance(beats int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := 0; i < beats; i++ {
		s.World.Step()
	}
}

// Save flushes the world to disk.
func (s *Service) Save() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.persist()
}

func (s *Service) persist() error {
	if s.Store == nil {
		return nil
	}
	return s.Store.Save(s.World, s.receipts, s.fingerprints)
}

func (s *Service) Snapshot() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.World.Snapshot()
}

func (s *Service) Entity(id string) (*Entity, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.World.Find(id)
}

func (s *Service) Feed(since int64, limit int) ([]Chronicle, int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	return s.World.Feed(since, limit)
}

func (s *Service) Top(n int) []*Entity {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.World.Top(n)
}

// Order is the only lever a human gets over an entity that is already running.
// Three per season, and none of them can be used to steer a fight directly.
func (s *Service) Order(id, kind, ownerHash string) (*Entity, *Problem) {
	s.mu.Lock()
	defer s.mu.Unlock()

	e, ok := s.World.Find(id)
	if !ok {
		return nil, problem("not_found", 404)
	}
	if e.OwnerHash != ownerHash || ownerHash == "" {
		return nil, problem("forbidden", 403)
	}
	if e.Status != StatusAlive {
		return nil, problem("entity_dead", 409)
	}
	if e.OrderCount >= 3 {
		return nil, problem("orders_exhausted", 429)
	}

	switch kind {
	case "hold":
		e.Order, e.OrderUntil = "hold", s.World.Beat+4
	case "hunt":
		e.Order, e.OrderUntil = "hunt", s.World.Beat+4
	case "retreat":
		// Retreat is physical and costs health: the world does not let you leave
		// a fight for free.
		edge := int64(0)
		if e.X > WorldWidth*Milli/2 {
			edge = WorldWidth * Milli
		}
		e.X = edge
		e.HP -= e.Normalized.Derived.MaxHP / 5
		e.Order, e.OrderUntil = "", 0
	default:
		return nil, problem("invalid_order", 400)
	}

	e.OrderCount++
	_ = s.persist()
	return e, nil
}

// Profile is the public read model of one entity. It is separate from Entity so
// an internal field can never leak by accident.
type Profile struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Kind        string     `json:"kind"`
	Season      string     `json:"season"`
	Status      string     `json:"status"`
	Survived    int64      `json:"survived"`
	Kills       int        `json:"kills"`
	Legacy      int        `json:"legacy"`
	EnteredBeat int64      `json:"enteredBeat"`
	DeathBeat   int64      `json:"deathBeat,omitempty"`
	Appearance  Appearance `json:"appearance"`
	Form        string     `json:"form,omitempty"`
	Chassis     string     `json:"chassis,omitempty"`
	Power       int64      `json:"power"`
	Generator   string     `json:"generator"`
	Voice       string     `json:"voice,omitempty"`
}

func (s *Service) Profile(id string) (*Profile, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.World.Find(id)
	if !ok {
		return nil, false
	}
	return &Profile{
		ID:          e.ID,
		Name:        e.Name,
		Kind:        e.Kind,
		Season:      e.SeasonID,
		Status:      e.Status,
		Survived:    e.Survived,
		Kills:       e.Kills,
		Legacy:      e.Legacy,
		EnteredBeat: e.EnteredBeat,
		DeathBeat:   e.DeathBeat,
		Appearance:  e.Spec.Appearance,
		Form:        e.Normalized.Form,
		Chassis:     e.Normalized.Chassis,
		Power:       e.Normalized.Power,
		Generator:   e.Spec.Provenance.Generator,
		Voice:       e.Spec.Voice,
	}, true
}

// SeasonInfo is what the client needs to render a clock without guessing.
type SeasonInfo struct {
	ID           string `json:"id"`
	Beat         int64  `json:"beat"`
	BeatsLeft    int64  `json:"beatsLeft"`
	BeatSeconds  int    `json:"beatSeconds"`
	RulesVersion string `json:"rulesVersion"`
	Entities     int    `json:"entities"`
	Alive        int    `json:"alive"`
	Wrecks       int    `json:"wrecks"`
}

func (s *Service) Season() SeasonInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	alive := 0
	for _, e := range s.World.Entities {
		if e.Status == StatusAlive {
			alive++
		}
	}
	left := int64(SeasonBeats) - s.World.Beat
	if left < 0 {
		left = 0
	}
	return SeasonInfo{
		ID: s.World.SeasonID, Beat: s.World.Beat, BeatsLeft: left,
		BeatSeconds: s.BeatSeconds, RulesVersion: RulesVersion,
		Entities: len(s.World.Entities), Alive: alive, Wrecks: len(s.World.Wrecks),
	}
}

// Fingerprint exposes the dedupe key for tests and logs.
func Fingerprint(spec Spec) string { return fingerprint(spec) }
