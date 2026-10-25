package reach

import (
	"strconv"
	"strings"
)

// Point is a grid coordinate inside the compiled geometry. Integer only: the
// outline of a weapon must be byte-for-byte identical on every machine.
type Point struct {
	X int `json:"x"`
	Y int `json:"y"`
}

// Geometry is the deterministic drawing of a spec. It is generated on the
// server from parameters, so an agent never has to produce strokes.
type Geometry struct {
	Form    string  `json:"form"`
	Outline []Point `json:"outline"`
	Area    int     `json:"area"`
	Hash    string  `json:"hash"`
}

// Compile turns a validated spec into geometry. The shapes are deliberately
// crude: a world seen from above at this zoom reads silhouettes, not detail.
func Compile(spec Spec) Geometry {
	form := weaponForm(spec)
	if form == "" {
		form = "blade"
	}
	length, mass, head := 40, 30, 20
	if spec.Loadout != nil {
		length = spec.Loadout.Weapon.Dimensions.Length
		mass = spec.Loadout.Weapon.Dimensions.Mass
		head = spec.Loadout.Weapon.Dimensions.Head
	}
	if length < 1 {
		length = 1
	}
	if mass < 1 {
		mass = 1
	}
	if head < 1 {
		head = mass
	}

	// Base shapes live in a 100x100 box and are scaled by length (forward) and
	// mass (across). clamp keeps a maximum of 320 units so the world map stays
	// readable at its zoom level.
	width := clamp(mass*2, 8, 72)
	size := clamp(length*3, 24, 320)

	var outline []Point
	switch form {
	case "blade":
		outline = []Point{
			{0, 0}, {width / 3, -size / 2}, {width / 3, size / 2}, {0, size / 4},
		}
	case "hammer":
		// Keep the head strictly wider than the shaft: overlapping vertices would
		// put a degenerate edge in the published outline.
		headWidth := clamp(head*3, width+8, 120)
		outline = []Point{
			{0, -headWidth / 2}, {size / 3, -headWidth / 2}, {size / 3, -width / 2},
			{size, -width / 2}, {size, width / 2}, {size / 3, width / 2},
			{size / 3, headWidth / 2}, {0, headWidth / 2},
		}
	case "cannon":
		outline = []Point{
			{0, -width / 2}, {size, -width / 3}, {size, width / 3}, {0, width / 2},
			{-width / 2, width / 3}, {-width / 2, -width / 3},
		}
	case "wheel":
		r := size / 2
		for i := 0; i < 12; i++ {
			outline = append(outline, Point{
				X: cosDeg(i*30) * r / 1000,
				Y: sinDeg(i*30) * r / 1000,
			})
		}
	case "shield":
		outline = []Point{
			{-size / 2, -width / 2}, {size / 2, -width / 3}, {size / 2, width / 3},
			{-size / 2, width / 2}, {-size / 2, width / 4}, {-size / 2, -width / 4},
		}
	default: // structure
		outline = []Point{
			{-size / 2, -width / 2}, {size / 2, -width / 2},
			{size / 2, width / 2}, {-size / 2, width / 2},
		}
	}

	hash := digest(form, length, mass, head, spec.Appearance.Silhouette, spec.Appearance.Palette)
	return Geometry{Form: form, Outline: outline, Area: polygonArea(outline), Hash: hash}
}

func clamp(v, low, high int) int {
	if v < low {
		return low
	}
	if v > high {
		return high
	}
	return v
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// polygonArea uses the shoelace formula. Magnitudes here are small enough that
// int is safe on every supported platform.
func polygonArea(points []Point) int {
	if len(points) < 3 {
		return 0
	}
	sum := 0
	for i := range points {
		j := (i + 1) % len(points)
		sum += points[i].X*points[j].Y - points[j].X*points[i].Y
	}
	return abs(sum) / 2
}

// cosDeg and sinDeg return milli-units so the wheel outline stays integer.
func cosDeg(deg int) int {
	table := [13]int{1000, 866, 500, 0, -500, -866, -1000, -866, -500, 0, 500, 866, 1000}
	return table[((deg%360)+360)%360/30]
}

func sinDeg(deg int) int {
	return cosDeg(deg - 90)
}

// GeometryKey is a short stable identifier used in slog lines and tests.
func GeometryKey(g Geometry) string {
	var b strings.Builder
	b.WriteString(g.Form)
	b.WriteByte(':')
	b.WriteString(strconv.Itoa(g.Area))
	b.WriteByte(':')
	b.WriteString(g.Hash[:8])
	return b.String()
}
