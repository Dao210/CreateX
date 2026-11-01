// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "./client";

const wsId = "11111111-1111-4111-8111-111111111111";
const policy = { gameId: "siege", scope: "all", defaultVisible: true, overrides: [], revision: 0 };
function respond(data: unknown) {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => vi.unstubAllGlobals());
it("reads global game policies without leaking workspace routing", async () => {
  const fetcher = respond({ games: [{ policy, worlds: [], impact: { total: 3, available: 3, visible: 3 }, binding: null }] });
  expect((await new ApiClient("").listAdminGames())[0]?.policy.gameId).toBe("siege");
  const headers = new Headers(fetcher.mock.calls[0]![1].headers);
  expect(headers.get("X-Workspace-ID")).toBe("");
  expect(headers.get("X-Workspace-Slug")).toBe("");
});
it("treats unknown policy enums as unavailable while retaining the response", async () => {
  respond({ ...policy, scope: "future", overrides: [{ workspaceId: wsId, access: "future", visibility: "future" }] });
  const parsed = await new ApiClient("").updateGamePolicy("siege", { expectedRevision: 0, scope: "all", defaultVisible: true, overrides: [] });
  expect(parsed.scope).toBe("disabled");
  expect(parsed.overrides[0]).toMatchObject({ access: "deny", visibility: "hide" });
});
it.each([
  {},
  { workspaceId: wsId, games: [{ gameId: "siege", visible: true }] },
  { workspaceId: wsId, games: [{ gameId: "siege", available: "true", visible: true }] },
  { workspaceId: "22222222-2222-4222-8222-222222222222", games: [] },
  { workspaceId: wsId, games: [{ gameId: "siege", available: true, visible: true }, { gameId: "siege", available: false, visible: false }] },
])("rejects malformed or cross-world decisions", async data => {
  respond(data);
  await expect(new ApiClient("").getWorldGames(wsId)).rejects.toThrow("invalid_game_policy_response");
});
it("accepts additive game decisions and scopes the request explicitly", async () => {
  const fetcher = respond({ workspaceId: wsId, games: [{ gameId: "future-game", available: true, visible: false, future: true }] });
  expect((await new ApiClient("").getWorldGames(wsId)).games[0]?.gameId).toBe("future-game");
  expect(new Headers(fetcher.mock.calls[0]![1].headers).get("X-Workspace-ID")).toBe(wsId);
});
it("rejects a save response for a different game and preserves the submitted revision", async () => {
  const fetcher = respond({ ...policy, gameId: "tanks" });
  const input = { expectedRevision: 4, scope: "disabled" as const, defaultVisible: false, overrides: [] };
  await expect(new ApiClient("").updateGamePolicy("siege", input)).rejects.toThrow("invalid_game_policy_response");
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual(input);
});
