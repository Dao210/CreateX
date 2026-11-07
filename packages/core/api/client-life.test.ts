// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { newTown, seedResidents } from "../agent-life";
import { ApiClient } from "./client";

afterEach(() => vi.unstubAllGlobals());
describe("Life snapshot API boundary", () => {
  const workspaceId = "a11fe000-0000-4000-8000-000000000001";
  const snapshot = { world: { id: workspaceId, workspaceId, tick: 1, tickMs: 2000, updatedAt: "2026-10-30T00:00:00Z" }, agents: [], resources: [], actions: [], events: [] };
  it("uses explicit workspace headers and tolerates added action/resource enums", async () => {
    const value = { ...snapshot, resources: [{ owner: "future", kind: "water", amount: 3 }], actions: [{ id: workspaceId, agentId: workspaceId, intent: { kind: "FUTURE_ACTION" }, reason: "future", startedTick: 0, dueTick: 1, status: "future" }] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(value), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await new ApiClient("https://api.example.test").getLifeSnapshot(workspaceId)).actions[0]?.intent.kind).toBe("FUTURE_ACTION");
    expect(fetchMock.mock.calls[0]?.[1]?.headers["X-Workspace-ID"]).toBe(workspaceId);
  });
  it.each([{ world: {} }, { ...snapshot, world: { ...snapshot.world, workspaceId: "a11fe000-0000-4000-8000-000000000002" } }])("rejects malformed or mismatched route-context data", async (value) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(value), { status: 200 })));
    await expect(new ApiClient("https://api.example.test").getLifeSnapshot(workspaceId)).rejects.toThrow("invalid_life_response");
  });
});

it("validates town mutations and tolerates additive town response fields", async () => {
  const workspaceId = "a11fe000-0000-4000-8000-000000000001";
  const request = { requestId: workspaceId, kind: "message" as const, residentId: workspaceId, text: "Hello" };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "bad", kind: "message" }), { status: 200 })));
  await expect(new ApiClient("https://api.example.test").submitTownCommand(workspaceId, request)).rejects.toThrow("invalid_life_response");
  const agents = seedResidents();
  const town = { ...newTown(agents), futureField: "safe", model: { ...newTown(agents).model, state: "future_state" } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ world: { id: workspaceId, workspaceId, tick: 1, tickMs: 2000, updatedAt: "2026-11-06T00:00:00Z" }, agents, town }), { status: 200 })));
  const result = await new ApiClient("https://api.example.test").getLifeSnapshot(workspaceId);
  expect(result.town?.model.state).toBe("unconfigured");
});

it("reads one shared simulation through distinct membership contexts", async () => {
  const first = "a11fe000-0000-4000-8000-000000000001";
  const second = "a11fe000-0000-4000-8000-000000000002";
  const simulation = "b11fe000-0000-4000-8000-000000000001";
  vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, init) => Promise.resolve(new Response(JSON.stringify({ world: { id: simulation, workspaceId: init.headers["X-Workspace-ID"], tick: 10, tickMs: 2000, updatedAt: "2026-11-07T00:00:00Z" }, agents: seedResidents() }), { status: 200 }))));
  const client = new ApiClient("https://api.example.test");
  const a = await client.getLifeSnapshot(first), b = await client.getLifeSnapshot(second);
  expect(a.world?.id).toBe(b.world?.id);
  expect(b.world?.workspaceId).toBe(second);
  expect(b.agents).toEqual(a.agents);
});
