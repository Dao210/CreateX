import { CannonDesignSchema, WeaponSpecSchema, WORLD_SCALE, canonicalDrawing, type CannonDesign, type Drawing, type Point, type WeaponSpec } from "./schema";

export const DEFAULT_CANNON: CannonDesign = { kind: "cannon-kit", version: 1, barrelLengthMm: 2200, barrelWidthMm: 950 };
export const CANNON_LIMITS = { length: { min: 1600, max: 3200 }, width: { min: 450, max: 1050 }, step: 50 } as const;
export const CANNON_PIVOT: Point = [1400, 2048];

export function cannonGeometry(input: CannonDesign) {
  const design = CannonDesignSchema.parse(input);
  const start = 1720, end = start + Math.round(design.barrelLengthMm / 1000 / WORLD_SCALE);
  const halfWidth = Math.round(design.barrelWidthMm / 2000 / WORLD_SCALE);
  return { start, end, top: 2048 - halfWidth, bottom: 2048 + halfWidth, halfWidth };
}

export function createCannonDrawing(design: CannonDesign, revision = 0): Drawing {
  const { start, end, top, bottom } = cannonGeometry(design);
  const axis: Point[] = Array.from({ length: 24 }, (_, i) => [
    Math.round(1400 + Math.cos(i * Math.PI * 2 / 24) * 240),
    Math.round(2048 + Math.sin(i * Math.PI * 2 / 24) * 240),
  ]);
  axis.push(axis[0]!);
  return { schemaVersion: 1, gridSize: 4096, revision, strokes: [
    { id: "kit-axis", points: axis, width: 24, color: "ink" },
    { id: "kit-brace", points: [[1400, 2048], [1750, 2048]], width: 24, color: "ink" },
    { id: "kit-barrel", points: [[start, top], [end, top], [end, bottom], [start, bottom], [start, top]], width: 24, color: "ink" },
  ] };
}

export function createCannonSpec(drawing: Drawing, hash: string): WeaponSpec {
  const barrel = drawing.strokes[2]!;
  const muzzle: Point = [barrel.points[1]![0], 2048];
  return { schemaVersion: 1, drawingHash: hash, mountHint: [...CANNON_PIVOT], unresolved: [], decorations: [],
    parts: drawing.strokes.map((stroke, i) => ({
      id: ["kit-axis", "kit-brace", "kit-barrel"][i]!, type: (["wheel", "structure", "cannon"] as const)[i]!,
      strokeRefs: [{ strokeId: stroke.id, fromPoint: 0, toPoint: stroke.points.length - 1 }],
      anchorHint: i === 0 ? [...CANNON_PIVOT] : i === 2 ? muzzle : null,
      directionHint: i === 2 ? [muzzle[0] + 256, muzzle[1]] : null,
    })),
    links: ["kit-brace", "kit-barrel"].map(id => ({ from: "kit-axis", to: id, kind: "fixed", anchorHint: null })),
  };
}

export function matchesCannonDesign(design: CannonDesign, drawing: Drawing, spec: WeaponSpec): boolean {
  if (!CannonDesignSchema.safeParse(design).success) return false;
  const generated = createCannonDrawing(design);
  return canonicalDrawing(generated) === canonicalDrawing(drawing) &&
    JSON.stringify(WeaponSpecSchema.parse(createCannonSpec(generated, spec.drawingHash))) === JSON.stringify(WeaponSpecSchema.parse(spec));
}
