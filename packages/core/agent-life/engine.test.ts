// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { advanceTick, seedResidents, seedResources, feasible, ruleBrain, LIFE_MAP, type Simulation } from "./index";
import { PlannerProposalSchema, LifeSnapshotSchema, PLANNER_JSON_SCHEMA } from "./schema";

describe("Agent Life rule authority", () => {
  it.each([20, 60])("sustains %i residents for 1440 minutes with bounded needs and traced settlements", (count) => {
    const agents = seedResidents(count);
    let state: Simulation = { tick: 0, agents, resources: seedResources(agents), actions: [] };
    const kinds = new Set<string>();
    const settled = new Set<string>();
    let lowestFullness = 100;
    for (let i = 0; i < 1440; i++) {
      const result = advanceTick(state, randomUUID);
      for (const action of result.completed) {
        expect(settled.has(action.id)).toBe(false); settled.add(action.id);
        const events = result.events.filter((e) => e.actionId === action.id);
        expect(events).toHaveLength(1);
        if (action.status === "completed") kinds.add(action.intent.kind);
      }
      state = result.state;
      expect(new Set(state.actions.map((a) => a.agentId)).size).toBe(count);
      expect(state.resources.every((r) => r.amount >= 0)).toBe(true);
      expect(state.agents.every((a) => [a.energy, a.fullness, a.social].every((n) => n >= 0 && n <= 100))).toBe(true);
      lowestFullness = Math.min(lowestFullness, ...state.agents.map((a) => a.fullness));
    }
    expect(lowestFullness).toBeGreaterThan(0);
    expect(kinds).toEqual(new Set(["MOVE", "REST", "EAT", "GATHER_WOOD", "WORK", "TALK"]));
    expect(state.agents.map((a) => a.position)).not.toEqual(agents.map((a) => a.position));
  }, 30_000);

  it("prioritizes survival and refuses remote work, empty inventory and self talk", () => {
    const self = seedResidents(1)[0]!;
    const resources = seedResources([self]);
    self.energy = 10;
    expect(ruleBrain.choose({ tick: 1, self, residents: [self], resources }).intent.kind).toBe("REST");
    self.energy = 80; self.fullness = 10;
    expect(ruleBrain.choose({ tick: 1, self, residents: [self], resources }).intent.kind).toBe("EAT");
    expect(feasible(self, { kind: "WORK" }, [self], resources)).toBe(false);
    expect(feasible(self, { kind: "EAT" }, [self], [])).toBe(false);
    expect(feasible(self, { kind: "TALK", targetId: self.id }, [self], resources)).toBe(false);
  });

  it("settles competing resource consumers once and records failed preconditions without a reward", () => {
    const agents = seedResidents(2).map((a) => ({ ...a, position: { ...LIFE_MAP.forest } }));
    const resources = seedResources(agents);
    resources.find((r) => r.owner === "forest")!.amount = 0;
    const actions = agents.map((a) => ({ id: randomUUID(), agentId: a.id, intent: { kind: "GATHER_WOOD" as const }, reason: "test", startedTick: 0, dueTick: 1, status: "running" as const }));
    const original: Simulation = { tick: 0, agents, resources, actions };
    const result = advanceTick(original, randomUUID);
    expect(result.completed.map((a) => a.status)).toEqual(["completed", "failed"]);
    expect(result.state.resources.filter((r) => r.kind === "wood" && r.owner !== "forest").reduce((s, r) => s + r.amount, 0)).toBe(3);
    expect(original.resources.find((r) => r.owner === "forest")!.amount).toBe(0);
    const replay = advanceTick(result.state, randomUUID);
    expect(replay.completed.some((a) => actions.some((old) => a.id === old.id))).toBe(false);
  });

  it("rejects planner commands outside the JSON Schema and revalidates semantic feasibility", () => {
    expect(PLANNER_JSON_SCHEMA).toHaveProperty("additionalProperties", false);
    for (const intent of [{ kind: "EXEC", code: "delete" }, { kind: "WORK", coins: 999 }, { kind: "MOVE", to: { x: 12, y: 0 } }]) {
      expect(PlannerProposalSchema.safeParse({ intent, reason: "test" }).success).toBe(false);
    }
    const agents = seedResidents(1);
    expect(() => advanceTick({ tick: 0, agents, resources: seedResources(agents), actions: [] }, randomUUID, { choose: () => ({ intent: { kind: "WORK" }, reason: "remote" }) })).toThrow("invalid_brain_proposal");
    expect(LifeSnapshotSchema.safeParse({ world: { tick: "bad" } }).success).toBe(false);
  });
});
