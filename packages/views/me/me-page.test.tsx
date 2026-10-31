import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactElement } from "react";
import { renderWithI18n } from "../test/i18n";
import { MePage } from "./me-page";
import { compileTankCharacter, tankPreferencesKey, type TankCharacterDraft } from "@auro/core/tank-defense";
import { DEFAULT_CANNON, RULES_VERSION, SIEGE_CAMPAIGN_PROGRESS_KEY, createCannonDrawing, createCannonSpec, siegePreferencesKey } from "@auro/core/siege";

const ids = {
  user: "11111111-1111-4111-8111-111111111111",
  workspace: "22222222-2222-4222-8222-222222222222",
  character: "33333333-3333-4333-8333-333333333333",
  manualCharacter: "66666666-6666-4666-8666-666666666666",
  blueprint: "44444444-4444-4444-8444-444444444444",
  session: "55555555-5555-4555-8555-555555555555",
};
const workspace = { id: ids.workspace, name: "Acme", slug: "acme" };
const mocks = vi.hoisted(() => ({ list: vi.fn(), progress: vi.fn(), library: vi.fn(), create: vi.fn(), push: vi.fn(), replace: vi.fn(), search: "", hash: "" }));

vi.mock("@auro/core/auth", () => ({
  useAuthStore: (selector: (state: { user: { id: string; name: string; avatar_url: string | null } }) => unknown) => selector({ user: { id: "11111111-1111-4111-8111-111111111111", name: "Ada", avatar_url: null } }),
}));
vi.mock("@auro/core/paths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@auro/core/paths")>()),
  useCurrentWorkspace: () => workspace,
  useWorkspacePaths: () => ({ settings: () => "/acme/settings", siege: () => "/acme/siege", tanks: () => "/acme/tanks" }),
}));
vi.mock("@auro/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@auro/core/api")>()),
  api: { listTankCharacters: mocks.list, getGameProgress: mocks.progress, createTankSession: mocks.create },
}));
vi.mock("@auro/core/siege/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@auro/core/siege/queries")>()),
  createSiegeClient: () => ({ library: mocks.library }),
}));
vi.mock("../navigation", async () => {
  const { useState } = await import("react");
  return {
    AppLink: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
    useNavigation: () => {
      const [search, setSearch] = useState(mocks.search);
      return {
        pathname: "/acme/me", searchParams: new URLSearchParams(search), hash: mocks.hash,
        push: mocks.push,
        replace: (path: string) => {
          mocks.replace(path);
          setSearch(path.split("?")[1]?.split("#")[0] ?? "");
        },
      };
    },
  };
});

function draft(name: string): TankCharacterDraft {
  const value: TankCharacterDraft = {
    profile: "tank-defense@1",
    name,
    parts: { chassis: "light", armor: "standard", cannon: "rapid" },
    appearance: { body: "#26b36a", accent: "#e5f79b", pattern: "stripe" },
  };
  return value;
}
function character(name: string, origin: "manual" | "mcp", id = ids.character) {
  const value = draft(name);
  const compiled = compileTankCharacter(value, `${id}@1`);
  return { id, revision: 1, workspaceId: ids.workspace, ownerId: ids.user, rulesVersion: 1 as const, compilerVersion: 1 as const, contentHash: `sha256:${"a".repeat(64)}`, draft: value, blueprint: compiled.blueprint, cost: compiled.cost, origin, createdAt: "2026-10-20T00:00:00Z" };
}
function blueprint() {
  const drawing = createCannonDrawing(DEFAULT_CANNON);
  const spec = createCannonSpec(drawing, "0".repeat(64));
  return { id: ids.blueprint, sessionId: ids.session, name: "Test Cannon", drawing, spec, cannonDesign: DEFAULT_CANNON, rulesVersion: RULES_VERSION, createdAt: "2026-10-21T00:00:00Z" };
}
function storage() {
  const values = new Map<string, string>();
  const adapter = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  values.set(tankPreferencesKey(ids.user, ids.workspace), JSON.stringify({ version: 1, best: 500, unlocked: 2, sound: true, difficulty: "casual" }));
  values.set(`${siegePreferencesKey(ids.user, ids.workspace)}:${SIEGE_CAMPAIGN_PROGRESS_KEY}`, JSON.stringify({ version: 1, stars: [1, 0, 0, 0, 0, 0, 0, 0], sound: true, volume: 0.5, speed: 1, selectedLevel: 1 }));
  return { values, adapter };
}
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return renderWithI18n(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  mocks.search = "";
  mocks.hash = "";
  mocks.list.mockResolvedValue([character("MCP Tank", "mcp"), character("Manual Tank", "manual", ids.manualCharacter)]);
  mocks.library.mockResolvedValue({ blueprints: [blueprint()] });
  mocks.progress.mockResolvedValue({ workspaceId: ids.workspace, siege: { stars: [3, 0, 0, 0, 0, 0, 0, 0], updatedAt: "2026-10-27T00:00:00Z" }, tanks: { best: 900, unlocked: 3, updatedAt: "2026-10-27T00:00:00Z" } });
});

describe("my creations", () => {
  it("shows the tank's permanent level and grown deployment stats", async () => {
    mocks.list.mockResolvedValue([{ ...character("Sky", "mcp"), progression: { xp: 700 } }]);
    render(<MePage storage={storage().adapter} />);
    const card = await screen.findByRole("group", { name: "Sky" });
    expect(within(card).getByText("Lv.5")).toBeInTheDocument();
    expect(within(card).getByText("Speed 104 · Armor 2 · Cooldown 14")).toBeInTheDocument();
    expect(within(card).getByRole("progressbar")).toBeInTheDocument();
  });
  it("launches the chosen creation into a frozen session and preserves retry after failure", async () => {
    const selected = character("MCP Tank", "mcp");
    const session = { id: ids.session, ownerId: ids.user, playPath: `/acme/tanks?session=${ids.session}` };
    mocks.create.mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValueOnce(session);
    render(<MePage storage={storage().adapter} />);
    const card = within(await screen.findByRole("group", { name: "MCP Tank" }));
    expect(card.getByRole("img", { name: "MCP Tank" }).tagName).toBe("CANVAS");
    fireEvent.click(card.getByRole("button", { name: "Play" }));
    expect(await card.findByRole("alert")).toHaveTextContent("Your selection is preserved");
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(card.getByRole("button", { name: "Play" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(session.playPath));
    expect(mocks.create).toHaveBeenCalledWith(ids.workspace, expect.objectContaining({ characterId: selected.id, revision: selected.revision, contentHash: selected.contentHash, mapId: "frontline", mode: "campaign" }));
    expect(mocks.create.mock.calls[1]![1].requestId).toBe(mocks.create.mock.calls[0]![1].requestId);
  });

  it("shows MCP-created tanks, saved blueprints and the merged progress", async () => {
    render(<MePage storage={storage().adapter} />);
    expect(await screen.findByText("MCP Tank")).toBeInTheDocument();
    expect(screen.getByText("Test Cannon")).toBeInTheDocument();
    expect(screen.getByText("MCP")).toBeInTheDocument();
    expect(screen.getAllByText("3 / 24").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/000900/).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "My Creations" })).toBeInTheDocument();
    expect(screen.getByText("Current world: Acme")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ada" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Creations", selected: true })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Continue campaign" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Game progress" }));
    expect(screen.getByText("3 / 24 stars")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue campaign" })).toHaveAttribute("href", "/acme/siege/campaign?level=2");
    expect(mocks.replace).toHaveBeenLastCalledWith("/acme/me?tab=progress");
  });

  it("opens a linked progress tab and preserves the filter, other parameters and fragment", async () => {
    mocks.search = "tab=progress&filter=mcp&source=shared";
    mocks.hash = "#collection";
    render(<MePage storage={storage().adapter} />);
    expect(await screen.findByText("3 / 24 stars")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Creations" }));
    expect(mocks.replace).toHaveBeenLastCalledWith("/acme/me?filter=mcp&source=shared#collection");
    expect(screen.getByText("MCP Tank")).toBeInTheDocument();
    expect(screen.queryByText("Manual Tank")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(mocks.replace).toHaveBeenLastCalledWith("/acme/me?source=shared#collection");
    expect(screen.getByText("Manual Tank")).toBeInTheDocument();
  });

  it("filters the collection to MCP-created content", async () => {
    render(<MePage storage={storage().adapter} />);
    await screen.findByText("Manual Tank");
    fireEvent.click(screen.getByRole("button", { name: "Created via MCP" }));
    expect(screen.queryByText("Manual Tank")).not.toBeInTheDocument();
    expect(screen.getByText("MCP Tank")).toBeInTheDocument();
  });

  it("shows an empty state for the active filter", async () => {
    mocks.list.mockResolvedValue([]);
    mocks.library.mockResolvedValue({ blueprints: [] });
    render(<MePage storage={storage().adapter} />);
    expect(await screen.findByText("Create one in the workshop or garage, or connect an agent through MCP.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tank Defense" }));
    expect(await screen.findByText("No tank characters yet.")).toBeInTheDocument();
    expect(screen.queryByText("Create one in the workshop or garage, or connect an agent through MCP.")).not.toBeInTheDocument();
  });
});
