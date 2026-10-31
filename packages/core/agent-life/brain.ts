import type { ActionIntent, Agent, Resource, Proposal } from "./schema";
import { LIFE_MAP, balance, feasible, samePosition } from "./rules";

export type Observation = Readonly<{ tick: number; self: Readonly<Agent>; residents: readonly Readonly<Agent>[]; resources: readonly Readonly<Resource>[] }>;
export interface AgentBrain { choose(observation: Observation): Proposal }
// Future asynchronous planners run outside settlement transactions; their unknown
// output must pass PlannerProposalSchema before reaching an AgentBrain adapter.
export interface LLMPlanner { plan(observation: Observation, signal: AbortSignal): Promise<unknown> }
function toward(agent: Readonly<Agent>, destination: Agent["position"], reason: string): Proposal {
  const { x, y } = agent.position;
  return { intent: { kind: "MOVE", to: { x: x + Math.sign(destination.x - x), y: x === destination.x ? y + Math.sign(destination.y - y) : y } }, reason };
}
// A Brain only proposes commands. Feasibility and settlement remain engine-owned.
export const ruleBrain: AgentBrain = {
  choose({ self, residents, resources }) {
    const candidates: { proposal: Proposal; score: number }[] = [];
    const add = (intent: ActionIntent, score: number, reason: string) => candidates.push({ proposal: { intent, reason }, score });
    add({ kind: "REST" }, 10 + (100 - self.energy) * 0.5, "recover_energy");
    if (self.energy < 30) add({ kind: "REST" }, 1_000, "urgent_energy");
    if (self.fullness < 65) add({ kind: "EAT" }, 100 + (100 - self.fullness) * 12, "need_food");
    const atFarm = samePosition(self.position, LIFE_MAP.farm);
    if (balance(resources, self.id, "food") < 3) candidates.push({
      proposal: atFarm ? { intent: { kind: "WORK" }, reason: "stock_food" } : toward(self, LIFE_MAP.farm, "reach_food"),
      score: self.fullness < 55 ? 950 : 280 + self.personality.diligence,
    });
    if (self.social < 50) {
      const partner = residents.find((a) => a.id !== self.id && samePosition(a.position, self.position));
      if (partner) add({ kind: "TALK", targetId: partner.id }, 200 + (100 - self.social) * 6 + self.personality.sociability, "need_company");
      else if (!samePosition(self.position, LIFE_MAP.square)) candidates.push({ proposal: toward(self, LIFE_MAP.square, "meet_neighbors"), score: 200 + (100 - self.social) * 6 });
      else add({ kind: "REST" }, 200 + (100 - self.social) * 6, "wait_for_company");
    }
    const wantsWood = self.goal.kind === "wood" && balance(resources, self.id, "wood") < self.goal.target;
    const destination = wantsWood ? LIFE_MAP.forest : LIFE_MAP.farm;
    candidates.push({ proposal: samePosition(self.position, destination)
      ? { intent: { kind: wantsWood ? "GATHER_WOOD" : "WORK" }, reason: "personal_goal" }
      : toward(self, destination, "reach_goal"), score: 100 + (wantsWood ? self.personality.curiosity : self.personality.diligence) });
    candidates.sort((a, b) => b.score - a.score);
    return candidates.find(({ proposal }) => feasible(self, proposal.intent, residents, resources))!.proposal;
  },
};

