package fish

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

//go:embed catalog.gen.json
var catalogJSON []byte

type Point struct {
	X int `json:"x"`
	Y int `json:"y"`
}
type Section struct {
	U      int `json:"u"`
	Height int `json:"height"`
	Width  int `json:"width"`
	Offset int `json:"offset"`
}
type Fin struct {
	At      int     `json:"at"`
	Side    string  `json:"side"`
	Outline []Point `json:"outline"`
}
type Body struct {
	LengthMM int       `json:"lengthMm"`
	Sections []Section `json:"sections"`
}
type Tail struct {
	Length int `json:"length"`
	Spread int `json:"spread"`
	Fork   int `json:"fork"`
}
type Eyes struct {
	At   int `json:"at"`
	Size int `json:"size"`
}
type Appearance struct {
	Body    string `json:"body"`
	Belly   string `json:"belly"`
	Accent  string `json:"accent"`
	Pattern string `json:"pattern"`
	Glow    int    `json:"glow"`
	Opacity int    `json:"opacity"`
}
type Motion struct {
	Style     string `json:"style"`
	Speed     int    `json:"speed"`
	Frequency int    `json:"frequency"`
	Amplitude int    `json:"amplitude"`
}
type Behavior struct {
	Schooling     int `json:"schooling"`
	Depth         int `json:"depth"`
	PersonalSpace int `json:"personalSpace"`
}
type Draft struct {
	Profile    string     `json:"profile"`
	Name       string     `json:"name"`
	Body       Body       `json:"body"`
	Fins       []Fin      `json:"fins"`
	Tail       Tail       `json:"tail"`
	Eyes       Eyes       `json:"eyes"`
	Appearance Appearance `json:"appearance"`
	Motion     Motion     `json:"motion"`
	Behavior   Behavior   `json:"behavior"`
}
type Issue struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}
type Validation struct {
	Valid  bool    `json:"valid"`
	Errors []Issue `json:"errors"`
}
type Catalog struct {
	DraftSchema   json.RawMessage `json:"draftSchema"`
	Examples      []Draft         `json:"examples"`
	Capacity      int             `json:"capacity"`
	MaxCharacters int             `json:"maxCharacters"`
	MaxRevisions  int             `json:"maxRevisions"`
}

// Parse the immutable required-field schema once; ocean reads decode many residents.
var requiredDraftSchema = func() map[string]any {
	var c struct {
		Schema map[string]any `json:"draftSchema"`
	}
	if err := json.Unmarshal(catalogJSON, &c); err != nil {
		panic(err)
	}
	return c.Schema
}()

var Rules = func() Catalog {
	var c Catalog
	if err := json.Unmarshal(catalogJSON, &c); err != nil {
		panic(err)
	}
	return c
}()
var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func StrictDecode(raw []byte, out any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("trailing JSON")
	}
	return nil
}
func digest(v any) string {
	raw, _ := json.Marshal(v)
	h := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(h[:])
}
func Validate(d Draft) Validation {
	v := Validation{Valid: true, Errors: []Issue{}}
	add := func(path, message string) { v.Valid = false; v.Errors = append(v.Errors, Issue{path, message}) }
	check := func(path string, n, min, max int) {
		if n < min || n > max {
			add(path, fmt.Sprintf("Use an integer from %d to %d.", min, max))
		}
	}
	if d.Profile != "fish@1" {
		add("/profile", "Use fish@1.")
	}
	if utf8.RuneCountInString(d.Name) < 1 || utf8.RuneCountInString(d.Name) > 40 || strings.TrimFunc(d.Name, func(r rune) bool { return unicode.IsSpace(r) || r == '\uFEFF' }) != d.Name || strings.IndexFunc(d.Name, unicode.IsControl) >= 0 {
		add("/name", "Use 1–40 characters without surrounding whitespace or controls.")
	}
	check("/body/lengthMm", d.Body.LengthMM, 100, 2000)
	if len(d.Body.Sections) < 4 || len(d.Body.Sections) > 16 {
		add("/body/sections", "Use 4–16 ordered sections.")
	}
	for i, s := range d.Body.Sections {
		p := fmt.Sprintf("/body/sections/%d", i)
		check(p+"/u", s.U, 0, 1000)
		check(p+"/height", s.Height, 5, 600)
		check(p+"/width", s.Width, 5, 600)
		check(p+"/offset", s.Offset, -200, 200)
		if i > 0 && s.U <= d.Body.Sections[i-1].U {
			add(p+"/u", "Sections must increase from head to tail.")
		}
	}
	if len(d.Body.Sections) > 0 && (d.Body.Sections[0].U != 0 || d.Body.Sections[len(d.Body.Sections)-1].U != 1000) {
		add("/body/sections", "Start at 0 and end at 1000.")
	}
	if d.Fins == nil || len(d.Fins) > 8 {
		add("/fins", "Use an array of up to 8 fins.")
	}
	for i, f := range d.Fins {
		p := fmt.Sprintf("/fins/%d", i)
		check(p+"/at", f.At, 100, 900)
		if f.Side != "dorsal" && f.Side != "ventral" && f.Side != "left" && f.Side != "right" {
			add(p+"/side", "Unknown fin side.")
		}
		if len(f.Outline) < 3 || len(f.Outline) > 12 {
			add(p+"/outline", "Use 3–12 convex outline vertices.")
			continue
		}
		sign, base, area := 0, 0, 0
		convex := true
		for j, a := range f.Outline {
			check(p+"/outline/x", a.X, -500, 500)
			check(p+"/outline/y", a.Y, 0, 700)
			if a.Y == 0 {
				base++
			}
			b := f.Outline[(j+1)%len(f.Outline)]
			c := f.Outline[(j+2)%len(f.Outline)]
			cross := (b.X-a.X)*(c.Y-b.Y) - (b.Y-a.Y)*(c.X-b.X)
			next := 1
			if cross < 0 {
				next = -1
			}
			if cross == 0 || (sign != 0 && sign != next) {
				convex = false
			}
			sign = next
			area += a.X*b.Y - a.Y*b.X
		}
		for j, a := range f.Outline {
			b := f.Outline[(j+1)%len(f.Outline)]
			for _, p := range f.Outline {
				cross := (b.X-a.X)*(p.Y-a.Y) - (b.Y-a.Y)*(p.X-a.X)
				if cross != 0 && ((cross > 0 && sign < 0) || (cross < 0 && sign > 0)) {
					convex = false
				}
			}
		}
		if !convex || area == 0 || base < 2 {
			add(p+"/outline", "Use a convex fin with two base vertices at y=0.")
		}
	}
	check("/tail/length", d.Tail.Length, 50, 700)
	check("/tail/spread", d.Tail.Spread, 50, 600)
	check("/tail/fork", d.Tail.Fork, 0, 800)
	check("/eyes/at", d.Eyes.At, 50, 300)
	check("/eyes/size", d.Eyes.Size, 10, 70)
	for _, c := range []struct{ p, v string }{{"body", d.Appearance.Body}, {"belly", d.Appearance.Belly}, {"accent", d.Appearance.Accent}} {
		if !colorPattern.MatchString(c.v) {
			add("/appearance/"+c.p, "Use #RRGGBB.")
		}
	}
	if d.Appearance.Pattern != "solid" && d.Appearance.Pattern != "stripes" && d.Appearance.Pattern != "spots" {
		add("/appearance/pattern", "Unknown pattern.")
	}
	check("/appearance/glow", d.Appearance.Glow, 0, 300)
	check("/appearance/opacity", d.Appearance.Opacity, 650, 1000)
	if d.Motion.Style != "tail-beat" && d.Motion.Style != "body-wave" && d.Motion.Style != "fin-glide" {
		add("/motion/style", "Unknown motion style.")
	}
	check("/motion/speed", d.Motion.Speed, 150, 1800)
	check("/motion/frequency", d.Motion.Frequency, 500, 4000)
	check("/motion/amplitude", d.Motion.Amplitude, 20, 180)
	check("/behavior/schooling", d.Behavior.Schooling, 0, 1000)
	check("/behavior/depth", d.Behavior.Depth, 100, 900)
	check("/behavior/personalSpace", d.Behavior.PersonalSpace, 300, 2000)
	return v
}

// Requiredness and nulls are checked before typed decoding, using the published schema.
func (d *Draft) UnmarshalJSON(raw []byte) error {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	var required func(any, map[string]any) error
	required = func(value any, schema map[string]any) error {
		if value == nil {
			return fmt.Errorf("null field")
		}
		switch schema["type"] {
		case "object":
			object, ok := value.(map[string]any)
			if !ok {
				return fmt.Errorf("expected object")
			}
			fields, _ := schema["required"].([]any)
			props, _ := schema["properties"].(map[string]any)
			for _, key := range fields {
				k := key.(string)
				v, ok := object[k]
				if !ok {
					return fmt.Errorf("missing %s", k)
				}
				child, _ := props[k].(map[string]any)
				if err := required(v, child); err != nil {
					return err
				}
			}
		case "array":
			array, ok := value.([]any)
			if !ok {
				return fmt.Errorf("expected array")
			}
			child, _ := schema["items"].(map[string]any)
			for _, v := range array {
				if err := required(v, child); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err := required(value, requiredDraftSchema); err != nil {
		return err
	}
	type plain Draft
	var parsed plain
	if err := StrictDecode(raw, &parsed); err != nil {
		return err
	}
	*d = Draft(parsed)
	return nil
}
