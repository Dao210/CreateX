// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
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
  it.each([{ world: {} }, { ...snapshot, world: { ...snapshot.world, workspaceId: "a11fe000-0000-4000-8000-000000000002" } }])("rejects malformed or cross-world data", async (value) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(value), { status: 200 })));
    await expect(new ApiClient("https://api.example.test").getLifeSnapshot(workspaceId)).rejects.toThrow("invalid_life_response");
  });
});
