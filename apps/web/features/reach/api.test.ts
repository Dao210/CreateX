// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSeason, fetchSnapshot } from "./api";
import { previewSnapshot } from "./preview";

afterEach(() => vi.unstubAllGlobals());
function respond(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}

describe("public world response boundary", () => {
  it("parses the world without trusting raw JSON", async () => {
    const snapshot = previewSnapshot();
    respond(snapshot);
    expect(await fetchSnapshot()).toEqual(snapshot);
  });
  it.each([{}, null, { ...previewSnapshot(), entities: [{ id: "broken", x: "NaN" }] }])("rejects malformed world data without breaking the preview", async (body) => {
    respond(body);
    expect(await fetchSnapshot()).toBeNull();
  });
  it("accepts null or omitted lists and safely handles new enum values", async () => {
    const snapshot = previewSnapshot();
    respond({ ...snapshot, supplies: null, wrecks: undefined, entities: [{ ...snapshot.entities[0], silhouette: "new-shape", status: "retired", palette: ["bad-css"] }] });
    const parsed = await fetchSnapshot();
    expect(parsed?.supplies).toEqual([]);
    expect(parsed?.wrecks).toEqual([]);
    expect(parsed?.entities[0]).toMatchObject({ silhouette: "slim", status: "dead", palette: ["#14161A", "#C8622D", "#E8E1D5"] });
  });
  it("rejects invalid season timing and network failures", async () => {
    respond({ id: "season", beat: 1, beatsLeft: 3, beatSeconds: 0, rulesVersion: "reach@1", entities: 0, alive: 0, wrecks: 0 });
    expect(await fetchSeason()).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchSnapshot()).toBeNull();
  });
  it("accepts larger valid wreck histories without discarding the world", async () => {
    const snapshot = previewSnapshot();
    const wreck = snapshot.wrecks[0]!;
    respond({ ...snapshot, wrecks: Array.from({ length: 2500 }, (_, i) => ({ ...wreck, id: `wreck-${i}` })) });
    expect((await fetchSnapshot())?.wrecks).toHaveLength(2500);
  });
  it("passes cancellation through to the transport", async () => {
    const controller = new AbortController();
    respond(previewSnapshot());
    controller.abort();
    await fetchSnapshot(controller.signal);
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});
