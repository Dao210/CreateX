import { DrawingSchema, WeaponSpecSchema, WORLD_SCALE, RULES_VERSION, type Drawing, type WeaponSpec, type Stroke, type Point, type PartType, type CannonDesign } from "./schema";
import { matchesCannonDesign } from "./cannon";
import { closed, convex, polygon, simplify, distance, measure, onStroke, touching } from "./geometry";

export interface ColliderDefinition {
  partId: string;
  type: PartType;
  shape: "ball" | "polygon" | "capsule";
  center: Point;
  radius: number;
  vertices: Point[];
  halfLength: number;
  rotation: number;
}
export interface LauncherDefinition {
  muzzle: Point;
  heading: number;
  barrelLength: number;
  projectileRadius: number;
  projectileSpeed: number;
  damage: number;
  range: number;
  reloadTicks: number;
  maxTurnSpeed: number;
  maxTorque: number;
  aimTolerance: number;
}
export interface WeaponDefinition {
  drawing: Drawing;
  spec: WeaponSpec;
  pivot: Point;
  colliders: ColliderDefinition[];
  mass: number;
  centerOfMass: Point;
  inertia: number;
  reach: number;
  ink: number;
  motion: "rotating" | "swinging" | "tracking" | "static";
  launcher: LauncherDefinition | null;
  rulesVersion: string;
  warnings: string[];
  cannonDesign: CannonDesign | null;
}
export class CompileError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "CompileError"; }
}
export function compileWeapon(drawing: Drawing, spec: WeaponSpec, hash: string, cannonDesign: CannonDesign | null = null): WeaponDefinition {
  if (!DrawingSchema.safeParse(drawing).success || !WeaponSpecSchema.safeParse(spec).success)
    throw new CompileError("invalid_blueprint");
  if (spec.drawingHash !== hash) throw new CompileError("drawing_changed");
  if (cannonDesign && !matchesCannonDesign(cannonDesign, drawing, spec)) throw new CompileError("cannon_design_mismatch");
  if (spec.unresolved.length) throw new CompileError("needs_confirmation");
  if (spec.parts.filter(p => p.type !== "structure").length > 4) throw new CompileError("too_many_parts");
  const wheels = spec.parts.filter(p => p.type === "wheel");
  if (wheels.length > 1) throw new CompileError("multiple_axes");
  const cannons = spec.parts.filter(p => p.type === "cannon");
  if (cannons.length > 1) throw new CompileError("multiple_cannons");
  if (cannons.length && spec.parts.some(p => p.type === "blade" || p.type === "hammer"))
    throw new CompileError("mixed_attacks");
  const ids = new Set(spec.parts.map(p => p.id));
  if (ids.size !== spec.parts.length) throw new CompileError("duplicate_part");
  const used = new Set<string>(), selected = new Map<string, Stroke[]>();
  const readRefs = (refs: WeaponSpec["parts"][number]["strokeRefs"]): Stroke[] => refs.map(ref => {
    const stroke = drawing.strokes.find(s => s.id === ref.strokeId);
    if (!stroke || ref.toPoint >= stroke.points.length || ref.fromPoint >= ref.toPoint)
      throw new CompileError("invalid_stroke_reference");
    for (let i = ref.fromPoint; i < ref.toPoint; i++) {
      const key = stroke.id + ":" + i;
      if (used.has(key)) throw new CompileError("overlapping_parts");
      used.add(key);
    }
    return { ...stroke, points: stroke.points.slice(ref.fromPoint, ref.toPoint + 1) };
  });
  spec.parts.forEach(p => selected.set(p.id, readRefs(p.strokeRefs)));
  spec.decorations.forEach(d => {
    if (d.attachedTo && !ids.has(d.attachedTo)) throw new CompileError("invalid_connection");
    readRefs(d.strokeRefs);
  });
  if (drawing.strokes.some(s => s.points.slice(1).some((_, i) => !used.has(s.id + ":" + i))))
    throw new CompileError("unassigned_strokes");
  const visited = new Set<string>();
  const root = spec.parts[0];
  if (!root) throw new CompileError("empty_geometry");
  visited.add(root.id);
  if (spec.links.length !== spec.parts.length - 1) throw new CompileError("disconnected_parts");
  for (const link of spec.links)
    if (!ids.has(link.from) || !ids.has(link.to) || link.from === link.to) throw new CompileError("invalid_connection");
  for (let i = 0; i < spec.parts.length; i++) for (const link of spec.links) {
    if (visited.has(link.from)) visited.add(link.to);
    if (visited.has(link.to)) visited.add(link.from);
  }
  if (visited.size !== ids.size) throw new CompileError("disconnected_parts");
  const wheel = wheels[0];
  const wheelStrokes = wheel ? selected.get(wheel.id) ?? [] : [];
  const wheelPoints = wheelStrokes.flatMap(s => s.points);
  const wheelCenter: Point | null = wheelPoints.length ? [
    Math.round((Math.min(...wheelPoints.map(p => p[0])) + Math.max(...wheelPoints.map(p => p[0]))) / 2),
    Math.round((Math.min(...wheelPoints.map(p => p[1])) + Math.max(...wheelPoints.map(p => p[1]))) / 2),
  ] : null;
  const pivot = spec.mountHint ?? wheelCenter ?? root.anchorHint;
  if (!pivot) throw new CompileError("missing_mount");
  const physicalStrokes = [...selected.values()].flat();
  if (!physicalStrokes.some(s => onStroke(pivot, s))) throw new CompileError("mount_outside_weapon");
  const colliders: ColliderDefinition[] = [];
  const local = (p: Point): Point => [(p[0] - pivot[0]) * WORLD_SCALE, (p[1] - pivot[1]) * WORLD_SCALE];
  for (const part of spec.parts) {
    const strokes = selected.get(part.id) ?? [];
    for (const stroke of strokes) {
      const base = { partId: part.id, type: part.type, center: [0, 0] as Point, radius: 0, vertices: [] as Point[], halfLength: 0, rotation: 0 };
      if (closed(stroke.points)) {
        const points = polygon(stroke.points);
        if (!convex(points) || points.length > 32) throw new CompileError("complex_outline");
        if (part.type === "wheel") {
          const m = measure([stroke], pivot);
          const rx = (m.bounds.maxX - m.bounds.minX) / 2, ry = (m.bounds.maxY - m.bounds.minY) / 2;
          if (Math.min(rx, ry) < 60 || Math.max(rx, ry) / Math.min(rx, ry) > 1.4) throw new CompileError("wheel_not_round");
          colliders.push({ ...base, shape: "ball", center: local([(m.bounds.minX + m.bounds.maxX) / 2, (m.bounds.minY + m.bounds.maxY) / 2]), radius: Math.min(rx, ry) * WORLD_SCALE });
        } else colliders.push({ ...base, shape: "polygon", vertices: points.map(local) });
      } else {
        const points = simplify(stroke.points, 36);
        for (let i = 0; i < points.length - 1; i++) {
          const a = points[i], b = points[i + 1];
          if (!a || !b || distance(a, b) < 4) continue;
          colliders.push({ ...base, shape: "capsule", center: local([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]),
            radius: stroke.width / 2 * WORLD_SCALE, halfLength: distance(a, b) / 2 * WORLD_SCALE,
            rotation: Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.PI / 2 });
        }
      }
    }
  }
  if (!colliders.length || colliders.length > 24) throw new CompileError("collision_budget");
  const physical = new Set([0]);
  for (let i = 0; i < physicalStrokes.length; i++) for (let j = 0; j < physicalStrokes.length; j++) {
    if (physical.has(j)) continue;
    if ([...physical].some(k => touching([physicalStrokes[k]!], [physicalStrokes[j]!]))) physical.add(j);
  }
  if (physical.size !== physicalStrokes.length) throw new CompileError("detached_geometry");
  const m = measure(physicalStrokes, pivot);
  if (m.area < 0.02 || m.reach < 0.1) throw new CompileError("empty_geometry");
  const all = measure(drawing.strokes, pivot);
  const powered = spec.parts.some(p => p.type === "blade" || p.type === "hammer");
  const ink = Math.ceil(all.length * 1.2 + m.area * 8 + (wheel ? 6 : 0) + (cannons.length ? 12 : 0));
  if (ink > 100) throw new CompileError("ink_budget");
  const mass = Math.max(0.5, m.area * 3);
  const inertia = Math.max(0.1, (m.inertiaArea - m.area * (m.center[0] ** 2 + m.center[1] ** 2)) * 3);
  let launcher: LauncherDefinition | null = null;
  const cannon = cannons[0];
  if (cannon) {
    const strokes = selected.get(cannon.id)!;
    const muzzle = cannon.anchorHint, direction = cannon.directionHint;
    if (!muzzle || !direction) throw new CompileError("missing_muzzle");
    if (!strokes.some(s => onStroke(muzzle, s))) throw new CompileError("muzzle_outside_barrel");
    const directionLength = distance(muzzle, direction);
    if (directionLength * WORLD_SCALE < 0.1) throw new CompileError("invalid_cannon_direction");
    const ux = (direction[0] - muzzle[0]) / directionLength, uy = (direction[1] - muzzle[1]) / directionLength;
    const points = strokes.flatMap(s => s.points);
    const forward = points.map(p => (p[0] - muzzle[0]) * ux + (p[1] - muzzle[1]) * uy);
    const across = points.map(p => -p[0] * uy + p[1] * ux);
    const length = (Math.max(...forward) - Math.min(...forward)) * WORLD_SCALE;
    const width = Math.max(Math.max(...across) - Math.min(...across), ...strokes.map(s => s.width)) * WORLD_SCALE;
    if (length < 0.4 || length < width * 1.5) throw new CompileError("invalid_barrel_shape");
    if (Math.max(...forward) * WORLD_SCALE > 0.14) throw new CompileError("muzzle_not_forward");
    const diameter = Math.max(0.12, Math.min(0.6, width * 0.45));
    launcher = {
      muzzle: local(muzzle), heading: Math.atan2(uy, ux), barrelLength: length,
      projectileRadius: diameter / 2, projectileSpeed: Math.min(18, 9 + length * 2),
      damage: Math.round(14 + diameter * 24), range: Math.min(10, 4 + length * 1.4),
      reloadTicks: Math.ceil((0.65 + diameter * 1.6 + length * 0.08) * 60),
      maxTurnSpeed: Math.max(0.45, Math.min(Math.PI / 2, 3 / (1 + inertia * 0.25))),
      maxTorque: 12, aimTolerance: Math.PI / 60,
    };
  }
  const motion = launcher ? "tracking" : powered ? wheel ? "rotating" : "swinging" : "static";
  return { drawing, spec, pivot, colliders, mass, centerOfMass: m.center, launcher,
    inertia, reach: m.reach, ink, motion,
    rulesVersion: RULES_VERSION, cannonDesign, warnings: motion === "static" ? ["passive_defense"] : [] };
}
