import type { FishSpec } from "./schema";
export interface SwimState { id: string; spec: FishSpec; position: [number, number, number]; velocity: [number, number, number]; phase: number; seed: number }
export const OCEAN_BOUNDS = { x: 12, y: 8, z: 8 };
export const OCEAN_ROCKS = [{ x: -5, y: 0.9, z: -2, radius: 2.2 }, { x: 5, y: 0.7, z: -4, radius: 1.8 }];
const norm = (v: number[]) => Math.hypot(...v) || 1;
export function swimState(id: string, spec: FishSpec, seed: number): SwimState {
  const random = (n: number) => { const v = Math.sin(seed * 0.01 + n * 78.233) * 43758.5453; return v - Math.floor(v); };
  const angle = random(1) * Math.PI * 2;
  return { id, spec, seed, position: [(random(2) - 0.5) * 16, 1.5 + spec.behavior.depth / 1000 * 5, (random(3) - 0.5) * 10], velocity: [Math.cos(angle) * spec.motion.speed / 1000, 0, Math.sin(angle) * spec.motion.speed / 1000], phase: random(4) * Math.PI * 2 };
}
/** Fixed-step ambient motion. Positions are presentation, never authoritative ecology. */
export function stepFish(states: SwimState[], dt: number, time: number) {
  if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1) return;
  const grid = new Map<string, SwimState[]>(), cell = 3;
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (const s of states) { const k = key(...s.position.map(v => Math.floor(v / cell)) as [number, number, number]); const list = grid.get(k) ?? []; list.push(s); grid.set(k, list); }
  const next: [number, number, number][] = [];
  for (const s of states) {
    const [x, y, z] = s.position, desired = s.spec.behavior.depth / 1000 * 5.5 + 1.5;
    const force = [Math.sin(time * 0.31 + s.seed) * 0.18, (desired - y) * 0.35, Math.cos(time * 0.23 + s.seed) * 0.18];
    const gc = s.position.map(v => Math.floor(v / cell));
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (const other of grid.get(key(gc[0]! + a, gc[1]! + b, gc[2]! + c)) ?? []) {
      if (other === s) continue;
      const delta = s.position.map((v, i) => v - other.position[i]!), distance = norm(delta);
      const space = (s.spec.behavior.personalSpace + Math.max(s.spec.body.lengthMm, other.spec.body.lengthMm) * 0.7) / 1000;
      if (distance < space) for (let i = 0; i < 3; i++) force[i]! += delta[i]! / distance * (space - distance) * 1.8;
      else if (distance < 3 && s.spec.motion.style === other.spec.motion.style) for (let i = 0; i < 3; i++) force[i]! += ((other.velocity[i]! - s.velocity[i]!) * 0.25 - delta[i]! * 0.1) * s.spec.behavior.schooling / 1000;
    }
    for (const rock of OCEAN_ROCKS) {
      const delta = [x - rock.x, y - rock.y, z - rock.z], distance = norm(delta), margin = rock.radius + s.spec.body.lengthMm / 1000 + 1;
      if (distance < margin) for (let i = 0; i < 3; i++) force[i]! += delta[i]! / distance * (margin - distance) * 4;
    }
    for (const i of [0, 2]) { const limit = i === 0 ? OCEAN_BOUNDS.x : OCEAN_BOUNDS.z; const v = s.position[i]!; if (Math.abs(v) > limit - 2.5) force[i]! -= Math.sign(v) * (Math.abs(v) - limit + 2.5) * 2; }
    force[1]! += y < 1 ? (1 - y) * 3 : y > 7 ? (7 - y) * 3 : 0;
    const acceleration = norm(force), maxAcceleration = 0.9;
    const v = s.velocity.map((n, i) => n + force[i]! / Math.max(1, acceleration / maxAcceleration) * dt), speed = s.spec.motion.speed / 1000, magnitude = norm(v);
    next.push(v.map(n => n / magnitude * speed) as [number, number, number]);
  }
  states.forEach((s, index) => {
    s.velocity = next[index]!;
    s.position = s.position.map((v, i) => v + s.velocity[i]! * dt) as [number, number, number];
    s.position[0] = Math.max(-12, Math.min(12, s.position[0])); s.position[1] = Math.max(0.7, Math.min(7.5, s.position[1])); s.position[2] = Math.max(-8, Math.min(8, s.position[2]));
    s.phase += dt * s.spec.motion.frequency / 1000 * Math.PI * 2;
  });
}
