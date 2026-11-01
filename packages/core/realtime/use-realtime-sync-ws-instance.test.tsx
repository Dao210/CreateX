/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WSClient } from "../api/ws-client";
import { chatKeys } from "../chat/queries";
import { runtimeKeys } from "../runtimes/queries";
import { workspaceKeys } from "../workspace/queries";
import { useRealtimeSync, type RealtimeSyncStores } from "./use-realtime-sync";


vi.mock("../platform/workspace-storage", () => ({
  getCurrentWsId: vi.fn(() => "ws-1"),
  getCurrentSlug: () => "test-ws",
  // Draft stores are now loaded transitively (storage-cleanup → register-all-drafts)
  // so their persist wiring must resolve against this mock.
  createWorkspaceAwareStorage: (adapter: unknown) => adapter,
  registerForWorkspaceRehydration: () => {},
}));

vi.mock("../paths", () => ({
  useHasOnboarded: () => true,
  resolvePostAuthDestination: () => "/",
}));

function createMockWs(): WSClient {
  return {
    on: vi.fn(() => () => {}),
    onAny: vi.fn(() => () => {}),
    onReconnect: vi.fn(() => () => {}),
  } as unknown as WSClient;
}

function createStores(): RealtimeSyncStores {
  return {
    authStore: Object.assign(() => ({}), {
      getState: () => ({ user: { id: "u1" } }),
      subscribe: () => () => {},
      setState: () => {},
      destroy: () => {},
    }),
  } as unknown as RealtimeSyncStores;
}

function createWrapper(qc: QueryClient) {
  // Named function (not arrow) so react/display-name lint rule passes —
  // anonymous render-fn components break that rule even in test files.
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("useRealtimeSync — ws instance change", () => {
  let qc: QueryClient;
  let stores: RealtimeSyncStores;
  let invalidateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    stores = createStores();
    invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  });

  it("skips invalidation on first non-null ws instance", () => {
    const ws = createMockWs();
    renderHook(() => useRealtimeSync(ws, stores), {
      wrapper: createWrapper(qc),
    });

    // The main effect calls invalidateQueries for its own setup, but the
    // ws-instance-change effect should NOT have fired invalidation.
    // The only invalidateQueries calls should come from the main effect's
    // event handlers, not from the instance-change effect.
    // We verify by checking that no call was made with workspaceKeys.list()
    // pattern from the instance-change path (it logs a specific message).
    // Simpler: count calls — first mount with a ws should not trigger the
    // workspace-scoped bulk invalidation.
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("does not invalidate when ws goes from instance to null", () => {
    const ws1 = createMockWs();
    const { rerender } = renderHook(
      ({ ws }) => useRealtimeSync(ws, stores),
      { initialProps: { ws: ws1 as WSClient | null }, wrapper: createWrapper(qc) },
    );

    invalidateSpy.mockClear();
    rerender({ ws: null });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("invalidates exactly once when a new ws instance appears after null gap", async () => {
    const ws1 = createMockWs();
    const { rerender } = renderHook(
      ({ ws }) => useRealtimeSync(ws, stores),
      { initialProps: { ws: ws1 as WSClient | null }, wrapper: createWrapper(qc) },
    );

    // Simulate workspace switch: ws -> null -> new ws
    invalidateSpy.mockClear();
    rerender({ ws: null });
    expect(invalidateSpy).not.toHaveBeenCalled();

    const ws2 = createMockWs();
    rerender({ ws: ws2 });

    // Should have called invalidateQueries for all workspace-scoped keys
    // (16 workspace-scoped [incl. property definitions] + 6 per-issue
    // prefixes + the workspace working-agents projection + 5 per-chat
    // prefixes + 1 workspaceKeys.list() + 1 cross-workspace inbox unread
    // summary = 31 calls).
    //
    // Awaited rather than counted synchronously: the inbox unread summary
    // refresh cancels any in-flight request before invalidating (see
    // onInboxSummaryInvalidate), so that one lands after the synchronous ones.
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(31));
  });

  it("does not re-invalidate when rerendered with the same ws instance", () => {
    const ws1 = createMockWs();
    const { rerender } = renderHook(
      ({ ws }) => useRealtimeSync(ws, stores),
      { initialProps: { ws: ws1 as WSClient | null }, wrapper: createWrapper(qc) },
    );

    invalidateSpy.mockClear();
    // Rerender with same instance
    rerender({ ws: ws1 });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("invalidates agent projections when a daemon changes liveness", () => {
    vi.useFakeTimers();
    try {
      const ws = createMockWs();
      renderHook(() => useRealtimeSync(ws, stores), {
        wrapper: createWrapper(qc),
      });
      const onAny = vi.mocked(ws.onAny).mock.calls[0]?.[0];
      expect(onAny).toBeDefined();

      invalidateSpy.mockClear();
      onAny!({ type: "daemon:register", payload: {} } as never);
      vi.advanceTimersByTime(100);

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: runtimeKeys.all("ws-1"),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: workspaceKeys.agents("ws-1"),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("invalidates per-issue caches (no wsId in key) on ws instance change", () => {
    // These keys are not under the ["issues", wsId] prefix, so they need
    // their own invalidation on recovery — otherwise events missed while
    // disconnected leave them stale forever (staleTime: Infinity, #3953).
    const ws1 = createMockWs();
    const { rerender } = renderHook(
      ({ ws }) => useRealtimeSync(ws, stores),
      { initialProps: { ws: ws1 as WSClient | null }, wrapper: createWrapper(qc) },
    );

    invalidateSpy.mockClear();
    rerender({ ws: null });

    const ws2 = createMockWs();
    rerender({ ws: ws2 });

    const calls = invalidateSpy.mock.calls.map((call: [{ queryKey?: unknown }, ...unknown[]]) => call[0].queryKey);
    expect(calls).toContainEqual(["issues", "timeline"]);
    expect(calls).toContainEqual(["issues", "reactions"]);
    expect(calls).toContainEqual(["issues", "subscribers"]);
    expect(calls).toContainEqual(["issues", "usage"]);
    expect(calls).toContainEqual(["issues", "attachments"]);
    expect(calls).toContainEqual(["issues", "tasks"]);
  });

  it("invalidates per-chat-session caches (no wsId in key) on ws instance change", () => {
    // These keys are not under the ["chat", wsId] prefix, so they need their
    // own recovery invalidation when reconnecting after missed chat/task events.
    const ws1 = createMockWs();
    const { rerender } = renderHook(
      ({ ws }) => useRealtimeSync(ws, stores),
      { initialProps: { ws: ws1 as WSClient | null }, wrapper: createWrapper(qc) },
    );

    invalidateSpy.mockClear();
    rerender({ ws: null });

    const ws2 = createMockWs();
    rerender({ ws: ws2 });

    const calls = invalidateSpy.mock.calls.map((call: [{ queryKey?: unknown }, ...unknown[]]) => call[0].queryKey);
    expect(calls).toContainEqual(["chat", "messages"]);
    expect(calls).toContainEqual(["chat", "messages-page"]);
    expect(calls).toContainEqual(["chat", "pending-task"]);
    expect(calls).toContainEqual(["task-messages"]);
  });

  it("invalidates per-chat-session caches after an established ws reconnects", () => {
    const ws = createMockWs();
    renderHook(() => useRealtimeSync(ws, stores), {
      wrapper: createWrapper(qc),
    });
    const reconnect = vi.mocked(ws.onReconnect).mock.calls[0]?.[0];
    expect(reconnect).toBeDefined();

    invalidateSpy.mockClear();
    reconnect!();

    const calls = invalidateSpy.mock.calls.map((call: [{ queryKey?: unknown }, ...unknown[]]) => call[0].queryKey);
    expect(calls).toContainEqual(chatKeys.messagesAll());
    expect(calls).toContainEqual(chatKeys.messagesPageAll());
    expect(calls).toContainEqual(chatKeys.pendingTaskAll());
  });

  it("ignores removed DingTalk group-route events", () => {
    const ws = createMockWs();
    renderHook(() => useRealtimeSync(ws, stores), {
      wrapper: createWrapper(qc),
    });
    const onAny = vi.mocked(ws.onAny).mock.calls[0]?.[0];
    expect(onAny).toBeDefined();

    onAny!({ type: "dingtalk_group_route:updated", payload: {} } as never);

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("invalidates the current workspace chat list when a channel creates a session", () => {
    const ws = createMockWs();
    renderHook(() => useRealtimeSync(ws, stores), {
      wrapper: createWrapper(qc),
    });
    const sessionCreated = vi
      .mocked(ws.on)
      .mock.calls.find(([event]) => event === "chat:session_created")?.[1];
    expect(sessionCreated).toBeDefined();

    (sessionCreated as (payload: unknown) => void)({
      workspace_id: "ws-1",
      chat_session_id: "channel-session-1",
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: chatKeys.sessions("ws-1"),
    });

		invalidateSpy.mockClear();
		(sessionCreated as (payload: unknown) => void)({
			workspace_id: "ws-2",
			chat_session_id: "other-workspace-session",
		});
		expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("useRealtimeSync — queued chat promotion", () => {
  it("refetches the transcript when a queued prompt starts running", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ws = createMockWs();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useRealtimeSync(ws, createStores()), {
      wrapper: createWrapper(qc),
    });
    const dispatch = vi
      .mocked(ws.on)
      .mock.calls.find(([event]) => event === "task:dispatch")?.[1];
    expect(dispatch).toBeDefined();

    invalidate.mockClear();
    (dispatch as (payload: unknown) => void)({
      task_id: "task-follow-up",
      chat_session_id: "session-1",
    });

    expect(invalidate).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatKeys.messages("session-1"),
    }, { cancelRefetch: false }));
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatKeys.messagesPage("session-1"),
    }, { cancelRefetch: false });
  });
});

