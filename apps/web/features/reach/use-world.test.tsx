import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { previewSnapshot } from "./preview";
import { useWorld } from "./use-world";

const api = vi.hoisted(() => ({ fetchSnapshot: vi.fn(), fetchSeason: vi.fn() }));
vi.mock("./api", () => api);
let client: QueryClient;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.fetchSnapshot.mockReset().mockResolvedValue({ ...previewSnapshot(), season: "live-season" });
  api.fetchSeason.mockReset().mockResolvedValue(null);
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });
function wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; }

describe("visible public world", () => {
  it("shows the fixture without requests until the map enters the viewport", async () => {
    const view = renderHook(({ visible }) => useWorld(visible), { wrapper, initialProps: { visible: false } });
    expect(view.result.current.snapshot.season).toBe("preview");
    expect(api.fetchSnapshot).not.toHaveBeenCalled();
    view.rerender({ visible: true });
    await waitFor(() => expect(view.result.current.source).toBe("live"));
    expect(view.result.current.snapshot.season).toBe("live-season");
  });
  it("retains the last valid snapshot if the service fails", async () => {
    const view = renderHook(() => useWorld(true), { wrapper });
    await waitFor(() => expect(view.result.current.source).toBe("live"));
    api.fetchSnapshot.mockResolvedValue(null);
    await act(async () => { await client.refetchQueries({ queryKey: ["public-world", "snapshot"] }); });
    await waitFor(() => expect(view.result.current.source).toBe("paused"));
    expect(view.result.current.snapshot.season).toBe("live-season");
  });
  it("labels failed initial requests as preview data", async () => {
    api.fetchSnapshot.mockResolvedValue(null);
    const view = renderHook(() => useWorld(true), { wrapper });
    await waitFor(() => expect(view.result.current.source).toBe("preview"));
    expect(view.result.current.snapshot.season).toBe("preview");
  });
});
