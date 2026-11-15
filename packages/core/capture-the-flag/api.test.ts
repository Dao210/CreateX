// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../api", async () => ({
  ...(await vi.importActual("../api")),
  authenticatedFetch: mock.fetch,
}));
import { ctfRequest, ctfStateOptions, ctfStrategyOptions } from "./queries";
import { StateSchema } from "./schema";
const ws = "00000000-0000-4000-8000-000000000001",
  user = "00000000-0000-4000-8000-000000000002";
const empty = {
  workspaceId: ws,
  canManage: false,
  mine: [],
  library: [],
  entries: [],
  batches: [],
  matches: [],
  leaderboard: [],
};
describe("CTF API boundary", () => {
  it("rejects malformed responses instead of rendering partial authority", async () => {
    mock.fetch.mockResolvedValue(
      new Response(JSON.stringify({ ...empty, canManage: "yes" })),
    );
    await expect(ctfRequest(ws, "state", StateSchema)).rejects.toThrow(
      "invalid_ctf_response",
    );
  });
  it("keeps workspace context explicit and rejects another world's response", async () => {
    mock.fetch.mockResolvedValue(
      new Response(JSON.stringify({ ...empty, workspaceId: user })),
    );
    const options = ctfStateOptions(ws, user);
    await expect(options.queryFn!({} as never)).rejects.toThrow(
      "invalid_ctf_response",
    );
    expect(mock.fetch.mock.lastCall?.[1].headers["X-Workspace-ID"]).toBe(ws);
    expect(mock.fetch.mock.lastCall?.[1].headers["X-Workspace-Slug"]).toBe("");
  });
  it("accepts an empty valid world and separates users in cache keys", async () => {
    mock.fetch.mockResolvedValue(new Response(JSON.stringify(empty)));
    expect(await ctfRequest(ws, "state", StateSchema)).toEqual(empty);
    expect(ctfStrategyOptions(ws, user, ws, 1).queryKey).not.toEqual(
      ctfStrategyOptions(ws, ws, ws, 1).queryKey,
    );
    expect(ctfStateOptions(ws, user).queryKey).not.toEqual(
      ctfStateOptions(ws, ws).queryKey,
    );
  });
});
