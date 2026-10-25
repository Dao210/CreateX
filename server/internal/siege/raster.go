package siege

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math"
)

// Rasterize uses only the validated vector data; external images and URLs are never fetched.
func Rasterize(d Drawing) ([]byte, error) {
	if err := validateDrawing(d); err != nil {
		return nil, err
	}
	img := image.NewRGBA(image.Rect(0, 0, 512, 512))
	for y := 0; y < 512; y++ {
		for x := 0; x < 512; x++ {
			img.SetRGBA(x, y, color.RGBA{255, 255, 255, 255})
		}
	}
	for _, stroke := range d.Strokes {
		for i := 0; i < len(stroke.Points)-1; i++ {
			a, b := stroke.Points[i], stroke.Points[i+1]
			ax, ay, bx, by := float64(a[0])/8, float64(a[1])/8, float64(b[0])/8, float64(b[1])/8
			steps := int(math.Ceil(math.Hypot(bx-ax, by-ay) * 2))
			if steps < 1 {
				steps = 1
			}
			radius := float64(stroke.Width) / 16
			for j := 0; j <= steps; j++ {
				t := float64(j) / float64(steps)
				cx, cy := ax+(bx-ax)*t, ay+(by-ay)*t
				for y := int(math.Floor(cy - radius)); y <= int(math.Ceil(cy+radius)); y++ {
					for x := int(math.Floor(cx - radius)); x <= int(math.Ceil(cx+radius)); x++ {
						if math.Hypot(float64(x)-cx, float64(y)-cy) <= radius {
							img.SetRGBA(x, y, color.RGBA{30, 40, 32, 255})
						}
					}
				}
			}
		}
	}
	var out bytes.Buffer
	err := png.Encode(&out, img)
	return out.Bytes(), err
}
