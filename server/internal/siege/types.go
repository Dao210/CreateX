package siege

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"regexp"
)

const RulesVersion = "p0.2"

var identifier = regexp.MustCompile("^[A-Za-z0-9_-]{1,64}$")

type Point [2]int

func (p *Point) UnmarshalJSON(data []byte) error {
	var values []int
	if err := json.Unmarshal(data, &values); err != nil || len(values) != 2 {
		return errors.New("invalid point")
	}
	*p = Point{values[0], values[1]}
	return nil
}

type Stroke struct {
	ID     string  `json:"id"`
	Points []Point `json:"points"`
	Width  int     `json:"width"`
	Color  string  `json:"color"`
}
type Drawing struct {
	SchemaVersion int      `json:"schemaVersion"`
	Revision      int      `json:"revision"`
	GridSize      int      `json:"gridSize"`
	Strokes       []Stroke `json:"strokes"`
}
type StrokeRef struct {
	StrokeID  string `json:"strokeId"`
	FromPoint int    `json:"fromPoint"`
	ToPoint   int    `json:"toPoint"`
}
type Part struct {
	ID            string      `json:"id"`
	Type          string      `json:"type"`
	StrokeRefs    []StrokeRef `json:"strokeRefs"`
	AnchorHint    *Point      `json:"anchorHint"`
	DirectionHint *Point      `json:"directionHint"`
}
type Decoration struct {
	StrokeRefs []StrokeRef `json:"strokeRefs"`
	AttachedTo *string     `json:"attachedTo"`
}
type Link struct {
	From       string `json:"from"`
	To         string `json:"to"`
	Kind       string `json:"kind"`
	AnchorHint *Point `json:"anchorHint"`
}
type Spec struct {
	SchemaVersion int          `json:"schemaVersion"`
	DrawingHash   string       `json:"drawingHash"`
	Parts         []Part       `json:"parts"`
	Decorations   []Decoration `json:"decorations"`
	Links         []Link       `json:"links"`
	MountHint     *Point       `json:"mountHint"`
	Unresolved    []string     `json:"unresolved"`
}

func validPoint(p Point) bool { return p[0] >= 0 && p[1] >= 0 && p[0] <= 4096 && p[1] <= 4096 }
func validateDrawing(d Drawing) error {
	if d.SchemaVersion != 1 || d.GridSize != 4096 || d.Revision < 0 || len(d.Strokes) == 0 || len(d.Strokes) > 64 {
		return problem("invalid_drawing", 400)
	}
	seen := map[string]bool{}
	count := 0
	for _, s := range d.Strokes {
		if !identifier.MatchString(s.ID) || seen[s.ID] || len(s.Points) < 2 || (s.Width != 24 && s.Width != 40) || (s.Color != "ink" && s.Color != "accent") {
			return problem("invalid_drawing", 400)
		}
		seen[s.ID] = true
		count += len(s.Points)
		for _, p := range s.Points {
			if !validPoint(p) {
				return problem("invalid_drawing", 400)
			}
		}
	}
	if count > 4096 {
		return problem("invalid_drawing", 400)
	}
	return nil
}
func drawingHash(d Drawing) string {
	canonical := struct {
		SchemaVersion int      `json:"schemaVersion"`
		GridSize      int      `json:"gridSize"`
		Strokes       []Stroke `json:"strokes"`
	}{d.SchemaVersion, d.GridSize, d.Strokes}
	data, _ := json.Marshal(canonical)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
func payloadHash(v any) string {
	data, _ := json.Marshal(v)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
func validateSpec(d Drawing, s Spec) error {
	if s.SchemaVersion != 1 || s.DrawingHash != drawingHash(d) || len(s.Parts) < 1 || len(s.Parts) > 12 || s.Decorations == nil || s.Links == nil || s.Unresolved == nil || len(s.Unresolved) > 8 || len(s.Decorations) > 64 || len(s.Links) > 11 {
		return problem("invalid_spec", 400)
	}
	strokes := map[string]Stroke{}
	for _, st := range d.Strokes {
		strokes[st.ID] = st
	}
	ids := map[string]bool{}
	used := map[string]map[int]bool{}
	powered, wheels, cannons, melee := 0, 0, 0, 0
	read := func(refs []StrokeRef) bool {
		if len(refs) == 0 || len(refs) > 64 {
			return false
		}
		for _, ref := range refs {
			st, ok := strokes[ref.StrokeID]
			if !ok || ref.FromPoint < 0 || ref.FromPoint >= ref.ToPoint || ref.ToPoint >= len(st.Points) {
				return false
			}
			if used[st.ID] == nil {
				used[st.ID] = map[int]bool{}
			}
			for i := ref.FromPoint; i < ref.ToPoint; i++ {
				if used[st.ID][i] {
					return false
				}
				used[st.ID][i] = true
			}
		}
		return true
	}
	for _, p := range s.Parts {
		if !identifier.MatchString(p.ID) || ids[p.ID] || !read(p.StrokeRefs) {
			return problem("invalid_spec", 400)
		}
		ids[p.ID] = true
		switch p.Type {
		case "blade", "hammer", "cannon", "wheel", "shield":
			powered++
			if p.Type == "wheel" {
				wheels++
			}
			if p.Type == "cannon" {
				cannons++
			}
			if p.Type == "blade" || p.Type == "hammer" {
				melee++
			}
		case "structure":
		default:
			return problem("invalid_spec", 400)
		}
		if (p.AnchorHint != nil && !validPoint(*p.AnchorHint)) || (p.DirectionHint != nil && !validPoint(*p.DirectionHint)) {
			return problem("invalid_spec", 400)
		}
	}
	if powered > 4 || wheels > 1 || cannons > 1 || (cannons > 0 && melee > 0) {
		return problem("invalid_spec", 400)
	}
	for _, decoration := range s.Decorations {
		if !read(decoration.StrokeRefs) || (decoration.AttachedTo != nil && !ids[*decoration.AttachedTo]) {
			return problem("invalid_spec", 400)
		}
	}
	for _, link := range s.Links {
		if !ids[link.From] || !ids[link.To] || link.From == link.To || link.Kind != "fixed" || (link.AnchorHint != nil && !validPoint(*link.AnchorHint)) {
			return problem("invalid_spec", 400)
		}
	}
	if s.MountHint != nil && !validPoint(*s.MountHint) {
		return problem("invalid_spec", 400)
	}
	for _, text := range s.Unresolved {
		if len(text) > 640 {
			return problem("invalid_spec", 400)
		}
	}
	for _, stroke := range d.Strokes {
		if len(used[stroke.ID]) != len(stroke.Points)-1 {
			return problem("invalid_spec", 400)
		}
	}
	return nil
}
func decodeStrict(data []byte, out any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return errors.New("trailing JSON")
	}
	return nil
}

type Problem struct {
	Code   string
	Status int
}

func (p *Problem) Error() string               { return p.Code }
func problem(code string, status int) *Problem { return &Problem{code, status} }
