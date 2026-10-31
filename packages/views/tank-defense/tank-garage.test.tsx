import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithI18n } from "../test/i18n";
import { TankGarage } from "./tank-garage";
import { TankCharacterEditor } from "./tank-character-editor";
import { applyTankGrowth, compileTankCharacter, type TankCharacterDraft } from "@auro/core/tank-defense";

const mocks = vi.hoisted(() => ({ list: vi.fn(), session: vi.fn(), save: vi.fn(), start: vi.fn(), settle: vi.fn(), create: vi.fn(), replace: vi.fn(), search: "", hash: "", listeners: new Set<() => void>() }));
vi.mock("@auro/core/api", async importOriginal => ({ ...await importOriginal<typeof import("@auro/core/api")>(), api: { listTankCharacters: mocks.list, getTankSession: mocks.session, saveTankCharacter: mocks.save, createTankSession: mocks.create, startTankTraining: mocks.start, settleTankTraining: mocks.settle, getBaseUrl: () => "https://api.example.invalid" } }));
vi.mock("../navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return { useNavigation: () => {
    const search = useSyncExternalStore(listener => { mocks.listeners.add(listener); return () => { mocks.listeners.delete(listener); }; }, () => mocks.search);
    return { pathname: "/acme/tanks", hash: mocks.hash, searchParams: new URLSearchParams(search), replace: mocks.replace, getShareableUrl: (path: string) => `https://auro.example.invalid${path}` };
  } };
});
function render(ui: React.ReactElement) { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); return renderWithI18n(<QueryClientProvider client={client}>{ui}</QueryClientProvider>); }
const storage = { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() };
const draft: TankCharacterDraft = { profile: "tank-defense@1", name: "Black Overlord", parts: { chassis: "heavy", armor: "heavy", cannon: "heavy" }, appearance: { body: "#000000", accent: "#000000", pattern: "solid" } };
const character = { id: "22222222-2222-4222-8222-222222222222", revision: 1, workspaceId: "workspace", ownerId: "user", draft, ...compileTankCharacter(draft, "22222222-2222-4222-8222-222222222222@1"), contentHash: `sha256:${"a".repeat(64)}` };
const session = { id: "11111111-1111-4111-8111-111111111111", ownerId: "user", character, mapId: "frontline", levelId: 1, mode: "campaign", playPath: "/acme/tanks?session=11111111-1111-4111-8111-111111111111" };
beforeEach(() => {
  vi.clearAllMocks(); mocks.search = ""; mocks.hash = ""; mocks.list.mockResolvedValue([]);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  mocks.replace.mockImplementation((path: string) => { const url = new URL(path, "https://auro.example.invalid"); mocks.search = url.search.slice(1); mocks.hash = url.hash; mocks.listeners.forEach(listener => listener()); });
});

it("dismisses the return guidance without changing the frozen battle or other URL state", async () => {
  mocks.search = `session=${session.id}&from=tank-connect&source=shared`; mocks.hash = "#loadout";
  mocks.session.mockResolvedValue(session); mocks.list.mockResolvedValue([character]);
  render(<TankGarage workspace={{ id: "workspace", slug: "acme" }} userId="user" storageKey="test" storage={storage} />);
  expect(await screen.findByRole("status", { name: "Connect Agent" })).toHaveTextContent("Once your agent finishes connecting");
  const board = screen.getByTestId("tank-battlefield");
  expect(board).toHaveAttribute("data-phase", "ready");
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Start defense" }));
  fireEvent.click(screen.getByRole("button", { name: "Dismiss connection guidance" }));
  expect(mocks.replace).toHaveBeenLastCalledWith(`/acme/tanks?session=${session.id}&source=shared#loadout`);
  expect(screen.queryByRole("status", { name: "Connect Agent" })).not.toBeInTheDocument();
  expect(screen.getByTestId("tank-battlefield")).toBe(board);
  expect(board).toHaveAttribute("data-phase", "running");
  expect(board).toHaveAttribute("data-character-id", character.blueprint.id);
});

it("does not treat other navigation parameters as proof of an agent connection", async () => {
  mocks.search = "from=connected&mcp=connected";
  render(<TankGarage workspace={{ id: "workspace", slug: "acme" }} userId="user" storageKey="test" storage={storage} />);
  expect(screen.queryByRole("status", { name: "Connect Agent" })).not.toBeInTheDocument();
});

it("shows a failed session without silently substituting a classic battle", async () => {
  mocks.search = `session=${session.id}`;
  mocks.session.mockRejectedValue(new Error("not_found"));
  render(<TankGarage workspace={{ id: "workspace", slug: "acme" }} userId="user" storageKey="test" storage={{ getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() }} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("This session could not be loaded");
  expect(screen.queryByTestId("tank-battlefield")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Return to classic tank" })); expect(mocks.replace).toHaveBeenCalledWith("/acme/tanks");
});

it("starts the selected character from the battlefield button through a frozen session", async () => {
  mocks.search = `character=${character.id}`;
  mocks.list.mockResolvedValue([character]); mocks.create.mockResolvedValue(session); mocks.session.mockResolvedValue(session);
  render(<TankGarage workspace={{ id: "workspace", slug: "acme" }} userId="user" storageKey="test" storage={storage} />);
  await screen.findByRole("option", { name: "Black Overlord · v1" });
  fireEvent.click(screen.getByRole("button", { name: "Start defense" }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledWith("workspace", expect.objectContaining({ characterId: character.id, revision: 1, contentHash: character.contentHash, mapId: "frontline", mode: "campaign" })));
  await waitFor(() => expect(screen.getByTestId("tank-battlefield")).toHaveAttribute("data-character-id", character.blueprint.id));
  expect(screen.getByTestId("tank-battlefield")).toHaveAttribute("data-phase", "running");
  expect(screen.getByTestId("tank-battlefield")).toHaveAttribute("data-player-speed", "50");
  expect(screen.getByTestId("tank-frozen-character")).toHaveTextContent("Black Overlord · v1");
});

it("keeps a selected character after a failed launch and reuses the request on retry", async () => {
  mocks.search = `character=${character.id}`; mocks.list.mockResolvedValue([character]);
  mocks.create.mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValueOnce(session); mocks.session.mockResolvedValue(session);
  render(<TankGarage workspace={{ id: "workspace", slug: "acme" }} userId="user" storageKey="test" storage={storage} />);
  await screen.findByRole("option", { name: "Black Overlord · v1" });
  fireEvent.click(screen.getByRole("button", { name: "Start defense" }));
  await screen.findAllByRole("alert");
  expect(screen.getByTestId("tank-battlefield")).toHaveAttribute("data-phase", "ready");
  expect(screen.getByRole("combobox", { name: "Character" })).toHaveValue(character.id);
  fireEvent.click(screen.getByRole("button", { name: "Start defense" }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
  expect(mocks.create.mock.calls[1]![1].requestId).toBe(mocks.create.mock.calls[0]![1].requestId);
  await waitFor(() => expect(screen.getByTestId("tank-battlefield")).toHaveAttribute("data-phase", "running"));
});

it("does not start a classic tank when a requested character cannot be loaded", async () => {
  mocks.search = `character=${character.id}`;
  render(<TankGarage workspace={{ id: "workspace", slug: "acme" }} userId="user" storageKey="test" storage={storage} />);
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Start defense" })).toBeDisabled();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(screen.getByTestId("tank-battlefield")).toHaveAttribute("data-phase", "ready");
});

it("keeps a valid frozen character playable independently of the current library", async () => {
  mocks.search = `session=${session.id}`; mocks.session.mockResolvedValue(session);
  render(<TankGarage workspace={{ id: "workspace", slug: "acme" }} userId="user" storageKey="test" storage={storage} />);
  await screen.findByTestId("tank-frozen-character");
  expect(screen.getByRole("combobox", { name: "Character" })).toHaveValue(character.id);
  fireEvent.click(screen.getByRole("button", { name: "Start defense" }));
  expect(screen.getByTestId("tank-battlefield")).toHaveAttribute("data-character-id", character.blueprint.id);
  expect(screen.getByTestId("tank-battlefield")).toHaveAttribute("data-phase", "running");
  expect(mocks.create).not.toHaveBeenCalled();
});

it("uses the latest URL selection when changing characters in the same page", async () => {
  const other = { ...character, id: "33333333-3333-4333-8333-333333333333", draft: { ...draft, name: "Second tank" } };
  mocks.search = `character=${other.id}`; mocks.list.mockResolvedValue([other, character]);
  mocks.create.mockResolvedValue(session); mocks.session.mockResolvedValue(session);
  render(<TankGarage workspace={{ id: "workspace", slug: "acme" }} userId="user" storageKey="test" storage={storage} />);
  await screen.findByRole("option", { name: "Second tank · v1" });
  fireEvent.change(screen.getByRole("combobox", { name: "Character" }), { target: { value: character.id } });
  expect(mocks.replace).toHaveBeenLastCalledWith(`/acme/tanks?character=${character.id}`);
  fireEvent.click(screen.getByRole("button", { name: "Start defense" }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledWith("workspace", expect.objectContaining({ characterId: character.id })));
  await waitFor(() => expect(screen.getByTestId("tank-battlefield")).toHaveAttribute("data-character-id", character.blueprint.id));
});

it("preserves a failed editor draft and retries the same intended save", async () => {
  mocks.save.mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValueOnce({ id: "saved" });
  const saved = vi.fn();
  render(<TankCharacterEditor workspaceId="workspace" open onOpenChange={vi.fn()} character={null} onSaved={saved} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Tank name" }), { target: { value: "My forest tank" } });
  fireEvent.click(screen.getByRole("button", { name: "Save character" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your selection is preserved");
  expect(screen.getByRole("textbox", { name: "Tank name" })).toHaveValue("My forest tank");
  fireEvent.click(screen.getByRole("button", { name: "Save character" })); await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(mocks.save.mock.calls[1]![1].requestId).toBe(mocks.save.mock.calls[0]![1].requestId);
});

it("registers owned training before play and retries the same run before settling an explicit end", async () => {
  const grown = { ...session, progression: { xp: 700 }, loadout: applyTankGrowth(character.blueprint, 700) };
  mocks.search = `session=${session.id}`; mocks.session.mockResolvedValue(grown); mocks.list.mockResolvedValue([{ ...character, progression: { xp: 700 } }]);
  mocks.start.mockRejectedValueOnce(new Error("offline")).mockImplementation((_ws, sessionId, input) => Promise.resolve({ id: input.requestId, sessionId, characterId: character.id, levelId: input.levelId }));
  mocks.settle.mockImplementation((_ws, _session, runId) => Promise.resolve({ runId, characterId: character.id, awardedXp: 0, progression: { xp: 700 } }));
  render(<TankGarage workspace={{ id: "workspace", slug: "acme" }} userId="user" storageKey="test" storage={storage} />);
  await screen.findByText("Lv.5");
  const battlefield = screen.getByTestId("tank-battlefield");
  expect(battlefield).toHaveAttribute("data-player-speed", "56");
  fireEvent.click(screen.getByRole("button", { name: "Modify tank" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Speed 56");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Start defense" }));
  await screen.findByText("Training could not be registered. Start again to retry.");
  expect(battlefield).toHaveAttribute("data-phase", "ready");
  fireEvent.click(screen.getByRole("button", { name: "Start defense" }));
  await waitFor(() => expect(battlefield).toHaveAttribute("data-phase", "running"));
  expect(mocks.start.mock.calls[1]![2].requestId).toBe(mocks.start.mock.calls[0]![2].requestId);
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  fireEvent.click(screen.getByRole("button", { name: "End run" }));
  await waitFor(() => expect(battlefield).toHaveAttribute("data-phase", "ready"));
  expect(mocks.settle).toHaveBeenCalledTimes(1);
  expect(mocks.settle.mock.calls[0]![3]).toEqual({ ticks: 0, kills: 0, outcome: "abandoned" });
});
