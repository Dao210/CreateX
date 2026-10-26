// @vitest-environment node
import { expect, it, vi } from "vitest";
const initialize = vi.hoisted(() => vi.fn());
vi.mock("@dimforge/rapier2d-compat", () => ({ default: { init: initialize } }));
import { initializePhysics } from "./physics";

it("retries failed initialization and shares the successful initialization", async () => {
  initialize.mockRejectedValueOnce(new Error("wasm unavailable")).mockResolvedValueOnce(undefined);
  await expect(initializePhysics()).rejects.toThrow("wasm unavailable");
  const first = initializePhysics(), second = initializePhysics();
  expect(first).toBe(second);
  await first; await initializePhysics();
  expect(initialize).toHaveBeenCalledTimes(2);
});
