// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { advanceTick, seedResidents, seedResources, type Simulation } from "./engine";
import { newTown, knowsActivity, retrieveMemories } from "./town";
import { TownSchema } from "./town-schema";
import type { AgentBrain } from "./brain";

const resting: AgentBrain = { choose: () => ({ intent: { kind: "REST" }, reason: "test_rest" }) };
function world(): Simulation {
  const agents = seedResidents(3).map(a => ({ ...a, position: { x: 6, y: 5 }, energy: 100, fullness: 100, social: 100 }));
  const town = newTown(agents);
  town.profiles.forEach(p => { p.interests = ["reading"]; });
  town.activities.push({ id: randomUUID(), organizerId: agents[0]!.id, title: "Reading together", interest: "reading", place: "cafe", startTick: 650, endTick: 710, status: "scheduled", decision: "shared_interest", attendees: [] });
  return { tick: 600, agents, resources: seedResources(agents), actions: [], town };
}
function talk(state: Simulation, from: number, to: number) {
  state.actions = [{ id: randomUUID(), agentId: state.agents[from]!.id, intent: { kind: "TALK", targetId: state.agents[to]!.id }, startedTick: state.tick - 2, dueTick: state.tick + 1, status: "running", reason: "share_activity" }];
  return advanceTick(state, randomUUID, resting).state;
}
describe("a town with causal shared history", () => {
  it("spreads invitations through completed encounters and records attendance only for informed residents", () => {
    let state = world(); const activity = state.town!.activities[0]!.id;
    expect(knowsActivity(state.town!, state.agents[0]!.id, activity)).toBe(true);
    expect(knowsActivity(state.town!, state.agents[2]!.id, activity)).toBe(false);
    state = talk(state, 0, 1);
    expect(knowsActivity(state.town!, state.agents[1]!.id, activity)).toBe(true);
    expect(knowsActivity(state.town!, state.agents[2]!.id, activity)).toBe(false);
    const snapshot = structuredClone(state);
    snapshot.tick = 650; snapshot.actions = [];
    const attendance = advanceTick(snapshot, randomUUID, resting).state.town!.activities[0]!;
    expect(attendance.attendees.sort()).toEqual([state.agents[0]!.id, state.agents[1]!.id].sort());
    expect(attendance.attendees).not.toContain(state.agents[2]!.id);
    state = talk(state, 1, 2);
    expect(knowsActivity(state.town!, state.agents[2]!.id, activity)).toBe(true);
    expect(state.town!.memories.find(m => m.residentId === state.agents[2]!.id && m.kind === "invitation")?.otherId).toBe(state.agents[1]!.id);
    expect(TownSchema.safeParse(state.town).success).toBe(true);
  });
  it("a failed remote conversation conveys no invitation and grants no familiarity", () => {
    const state = world(); state.agents[1]!.position = { x: 0, y: 0 };
    const after = talk(state, 0, 1);
    expect(after.town!.memories).toHaveLength(0);
    expect(after.town!.relationships).toHaveLength(0);
    expect(knowsActivity(after.town!, state.agents[1]!.id, after.town!.activities[0]!.id)).toBe(false);
  });
  it("retrieves only personal memories and preserves profiles and experiences through serialization", () => {
    const state = talk(world(), 0, 1), id = state.agents[1]!.id;
    const memories = retrieveMemories(state.town!, id, state.tick, state.agents[0]!.id);
    expect(memories.length).toBeGreaterThan(0);
    expect(memories.every(m => m.residentId === id)).toBe(true);
    const restored = JSON.parse(JSON.stringify(state));
    const next = advanceTick(restored, randomUUID, resting).state;
    expect(next.town!.profiles).toEqual(state.town!.profiles);
    expect(next.town!.relationships).toEqual(state.town!.relationships);
    expect(next.town!.memories).toEqual(state.town!.memories);
  });
  it("queues a bounded model request without inventing dialogue or spreading invitations", () => {
    const state = world(); state.town!.model.mode = "llm"; state.town!.model.state = "ready";
    const after = talk(state, 0, 1);
    expect(after.town!.jobs.some(j => j.kind === "dialogue" && j.status === "queued")).toBe(true);
    expect(after.town!.conversations).toHaveLength(0);
    expect(knowsActivity(after.town!, state.agents[1]!.id, after.town!.activities[0]!.id)).toBe(false);
  });
});
