// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client";
import { compileTankCharacter } from "../tank-defense/characters";
import fixtures from "../tank-defense/character-cases.json";

const wsId = "22222222-2222-4222-8222-222222222222";
const id = "11111111-1111-4111-8111-111111111111";
const draft = fixtures[0]!.draft;
const character = { id, workspaceId: wsId, ownerId: id, revision: 1, rulesVersion: 1, compilerVersion: 1, contentHash: `sha256:${"a".repeat(64)}`, draft, ...compileTankCharacter(draft, `${id}@1`), createdAt: "2026-10-24T00:00:00Z" };
afterEach(() => vi.unstubAllGlobals());
function response(data: unknown) { const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } })); vi.stubGlobal("fetch", fetcher); return fetcher; }

describe("tank API response boundary", () => {
  it("validates the library and binds headers to the requested workspace", async () => {
    const fetcher = response({ characters: [character] });
    const api = new ApiClient("https://api.example.invalid");
    const items = await api.listTankCharacters(wsId);
    expect(items[0]?.draft.name).toBe(draft.name);
    expect(items[0]?.origin).toBe("manual");
    const init = fetcher.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get("X-Workspace-ID")).toBe(wsId);
    expect(new Headers(init.headers).get("X-Workspace-Slug")).toBe("");
  });
  it("requests only the caller's characters for the personal collection", async () => {
    const fetcher = response({ characters: [character] });
    const items = await new ApiClient("https://api.example.invalid").listTankCharacters(wsId, true);
    expect(items[0]?.origin).toBe("manual");
    expect(fetcher.mock.calls[0]![0]).toBe("/api/tanks/v1/characters?mine=1");
  });
  it.each([{}, { characters: [{}] }, { characters: [{ ...character, workspaceId: "33333333-3333-4333-8333-333333333333" }] }, { characters: [{ ...character, blueprint: { ...character.blueprint, speed: 9999 } }] }])("rejects a malformed or mismatched character library", async raw => {
    response(raw);
    await expect(new ApiClient("https://api.example.invalid").listTankCharacters(wsId)).rejects.toThrow("invalid_tank_response");
  });
  it("refuses a future session rather than loading the classic tank", async () => {
    response({ rulesVersion: 2, id });
    await expect(new ApiClient("https://api.example.invalid").getTankSession(wsId, id)).rejects.toThrow("invalid_tank_response");
  });
});
