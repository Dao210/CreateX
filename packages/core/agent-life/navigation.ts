import type { Agent } from "./schema";
type Position = Agent["position"];
const key = (p: Position) => `${p.x},${p.y}`;
const road = (p: Position) => p.y === 2 || p.y === 5 || [3, 6, 10].includes(p.x)
  || (p.y === 6 && p.x >= 3 && p.x <= 10) || (p.x === 1 && p.y === 1)
  || (p.y === 4 && p.x >= 1 && p.x <= 3) || (p.y === 7 && p.x === 2);
const paths = new Map<string, Position>();
/** Follow roads and building approaches. Legacy grass positions can walk onto the network. */
export function nextTownStep(from: Position, to: Position): Position {
  const cacheKey = `${key(from)}:${key(to)}`, cached = paths.get(cacheKey);
  if (cached) return { ...cached };
  const queue: { position: Position; first?: Position }[] = [{ position: from }], visited = new Set([key(from)]);
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    for (const delta of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
      const p = { x: current.position.x + delta.x, y: current.position.y + delta.y };
      if (p.x < 0 || p.x > 11 || p.y < 0 || p.y > 7 || visited.has(key(p)) || (!road(p) && key(p) !== key(to))) continue;
      const first = current.first ?? p;
      if (key(p) === key(to)) { paths.set(cacheKey, first); return { ...first }; }
      visited.add(key(p)); queue.push({ position: p, first });
    }
  }
  return { x: from.x + Math.sign(to.x - from.x), y: from.x === to.x ? from.y + Math.sign(to.y - from.y) : from.y };
}
