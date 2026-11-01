import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithI18n } from "../test/i18n";
import { GameManager } from "./game-manager";

const mocks = vi.hoisted(() => ({ list: vi.fn(), worlds: vi.fn(), preview: vi.fn(), save: vi.fn(), audit: vi.fn() }));
vi.mock("@auro/core/api", async original => ({ ...await original<typeof import("@auro/core/api")>(), api: { listAdminGames: mocks.list, searchGameAdminWorlds: mocks.worlds, previewGamePolicy: mocks.preview, updateGamePolicy: mocks.save, getGamePolicyActivity: mocks.audit } }));
const world = { id: "11111111-1111-4111-8111-111111111111", name: "Alpha", slug: "alpha" };
const policy = { gameId: "siege", scope: "all", defaultVisible: true, overrides: [], revision: 3 };
function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return renderWithI18n(<QueryClientProvider client={client}><GameManager userId="admin" /></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.list.mockResolvedValue([{ policy, worlds: [], impact: { total: 2, available: 2, visible: 2 }, binding: null }]);
  mocks.worlds.mockResolvedValue({ items: [world] });mocks.audit.mockResolvedValue({ items: [] });mocks.preview.mockResolvedValue({ total: 2, available: 2, visible: 0 });
});
it("previews a hidden entry without revoking access and preserves a failed edit", async () => {
  mocks.save.mockRejectedValue(new Error("temporary failure"));render();
  const toggle = await screen.findByRole("switch", { name: "Show in sidebar by default" });fireEvent.click(toggle);
  expect(await screen.findByText("After saving: 2 of 2 worlds available · 0 sidebar entries")).toBeInTheDocument();
  const save = screen.getByRole("button", { name: "Save policy" });await waitFor(() => expect(save).toBeEnabled());fireEvent.click(save);
  expect(await screen.findByRole("alert")).toHaveTextContent("Your proposed policy is preserved");
  expect(toggle).toHaveAttribute("aria-checked", "false");
  fireEvent.click(save);await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.calls[0]).toEqual(["siege", { expectedRevision: 3, scope: "all", defaultVisible: false, overrides: [] }]);
});
it("adds a world exception and previews its effective result", async () => {
  render();fireEvent.click(await screen.findByRole("button", { name: "Add exception for Alpha" }));
  const access = screen.getByRole("combobox", { name: "Alpha · Game access" });fireEvent.change(access, { target: { value: "deny" } });
  fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
  expect(screen.getByText("Unavailable")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Restore inheritance · Alpha" }));expect(screen.queryByRole("combobox", { name: "Alpha · Game access" })).not.toBeInTheDocument();
});
it("limits resident life scope to its existing binding", async () => {
  mocks.list.mockResolvedValue([{ policy: { ...policy, gameId: "life", scope: "bound" }, worlds: [], impact: { total: 2, available: 0, visible: 0 }, binding: null }]);
  render();expect(await screen.findByText("Not initialized")).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "All worlds" })).not.toBeInTheDocument();
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();expect(mocks.worlds).not.toHaveBeenCalled();
});
