// @vitest-environment node
import { expect, it, vi } from "vitest";
import { SiegeClient } from "./client";
import { SAMPLES, sampleSpec } from "./samples";
import { DEFAULT_CANNON, createCannonDrawing, createCannonSpec } from "./cannon";
it("restores kit metadata and preserves drawings for unknown or malformed kit versions", async () => {
  const drawing = createCannonDrawing(DEFAULT_CANNON), spec = createCannonSpec(drawing, "0".repeat(64));
  const blueprint = { id: "22222222-2222-4222-8222-222222222222", name: "kit", drawing, spec, rulesVersion: "p0.2", createdAt: "2026-10-08" };
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
    id: "11111111-1111-4111-8111-111111111111", version: 1, blueprints: [
      { ...blueprint, cannonDesign: DEFAULT_CANNON },
      { ...blueprint, cannonDesign: { ...DEFAULT_CANNON, version: 99 } },
      { ...blueprint, cannonDesign: { ...DEFAULT_CANNON, barrelWidthMm: "wide" } }, blueprint,
    ],
  })));
  const saved = await new SiegeClient("/api/siege", transport).read("id");
  expect(saved.blueprints[0]!.cannonDesign).toEqual(DEFAULT_CANNON);
  for (const b of saved.blueprints.slice(1)) { expect(b.cannonDesign).toBeNull(); expect(b.drawing).toEqual(drawing); }
});
it("rejects malformed sessions without discarding caller input", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"version":1}'));
  await expect(new SiegeClient("/api/siege", transport).read("id")).rejects.toMatchObject({ code: "invalid_response" });
});
it("sends the identical request and isolated cookie credentials", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"code":"version_conflict"}', { status: 409 }));
  const client = new SiegeClient("/api/siege", transport);
  await expect(client.create("same-id")).rejects.toMatchObject({ code: "version_conflict" });
  expect(transport).toHaveBeenCalledWith("/api/siege/sessions", expect.objectContaining({
    credentials: "include", body: '{"requestId":"same-id"}',
  }));
});
it("retains original drawing when a saved blueprint uses a future execution type", async () => {
  const drawing = structuredClone(SAMPLES[0]!.drawing), spec = sampleSpec(SAMPLES[0]!, "0".repeat(64));
  Object.assign(spec.parts[0]!, { type: "future_spring" });
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
    id: "11111111-1111-4111-8111-111111111111", version: 1, blueprints: [{
      id: "22222222-2222-4222-8222-222222222222", name: "future", drawing, spec, rulesVersion: "p1", createdAt: "2026-10-07",
    }],
  })));
  const session = await new SiegeClient("/api/siege", transport).read("id");
  expect(session.blueprints[0]!.drawing).toEqual(drawing);
  expect(session.blueprints[0]!.spec).toBeNull();
});
it("accepts a cannon proposal but rejects model-supplied damage", async () => {
  const sample = SAMPLES[3]!, spec = sampleSpec(sample, "0".repeat(64));
  const proposal = { requestId: "11111111-1111-4111-8111-111111111111", drawingHash: spec.drawingHash, state: "complete", spec };
  const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(proposal)))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...proposal, spec: { ...spec, damage: 99999 } })));
  const client = new SiegeClient("/api/siege", transport);
  expect((await client.receipt("session", proposal.requestId)).spec?.parts[2]?.type).toBe("cannon");
  await expect(client.receipt("session", proposal.requestId)).rejects.toMatchObject({ code: "invalid_response" });
});
