import { type Drawing, type Point, type WeaponSpec, type PartType } from "./schema";

const circle = (x: number, y: number, radius: number): Point[] =>
  Array.from({ length: 25 }, (_, i) => [
    Math.round(x + Math.cos(i * Math.PI / 12) * radius),
    Math.round(y + Math.sin(i * Math.PI / 12) * radius),
  ]);
const stroke = (id: string, points: Point[]) => ({ id, points, width: 24 as const, color: "ink" as const });
export interface Sample { id: string; name: string; drawing: Drawing; types: PartType[]; pivot: Point; muzzle?: Point; direction?: Point; }
export const SAMPLES: Sample[] = [
  { id: "hammer", name: "旋转锤", types: ["wheel", "structure", "hammer"], pivot: [950, 2048],
    drawing: { schemaVersion: 1, revision: 1, gridSize: 4096, strokes: [
      stroke("axle", circle(950, 2048, 190)),
      stroke("arm", [[950, 2048], [2560, 2048]]),
      stroke("head", [[2530, 1720], [3080, 1720], [3080, 2376], [2530, 2376], [2530, 1720]]),
    ] } },
  { id: "blade", name: "长柄刀", types: ["structure", "blade"], pivot: [950, 2048],
    drawing: { schemaVersion: 1, revision: 1, gridSize: 4096, strokes: [
      stroke("handle", [[950, 2048], [2100, 2048]]),
      stroke("blade", [[2040, 1930], [3100, 1720], [3300, 2048], [2040, 2160], [2040, 1930]]),
    ] } },
  { id: "shield", name: "大盾", types: ["structure", "shield"], pivot: [1100, 2100],
    drawing: { schemaVersion: 1, revision: 1, gridSize: 4096, strokes: [
      stroke("brace", [[1100, 2100], [2300, 2100]]),
      stroke("shield", [[2250, 1400], [2650, 1560], [2750, 2160], [2460, 2660], [2180, 2180], [2250, 1400]]),
    ] } },
  { id: "cannon", name: "自动炮台", types: ["wheel", "structure", "cannon"], pivot: [1400, 2048],
    muzzle: [2850, 2048], direction: [3400, 2048],
    drawing: { schemaVersion: 1, revision: 1, gridSize: 4096, strokes: [
      stroke("turret-axis", circle(1400, 2048, 240)),
      stroke("turret-brace", [[1400, 2048], [1750, 2048]]),
      stroke("barrel", [[1720, 1808], [2850, 1808], [2850, 2288], [1720, 2288], [1720, 1808]]),
    ] } },
];
export function sampleSpec(sample: Sample, hash: string): WeaponSpec {
  const parts = sample.drawing.strokes.map((s, i) => ({
    id: "part-" + s.id, type: sample.types[i] ?? "structure",
    strokeRefs: [{ strokeId: s.id, fromPoint: 0, toPoint: s.points.length - 1 }],
    anchorHint: sample.types[i] === "cannon" ? sample.muzzle ?? null : i === 0 ? sample.pivot : null,
    directionHint: sample.types[i] === "cannon" ? sample.direction ?? null : null,
  }));
  return { schemaVersion: 1, drawingHash: hash, parts, decorations: [],
    links: parts.slice(1).map(p => ({ from: parts[0]?.id ?? "", to: p.id, kind: "fixed", anchorHint: null })),
    mountHint: sample.pivot, unresolved: [] };
}
