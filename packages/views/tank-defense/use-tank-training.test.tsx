import { beforeEach, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TankDefenseGame, TANK_LEVELS, tankKeys, type TankPlaySession } from "@auro/core/tank-defense";
import { useTankTraining } from "./use-tank-training";

const mocks = vi.hoisted(() => ({ start: vi.fn(), settle: vi.fn() }));
vi.mock("@auro/core/api", async original => ({ ...await original<typeof import("@auro/core/api")>(), api: { startTankTraining: mocks.start, settleTankTraining: mocks.settle } }));
const session = { id: "session", character: { id: "tank", ownerId: "user" }, progression: { xp: 0 } } as TankPlaySession;
beforeEach(() => { vi.resetAllMocks(); mocks.start.mockImplementation((_ws, sessionId, input) => Promise.resolve({ id: input.requestId, sessionId, characterId: "tank", levelId: input.levelId })); mocks.settle.mockImplementation((_ws, _session, runId) => Promise.resolve({ runId, characterId: "tank", awardedXp: 80, progression: { xp: 80 } })); });
function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const hook = renderHook(() => useTankTraining("world", session, "user"), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  return { ...hook, client, game: new TankDefenseGame(TANK_LEVELS[0]!) };
}
it("registers once, preserves the request ID after a network failure, and grants once", async () => {
  const { result, game } = setup();
  mocks.start.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { await expect(result.current.prepare!(game)).rejects.toThrow("offline"); });
  await act(async () => { await Promise.all([result.current.prepare!(game), result.current.prepare!(game)]); });
  expect(mocks.start).toHaveBeenCalledTimes(2);
  expect(mocks.start.mock.calls[0]![2].requestId).toBe(mocks.start.mock.calls[1]![2].requestId);
  game.tick = 3600; game.kills = 8;
  await act(async () => { await Promise.all([result.current.finish!(game, "defeat"), result.current.finish!(game, "defeat")]); });
  expect(mocks.settle).toHaveBeenCalledTimes(1);
});
it("retries the captured summary and invalidates both collections", async () => {
  const { result, client, game } = setup();
  client.setQueryData(tankKeys.characters("world"), []);
  client.setQueryData(tankKeys.mine("world", "user"), []);
  await act(async () => { await result.current.prepare!(game); });
  game.tick = 3600; game.kills = 8;
  mocks.settle.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { await expect(result.current.finish!(game, "defeat")).rejects.toThrow("offline"); });
  game.kills = 99;
  await act(async () => { result.current.retry(); });
  expect(mocks.settle.mock.calls[1]).toEqual(mocks.settle.mock.calls[0]);
  expect(client.getQueryState(tankKeys.characters("world"))?.isInvalidated).toBe(true);
  expect(client.getQueryState(tankKeys.mine("world", "user"))?.isInvalidated).toBe(true);
});
