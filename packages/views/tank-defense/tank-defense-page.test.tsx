import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { tankPreferencesKey } from "@auro/core/tank-defense";
import type { StorageAdapter } from "@auro/core/types";
import { renderWithI18n } from "../test/i18n";
import { TankDefensePage } from "./tank-defense-page";

const identity = vi.hoisted(() => ({
  userId: "user-1" as string | null,
  workspace: { id: "workspace-1" } as { id: string } | null,
}));

vi.mock("@auro/core/auth", () => ({
  useAuthStore: Object.assign(
    (selector: (state: { user: { id: string } | null }) => unknown) => selector({ user: identity.userId ? { id: identity.userId } : null }),
    { getState: () => ({ user: identity.userId ? { id: identity.userId } : null }) },
  ),
}));
vi.mock("@auro/core/paths", () => ({ useCurrentWorkspace: () => identity.workspace }));
// This suite owns identity/persistence; the garage owns its server queries.
vi.mock("./tank-garage", async () => {
  const { TankBattle } = await import("./tank-battle");
  return { TankGarage: ({ storage, storageKey }: { storage: StorageAdapter; storageKey: string }) => <TankBattle storage={storage} storageKey={storageKey} /> };
});

function records() {
  const values = new Map<string, string>();
  const storage: StorageAdapter = {
    getItem: vi.fn(key => values.get(key) ?? null),
    setItem: vi.fn((key, value) => { values.set(key, value); }),
    removeItem: vi.fn(key => { values.delete(key); }),
  };
  return { storage, values };
}

beforeEach(() => {
  identity.userId = "user-1";
  identity.workspace = { id: "workspace-1" };
  // These tests own identity/persistence wiring. Browser tests own Canvas and input.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

describe("workspace tank defense page", () => {
  it("starts a fresh battle and reloads the right records on account or workspace changes", () => {
    const { storage, values } = records();
    const ownerKey = tankPreferencesKey("user-1", "workspace-1");
    values.set(ownerKey, JSON.stringify({ version: 1, best: 9000, unlocked: 3, sound: false }));
    values.set(tankPreferencesKey("user-2", "workspace-2"), JSON.stringify({ version: 1, best: 300, unlocked: 2, sound: true }));
    const view = renderWithI18n(<TankDefensePage storage={storage} />);
    expect(screen.getByTestId("tank-best")).toHaveTextContent("009000");
    fireEvent.click(screen.getByRole("button", { name: "Start defense" }));
    expect(screen.getByTestId("tank-battlefield")).toHaveAttribute("data-phase", "running");

    identity.userId = "user-2";
    view.rerender(<TankDefensePage storage={storage} />);
    expect(screen.getByTestId("tank-battlefield")).toHaveAttribute("data-phase", "ready");
    expect(screen.getByTestId("tank-best")).toHaveTextContent("000000");
    expect(screen.getByRole("button", { name: /Frozen Crossing/ })).toBeDisabled();

    identity.workspace = { id: "workspace-2" };
    view.rerender(<TankDefensePage storage={storage} />);
    expect(screen.getByTestId("tank-best")).toHaveTextContent("000300");
    expect(screen.getByRole("button", { name: /Frozen Crossing/ })).toBeEnabled();
    expect(JSON.parse(values.get(ownerKey)!).best).toBe(9000);
  });

  it("writes preferences only to the current account and workspace", () => {
    const { storage, values } = records();
    renderWithI18n(<TankDefensePage storage={storage} />);
    fireEvent.click(screen.getByRole("button", { name: "Mute sound" }));
    expect([...values.keys()]).toEqual([tankPreferencesKey("user-1", "workspace-1")]);
    expect(JSON.parse([...values.values()][0]!).sound).toBe(false);
  });

  it.each(["account", "workspace"])("does not read or create records before the %s resolves", unresolved => {
    if (unresolved === "account") identity.userId = null;
    else identity.workspace = null;
    const { storage } = records();
    renderWithI18n(<TankDefensePage storage={storage} />);
    expect(screen.queryByTestId("tank-defense-page")).not.toBeInTheDocument();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("still permits a game when device storage is unavailable", () => {
    const unavailable = () => { throw new Error("Storage blocked"); };
    renderWithI18n(<TankDefensePage storage={{ getItem: unavailable, setItem: unavailable, removeItem: unavailable }} />, { locale: "zh-Hans" });
    expect(screen.getByRole("heading", { name: "坦克守城" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始守卫" })).toBeEnabled();
  });
});
