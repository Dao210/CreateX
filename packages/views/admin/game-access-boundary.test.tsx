import { beforeEach, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithI18n } from "../test/i18n";
import { GameAccessBoundary } from "./game-access-boundary";

const mocks = vi.hoisted(() => ({ get: vi.fn(), world: { id: "11111111-1111-4111-8111-111111111111" } }));
vi.mock("@auro/core/paths", () => ({ useCurrentWorkspace: () => mocks.world }));
vi.mock("@auro/core/api", () => ({ api: { getWorldGames: mocks.get } }));
function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithI18n(<QueryClientProvider client={client}><GameAccessBoundary gameId="siege"><p>Game mounted</p></GameAccessBoundary></QueryClientProvider>);
}
beforeEach(() => vi.clearAllMocks());
it("permits a hidden but available game", async () => {
  mocks.get.mockResolvedValue({ workspaceId: mocks.world.id, games: [{ gameId: "siege", available: true, visible: false }] });
  render(); expect(await screen.findByText("Game mounted")).toBeInTheDocument();
});
it("does not mount game content when the world is denied", async () => {
  mocks.get.mockResolvedValue({ workspaceId: mocks.world.id, games: [{ gameId: "siege", available: false, visible: true }] });
  render(); expect(await screen.findByText("This game is not open in the current world.")).toBeInTheDocument(); expect(screen.queryByText("Game mounted")).not.toBeInTheDocument();
});
it("distinguishes a failed permission lookup from a closed game", async () => {
  mocks.get.mockRejectedValue(new Error("network error"));render();
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not verify game access");
  expect(screen.queryByText("Game mounted")).not.toBeInTheDocument();
});
