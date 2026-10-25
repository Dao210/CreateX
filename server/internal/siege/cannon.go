package siege

import (
	"math"
	"reflect"
)

// CannonDesign describes the editable kit, not combat attributes.
type CannonDesign struct {
	Kind           string `json:"kind"`
	Version        int    `json:"version"`
	BarrelLengthMm int    `json:"barrelLengthMm"`
	BarrelWidthMm  int    `json:"barrelWidthMm"`
}

func cannonDrawing(design CannonDesign, revision int) Drawing {
	end := 1720 + int(math.Round(float64(design.BarrelLengthMm)*512/1000))
	half := int(math.Round(float64(design.BarrelWidthMm) * 512 / 2000))
	axis := make([]Point, 0, 25)
	for i := 0; i < 24; i++ {
		angle := float64(i) * math.Pi * 2 / 24
		axis = append(axis, Point{int(math.Round(1400 + math.Cos(angle)*240)), int(math.Round(2048 + math.Sin(angle)*240))})
	}
	axis = append(axis, axis[0])
	return Drawing{SchemaVersion: 1, Revision: revision, GridSize: 4096, Strokes: []Stroke{
		{ID: "kit-axis", Points: axis, Width: 24, Color: "ink"},
		{ID: "kit-brace", Points: []Point{{1400, 2048}, {1750, 2048}}, Width: 24, Color: "ink"},
		{ID: "kit-barrel", Points: []Point{{1720, 2048 - half}, {end, 2048 - half}, {end, 2048 + half}, {1720, 2048 + half}, {1720, 2048 - half}}, Width: 24, Color: "ink"},
	}}
}

func cannonSpec(drawing Drawing) Spec {
	pivot := Point{1400, 2048}
	muzzle := Point{drawing.Strokes[2].Points[1][0], 2048}
	direction := Point{muzzle[0] + 256, 2048}
	types := []string{"wheel", "structure", "cannon"}
	spec := Spec{SchemaVersion: 1, DrawingHash: drawingHash(drawing), MountHint: &pivot,
		Decorations: []Decoration{}, Links: []Link{}, Unresolved: []string{}, Parts: []Part{}}
	for i, stroke := range drawing.Strokes {
		part := Part{ID: stroke.ID, Type: types[i], StrokeRefs: []StrokeRef{{StrokeID: stroke.ID, FromPoint: 0, ToPoint: len(stroke.Points) - 1}}}
		if i == 0 {
			part.AnchorHint = &pivot
		}
		if i == 2 {
			part.AnchorHint, part.DirectionHint = &muzzle, &direction
		}
		spec.Parts = append(spec.Parts, part)
		if i > 0 {
			spec.Links = append(spec.Links, Link{From: "kit-axis", To: stroke.ID, Kind: "fixed"})
		}
	}
	return spec
}

func validateCannonDesign(design *CannonDesign, drawing Drawing, spec Spec) error {
	if design == nil {
		return nil
	}
	if design.Kind != "cannon-kit" || design.Version != 1 ||
		design.BarrelLengthMm < 1600 || design.BarrelLengthMm > 3200 || design.BarrelLengthMm%50 != 0 ||
		design.BarrelWidthMm < 450 || design.BarrelWidthMm > 1050 || design.BarrelWidthMm%50 != 0 {
		return problem("invalid_cannon_design", 400)
	}
	expected := cannonDrawing(*design, drawing.Revision)
	if !reflect.DeepEqual(expected, drawing) || !reflect.DeepEqual(cannonSpec(expected), spec) {
		return problem("cannon_design_mismatch", 400)
	}
	return nil
}
