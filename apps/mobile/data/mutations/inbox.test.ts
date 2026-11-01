// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { useMarkInboxRead } from "./inbox";
import type { InboxItem } from "@auro/core/types";

const state = vi.hoisted(() => ({ client: null as QueryClient | null }));
vi.mock("@tanstack/react-query", async original => ({ ...await original<typeof import("@tanstack/react-query")>(), useQueryClient: () => state.client, useMutation: (options: unknown) => options }));
vi.mock("@/data/api", () => ({ api: { markInboxRead: vi.fn() } }));
vi.mock("@/data/workspace-store", () => ({ useWorkspaceStore: Object.assign((selector: (value: { currentWorkspaceId: string }) => unknown) => selector({ currentWorkspaceId: "w" }), { getState: () => ({ currentWorkspaceId: "w" }) }) }));

describe("mobile navigation-time read", () => {
  it("patches synchronously and restores the pre-patch unread state on failure", async () => {
    const client = new QueryClient();
    state.client = client;
    const key = ["inbox", "w", "list"];
    client.setQueryData(key, [{ id: "n", read: false }]);
    let finish!: () => void;
    vi.spyOn(client, "cancelQueries").mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const mutation = useMarkInboxRead() as unknown as {
      onMutate: (id: string) => Promise<{ prev: InboxItem[]; key: readonly unknown[] }>;
      onError: (error: Error, id: string, context: { prev: InboxItem[]; key: readonly unknown[] }) => void;
    };
    const pending = mutation.onMutate("n");
    expect(client.getQueryData<InboxItem[]>(key)?.[0]?.read).toBe(true);
    finish();
    const context = await pending;
    mutation.onError(new Error("network"), "n", context);
    expect(client.getQueryData<InboxItem[]>(key)?.[0]?.read).toBe(false);
    client.clear();
  });
});
