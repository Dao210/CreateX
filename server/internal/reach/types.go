// Package reach implements the REACH world: a persistent, automatically
// running game world where submitted weapons and characters survive on their
// own. See docs/reach-world-prd.md.
//
// Everything that affects the outcome of a beat is deterministic. The same
// season seed, the same entity set, and the same beat range always produce the
// same digest, so any player can replay a season and check it.
package reach

// Wire and rule versions. Bump SchemaEntityV1 only for breaking payload
// changes; bump RulesVersion whenever settlement math changes, because it
// invalidates every stored replay.
const (
	SchemaEntityV1 = "reach.entity/1"
	RulesVersion   = "reach@1"

	BeatSeconds = 60
	// SeasonBeats is one week of beats.
	SeasonBeats = 7 * 24 * 60

	// World is measured in grid units. Movement is stored in milli-grid so a
	// slow entity can move less than one unit per beat without floating point.
	WorldWidth  = 2048
	WorldHeight = 1024
	Milli       = 1000

	MaxEntitiesPerSeason = 5000
	WreckLifetimeBeats   = 24 * 60
	CatastropheEvery     = 240
	SupplyRegenBeats     = 96
)

// Entity kinds.
const (
	KindCharacter = "character"
	KindWeapon    = "weapon"
)

// Entity status.
const (
	StatusAlive = "alive"
	StatusDead  = "dead"
)

// FieldError is one rejected field, addressed by JSON path so an agent can fix
// exactly what is wrong and retry once.
type FieldError struct {
	Path   string `json:"path"`
	Code   string `json:"code"`
	Detail string `json:"detail,omitempty"`
}

// Problem is the error shape shared by every reach endpoint.
type Problem struct {
	Code   string
	Status int
	Fields []FieldError
}

func (p *Problem) Error() string { return p.Code }

func problem(code string, status int) *Problem { return &Problem{Code: code, Status: status} }

// invalid reports a 422 with per-field diagnostics. A submission that fails
// validation is expected on the first attempt; the diagnostics are part of the
// product, not an afterthought.
func invalid(fields ...FieldError) *Problem {
	return &Problem{Code: "invalid_entity", Status: 422, Fields: fields}
}

// Spec is the only thing an outside client may send. It is deliberately a
// closed vocabulary: no scripts, no free geometry, no unbounded numbers.
type Spec struct {
	Schema     string     `json:"schema"`
	Kind       string     `json:"kind"`
	Name       string     `json:"name"`
	Locale     string     `json:"locale,omitempty"`
	Appearance Appearance `json:"appearance"`
	Chassis    string     `json:"chassis,omitempty"`
	// WeaponForm is used only when Kind is "weapon": a weapon is submitted as a
	// stand-alone object, so it carries its form at the top level instead of a
	// full character loadout.
	WeaponForm string     `json:"weaponForm,omitempty"`
	Loadout    *Loadout   `json:"loadout,omitempty"`
	Stats      Stats      `json:"stats"`
	Policy     *Policy    `json:"policy,omitempty"`
	Voice      string     `json:"voice,omitempty"`
	Provenance Provenance `json:"provenance"`
}

type Appearance struct {
	Palette    []string `json:"palette"`
	Silhouette string   `json:"silhouette"`
}

type Loadout struct {
	Weapon Weapon `json:"weapon"`
	Armor  Armor  `json:"armor"`
}

type Weapon struct {
	Form       string     `json:"form"`
	Dimensions Dimensions `json:"dimensions"`
	Material   string     `json:"material"`
	Trait      string     `json:"trait"`
}

type Dimensions struct {
	Length int `json:"length"`
	Mass   int `json:"mass"`
	Head   int `json:"head,omitempty"`
}

type Armor struct {
	Plate string `json:"plate"`
	Trait string `json:"trait"`
}

// Stats is a point buy. The five values must sum to StatBudget, which is what
// stops a generator from shipping a character that is good at everything.
type Stats struct {
	Atk    int `json:"atk"`
	Tough  int `json:"tough"`
	Agi    int `json:"agi"`
	Sense  int `json:"sense"`
	Upkeep int `json:"upkeep"`
}

const (
	StatBudget = 100
	StatMax    = 40
)

func (s Stats) Sum() int { return s.Atk + s.Tough + s.Agi + s.Sense + s.Upkeep }

// Policy is a declarative temperament. The engine reads it, nothing executes it.
type Policy struct {
	Aggression float64 `json:"aggression"`
	Caution    float64 `json:"caution"`
	Hoard      float64 `json:"hoard"`
	Loyalty    float64 `json:"loyalty"`
}

type Provenance struct {
	Generator string `json:"generator"`
	Model     string `json:"model,omitempty"`
	Author    string `json:"author,omitempty"`
}

// Derived is the integer settlement view of a spec. Every value is fixed point
// so replays survive a change of machine.
type Derived struct {
	MaxHP     int64  `json:"maxHp"`     // milli HP
	Damage    int64  `json:"damage"`    // milli HP per hit
	Speed     int64  `json:"speed"`     // milli grid per beat
	Sense     int64  `json:"sense"`     // grid
	Upkeep    int64  `json:"upkeep"`    // milli charge per beat
	Range     int64  `json:"range"`     // grid
	ArmorTake int64  `json:"armorTake"` // damage multiplier, milli (850 = takes 85%)
	Trait     string `json:"trait"`
	Material  string `json:"material"`
}

// Normalized is what the server actually runs: the client's intent compiled
// into deterministic geometry plus derived numbers.
type Normalized struct {
	Schema    string   `json:"schema"`
	Derived   Derived  `json:"derived"`
	Geometry  Geometry `json:"geometry"`
	Power     int64    `json:"power"`
	Form      string   `json:"form,omitempty"`
	Chassis   string   `json:"chassis,omitempty"`
	Colliders int      `json:"colliders"`
}

// Receipt is returned for every accepted submission and is idempotent: the same
// Idempotency-Key always yields the same entity and the same receipt.
type Receipt struct {
	EntityID     string      `json:"entityId"`
	WorldVersion int64       `json:"worldVersion"`
	EnterBeat    int64       `json:"enterBeat"`
	Normalized   Normalized  `json:"normalized"`
	Diagnostics  Diagnostics `json:"diagnostics"`
}

type Diagnostics struct {
	PowerIndex int          `json:"powerIndex"`
	Notes      []string     `json:"notes"`
	Fields     []FieldError `json:"fields,omitempty"`
}

// Entity is the runtime record. Spec is kept for audit; Normalized is what the
// engine reads. Storing both means a rules change can be re-applied without
// losing what the player actually asked for.
type Entity struct {
	ID          string     `json:"id"`
	SeasonID    string     `json:"seasonId"`
	Kind        string     `json:"kind"`
	Name        string     `json:"name"`
	Locale      string     `json:"locale,omitempty"`
	OwnerHash   string     `json:"ownerHash"`
	Spec        Spec       `json:"spec"`
	Normalized  Normalized `json:"normalized"`
	EnteredBeat int64      `json:"enteredBeat"`
	Survived    int64      `json:"survived"`
	Kills       int        `json:"kills"`
	Legacy      int        `json:"legacy"`
	Status      string     `json:"status"`
	DeathBeat   int64      `json:"deathBeat,omitempty"`
	LineageFrom string     `json:"lineageFrom,omitempty"`

	// Simulation state. These fields are persisted with the world but must never
	// be serialized straight to a public response: the HTTP layer exposes
	// Snapshot.EntityView instead.
	X          int64  `json:"x"`
	Y          int64  `json:"y"`
	HP         int64  `json:"hp"`
	Charge     int64  `json:"charge"`
	Stun       int    `json:"stun,omitempty"`
	Bleed      int    `json:"bleed,omitempty"`
	Trait      string `json:"trait,omitempty"`
	Order      string `json:"order,omitempty"`
	OrderUntil int64  `json:"orderUntil,omitempty"`
	OrderCount int    `json:"orderCount,omitempty"`
}
