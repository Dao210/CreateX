import type { ActionIntent, Agent, Resource } from "./schema";

export const LIFE_TICK_MS = 2_000;
export const LIFE_CAPACITY = 60;
export const LIFE_MAP = { width: 12, height: 8, home: { x: 2, y: 2 }, farm: { x: 9, y: 2 }, forest: { x: 9, y: 6 }, square: { x: 3, y: 6 } } as const;
export const DURATIONS = { MOVE: 1, REST: 3, EAT: 1, GATHER_WOOD: 3, WORK: 3, TALK: 2 } as const;
export const samePosition = (a: Agent["position"], b: Agent["position"]) => a.x === b.x && a.y === b.y;
export function balance(resources: readonly Readonly<Resource>[], owner: string, kind: Resource["kind"]) {
  return resources.find((r) => r.owner === owner && r.kind === kind)?.amount ?? 0;
}
export function feasible(agent: Agent | Readonly<Agent>, intent: ActionIntent, agents: readonly Readonly<Agent>[], resources: readonly Readonly<Resource>[]): boolean {
  switch (intent.kind) {
    case "MOVE": return intent.to.x >= 0 && intent.to.x < LIFE_MAP.width && intent.to.y >= 0 && intent.to.y < LIFE_MAP.height && Math.abs(intent.to.x - agent.position.x) + Math.abs(intent.to.y - agent.position.y) === 1;
    case "REST": return true;
    case "EAT": return balance(resources, agent.id, "food") >= 1;
    case "GATHER_WOOD": return samePosition(agent.position, LIFE_MAP.forest) && agent.energy >= 8 && balance(resources, "forest", "wood") >= 3;
    case "WORK": return samePosition(agent.position, LIFE_MAP.farm) && agent.energy >= 10 && balance(resources, agent.id, "food") < 8 && balance(resources, "farm", "food") >= 5;
    case "TALK": return intent.targetId !== agent.id && agents.some((other) => other.id === intent.targetId && samePosition(agent.position, other.position));
  }
}

