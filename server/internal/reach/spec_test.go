package reach

import (
	"reflect"
	"strings"
	"testing"
)

func validCharacter() Spec {
	return Spec{
		Schema:     SchemaEntityV1,
		Kind:       KindCharacter,
		Name:       "Rust Marshal",
		Locale:     "en",
		Appearance: Appearance{Palette: []string{"#1B1B1F", "#C8622D", "#E8E1D5"}, Silhouette: "broad"},
		Chassis:    "walker",
		Loadout: &Loadout{
			Weapon: Weapon{
				Form:       "hammer",
				Dimensions: Dimensions{Length: 42, Mass: 30, Head: 18},
				Material:   "scrap",
				Trait:      "concussive",
			},
			Armor: Armor{Plate: "plated", Trait: "braced"},
		},
		Stats:      Stats{Atk: 26, Tough: 30, Agi: 12, Sense: 16, Upkeep: 16},
		Policy:     &Policy{Aggression: 0.6, Caution: 0.4, Hoard: 0.2, Loyalty: 0.5},
		Voice:      "I don't move first. I move last.",
		Provenance: Provenance{Generator: "workbuddy", Model: "claude-sonnet", Author: "chunjun"},
	}
}

func paths(fields []FieldError) []string {
	out := make([]string, len(fields))
	for i, f := range fields {
		out[i] = f.Path
	}
	return out
}

func hasPath(fields []FieldError, path string) bool {
	for _, f := range fields {
		if f.Path == path {
			return true
		}
	}
	return false
}

func TestValidCharacterPasses(t *testing.T) {
	if fields := Validate(validCharacter()); len(fields) != 0 {
		t.Fatalf("expected no fields, got %+v", fields)
	}
}

func TestStatsBudgetIsEnforced(t *testing.T) {
	spec := validCharacter()
	spec.Stats = Stats{Atk: 40, Tough: 40, Agi: 10, Sense: 10, Upkeep: 1}
	if fields := Validate(spec); !hasPath(fields, "stats") {
		t.Fatalf("expected stats budget error, got %v", paths(fields))
	}

	spec.Stats = Stats{Atk: 20, Tough: 20, Agi: 20, Sense: 20, Upkeep: 19}
	if fields := Validate(spec); !hasPath(fields, "stats") {
		t.Fatalf("under-budget must also fail, got %v", paths(fields))
	}
}

func TestStatCapIsEnforced(t *testing.T) {
	spec := validCharacter()
	spec.Stats = Stats{Atk: 41, Tough: 20, Agi: 20, Sense: 19, Upkeep: 0}
	if fields := Validate(spec); !hasPath(fields, "stats.atk") {
		t.Fatalf("expected stats.atk error, got %v", paths(fields))
	}
}

func TestDegenerateStatsRejected(t *testing.T) {
	spec := validCharacter()
	spec.Stats = Stats{Atk: 0, Tough: 100, Agi: 0, Sense: 0, Upkeep: 0}
	fields := Validate(spec)
	if !hasPath(fields, "stats") && !hasPath(fields, "stats.tough") {
		t.Fatalf("expected rejection, got %v", paths(fields))
	}
}

func TestNamesRejected(t *testing.T) {
	for _, name := range []string{"a", "Rust 🦀", "see https://x.io", strings.Repeat("x", 33)} {
		spec := validCharacter()
		spec.Name = name
		if fields := Validate(spec); !hasPath(fields, "name") {
			t.Fatalf("name %q should be rejected, got %v", name, paths(fields))
		}
	}
	ok := validCharacter()
	ok.Name = "锈帅"
	if fields := Validate(ok); len(fields) != 0 {
		t.Fatalf("chinese name should pass, got %+v", fields)
	}
}

func TestPaletteRules(t *testing.T) {
	spec := validCharacter()
	spec.Appearance.Palette = []string{"#111111", "#222222"}
	if fields := Validate(spec); !hasPath(fields, "appearance.palette") {
		t.Fatalf("two colors should fail, got %v", paths(fields))
	}

	spec.Appearance.Palette = []string{"#111111", "#111111", "#121212"}
	if fields := Validate(spec); !hasPath(fields, "appearance.palette") {
		t.Fatalf("flat palette should fail contrast, got %v", paths(fields))
	}
}

func TestClosedVocabulary(t *testing.T) {
	spec := validCharacter()
	spec.Loadout.Weapon.Form = "laser"
	spec.Loadout.Weapon.Material = "gold"
	if fields := Validate(spec); !hasPath(fields, "loadout.weapon.form") || !hasPath(fields, "loadout.weapon.material") {
		t.Fatalf("unknown vocabulary must be rejected, got %v", paths(fields))
	}
}

func TestHammerNeedsHead(t *testing.T) {
	spec := validCharacter()
	spec.Loadout.Weapon.Dimensions.Head = 0
	if fields := Validate(spec); !hasPath(fields, "loadout.weapon.dimensions.head") {
		t.Fatalf("expected head error, got %v", paths(fields))
	}
}

func TestWeaponKindIsStandalone(t *testing.T) {
	spec := Spec{
		Schema:     SchemaEntityV1,
		Kind:       KindWeapon,
		Name:       "Long Iron",
		Appearance: Appearance{Palette: []string{"#1B1B1F", "#C8622D", "#E8E1D5"}, Silhouette: "slim"},
		WeaponForm: "blade",
		Stats:      Stats{Atk: 30, Tough: 20, Agi: 20, Sense: 20, Upkeep: 10},
		Provenance: Provenance{Generator: "codex"},
	}
	if fields := Validate(spec); len(fields) != 0 {
		t.Fatalf("expected valid weapon, got %+v", fields)
	}

	spec.Loadout = &Loadout{}
	if fields := Validate(spec); !hasPath(fields, "loadout") {
		t.Fatalf("weapon with loadout must fail, got %v", paths(fields))
	}
}

// TestDeriveTrades pins the trade-off design: every material or chassis that
// gains something must lose something, otherwise the point buy is decorative.
func TestDeriveTrades(t *testing.T) {
	scrap := validCharacter()
	scrap.Loadout.Weapon.Material = "scrap"
	glass := validCharacter()
	glass.Loadout.Weapon.Material = "glass"

	base, hard := Derive(scrap), Derive(glass)
	if hard.Damage <= base.Damage {
		t.Fatalf("glass must hit harder: %d vs %d", hard.Damage, base.Damage)
	}
	if hard.MaxHP >= base.MaxHP {
		t.Fatalf("glass must die faster: %d vs %d", hard.MaxHP, base.MaxHP)
	}

	walker := validCharacter()
	walker.Chassis = "walker"
	tower := validCharacter()
	tower.Chassis = "tower"
	if Derive(tower).Speed >= Derive(walker).Speed {
		t.Fatal("tower must be slower than walker")
	}
	if Derive(tower).ArmorTake >= Derive(walker).ArmorTake {
		t.Fatal("tower must take less damage than walker")
	}
}

func TestNormalizeIsDeterministic(t *testing.T) {
	a, fields := Normalize(validCharacter())
	if len(fields) != 0 {
		t.Fatalf("unexpected fields: %+v", fields)
	}
	b, _ := Normalize(validCharacter())
	if !reflect.DeepEqual(a, b) {
		t.Fatal("normalize must be byte-identical for the same spec")
	}
	if a.Geometry.Hash == "" || a.Colliders == 0 {
		t.Fatal("geometry must be compiled")
	}
}

func TestPercentile(t *testing.T) {
	samples := []int64{10, 20, 20, 30}
	if got := Percentile(20, samples); got != 50 {
		t.Fatalf("expected 50, got %d", got)
	}
	if got := Percentile(100, samples); got != 100 {
		t.Fatalf("expected 100, got %d", got)
	}
	if got := Percentile(0, nil); got != 50 {
		t.Fatalf("empty sample should be neutral, got %d", got)
	}
}

func TestEntitySchemaMatchesValidator(t *testing.T) {
	schema := EntitySchema()
	properties := schema["properties"].(map[string]any)

	enumOf := func(path string) []string {
		node := properties[path].(map[string]any)
		raw := node["enum"].([]any)
		out := make([]string, len(raw))
		for i, v := range raw {
			out[i] = v.(string)
		}
		return out
	}

	cases := map[string][]string{
		"kind":       keys(map[string]bool{KindCharacter: true, KindWeapon: true}),
		"chassis":    keys(chassisSet),
		"weaponForm": keys(forms),
	}
	for path, want := range cases {
		if got := enumOf(path); !reflect.DeepEqual(got, want) {
			t.Fatalf("%s enum drift: schema %v, validator %v", path, got, want)
		}
	}

	if _, err := EntitySchemaJSON(); err != nil {
		t.Fatalf("schema must serialize: %v", err)
	}
}

func TestDrifterSpecIsValid(t *testing.T) {
	if fields := Validate(drifterSpec); len(fields) != 0 {
		t.Fatalf("drifter must satisfy the same rules as players: %+v", fields)
	}
}

// TestEveryTraitIsUsable guards against the validator and Derive drifting apart:
// a trait the engine implements but the closed set rejects is a bug that only
// shows up when a player tries it.
func TestEveryTraitIsUsable(t *testing.T) {
	for trait := range weaponTraits {
		spec := validCharacter()
		spec.Loadout.Weapon.Trait = trait
		if fields := Validate(spec); len(fields) != 0 {
			t.Fatalf("trait %q is implemented but rejected: %+v", trait, fields)
		}
	}
	for trait := range armorTraits {
		spec := validCharacter()
		spec.Loadout.Armor.Trait = trait
		if fields := Validate(spec); len(fields) != 0 {
			t.Fatalf("armor trait %q rejected: %+v", trait, fields)
		}
	}
	for material := range materials {
		spec := validCharacter()
		spec.Loadout.Weapon.Material = material
		if fields := Validate(spec); len(fields) != 0 {
			t.Fatalf("material %q rejected: %+v", material, fields)
		}
	}
}
