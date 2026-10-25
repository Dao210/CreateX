package reach

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

var (
	silhouettes  = set("slim", "broad", "tall", "low")
	chassisSet   = set("walker", "crawler", "drifter", "tower")
	forms        = set("blade", "hammer", "cannon", "wheel", "shield", "structure")
	materials    = set("scrap", "bone", "glass", "iron")
	weaponTraits = set("concussive", "serrated", "reach", "swift", "volatile", "bulwark", "none")
	plates       = set("plated", "light")
	armorTraits  = set("braced", "reactive", "none")
	generators   = set("human", "workbuddy", "codex", "other")
	locales      = set("en", "zh-Hans", "zh-Hant", "ja", "ko")
)

func set(values ...string) map[string]bool {
	m := make(map[string]bool, len(values))
	for _, v := range values {
		m[v] = true
	}
	return m
}

// formRange is the reach of each weapon form in grid units, before material and
// trait modifiers. Structure hits what stands next to it; cannon reaches across
// a belt.
var formRange = map[string]int64{
	"blade":     14,
	"hammer":    11,
	"cannon":    48,
	"wheel":     9,
	"shield":    7,
	"structure": 12,
}

// Validate checks a spec and returns every problem it can find, not just the
// first one. A generator that gets three field errors back can fix all three.
func Validate(spec Spec) []FieldError {
	var fields []FieldError
	add := func(path, code, detail string) {
		fields = append(fields, FieldError{Path: path, Code: code, Detail: detail})
	}
	paletteOK := true

	if spec.Schema != SchemaEntityV1 {
		add("schema", "unsupported", "expected "+SchemaEntityV1)
	}
	if spec.Kind != KindCharacter && spec.Kind != KindWeapon {
		add("kind", "unsupported", "expected character or weapon")
	}
	if name := strings.TrimSpace(spec.Name); !validName(name) {
		add("name", "invalid", "2-32 letters, digits, spaces, hyphens or underscores")
	}

	if len(spec.Appearance.Palette) != 3 {
		add("appearance.palette", "invalid", "exactly 3 hex colors")
		paletteOK = false
	} else {
		for i, color := range spec.Appearance.Palette {
			if _, ok := parseHex(color); !ok {
				add(fmt.Sprintf("appearance.palette[%d]", i), "invalid", "expected #RRGGBB")
				paletteOK = false
			}
		}
		if paletteOK && minContrast(spec.Appearance.Palette) < 1400 {
			add("appearance.palette", "low_contrast", "colors must differ enough to read on the map")
		}
	}
	if !silhouettes[spec.Appearance.Silhouette] {
		add("appearance.silhouette", "unsupported", "slim, broad, tall or low")
	}

	if spec.Locale != "" && !locales[spec.Locale] {
		add("locale", "unsupported", "en, zh-Hans, zh-Hant, ja or ko")
	}

	switch spec.Kind {
	case KindCharacter:
		if !chassisSet[spec.Chassis] {
			add("chassis", "unsupported", "walker, crawler, drifter or tower")
		}
		if spec.Loadout == nil {
			add("loadout", "required", "a character needs a weapon and armor")
		} else {
			fields = append(fields, validateWeapon("loadout.weapon", spec.Loadout.Weapon)...)
			if !plates[spec.Loadout.Armor.Plate] {
				add("loadout.armor.plate", "unsupported", "plated or light")
			}
			if !armorTraits[spec.Loadout.Armor.Trait] {
				add("loadout.armor.trait", "unsupported", "braced, reactive or none")
			}
		}
		if spec.Policy == nil {
			add("policy", "required", "a character needs a temperament")
		}
	case KindWeapon:
		if spec.Chassis != "" {
			add("chassis", "unexpected", "weapons have no chassis")
		}
		if spec.Loadout != nil {
			add("loadout", "unexpected", "a weapon is submitted on its own")
		}
		if spec.Policy != nil {
			add("policy", "unexpected", "weapons hold no policy")
		}
		// A weapon spec carries its form on the top level via loadout-less
		// fields: reuse Stats for its numbers and treat Appearance as the object.
		if spec.WeaponForm == "" {
			add("weaponForm", "required", "a weapon needs a form")
		} else if !forms[spec.WeaponForm] {
			add("weaponForm", "unsupported", "blade, hammer, cannon, wheel, shield or structure")
		}
	}

	if spec.Policy != nil {
		for _, p := range []struct {
			path  string
			value float64
		}{
			{"policy.aggression", spec.Policy.Aggression},
			{"policy.caution", spec.Policy.Caution},
			{"policy.hoard", spec.Policy.Hoard},
			{"policy.loyalty", spec.Policy.Loyalty},
		} {
			if math.IsNaN(p.value) || p.value < 0 || p.value > 1 {
				add(p.path, "out_of_range", "0 to 1")
			}
		}
	}

	fields = append(fields, validateStats(spec.Stats)...)

	if n := utf8.RuneCountInString(spec.Voice); n > 60 {
		add("voice", "too_long", "60 characters or fewer")
	}
	if strings.Contains(spec.Voice, "://") {
		add("voice", "invalid", "no links")
	}
	if !generators[spec.Provenance.Generator] {
		add("provenance.generator", "unsupported", "human, workbuddy, codex or other")
	}
	if utf8.RuneCountInString(spec.Provenance.Author) > 64 {
		add("provenance.author", "too_long", "64 characters or fewer")
	}
	if utf8.RuneCountInString(spec.Provenance.Model) > 64 {
		add("provenance.model", "too_long", "64 characters or fewer")
	}
	return fields
}

func validateWeapon(path string, w Weapon) []FieldError {
	var fields []FieldError
	add := func(p, code, detail string) {
		fields = append(fields, FieldError{Path: p, Code: code, Detail: detail})
	}
	if !forms[w.Form] {
		add(path+".form", "unsupported", "blade, hammer, cannon, wheel, shield or structure")
	}
	if !materials[w.Material] {
		add(path+".material", "unsupported", "scrap, bone, glass or iron")
	}
	if !weaponTraits[w.Trait] {
		add(path+".trait", "unsupported", "concussive, serrated, reach, swift, volatile or none")
	}
	if w.Dimensions.Length < 1 || w.Dimensions.Length > 100 {
		add(path+".dimensions.length", "out_of_range", "1 to 100")
	}
	if w.Dimensions.Mass < 1 || w.Dimensions.Mass > 100 {
		add(path+".dimensions.mass", "out_of_range", "1 to 100")
	}
	if w.Form == "hammer" && (w.Dimensions.Head < 1 || w.Dimensions.Head > 100) {
		add(path+".dimensions.head", "out_of_range", "a hammer needs a head between 1 and 100")
	}
	if w.Dimensions.Head < 0 || w.Dimensions.Head > 100 {
		add(path+".dimensions.head", "out_of_range", "0 to 100")
	}
	return fields
}

func validateStats(s Stats) []FieldError {
	var fields []FieldError
	for _, f := range []struct {
		path  string
		value int
	}{
		{"stats.atk", s.Atk},
		{"stats.tough", s.Tough},
		{"stats.agi", s.Agi},
		{"stats.sense", s.Sense},
		{"stats.upkeep", s.Upkeep},
	} {
		if f.value < 0 || f.value > StatMax {
			fields = append(fields, FieldError{Path: f.path, Code: "out_of_range", Detail: "0 to 40"})
		}
	}
	if sum := s.Sum(); sum != StatBudget {
		fields = append(fields, FieldError{
			Path:   "stats",
			Code:   "budget",
			Detail: fmt.Sprintf("must sum to %d, got %d", StatBudget, sum),
		})
	}
	if nonZero(s) < 2 {
		fields = append(fields, FieldError{
			Path:   "stats",
			Code:   "degenerate",
			Detail: "at least two attributes must be non-zero",
		})
	}
	return fields
}

func nonZero(s Stats) int {
	n := 0
	for _, v := range []int{s.Atk, s.Tough, s.Agi, s.Sense, s.Upkeep} {
		if v > 0 {
			n++
		}
	}
	return n
}

func validName(name string) bool {
	n := utf8.RuneCountInString(name)
	if n < 2 || n > 32 {
		return false
	}
	if strings.Contains(name, "://") || strings.Contains(name, "www.") {
		return false
	}
	for _, r := range name {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == ' ' || r == '-' || r == '_' {
			continue
		}
		return false
	}
	return true
}

func parseHex(color string) ([3]int, bool) {
	var out [3]int
	if len(color) != 7 || color[0] != '#' {
		return out, false
	}
	for i := 0; i < 3; i++ {
		v, err := strconv.ParseUint(color[1+i*2:3+i*2], 16, 8)
		if err != nil {
			return out, false
		}
		out[i] = int(v)
	}
	return out, true
}

// luminance is the WCAG relative luminance, used only to check that a palette is
// legible on the dark map.
func luminance(color string) float64 {
	rgb, _ := parseHex(color)
	channel := func(v int) float64 {
		c := float64(v) / 255
		if c <= 0.03928 {
			return c / 12.92
		}
		return math.Pow((c+0.055)/1.055, 2.4)
	}
	return 0.2126*channel(rgb[0]) + 0.7152*channel(rgb[1]) + 0.0722*channel(rgb[2])
}

func contrast(a, b string) float64 {
	la, lb := luminance(a), luminance(b)
	if la < lb {
		la, lb = lb, la
	}
	return (la + 0.05) / (lb + 0.05)
}

func minContrast(palette []string) int {
	worst := math.MaxFloat64
	for i := 0; i < len(palette); i++ {
		for j := i + 1; j < len(palette); j++ {
			if c := contrast(palette[i], palette[j]); c < worst {
				worst = c
			}
		}
	}
	if worst == math.MaxFloat64 {
		return 0
	}
	return int(worst * 1000)
}

// Derive compiles a spec into fixed-point settlement numbers. Every modifier
// here is a trade: glass hits harder and dies faster, a tower sees further and
// barely moves.
func Derive(spec Spec) Derived {
	d := Derived{
		MaxHP:     (40 + int64(spec.Stats.Tough)*3) * Milli,
		Damage:    (6*Milli + int64(spec.Stats.Atk)*1400),
		Speed:     Milli + int64(spec.Stats.Agi)*60,
		Sense:     60 + int64(spec.Stats.Sense)*9,
		Upkeep:    Milli + int64(spec.Stats.Upkeep)*40,
		Range:     formRange["blade"],
		ArmorTake: Milli,
		Trait:     "none",
		Material:  "scrap",
	}

	form := spec.WeaponForm
	if spec.Loadout != nil {
		form = spec.Loadout.Weapon.Form
		d.Material = spec.Loadout.Weapon.Material
		d.Trait = spec.Loadout.Weapon.Trait
		d.Range = formRange[spec.Loadout.Weapon.Form]
		if mass := spec.Loadout.Weapon.Dimensions.Mass; mass > 60 {
			d.Speed = d.Speed * 90 / 100
		}
		if spec.Loadout.Weapon.Form == "hammer" {
			d.Damage += int64(spec.Loadout.Weapon.Dimensions.Head) * 90
		}
	}
	if form == "" {
		form = "blade"
	}
	if d.Range == 0 {
		d.Range = formRange["blade"]
	}

	switch d.Material {
	case "bone":
		d.Damage = d.Damage * 115 / 100
		d.MaxHP = d.MaxHP * 95 / 100
	case "glass":
		d.Damage = d.Damage * 135 / 100
		d.MaxHP = d.MaxHP * 85 / 100
	case "iron":
		d.Damage = d.Damage * 95 / 100
		d.Speed = d.Speed * 90 / 100
	}

	switch d.Trait {
	case "reach":
		d.Range = d.Range * 120 / 100
	case "swift":
		d.Speed = d.Speed * 115 / 100
	case "volatile":
		d.Damage = d.Damage * 125 / 100
	case "bulwark":
		d.ArmorTake = d.ArmorTake * 85 / 100
	}

	if spec.Loadout != nil {
		switch spec.Loadout.Armor.Plate {
		case "plated":
			d.ArmorTake = d.ArmorTake * 85 / 100
			d.Speed = d.Speed * 90 / 100
		case "light":
			d.ArmorTake = d.ArmorTake * 105 / 100
			d.Speed = d.Speed * 110 / 100
		}
		if spec.Loadout.Armor.Trait == "braced" {
			d.ArmorTake = d.ArmorTake * 90 / 100
		}
	}

	switch spec.Chassis {
	case "crawler":
		d.Speed = d.Speed * 85 / 100
		d.ArmorTake = d.ArmorTake * 90 / 100
	case "drifter":
		d.Speed = d.Speed * 110 / 100
		d.MaxHP = d.MaxHP * 90 / 100
	case "tower":
		d.Speed = d.Speed * 65 / 100
		d.ArmorTake = d.ArmorTake * 80 / 100
		d.Range = d.Range * 110 / 100
	}

	if d.MaxHP < 10*Milli {
		d.MaxHP = 10 * Milli
	}
	if d.Speed < 200 {
		d.Speed = 200
	}
	return d
}

// Power is the scalar used for the public powerIndex. It deliberately rewards
// staying alive over hitting hard, so a glass cannon does not top the board.
func Power(d Derived) int64 {
	durability := d.MaxHP / Milli * d.Sense / 100
	strike := d.Damage / Milli * d.Range / 10
	mobility := d.Speed / 100
	return (durability*3 + strike*2) * (Milli + mobility) / Milli
}

// Percentile ranks value inside samples, 0-100. Ties count as half, which keeps
// the number stable when many entities share a build.
func Percentile(value int64, samples []int64) int {
	if len(samples) == 0 {
		return 50
	}
	below, equal := 0, 0
	for _, v := range samples {
		switch {
		case v < value:
			below++
		case v == value:
			equal++
		}
	}
	return int(math.Round((float64(below) + float64(equal)/2) / float64(len(samples)) * 100))
}

// Normalize runs validation then compiles the spec. It is the single entry point
// used by the submission API, so no caller can skip a rule.
func Normalize(spec Spec) (Normalized, []FieldError) {
	if fields := Validate(spec); len(fields) > 0 {
		return Normalized{}, fields
	}
	d := Derive(spec)
	geo := Compile(spec)
	return Normalized{
		Schema:    SchemaEntityV1,
		Derived:   d,
		Geometry:  geo,
		Power:     Power(d),
		Form:      weaponForm(spec),
		Chassis:   spec.Chassis,
		Colliders: len(geo.Outline),
	}, nil
}

func weaponForm(spec Spec) string {
	if spec.Loadout != nil {
		return spec.Loadout.Weapon.Form
	}
	return spec.WeaponForm
}

// fingerprint is the deduplication key: same spec bytes mean the same entity.
func fingerprint(spec Spec) string {
	data, _ := json.Marshal(spec)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func digest(values ...any) string {
	h := sha256.New()
	for _, v := range values {
		data, _ := json.Marshal(v)
		h.Write(data)
	}
	return hex.EncodeToString(h.Sum(nil))[:16]
}
