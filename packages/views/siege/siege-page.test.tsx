import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { SiegePlatform } from "@auro/core/siege";
import { scopedSiegeStorage, siegePreferencesKey } from "@auro/core/siege";
import type { StorageAdapter } from "@auro/core/types";
import { renderWithI18n } from "../test/i18n";
import { SiegePage } from "./siege-page";

const identity = vi.hoisted(() => ({ userId: "alice" as string | null, workspace: { id: "alpha-id", slug: "alpha" } as { id: string; slug: string } | null }));
vi.mock("@auro/core/auth", () => ({ useAuthStore: Object.assign((selector: (state: { user: { id: string } | null }) => unknown) => selector({ user: identity.userId ? { id: identity.userId } : null }), { getState: () => ({ user: identity.userId ? { id: identity.userId } : null }) }) }));
vi.mock("@auro/core/paths", () => ({ useCurrentWorkspace: () => identity.workspace }));
vi.mock("../navigation", () => ({ AppLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("./platform/web", () => ({ createWebSiegePlatform: (storage: StorageAdapter, namespace: string) => ({ preferences: scopedSiegeStorage(storage, namespace) }) }));
vi.mock("./siege-workshop", () => ({ SiegeWorkshop: ({ platform }: { platform: SiegePlatform }) => {
  const [value, setValue] = useState(() => platform.preferences.getItem("draft") ?? "new");
  return <button onClick={() => { platform.preferences.setItem("draft", "edited"); setValue("edited"); }}>{value}</button>;
} }));

beforeEach(() => { identity.userId = "alice"; identity.workspace = { id: "alpha-id", slug: "alpha" }; });
function records() {
  const values = new Map<string, string>();
  const storage = { getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value); }), removeItem: vi.fn((key: string) => { values.delete(key); }) };
  return { storage, values };
}
it("remounts local state and reloads scoped records after account or workspace changes", async () => {
  const { storage, values } = records();
  const ownerKey = `${siegePreferencesKey("alice", "alpha-id")}:draft`;
  values.set(ownerKey, "saved");
  const view = renderWithI18n(<SiegePage storage={storage} />);
  fireEvent.click(await screen.findByRole("button", { name: "saved" }));
  expect(values.get(ownerKey)).toBe("edited");
  identity.workspace = { id: "beta-id", slug: "beta" }; view.rerender(<SiegePage storage={storage} />);
  expect(await screen.findByRole("button", { name: "new" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Woodland campaign" })).toHaveAttribute("href", "/beta/siege/campaign");
  fireEvent.click(screen.getByRole("button", { name: "new" }));
  identity.userId = "bob"; view.rerender(<SiegePage storage={storage} />);
  expect(await screen.findByRole("button", { name: "new" })).toBeInTheDocument();
  expect(values.get(ownerKey)).toBe("edited");
});
it.each(["account", "workspace"])("does not touch storage before the %s resolves", missing => {
  if (missing === "account") identity.userId = null; else identity.workspace = null;
  const { storage } = records(); renderWithI18n(<SiegePage storage={storage} />);
  expect(screen.queryByTestId("siege-page")).not.toBeInTheDocument();
  expect(storage.getItem).not.toHaveBeenCalled(); expect(storage.setItem).not.toHaveBeenCalled();
});
