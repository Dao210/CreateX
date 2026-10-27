import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
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
const mocks = vi.hoisted(() => ({ list: vi.fn(), progress: vi.fn(), library: vi.fn() }));

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
  api: { listTankCharacters: mocks.list, getGameProgress: mocks.progress },
}));
vi.mock("@auro/core/siege/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@auro/core/siege/queries")>()),
  createSiegeClient: () => ({ library: mocks.library }),
}));
vi.mock("../navigation", () => ({
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

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
  mocks.list.mockResolvedValue([character("MCP Tank", "mcp"), character("Manual Tank", "manual", ids.manualCharacter)]);
  mocks.library.mockResolvedValue({ blueprints: [blueprint()] });
  mocks.progress.mockResolvedValue({ workspaceId: ids.workspace, siege: { stars: [3, 0, 0, 0, 0, 0, 0, 0], updatedAt: "2026-10-27T00:00:00Z" }, tanks: { best: 900, unlocked: 3, updatedAt: "2026-10-27T00:00:00Z" } });
});

describe("my space", () => {
  it("shows MCP-created tanks, saved blueprints and the merged progress", async () => {
    render(<MePage storage={storage().adapter} />);
    expect(await screen.findByText("MCP Tank")).toBeInTheDocument();
    expect(screen.getByText("Test Cannon")).toBeInTheDocument();
    expect(screen.getByText("MCP")).toBeInTheDocument();
    expect(screen.getAllByText("3 / 24").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/000900/).length).toBeGreaterThan(0);
    expect(screen.getByText("3 / 24 stars")).toBeInTheDocument();
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
