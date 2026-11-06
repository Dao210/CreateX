// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { advanceTick, seedResidents, seedResources, type Simulation } from "./engine";
import { newTown } from "./town";
import { emptyCivilization, STORAGE_DESIGNS } from "./civilization-schema";
import { canWithdraw, civicActionFeasible } from "./civilization";
import { TownSchema } from "./town-schema";
import type { AgentBrain } from "./brain";
const rest: AgentBrain = { choose: () => ({ intent: { kind: "REST" }, reason: "test" }) };
function proposed(): Simulation {
  const agents = seedResidents(3).map(agent => ({ ...agent, position: { x: 8, y: 5 }, energy: 100, fullness: 100 }));
  agents[2]!.position = { x: 0, y: 0 };
  const town = newTown(agents); town.profiles.forEach(row => { row.interests = ["community"]; });
  town.civilization = emptyCivilization();
  const prototypeId = randomUUID();
  town.civilization.prototypes.push({ id: prototypeId, authorId: randomUUID(), name: "Neighbors' store", variant: "light", createdTick: 600 });
  town.civilization.suggestions.push({ id: randomUUID(), prototypeId, residentId: agents[0]!.id, createdTick: 600, status: "pending" });
  return advanceTick({ tick: 600, agents, resources: seedResources(agents), actions: [], town }, randomUUID, rest).state;
}
describe("civilization with authoritative local causes", () => {
  it("shares a project only after a successful local encounter", () => {
    let state = proposed(); const projectId = state.town!.civilization!.projects[0]!.id;
    expect(state.town!.civilization!.projects[0]!.knownBy).not.toContain(state.agents[2]!.id);
    const sourceId = randomUUID();
    state.agents[1]!.position = { x: 0, y: 0 };
    state.actions = [{ id: sourceId, agentId: state.agents[1]!.id, intent: { kind: "TALK", targetId: state.agents[2]!.id }, startedTick: 599, dueTick: 602, status: "running", reason: "share" }];
    const failed = structuredClone(state); failed.agents[2]!.position = { x: 0, y: 1 };
    expect(advanceTick(failed, randomUUID, rest).state.town!.civilization!.projects[0]!.knownBy).not.toContain(state.agents[2]!.id);
    state = advanceTick(state, randomUUID, rest).state;
    expect(state.town!.civilization!.projects[0]!.knownBy).toContain(state.agents[2]!.id);
    expect(state.town!.civilization!.news).toContainEqual(expect.objectContaining({ projectId, kind: "discovered", residentId: state.agents[2]!.id, otherId: state.agents[1]!.id, sourceId }));
  });
  it("settles the last shared food once, preserving the total and an action/event trace", () => {
    const state = proposed(), project = state.town!.civilization!.projects[0]!;
    Object.assign(project, { status: "active", wood: 9, labor: 18, food: 1, completedTick: 601 });
    state.actions = state.agents.slice(0, 2).map(agent => ({ id: randomUUID(), agentId: agent.id, intent: { kind: "WITHDRAW_FOOD", projectId: project.id }, startedTick: 601, dueTick: 602, status: "running", reason: "food" }));
    const before = state.resources.filter(row => row.kind === "food" && row.owner !== "farm").reduce((sum, row) => sum + row.amount, project.food);
    const result = advanceTick(state, randomUUID, rest);
    expect(result.completed.map(action => action.status)).toEqual(["completed", "failed"]);
    expect(result.state.town!.civilization!.projects[0]!.food).toBe(0);
    expect(result.state.resources.filter(row => row.kind === "food" && row.owner !== "farm").reduce((sum, row) => sum + row.amount, 0)).toBe(before);
    expect(result.events.filter(event => event.kind === "civilization_event" && event.payload.kind === "withdrawn")).toHaveLength(1);
    for (const action of result.completed) expect(result.events.filter(event => event.actionId === action.id)).toHaveLength(1);
    expect(advanceTick(result.state, randomUUID, rest).completed.some(action => state.actions.some(old => old.id === action.id))).toBe(false);
    expect(TownSchema.safeParse(result.state.town).success).toBe(true);
  });
  it("enforces the chosen allowance and site, and records actual material transfers", () => {
    const state = proposed(), project = state.town!.civilization!.projects[0]!, agent = state.agents[0]!;
    state.resources.find(row => row.owner === agent.id && row.kind === "wood")!.amount = 3;
    state.actions = [{ id: randomUUID(), agentId: agent.id, intent: { kind: "DELIVER_WOOD", projectId: project.id }, startedTick: 600, dueTick: 602, status: "running", reason: "materials" }];
    const result = advanceTick(state, randomUUID, rest);
    expect(result.state.resources.find(row => row.owner === agent.id && row.kind === "wood")!.amount).toBe(0);
    expect(result.state.town!.civilization!.projects[0]!.wood).toBe(3);
    Object.assign(project, { status: "active", food: 20 });
    project.members[0]!.todayWithdrawn = 2;
    project.rule.distribution = "contribution";
    expect(canWithdraw(state, project, agent)).toBe(false);
    project.rule.distribution = "equal";
    expect(canWithdraw(state, project, agent)).toBe(true);
    agent.position = { x: 7, y: 5 };
    expect(civicActionFeasible(state, agent, { kind: "WITHDRAW_FOOD", projectId: project.id })).toBe(false);
  });
  it("adopts only informed two-thirds votes and preserves the former agreement", () => {
    const state = proposed(), civ = state.town!.civilization!, project = civ.projects[0]!;
    Object.assign(project, { status: "active", wood: 9, labor: 18, completedTick: 601 });
    state.agents[2]!.position = { ...project.position };
    for (const agent of state.agents.slice(1)) {
      state.town!.profiles.find(profile => profile.residentId === agent.id)!.interests = ["reading"];
      agent.personality.diligence = 90; agent.personality.sociability = 60;
    }
    civ.debates.push({ id: randomUUID(), projectId: project.id, proposerId: state.agents[1]!.id, distribution: "contribution", maintenance: "rotation", createdTick: 601, expiresTick: 2000, status: "open", knownBy: state.agents.map(agent => agent.id), votes: [] });
    const result = advanceTick(state, randomUUID, rest);
    expect(result.state.town!.civilization!.projects[0]!.rule).toMatchObject({ revision: 2, distribution: "contribution", maintenance: "rotation" });
    expect(result.events.find(event => event.kind === "civilization_event" && event.payload.kind === "rule_adopted")?.payload.rule).toMatchObject({ revision: 2, distribution: "contribution" });
    expect(result.state.town!.civilization!.news.find(row => row.kind === "proposed")?.rule).toMatchObject({ revision: 1, distribution: "equal" });
    expect(advanceTick(result.state, randomUUID, rest).events.some(event => event.kind === "civilization_event" && event.payload.kind === "rule_adopted")).toBe(false);
  });
  it("persists every civic fact before trimming the bounded viewer snapshot", () => {
    const agents = seedResidents(60).map(agent => ({ ...agent, position: { x: 8, y: 5 }, energy: 100, fullness: 100 }));
    const town = newTown(agents); town.profiles.forEach(profile => { profile.interests = ["community"]; });
    town.civilization = emptyCivilization();
    const prototypeId = randomUUID();
    town.civilization.prototypes.push({ id: prototypeId, authorId: null, name: "", variant: "light", createdTick: 600 });
    for (const agent of agents.slice(0, 3)) town.civilization.suggestions.push({ id: randomUUID(), prototypeId, residentId: agent.id, createdTick: 600, status: "pending" });
    const result = advanceTick({ tick: 600, agents, resources: seedResources(agents), actions: [], town }, randomUUID, rest);
    const facts = result.events.filter(event => event.kind === "civilization_event");
    expect(facts.length).toBeGreaterThan(96);
    expect(facts.filter(event => event.payload.kind === "proposed")).toHaveLength(3);
    expect(result.state.town!.civilization!.news).toHaveLength(96);
    expect(TownSchema.safeParse(result.state.town).success).toBe(true);
  });
  it("runs a week without a viewer, with bounded state and a completed shared facility", () => {
    const agents = seedResidents(20); let state: Simulation = { tick: 0, agents, resources: seedResources(agents), actions: [] };
    const kinds = new Set<string>(); let minFullness = 100;
    for (let tick = 0; tick < 10080; tick++) {
      const result = advanceTick(state, randomUUID); state = result.state;
      result.events.filter(event => event.kind === "civilization_event").forEach(event => kinds.add(String(event.payload.kind)));
      if (tick % 1440 === 0) expect(TownSchema.safeParse(state.town).success).toBe(true);
      if (state.resources.some(row => row.amount < 0)) throw new Error("negative inventory");
      minFullness = Math.min(minFullness, ...state.agents.map(agent => agent.fullness));
    }
    expect(minFullness).toBeGreaterThan(0);
    const project = state.town!.civilization!.projects[0]!;
    expect(project.labor).toBe(STORAGE_DESIGNS[project.variant].labor);
    expect(project.food).toBeLessThanOrEqual(STORAGE_DESIGNS[project.variant].capacity);
    for (const kind of ["proposed", "joined", "delivered", "completed", "deposited", "maintenance"]) expect(kinds.has(kind), kind).toBe(true);
    expect(state.town!.civilization!.news.length).toBeLessThanOrEqual(96);
  }, 120_000);
});
