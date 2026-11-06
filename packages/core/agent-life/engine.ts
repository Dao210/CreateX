import { PlannerProposalSchema, type Agent, type Action, type Resource } from "./schema";
import { ruleBrain, type AgentBrain } from "./brain";
import { LIFE_CAPACITY, DURATIONS, balance, feasible } from "./rules";
import type { Town } from "./town-schema";
import { beginTownTick, finishTownTick, settleTownTalk, townProposal } from "./town";
import { beginCivilizationTick, civilizationProposal, civicActionFeasible, settleCivicAction, shareCivicKnowledge, finishCivilizationTick } from "./civilization";

export type Simulation = { tick: number; agents: Agent[]; resources: Resource[]; actions: Action[]; town?: Town | null };
export type EngineEvent = { actionId: string | null; agentId: string | null; kind: string; payload: Record<string, unknown> };
export type TickResult = { state: Simulation; completed: Action[]; started: Action[]; events: EngineEvent[] };
const clamp = (n: number) => Math.min(100, Math.max(0, n));
function change(resources: Resource[], owner: string, kind: Resource["kind"], delta: number) {
  const row = resources.find((r) => r.owner === owner && r.kind === kind);
  if (!row || row.amount + delta < 0) throw new Error("invalid_resource_change");
  row.amount += delta;
}
export function seedResidents(count = 20): Agent[] {
  if (!Number.isInteger(count) || count < 1 || count > LIFE_CAPACITY) throw new Error("resident_capacity");
  const names = ["Mika", "Rowan", "Ada", "Jun", "Cleo", "Nico", "Lumi", "Sage", "Noa", "Iris", "Oren", "Milo", "Yuna", "Theo", "Alma", "Finn", "Rin", "Lena", "Kai", "Nova"];
  return Array.from({ length: count }, (_, i) => ({
    id: `a11fe000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, name: names[i] ?? `Resident ${i + 1}`,
    position: { x: 2 + i % 3, y: 2 + Math.floor(i / 3) % 4 },
    energy: 65 + i % 30, fullness: 50 + i % 40, social: 50 + i % 40,
    personality: { diligence: (i * 31 + 15) % 101, sociability: (i * 43 + 35) % 101, curiosity: (i * 19 + 55) % 101 },
    goal: { kind: i % 2 ? "coins" : "wood", target: i % 2 ? 20 : 12 },
  }));
}
export function seedResources(agents: Agent[]): Resource[] {
  return [{ owner: "forest", kind: "wood", amount: 400 }, { owner: "farm", kind: "food", amount: 400 },
    ...agents.flatMap((agent) => ([{ owner: agent.id, kind: "food", amount: 4 }, { owner: agent.id, kind: "wood", amount: 0 }, { owner: agent.id, kind: "coins", amount: 0 }] satisfies Resource[]))];
}

export function advanceTick(previous: Simulation, nextId: () => string, brain: AgentBrain = ruleBrain): TickResult {
  const state = structuredClone(previous);
  state.tick++;
  beginTownTick(state, nextId);
  beginCivilizationTick(state, nextId);
  const events: EngineEvent[] = [], completed: Action[] = [], started: Action[] = [];
  const replenished: Record<string, number> = {};
  for (const [owner, kind, rate] of [["forest", "wood", state.tick % 3 === 0 ? 1 : 0], ["farm", "food", state.tick % 12 === 0 ? Math.max(1, Math.round(state.agents.length / 20)) : 0]] as const) {
    const delta = Math.min(rate, 600 - balance(state.resources, owner, kind));
    if (delta > 0) { change(state.resources, owner, kind, delta); replenished[`${owner}:${kind}`] = delta; }
  }
  if (Object.keys(replenished).length) events.push({ actionId: null, agentId: null, kind: "resources_replenished", payload: replenished });
  for (const agent of state.agents) {
    if (state.tick % 5 === 0) agent.energy = clamp(agent.energy - 1);
    if (state.tick % 10 === 0) agent.fullness = clamp(agent.fullness - 1);
    if (state.tick % 15 === 0) agent.social = clamp(agent.social - 1);
  }
  const due = state.actions.filter((a) => a.status === "running" && a.dueTick <= state.tick).sort((a, b) => a.agentId.localeCompare(b.agentId));
  for (const action of due) {
    const agent = state.agents.find((a) => a.id === action.agentId);
    if (!agent) throw new Error("action_owner_missing");
    const before = structuredClone({ agent, resources: state.resources });
    const intent = PlannerProposalSchema.parse({ intent: action.intent, reason: action.reason }).intent;
    const valid = "projectId" in intent ? civicActionFeasible(state, agent, intent) : feasible(agent, intent, state.agents, state.resources);
    if (valid) {
      switch (intent.kind) {
        case "MOVE": agent.position = intent.to; break;
        case "REST": agent.energy = clamp(agent.energy + 40); break;
        case "EAT": change(state.resources, agent.id, "food", -1); agent.fullness = clamp(agent.fullness + 35); break;
        case "GATHER_WOOD": change(state.resources, "forest", "wood", -3); change(state.resources, agent.id, "wood", 3); agent.energy = clamp(agent.energy - 6); break;
        case "WORK": change(state.resources, "farm", "food", -5); change(state.resources, agent.id, "food", 5); change(state.resources, agent.id, "coins", 1); agent.energy = clamp(agent.energy - 8); break;
        case "TALK": {
          const target = state.agents.find((a) => a.id === intent.targetId)!;
          const targetBefore = target.social;
          target.social = clamp(target.social + 30); agent.social = clamp(agent.social + 35);
          settleTownTalk(state, agent, target, nextId);
          shareCivicKnowledge(state, agent, target, action.id, nextId);
          shareCivicKnowledge(state, target, agent, action.id, nextId);
          events.push({ actionId: action.id, agentId: agent.id, kind: "action_completed", payload: { intent, reason: action.reason, socialDelta: agent.social - before.agent.social, targetId: target.id, targetSocialDelta: target.social - targetBefore } });
          break;
        }
        case "DELIVER_WOOD": case "BUILD": case "STORE_FOOD": case "WITHDRAW_FOOD": case "MAINTAIN":
          settleCivicAction(state, agent, intent, action.id, nextId);
          break;
      }
    }
    action.status = valid ? "completed" : "failed";
    if (balance(before.resources, agent.id, agent.goal.kind) < agent.goal.target && balance(state.resources, agent.id, agent.goal.kind) >= agent.goal.target) {
      events.push({ actionId: null, agentId: agent.id, kind: "goal_reached", payload: { name: agent.name, goalKind: agent.goal.kind, target: agent.goal.target } });
    }
    completed.push(action);
    if (intent.kind !== "TALK" || !valid) events.push({ actionId: action.id, agentId: agent.id, kind: valid ? "action_completed" : "action_failed", payload: {
      intent, reason: action.reason, ...(valid ? {
        before: { position: before.agent.position, energy: before.agent.energy, fullness: before.agent.fullness },
        after: { position: agent.position, energy: agent.energy, fullness: agent.fullness },
        resources: state.resources.flatMap((r, i) => r.amount === before.resources[i]!.amount ? [] : [{ owner: r.owner, kind: r.kind, delta: r.amount - before.resources[i]!.amount }]),
      } : { failure: "precondition_changed" }),
    } });
  }
  state.actions = state.actions.filter((a) => a.status === "running");
  // Rotate selection order so shared resources do not always favor the same ID.
  for (let i = 0; i < state.agents.length; i++) {
    const agent = state.agents[(i + state.tick) % state.agents.length]!;
    if (state.actions.some((a) => a.agentId === agent.id)) continue;
    const observation = structuredClone({ tick: state.tick, self: agent,
      residents: state.agents.filter(other => Math.abs(other.position.x - agent.position.x) + Math.abs(other.position.y - agent.position.y) <= 2),
      resources: state.resources.filter(r => r.owner === agent.id || r.owner === "farm" || r.owner === "forest"),
    });
    const civic = brain === ruleBrain ? civilizationProposal(state, agent) : undefined;
    const proposal = PlannerProposalSchema.parse(civic ?? (brain === ruleBrain ? townProposal(state, agent) : undefined) ?? brain.choose(observation));
    const available = "projectId" in proposal.intent ? civicActionFeasible(state, agent, proposal.intent) : feasible(agent, proposal.intent, state.agents, state.resources);
    if (!available) throw new Error("invalid_brain_proposal");
    const action: Action = { id: nextId(), agentId: agent.id, ...proposal, startedTick: state.tick, dueTick: state.tick + DURATIONS[proposal.intent.kind], status: "running" };
    state.actions.push(action); started.push(action);
  }
  finishTownTick(state, nextId);
  finishCivilizationTick(state, previous, nextId);
  for (const item of state.town!.civilization!.news) {
    if (!previous.town?.civilization?.news.some(old => old.id === item.id)) {
      events.push({ actionId: null, agentId: item.residentId, kind: "civilization_event", payload: { ...item } });
    }
  }
  // Keep the snapshot bounded only after every new civic fact has entered the event output.
  state.town!.civilization!.news = state.town!.civilization!.news.slice(-96);
  for (const conversation of state.town!.conversations) {
    if (!previous.town?.conversations.some(c => c.id === conversation.id)) events.push({ actionId: null, agentId: conversation.residentId, kind: "town_conversation", payload: { ...conversation } });
  }
  for (const activity of state.town!.activities) {
    const old = previous.town?.activities.find(a => a.id === activity.id);
    if (old && (old.status !== activity.status || old.attendees.length !== activity.attendees.length)) events.push({ actionId: null, agentId: activity.organizerId, kind: "town_activity", payload: { ...activity } });
  }
  return { state, completed, started, events };
}
