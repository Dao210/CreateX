// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { DealClient, DealError, DealSessionSchema, dealRecap } from "./index";

const fixture = () => ({
  id: "d7ad1c20-62bc-4dca-88aa-9a23257b3210",
  version: 1,
  scenario_version: "the-debt@1",
  remaining_seconds: 480,
  debt_remaining: 100000,
  cash: 3000,
  pose: "calm",
  dialogue: "opening",
  reaction: "watching",
  items: [
    {
      id: "cash",
      name: "cash",
      owner: "player",
      description: "money",
      actions: ["inspect", "future_action"],
    },
  ],
});
describe("DEAL API boundary", () => {
  it("keeps the UI usable with optional fields and unknown poses/actions", () => {
    const parsed = DealSessionSchema.parse({ ...fixture(), pose: "new_pose" });
    expect(parsed.pose).toBe("calm");
    expect(parsed.items[0]?.actions).toEqual(["inspect"]);
    expect(parsed.history).toEqual([]);
    expect(parsed.ending).toBeNull();
  });
  it("rejects incomplete or invalid critical session data", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "broken", version: 1 }), {
          status: 200,
        }),
      );
    await expect(
      new DealClient("/api/deal", transport).create(),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("keeps the exact idempotency payload and isolated cookie credentials", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(fixture()), { status: 200 }),
      );
    const input = {
      request_id: "id",
      expected_version: 1,
      kind: "talk" as const,
      text: "我同意",
    };
    await new DealClient("/api/deal", transport).turn("session", input);
    expect(transport).toHaveBeenCalledWith(
      "/api/deal/sessions/session/turns",
      expect.objectContaining({
        credentials: "include",
        body: JSON.stringify(input),
      }),
    );
  });
  it("exposes stable error codes and actual recorded recap data", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('{"code":"version_conflict"}', { status: 409 }),
      );
    await expect(
      new DealClient("/api/deal", transport).read("session"),
    ).rejects.toEqual(new DealError("version_conflict"));
    expect(dealRecap(DealSessionSchema.parse(fixture()))).toContain(
      "剩余债务：$100,000",
    );
  });
});
