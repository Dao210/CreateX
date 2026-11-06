// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { seedResidents, seedResources, advanceTick } from "./engine";
import { LIFE_PROTOCOL_VERSION, RuntimeRequestSchema, TickResultSchema } from "./runtime-contract";

describe("internal life compute protocol", () => {
  const requestId = "b11fe000-0000-4000-8000-000000000001";
  const agents = seedResidents();
  const state = { tick: 0, agents, resources: seedResources(agents), actions: [] };
  it("accepts a snapshot request and the engine's own bounded result", () => {
    expect(RuntimeRequestSchema.parse({ version: LIFE_PROTOCOL_VERSION, requestId, operation: "tick", state }).operation).toBe("tick");
    expect(TickResultSchema.parse(advanceTick(state, randomUUID)).state.tick).toBe(1);
  });
  it.each([
    { version: 99, requestId, operation: "seed" },
    { version: 2, requestId, operation: "exec", code: "anything" },
    { version: 2, requestId, operation: "seed", databaseUrl: "forbidden" },
    { version: 2, requestId, operation: "tick", state: { ...state, tick: -1 } },
    { version: 2, requestId, operation: "tick", state: { ...state, agents: [...agents, ...agents, ...agents, ...agents] } },
  ])("rejects unsupported or unbounded requests", (request) => {
    expect(RuntimeRequestSchema.safeParse(request).success).toBe(false);
  });
});
