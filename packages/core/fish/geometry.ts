import type { FishSpec } from "./schema";

export interface FishGeometry { positions: number[]; colors: number[]; indices: number[] }
export function bodySection(spec: FishSpec, u: number) {
  const sections = spec.body.sections;
  let i = 1;
  while (i < sections.length - 1 && sections[i]!.u < u) i++;
  const a = sections[i - 1]!, b = sections[i]!;
  const t = Math.max(0, Math.min(1, (u - a.u) / (b.u - a.u)));
  return { height: (a.height + (b.height - a.height) * t) / 1000, width: (a.width + (b.width - a.width) * t) / 1000, offset: (a.offset + (b.offset - a.offset) * t) / 1000 };
}
function rgb(hex: string) { const n = Number.parseInt(hex.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
/** Plain arrays keep the compiler independent of the rendering library. Forward is +X. */
export function compileFishGeometry(spec: FishSpec): FishGeometry {
  const g: FishGeometry = { positions: [], colors: [], indices: [] };
  const length = spec.body.lengthMm / 1000, rings = 32, sides = 16;
  const base = rgb(spec.appearance.body), belly = rgb(spec.appearance.belly), accent = rgb(spec.appearance.accent);
  for (let i = 0; i <= rings; i++) {
    const u = i / rings, s = bodySection(spec, u * 1000);
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * Math.PI * 2, y = Math.cos(a), z = Math.sin(a);
      g.positions.push((0.5 - u) * length, (s.offset + y * s.height) * length, z * s.width * length);
      const pattern = spec.appearance.pattern === "stripes" ? Math.sin(u * 55) > 0.6 : spec.appearance.pattern === "spots" && Math.sin(u * 43 + a * 3) * Math.cos(a * 7 - u * 19) > 0.55;
      const c = pattern ? accent : y < -0.2 ? belly : base;
      g.colors.push(...c);
      if (i < rings && j < sides) { const v = i * (sides + 1) + j; g.indices.push(v, v + sides + 1, v + 1, v + 1, v + sides + 1, v + sides + 2); }
    }
  }
  for (const ring of [0, rings]) {
    const center = g.positions.length / 3, s = bodySection(spec, ring === 0 ? 0 : 1000);
    g.positions.push((ring === 0 ? 0.5 : -0.5) * length, s.offset * length, 0); g.colors.push(...base);
    for (let j = 0; j < sides; j++) { const a = ring * (sides + 1) + j; g.indices.push(center, ring === 0 ? a + 1 : a, ring === 0 ? a : a + 1); }
  }
  const polygon = (points: number[][]) => { const start = g.positions.length / 3; for (const p of points) { g.positions.push(...p); g.colors.push(...accent); } for (let i = 1; i < points.length - 1; i++) g.indices.push(start, start + i, start + i + 1); };
  for (const fin of spec.fins) {
    const s = bodySection(spec, fin.at), x = (0.5 - fin.at / 1000) * length;
    polygon(fin.outline.map(p => {
      const dx = p.x / 1000 * length, dy = p.y / 1000 * length;
      if (fin.side === "dorsal") return [x + dx, (s.offset + s.height) * length + dy, 0];
      if (fin.side === "ventral") return [x + dx, (s.offset - s.height) * length - dy, 0];
      return [x + dx, s.offset * length - dy * 0.18, (fin.side === "left" ? 1 : -1) * (s.width * length + dy)];
    }));
  }
  const tip = bodySection(spec, 1000), tailX = -0.5 * length, tailY = tip.offset * length, tailLength = spec.tail.length / 1000 * length, spread = spec.tail.spread / 1000 * length;
  // Separate lobes allow a concave fork without fan-triangulating a concave polygon.
  for (const sign of [-1, 1]) polygon([[tailX, tailY, 0], [tailX - tailLength, tailY + sign * spread, 0], [tailX - tailLength * (1 - spec.tail.fork / 1000), tailY, 0]]);
  const eyeSection = bodySection(spec, spec.eyes.at), eyeSize = length * spec.eyes.size / 1000;
  const sphere = (cx: number, cy: number, cz: number, radius: number, color: number[]) => {
    const start = g.positions.length / 3, rows = 6, columns = 8;
    for (let i = 0; i <= rows; i++) for (let j = 0; j <= columns; j++) {
      const latitude = i / rows * Math.PI, longitude = j / columns * Math.PI * 2;
      g.positions.push(cx + Math.sin(latitude) * Math.cos(longitude) * radius, cy + Math.cos(latitude) * radius, cz + Math.sin(latitude) * Math.sin(longitude) * radius); g.colors.push(...color);
      if (i < rows && j < columns) { const v = start + i * (columns + 1) + j; g.indices.push(v, v + 1, v + columns + 1, v + 1, v + columns + 2, v + columns + 1); }
    }
  };
  for (const sign of [-1, 1]) {
    const x = (0.5 - spec.eyes.at / 1000) * length, y = (eyeSection.offset + eyeSection.height * 0.25) * length, z = sign * eyeSection.width * length * 0.92;
    sphere(x, y, z, eyeSize, rgb("#F8F1D8")); sphere(x + eyeSize * 0.25, y, z + sign * eyeSize * 0.8, eyeSize * 0.53, rgb("#112D35"));
  }
  return g;
}
