package tanks

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

//go:embed character-catalog.gen.json
var catalogJSON []byte

type partRule struct {
	Speed           int `json:"speed"`
	Armor           int `json:"armor"`
	Cost            int `json:"cost"`
	ProjectileSpeed int `json:"projectileSpeed"`
	FireInterval    int `json:"fireInterval"`
}
type Map struct {
	ID      string `json:"id"`
	LevelID int    `json:"levelId"`
	Version int    `json:"version"`
}
type Catalog struct {
	Profile         string              `json:"profile"`
	RulesVersion    int                 `json:"rulesVersion"`
	CompilerVersion int                 `json:"compilerVersion"`
	Budget          int                 `json:"budget"`
	Chassis         map[string]partRule `json:"chassis"`
	Armor           map[string]partRule `json:"armor"`
	Cannon          map[string]partRule `json:"cannon"`
	Maps            []Map               `json:"maps"`
	Modes           []string            `json:"modes"`
	Actions         []string            `json:"actions"`
	DraftSchema     json.RawMessage     `json:"draftSchema"`
}

var Rules = func() Catalog {
	var c Catalog
	if err := json.Unmarshal(catalogJSON, &c); err != nil {
		panic(err)
	}
	return c
}()

type Appearance struct {
	Body    string `json:"body"`
	Accent  string `json:"accent"`
	Pattern string `json:"pattern"`
}
type Parts struct {
	Chassis string `json:"chassis"`
	Armor   string `json:"armor"`
	Cannon  string `json:"cannon"`
}
type Draft struct {
	Profile    string     `json:"profile"`
	Name       string     `json:"name"`
	Parts      Parts      `json:"parts"`
	Appearance Appearance `json:"appearance"`
}
type Blueprint struct {
	ID              string     `json:"id"`
	Speed           int        `json:"speed"`
	Armor           int        `json:"armor"`
	ProjectileSpeed int        `json:"projectileSpeed"`
	FireInterval    int        `json:"fireInterval"`
	Score           int        `json:"score"`
	Appearance      Appearance `json:"appearance"`
}
type Issue struct {
	Code    string `json:"code"`
	Path    string `json:"path"`
	Message string `json:"message"`
}
type Validation struct {
	Valid     bool       `json:"valid"`
	Errors    []Issue    `json:"errors"`
	Blueprint *Blueprint `json:"blueprint,omitempty"`
	Cost      int        `json:"cost"`
	Budget    int        `json:"budget"`
}

var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func Validate(d Draft, id string) Validation {
	v := Validation{Valid: true, Errors: []Issue{}, Budget: Rules.Budget}
	add := func(code, path, message string) {
		v.Valid = false
		v.Errors = append(v.Errors, Issue{code, path, message})
	}
	if d.Profile != Rules.Profile {
		add("unsupported_profile", "/profile", "Use tank-defense@1.")
	}
	if utf8.RuneCountInString(d.Name) < 1 || utf8.RuneCountInString(d.Name) > 40 || d.Name != strings.TrimFunc(d.Name, func(r rune) bool { return unicode.IsSpace(r) || r == '\uFEFF' }) || strings.IndexFunc(d.Name, func(r rune) bool { return unicode.IsControl(r) }) >= 0 {
		add("invalid_name", "/name", "Use 1–40 characters without surrounding whitespace or control characters.")
	}
	chassis, cok := Rules.Chassis[d.Parts.Chassis]
	armor, aok := Rules.Armor[d.Parts.Armor]
	cannon, wok := Rules.Cannon[d.Parts.Cannon]
	for _, p := range []struct {
		ok   bool
		path string
	}{{cok, "/parts/chassis"}, {aok, "/parts/armor"}, {wok, "/parts/cannon"}} {
		if !p.ok {
			add("unknown_part", p.path, "Choose a part from the catalog.")
		}
	}
	if !colorPattern.MatchString(d.Appearance.Body) {
		add("invalid_color", "/appearance/body", "Use a six-digit hex color.")
	}
	if !colorPattern.MatchString(d.Appearance.Accent) {
		add("invalid_color", "/appearance/accent", "Use a six-digit hex color.")
	}
	if d.Appearance.Pattern != "solid" && d.Appearance.Pattern != "stripe" && d.Appearance.Pattern != "cross" {
		add("unknown_pattern", "/appearance/pattern", "Choose solid, stripe, or cross.")
	}
	if cok && aok && wok {
		v.Cost = chassis.Cost + armor.Cost + cannon.Cost
		if v.Cost > Rules.Budget {
			add("character_budget_exceeded", "/parts", "Parts exceed the 9-point budget.")
		}
	}
	if v.Valid {
		v.Blueprint = &Blueprint{ID: id, Speed: chassis.Speed + armor.Speed, Armor: 1 + chassis.Armor + armor.Armor, ProjectileSpeed: cannon.ProjectileSpeed, FireInterval: cannon.FireInterval, Appearance: d.Appearance}
	}
	return v
}

func digest(value any) string {
	b, _ := json.Marshal(value)
	sum := sha256.Sum256(b)
	return "sha256:" + hex.EncodeToString(sum[:])
}

// StrictDecode rejects unknown fields, trailing values, and duplicate object keys.
func StrictDecode(raw []byte, out any) error {
	if trimmed := bytes.TrimSpace(raw); len(trimmed) == 0 || trimmed[0] != '{' {
		return fmt.Errorf("expected an object")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	var value func() error
	value = func() error {
		t, err := d.Token()
		if err != nil {
			return err
		}
		if delim, ok := t.(json.Delim); ok {
			switch delim {
			case '{':
				keys := map[string]bool{}
				for d.More() {
					k, e := d.Token()
					if e != nil {
						return e
					}
					key, ok := k.(string)
					if !ok || keys[key] {
						return fmt.Errorf("duplicate object key")
					}
					keys[key] = true
					if e = value(); e != nil {
						return e
					}
				}
				_, err = d.Token()
			case '[':
				for d.More() {
					if err = value(); err != nil {
						return err
					}
				}
				_, err = d.Token()
			default:
				return fmt.Errorf("invalid delimiter")
			}
		}
		return err
	}
	if err := value(); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return fmt.Errorf("trailing JSON")
	}
	d = json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	return d.Decode(out)
}
