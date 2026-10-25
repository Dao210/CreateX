import { WORLD_SCALE, type Point, type Stroke } from "./schema";

export const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0));
const cross = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
export function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return distance(p, [a[0] + dx * t, a[1] + dy * t]);
}
export function simplify(points: Point[], tolerance = 24): Point[] {
  if (points.length < 3) return points;
  const kept = new Set([0, points.length - 1]), pending: Array<[number, number]> = [[0, points.length - 1]];
  while (pending.length) {
    const [start, end] = pending.pop()!;
    let max = 0, index = start;
    for (let i = start + 1; i < end; i++) {
      const d = segmentDistance(points[i]!, points[start]!, points[end]!);
      if (d > max) { max = d; index = i; }
    }
    if (max > tolerance) { kept.add(index); pending.push([start, index], [index, end]); }
  }
  return [...kept].sort((a, b) => a - b).map(i => points[i]!);
}
export function closed(points: Point[]): boolean {
  return points.length >= 4 && distance(points[0] ?? [], points[points.length - 1] ?? []) < 70;
}
export function polygon(points: Point[]): Point[] {
  return simplify(points.slice(0, -1));
}
export function convex(points: Point[]): boolean {
  if (points.length < 3) return false;
  for (let i = 0; i < points.length; i++) for (let j = i + 2; j < points.length; j++) {
    if (i === 0 && j === points.length - 1) continue;
    if (intersects(points[i]!, points[(i + 1) % points.length]!, points[j]!, points[(j + 1) % points.length]!)) return false;
  }
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], c = points[(i + 2) % points.length];
    if (!a || !b || !c) continue;
    const value = cross(a, b, c);
    if (Math.abs(value) < 1) continue;
    if (sign && Math.sign(value) !== sign) return false;
    sign = Math.sign(value);
  }
  return sign !== 0;
}
export function inside(point: Point, points: Point[]): boolean {
  let result = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if (a && b && (a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}
function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}
export function onStroke(point: Point, stroke: Stroke, tolerance = 70): boolean {
  return (closed(stroke.points) && inside(point, stroke.points)) || stroke.points.some((a, i) => {
    const b = stroke.points[i + 1];
    return b && segmentDistance(point, a, b) <= tolerance;
  });
}
export function touching(a: Stroke[], b: Stroke[]): boolean {
  return a.some(left => b.some(right => {
    const lp = simplify(left.points), rp = simplify(right.points);
    if (lp.some(p => onStroke(p, right)) || rp.some(p => onStroke(p, left))) return true;
    return lp.some((p, i) => rp.some((q, j) => lp[i + 1] && rp[j + 1] && intersects(p, lp[i + 1]!, q, rp[j + 1]!)));
  }));
}
export function measure(strokes: Stroke[], pivot: Point) {
  const points = strokes.flatMap(s => s.points);
  if (!points.length) throw new Error("empty_geometry");
  const minX = Math.min(...points.map(p => p[0])), maxX = Math.max(...points.map(p => p[0]));
  const minY = Math.min(...points.map(p => p[1])), maxY = Math.max(...points.map(p => p[1]));
  const step = 32, occupied = new Set<number>();
  let inertiaArea = 0, cx = 0, cy = 0;
  for (const stroke of strokes) {
    const isClosed = closed(stroke.points);
    const outline = simplify(stroke.points, 8);
    for (let y = Math.max(0, Math.floor(minY / step) - 1); y <= Math.min(127, Math.floor(maxY / step) + 1); y++) {
      for (let x = Math.max(0, Math.floor(minX / step) - 1); x <= Math.min(127, Math.floor(maxX / step) + 1); x++) {
        const point: Point = [x * step + step / 2, y * step + step / 2];
        const hit = isClosed ? inside(point, outline) : outline.some((a, i) => {
          const b = outline[i + 1];
          return b && segmentDistance(point, a, b) <= Math.max(stroke.width / 2, step / 2);
        });
        if (hit) occupied.add(y * 128 + x);
      }
    }
  }
  const cellArea = (step * WORLD_SCALE) ** 2;
  for (const cell of occupied) {
    const x = ((cell % 128) * step + step / 2 - pivot[0]) * WORLD_SCALE;
    const y = (Math.floor(cell / 128) * step + step / 2 - pivot[1]) * WORLD_SCALE;
    cx += x; cy += y; inertiaArea += cellArea * (x * x + y * y);
  }
  const length = strokes.reduce((sum, s) => sum + s.points.reduce((n, p, i) =>
    n + (s.points[i + 1] ? distance(p, s.points[i + 1] ?? p) * WORLD_SCALE : 0), 0), 0);
  return { area: occupied.size * cellArea, inertiaArea, length,
    center: [cx / (occupied.size || 1), cy / (occupied.size || 1)] as Point,
    bounds: { minX, minY, maxX, maxY },
    reach: Math.max(...points.map(p => distance(p, pivot))) * WORLD_SCALE };
}
