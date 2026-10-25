package reach

import (
	"fmt"
	"sort"
)

// Belt geometry: the world is cut into three vertical belts. Belts matter
// because rifts and catastrophes are named after them, and because the chronicle
// uses them to say where something happened.
const (
	BeltCount = 3
	BeltWidth = WorldWidth / BeltCount
)

// bucketSize is the spatial index cell. It is larger than the maximum sense
// radius (60 + 40*7 = 340 grid), so a 3x3 neighbourhood always covers a full
// sense sweep and the index never changes what an entity can see.
const bucketSize = 384 * Milli

// Supply is a charge cache. Supplies are sparse, so taking one is a decision,
// not a chore.
type Supply struct {
	ID            string
	X             int64
	Y             int64
	Charge        int64
	LastDrainBeat int64
}

// Wreck is what a dead entity leaves behind. It is the only way for one player's
// creation to become part of another player's story, so it is worth keeping.
type Wreck struct {
	ID           string `json:"id"`
	FromEntityID string `json:"fromEntityId"`
	FromName     string `json:"fromName"`
	Beat         int64  `json:"beat"`
	Spec         Spec   `json:"spec"`
	X            int64  `json:"-"`
	Y            int64  `json:"-"`
	ClaimedBy    string `json:"claimedBy,omitempty"`
}

// ChronicleText carries both shipped locales. The server renders the sentence so
// a user's `voice` never reaches the front page unmoderated.
type ChronicleText struct {
	EN string `json:"en"`
	ZH string `json:"zh"`
}

// Chronicle is the readable layer of the simulation: what the homepage shows.
// Seq is monotonic and survives slice trimming, so a client cursor stays valid.
type Chronicle struct {
	Seq      int64         `json:"seq"`
	Beat     int64         `json:"beat"`
	Kind     string        `json:"kind"`
	Entities []string      `json:"entities,omitempty"`
	Belt     int           `json:"belt,omitempty"`
	Text     ChronicleText `json:"text"`
}

// World is one season of the simulation. It is not safe for concurrent use; the
// service serializes access so a beat is never half-applied.
type World struct {
	SeasonID string
	Seed     uint64
	Beat     int64
	Version  int64

	Entities  []*Entity
	byID      map[string]*Entity
	Wrecks    []*Wreck
	Supplies  []*Supply
	Rifts     [2]int64
	Chronicle []Chronicle

	PowerSamples   []int64
	seq            int64
	firstBloodDone bool
	digestValue    string
}

// NewWorld seeds a season. Supply positions and rift offsets come from the seed,
// so two servers starting from the same row produce the same map.
func NewWorld(seasonID string, seed uint64) *World {
	w := &World{
		SeasonID: seasonID,
		Seed:     seed,
		byID:     make(map[string]*Entity, 256),
	}
	w.Rifts = [2]int64{w.riftAt(0), w.riftAt(1)}
	for i := 0; i < 40; i++ {
		w.Supplies = append(w.Supplies, &Supply{
			ID:     fmt.Sprintf("s-%02d", i),
			X:      draw(seed, 0, "supply-x-"+fmt.Sprint(i), WorldWidth*Milli),
			Y:      draw(seed, 0, "supply-y-"+fmt.Sprint(i), WorldHeight*Milli),
			Charge: 100 * Milli,
		})
	}
	w.digestValue = w.computeDigest()
	return w
}

func (w *World) riftAt(i int) int64 {
	span := int64(WorldWidth*Milli - 48*Milli)
	return draw(w.Seed, w.Beat/CatastropheEvery, "rift-"+fmt.Sprint(i), span) + 24*Milli
}

// Enter places an entity on the map. Entry positions are derived from the season
// seed and the entity id, never from arrival order: otherwise two identical
// submissions would start in different places depending on who else joined.
func (w *World) Enter(e *Entity, normalized Normalized, spec Spec) {
	d := normalized.Derived
	e.SeasonID = w.SeasonID
	e.Spec = spec
	e.Normalized = normalized
	e.Status = StatusAlive
	e.EnteredBeat = w.Beat
	e.HP = d.MaxHP
	e.Charge = 100 * Milli
	e.Trait = d.Trait
	e.X = draw(w.Seed, e.EnteredBeat, "spawn-x-"+e.ID, WorldWidth*Milli)
	e.Y = draw(w.Seed, e.EnteredBeat, "spawn-y-"+e.ID, WorldHeight*Milli)
	for _, rift := range w.Rifts {
		if abs64(e.X-rift) < 40*Milli {
			e.X = clampMilli(e.X+80*Milli, 0, WorldWidth*Milli)
		}
	}
	w.Entities = append(w.Entities, e)
	w.byID[e.ID] = e
	w.PowerSamples = append(w.PowerSamples, normalized.Power)
}

// Step advances exactly one beat. The order below is part of the rules: consume,
// then decide, then move, then strike. Changing it changes every replay.
func (w *World) Step() {
	w.Beat++
	if w.Beat%CatastropheEvery == 0 {
		w.Rifts = [2]int64{w.riftAt(0), w.riftAt(1)}
		w.catastrophe()
	}

	active := w.activeEntities()
	buckets := buildBuckets(active)
	w.tickUpkeep(active)
	w.regenerateSupplies()

	type hit struct {
		from, to *Entity
		damage   int64
	}
	var hits []hit

	for _, e := range active {
		if e.Status != StatusAlive || e.Stun > 0 {
			continue
		}
		enemy := nearestEnemy(e, buckets)
		if enemy != nil && within(e.X, e.Y, enemy.X, enemy.Y, e.Normalized.Derived.Range*Milli) {
			hits = append(hits, hit{from: e, to: enemy, damage: e.Normalized.Derived.Damage})
			continue
		}
		w.move(e, enemy)
	}

	// All intents were chosen against the same starting state; apply them in a
	// fixed order so a kill is never resolved twice.
	for _, h := range hits {
		w.strike(h.from, h.to, h.damage)
	}

	w.claimWrecks(active)
	w.expireWrecks()
	w.digestValue = w.computeDigest()
	w.Version++
}

func (w *World) activeEntities() []*Entity {
	out := make([]*Entity, 0, len(w.Entities))
	for _, e := range w.Entities {
		if e.Status == StatusAlive {
			out = append(out, e)
		}
	}
	return out
}

func buildBuckets(active []*Entity) [][]*Entity {
	cols := WorldWidth*Milli/bucketSize + 1
	rows := WorldHeight*Milli/bucketSize + 1
	buckets := make([][]*Entity, cols*rows)
	for _, e := range active {
		idx := int(e.X/bucketSize) + int(e.Y/bucketSize)*cols
		if idx >= 0 && idx < len(buckets) {
			buckets[idx] = append(buckets[idx], e)
		}
	}
	return buckets
}

func (w *World) tickUpkeep(active []*Entity) {
	for _, e := range active {
		d := e.Normalized.Derived
		e.Survived++
		e.Charge -= d.Upkeep
		if e.Charge <= 0 {
			e.Charge = 0
			e.HP -= 3 * Milli
		}
		if e.Bleed > 0 {
			e.HP -= 2500
			e.Bleed--
		}
		if e.Stun > 0 {
			e.Stun--
		}
		if inRift(e.X, w.Rifts) {
			e.HP -= 2 * Milli
		}
		if e.HP <= 0 {
			w.die(e, "")
		}
	}
}

func inRift(x int64, rifts [2]int64) bool {
	for _, rift := range rifts {
		if abs64(x-rift) < 24*Milli {
			return true
		}
	}
	return false
}

func (w *World) regenerateSupplies() {
	for _, s := range w.Supplies {
		if s.Charge < 100*Milli && w.Beat-s.LastDrainBeat >= SupplyRegenBeats {
			s.Charge = 100 * Milli
		}
	}
}

// move applies one beat of travel toward the decision target. Being slowed to a
// crawl is a real outcome: a tower caught in a rift dies there.
func (w *World) move(e *Entity, enemy *Entity) {
	caution, hoard := 0.5, 0.5
	if p := e.Spec.Policy; p != nil {
		caution, hoard = p.Caution, p.Hoard
	}
	order := ""
	if e.OrderUntil > w.Beat {
		order = e.Order
	}

	var tx, ty int64
	switch {
	case order == "hold":
		tx, ty = e.X, e.Y
	case enemy != nil && order != "hunt" && w.shouldFlee(e, enemy, caution):
		tx, ty = fleeTarget(e, enemy)
	case float64(e.Charge) < (0.5+0.3*hoard)*float64(100*Milli):
		if supply := w.nearestSupply(e); supply != nil {
			tx, ty = supply.X, supply.Y
		} else {
			tx, ty = wanderTarget(w.Seed, w.Beat, e)
		}
	case enemy != nil:
		tx, ty = enemy.X, enemy.Y
	case float64(e.Charge) < 0.75*float64(100*Milli):
		if supply := w.nearestSupply(e); supply != nil {
			tx, ty = supply.X, supply.Y
		} else {
			tx, ty = wanderTarget(w.Seed, w.Beat, e)
		}
	default:
		tx, ty = wanderTarget(w.Seed, w.Beat, e)
	}

	if supply := w.nearestSupply(e); supply != nil && within(e.X, e.Y, supply.X, supply.Y, 4*Milli) {
		take := min64(25*Milli, supply.Charge)
		if take > 0 {
			e.Charge = min64(100*Milli, e.Charge+take)
			supply.Charge -= take
			supply.LastDrainBeat = w.Beat
		}
	}

	dx, dy := tx-e.X, ty-e.Y
	dist := isqrt(dx*dx + dy*dy)
	speed := e.Normalized.Derived.Speed
	if dist <= speed {
		e.X, e.Y = tx, ty
	} else if dist > 0 {
		e.X += dx * speed / dist
		e.Y += dy * speed / dist
	}
	e.X = clampMilli(e.X, 0, WorldWidth*Milli)
	e.Y = clampMilli(e.Y, 0, WorldHeight*Milli)
}

func (w *World) shouldFlee(e, enemy *Entity, caution float64) bool {
	hpRatio := float64(e.HP) / float64(max64(1, e.Normalized.Derived.MaxHP))
	return hpRatio < 0.55 && caution*hpRatio > 0.15
}

func fleeTarget(e, enemy *Entity) (int64, int64) {
	x := e.X + (e.X-enemy.X)*3
	y := e.Y + (e.Y-enemy.Y)*3
	return clampMilli(x, 0, WorldWidth*Milli), clampMilli(y, 0, WorldHeight*Milli)
}

func wanderTarget(seed uint64, beat int64, e *Entity) (int64, int64) {
	// Wander in 16-beat blocks so movement reads as intent, not jitter.
	block := beat / 16
	x := draw(seed, block, "wander-x-"+e.ID, 400*Milli) - 200*Milli
	y := draw(seed, block, "wander-y-"+e.ID, 400*Milli) - 200*Milli
	return clampMilli(e.X+x, 0, WorldWidth*Milli), clampMilli(e.Y+y, 0, WorldHeight*Milli)
}

// nearestEnemy scans the entity's bucket and its neighbours. Ties keep the first
// candidate in slice order, which is fixed, so the choice is reproducible.
func nearestEnemy(e *Entity, buckets [][]*Entity) *Entity {
	cols := WorldWidth*Milli/bucketSize + 1
	rows := WorldHeight*Milli/bucketSize + 1
	cx, cy := int(e.X/bucketSize), int(e.Y/bucketSize)
	radius := e.Normalized.Derived.Sense * Milli
	limit := radius * radius

	var best *Entity
	bestDist := int64(-1)
	for dy := -1; dy <= 1; dy++ {
		y := cy + dy
		if y < 0 || y >= rows {
			continue
		}
		for dx := -1; dx <= 1; dx++ {
			x := cx + dx
			if x < 0 || x >= cols {
				continue
			}
			for _, other := range buckets[x+y*cols] {
				if other == e || other.Status != StatusAlive {
					continue
				}
				d2 := (other.X-e.X)*(other.X-e.X) + (other.Y-e.Y)*(other.Y-e.Y)
				if d2 > limit {
					continue
				}
				if bestDist == -1 || d2 < bestDist {
					best, bestDist = other, d2
				}
			}
		}
	}
	return best
}

func (w *World) nearestSupply(e *Entity) *Supply {
	var best *Supply
	bestDist := int64(-1)
	for _, s := range w.Supplies {
		if s.Charge <= 0 {
			continue
		}
		d2 := (s.X-e.X)*(s.X-e.X) + (s.Y-e.Y)*(s.Y-e.Y)
		if bestDist == -1 || d2 < bestDist {
			best, bestDist = s, d2
		}
	}
	return best
}

// strike applies one hit in both directions: armor can turn a kill into a trade.
func (w *World) strike(from, to *Entity, damage int64) {
	if from.Status != StatusAlive || to.Status != StatusAlive {
		return
	}
	dealt := damage * to.Normalized.Derived.ArmorTake / Milli
	if to.Order == "hold" && to.OrderUntil > w.Beat {
		dealt = dealt * 90 / 100
	}
	to.HP -= dealt

	switch from.Trait {
	case "concussive":
		to.Stun = 1
	case "serrated":
		to.Bleed = 3
	case "volatile":
		from.HP -= damage * 8 / 100
	}
	if from.Spec.Loadout != nil && from.Spec.Loadout.Weapon.Material == "bone" {
		from.HP -= damage * 5 / 100
	}
	if to.Spec.Loadout != nil && to.Spec.Loadout.Armor.Trait == "reactive" {
		from.HP -= dealt * 10 / 100
	}

	if to.HP <= 0 && to.Status == StatusAlive {
		w.die(to, from.ID)
		from.Kills++
		w.recordKill(from, to)
	}
	if from.HP <= 0 && from.Status == StatusAlive {
		w.die(from, to.ID)
		to.Kills++
		w.recordKill(to, from)
	}
}

func (w *World) die(e *Entity, killerID string) {
	e.Status = StatusDead
	e.HP = 0
	e.DeathBeat = w.Beat
	w.Wrecks = append(w.Wrecks, &Wreck{
		ID:           fmt.Sprintf("w-%s-%d", e.ID, w.Beat),
		FromEntityID: e.ID,
		FromName:     e.Name,
		Beat:         w.Beat,
		Spec:         e.Spec,
		X:            e.X,
		Y:            e.Y,
	})
	if killerID == "" {
		belt := beltOf(e.X)
		w.say(Chronicle{
			Kind:     "death",
			Entities: []string{e.ID},
			Belt:     belt,
			Text: ChronicleText{
				EN: fmt.Sprintf("%s fell at the %s. Wreck intact.", e.Name, beltEN(belt)),
				ZH: fmt.Sprintf("「%s」倒于%s，残骸完好。", e.Name, beltZH(belt)),
			},
		})
	}
}

func (w *World) recordKill(killer, victim *Entity) {
	belt := beltOf(victim.X)
	kind := "kill"
	if !w.firstBloodDone {
		w.firstBloodDone = true
		kind = "first_blood"
	}
	w.say(Chronicle{
		Kind:     kind,
		Entities: []string{killer.ID, victim.ID},
		Belt:     belt,
		Text: ChronicleText{
			EN: fmt.Sprintf("%s put down %s at the %s.", killer.Name, victim.Name, beltEN(belt)),
			ZH: fmt.Sprintf("「%s」在%s放倒了「%s」。", killer.Name, beltZH(belt), victim.Name),
		},
	})
}

// claimWrecks lets a living entity salvage a nearby wreck. The dead entity gains
// legacy, which is why dying well is not the same as dying quietly.
func (w *World) claimWrecks(active []*Entity) {
	for _, wreck := range w.Wrecks {
		if wreck.ClaimedBy != "" {
			continue
		}
		for _, e := range active {
			if e.Status != StatusAlive || !within(e.X, e.Y, wreck.X, wreck.Y, 5*Milli) {
				continue
			}
			wreck.ClaimedBy = e.ID
			e.HP = min64(e.Normalized.Derived.MaxHP, e.HP+e.Normalized.Derived.MaxHP/3)
			if from, ok := w.byID[wreck.FromEntityID]; ok {
				from.Legacy++
			}
			w.say(Chronicle{
				Kind:     "claim",
				Entities: []string{e.ID, wreck.FromEntityID},
				Text: ChronicleText{
					EN: fmt.Sprintf("%s picked over %s's wreck.", e.Name, wreck.FromName),
					ZH: fmt.Sprintf("「%s」拾取了「%s」的残骸。", e.Name, wreck.FromName),
				},
			})
			break
		}
	}
}

func (w *World) expireWrecks() {
	kept := w.Wrecks[:0]
	for _, wreck := range w.Wrecks {
		if w.Beat-wreck.Beat < WreckLifetimeBeats {
			kept = append(kept, wreck)
		}
	}
	w.Wrecks = kept
}

// catastrophe is the reason a season cannot be solved once and then farmed: the
// map itself changes, and drifters arrive to fill the space nobody is using.
func (w *World) catastrophe() {
	belt := int(draw(w.Seed, w.Beat, "catastrophe-belt", BeltCount))
	w.say(Chronicle{
		Kind: "catastrophe",
		Belt: belt,
		Text: ChronicleText{
			EN: fmt.Sprintf("The %s collapsed. Drifters came through.", beltEN(belt)),
			ZH: fmt.Sprintf("%s塌陷，漂移者涌了进来。", beltZH(belt)),
		},
	})
	for i := 0; i < 8; i++ {
		id := fmt.Sprintf("drifter-%s-%d-%d", w.SeasonID, w.Beat, i)
		if _, exists := w.byID[id]; exists {
			continue
		}
		normalized, fields := Normalize(drifterSpec)
		if len(fields) > 0 {
			continue
		}
		e := &Entity{ID: id, Kind: KindCharacter, Name: "Drifter", Locale: "en"}
		w.Enter(e, normalized, drifterSpec)
		e.X = int64(belt)*BeltWidth*Milli + draw(w.Seed, w.Beat, "drifter-x-"+id, BeltWidth*Milli)
		e.Y = draw(w.Seed, w.Beat, "drifter-y-"+id, WorldHeight*Milli)
	}
}

func (w *World) say(c Chronicle) {
	w.seq++
	c.Seq = w.seq
	c.Beat = w.Beat
	w.Chronicle = append(w.Chronicle, c)
	if len(w.Chronicle) > 4000 {
		w.Chronicle = append([]Chronicle(nil), w.Chronicle[len(w.Chronicle)-3000:]...)
	}
}

func beltOf(x int64) int {
	belt := int(x / (BeltWidth * Milli))
	if belt < 0 {
		return 0
	}
	if belt >= BeltCount {
		return BeltCount - 1
	}
	return belt
}

func beltEN(belt int) string {
	return [...]string{"first belt", "second belt", "third belt"}[belt]
}

func beltZH(belt int) string {
	return [...]string{"第一带", "第二带", "第三带"}[belt]
}

// Digest is the replay check: two runs with the same seed and entities must
// produce the same string after every beat.
func (w *World) Digest() string { return w.digestValue }

func (w *World) computeDigest() string {
	acc := uint64(14695981039346656037)
	for _, e := range w.Entities {
		acc = mix64(acc ^ hashString(e.ID) ^ uint64(e.HP) ^ uint64(e.X)<<20 ^ uint64(e.Y)<<40)
	}
	acc = mix64(acc ^ uint64(len(w.Wrecks)))
	return fmt.Sprintf("%016x", acc)
}

// Top returns the season board. Survivors first, then kills, then id, so the
// ordering is total and stable.
func (w *World) Top(n int) []*Entity {
	out := append([]*Entity(nil), w.Entities...)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Survived != out[j].Survived {
			return out[i].Survived > out[j].Survived
		}
		if out[i].Kills != out[j].Kills {
			return out[i].Kills > out[j].Kills
		}
		return out[i].ID < out[j].ID
	})
	if n > 0 && len(out) > n {
		out = out[:n]
	}
	return out
}

func (w *World) Find(id string) (*Entity, bool) {
	e, ok := w.byID[id]
	return e, ok
}

// Snapshot is the read model the homepage consumes. It is deliberately smaller
// than World: the browser gets positions, names and colors, not spec internals.
type Snapshot struct {
	Season       string       `json:"season"`
	Beat         int64        `json:"beat"`
	Version      int64        `json:"version"`
	RulesVersion string       `json:"rulesVersion"`
	Digest       string       `json:"digest"`
	Rifts        []int64      `json:"rifts"`
	Supplies     []SupplyView `json:"supplies"`
	Entities     []EntityView `json:"entities"`
	Wrecks       []WreckView  `json:"wrecks"`
	Chronicle    []Chronicle  `json:"chronicle"`
}

type SupplyView struct {
	ID     string `json:"id"`
	X      int64  `json:"x"`
	Y      int64  `json:"y"`
	Charge int    `json:"charge"`
}

type EntityView struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Kind       string   `json:"kind"`
	X          int64    `json:"x"`
	Y          int64    `json:"y"`
	HP         int      `json:"hp"`
	Status     string   `json:"status"`
	Kills      int      `json:"kills"`
	Survived   int64    `json:"survived"`
	Palette    []string `json:"palette"`
	Silhouette string   `json:"silhouette"`
	Form       string   `json:"form,omitempty"`
	Geometry   string   `json:"geometry,omitempty"`
	Generator  string   `json:"generator"`
}

type WreckView struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	X       int64  `json:"x"`
	Y       int64  `json:"y"`
	Beat    int64  `json:"beat"`
	Claimed bool   `json:"claimed"`
}

func (w *World) Snapshot() Snapshot {
	snap := Snapshot{
		Season:       w.SeasonID,
		Beat:         w.Beat,
		Version:      w.Version,
		RulesVersion: RulesVersion,
		Digest:       w.digestValue,
		Rifts:        []int64{w.Rifts[0] / Milli, w.Rifts[1] / Milli},
		Supplies:     make([]SupplyView, 0, len(w.Supplies)),
		Entities:     make([]EntityView, 0, len(w.Entities)),
		Wrecks:       make([]WreckView, 0, len(w.Wrecks)),
		Chronicle:    w.recentChronicle(40),
	}
	for _, s := range w.Supplies {
		snap.Supplies = append(snap.Supplies, SupplyView{ID: s.ID, X: s.X / Milli, Y: s.Y / Milli, Charge: int(s.Charge / Milli)})
	}
	for _, e := range w.Entities {
		hp := 0
		if max := e.Normalized.Derived.MaxHP; max > 0 {
			hp = int(e.HP * 100 / max)
		}
		snap.Entities = append(snap.Entities, EntityView{
			ID: e.ID, Name: e.Name, Kind: e.Kind, X: e.X / Milli, Y: e.Y / Milli,
			HP: hp, Status: e.Status, Kills: e.Kills, Survived: e.Survived,
			Palette: e.Spec.Appearance.Palette, Silhouette: e.Spec.Appearance.Silhouette,
			Form: e.Normalized.Form, Geometry: e.Normalized.Geometry.Hash,
			Generator: e.Spec.Provenance.Generator,
		})
	}
	for _, wreck := range w.Wrecks {
		snap.Wrecks = append(snap.Wrecks, WreckView{
			ID: wreck.ID, Name: wreck.FromName, X: wreck.X / Milli, Y: wreck.Y / Milli,
			Beat: wreck.Beat, Claimed: wreck.ClaimedBy != "",
		})
	}
	return snap
}

func (w *World) recentChronicle(n int) []Chronicle {
	// Always return a non-nil slice: a JSON null here would break every client
	// that iterates the feed on a fresh world.
	if len(w.Chronicle) == 0 {
		return []Chronicle{}
	}
	if len(w.Chronicle) <= n {
		return append([]Chronicle{}, w.Chronicle...)
	}
	return append([]Chronicle{}, w.Chronicle[len(w.Chronicle)-n:]...)
}

// FeedCursor is the last chronicle sequence a client has seen.
type FeedCursor struct {
	Seq int64 `json:"seq"`
}

func (w *World) Feed(since int64, limit int) ([]Chronicle, int64) {
	out := make([]Chronicle, 0, limit)
	cursor := since
	for _, c := range w.Chronicle {
		if c.Seq <= since {
			continue
		}
		out = append(out, c)
		cursor = c.Seq
		if len(out) >= limit {
			break
		}
	}
	return out, cursor
}

func within(ax, ay, bx, by, radius int64) bool {
	dx, dy := ax-bx, ay-by
	return dx*dx+dy*dy <= radius*radius
}

func isqrt(v int64) int64 {
	if v <= 0 {
		return 0
	}
	x := v
	y := (x + 1) / 2
	for y < x {
		x = y
		y = (x + v/x) / 2
	}
	return x
}

func clampMilli(v, low, high int64) int64 {
	if v < low {
		return low
	}
	if v > high {
		return high
	}
	return v
}

func abs64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

// drifterSpec is the world's own creature. It exists so the map has events even
// when nobody has submitted anything yet.
var drifterSpec = Spec{
	Schema:     SchemaEntityV1,
	Kind:       KindCharacter,
	Name:       "Drifter",
	Appearance: Appearance{Palette: []string{"#2A2E33", "#8A8F98", "#E8E1D5"}, Silhouette: "low"},
	Chassis:    "crawler",
	Loadout: &Loadout{
		Weapon: Weapon{Form: "blade", Dimensions: Dimensions{Length: 30, Mass: 20}, Material: "scrap", Trait: "serrated"},
		Armor:  Armor{Plate: "light", Trait: "none"},
	},
	Stats:      Stats{Atk: 24, Tough: 18, Agi: 22, Sense: 20, Upkeep: 16},
	Policy:     &Policy{Aggression: 0.95, Caution: 0.05, Hoard: 0, Loyalty: 0},
	Provenance: Provenance{Generator: "other", Author: "world"},
}
