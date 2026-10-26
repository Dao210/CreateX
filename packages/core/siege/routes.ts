import type { Position } from "./campaign";

export interface CompiledRoute { points: readonly Position[]; lengths: readonly number[]; total: number }
export function compileRoute(points: readonly Position[]): CompiledRoute {
  const lengths = points.slice(1).map((point, i) => Math.hypot(point.x - points[i]!.x, point.y - points[i]!.y));
  return { points, lengths, total: lengths.reduce((sum, length) => sum + length, 0) };
}
export function pointOnCompiledRoute(route: CompiledRoute, progress: number): Position {
  let remaining = Math.max(0, progress);
  for (let i = 0; i < route.lengths.length; i++) {
    const a = route.points[i]!, b = route.points[i + 1]!, length = route.lengths[i]!;
    if (remaining <= length && length > 0) return { x: a.x + (b.x - a.x) * remaining / length, y: a.y + (b.y - a.y) * remaining / length };
    remaining -= length;
  }
  return { ...route.points[route.points.length - 1]! };
}

/** Preserve the campaign priority and ID tie-break without sorting candidates. */
export function selectCampaignTarget<T extends { id: number; route: number; progress: number; hp: number }>(
  enemies: Iterable<T>, routes: readonly CompiledRoute[], inRange: (enemy: T) => boolean, focus: string | null,
): T | undefined {
  let selected: T | undefined, distance = Infinity;
  for (const enemy of enemies) {
    if (enemy.hp <= 0 || !inRange(enemy)) continue;
    if (focus === `enemy:${enemy.id}`) return enemy;
    const remaining = routes[enemy.route]!.total - enemy.progress;
    if (remaining < distance || (remaining === distance && (!selected || enemy.id < selected.id))) { selected = enemy; distance = remaining; }
  }
  return selected;
}
