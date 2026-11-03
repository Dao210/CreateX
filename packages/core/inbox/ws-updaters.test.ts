// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  onInboxInvalidate,
  onInboxNew,
  onInboxSummaryInvalidate,
} from "./ws-updaters";
import { inboxKeys } from "./queries";
import type { InboxItem } from "../types";

const wsId = "ws-1";

function makeItem(
  id: string,
  _retiredContext: string | null,
  overrides: Partial<InboxItem> = {},
): InboxItem {
  return {
    id,
    workspace_id: wsId,
    recipient_type: "member",
    recipient_id: "user-1",
    actor_type: null,
    actor_id: null,
    type: "mentioned",
    severity: "info",
    title: `item ${id}`,
    body: null,
    read: false,
    archived: false,
    created_at: "2025-01-01T00:00:00Z",
    details: null,
    ...overrides,
  };
}

describe("onInboxInvalidate", () => {
  it("invalidates the workspace prefix, covering both the main and archived lists", async () => {
    // Every inbox event can move an item across the two lists, so they are
    // always refreshed together (MUL-3736).
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    await onInboxInvalidate(qc, wsId);

    expect(spy).toHaveBeenCalledWith({ queryKey: inboxKeys.all(wsId) });
  });

  it("does not reach the account-level summary key", async () => {
    // The summary is keyed ["inbox", "unread-summary"], NOT under the
    // workspace prefix — its own updater owns it.
    const qc = new QueryClient();
    qc.setQueryData(inboxKeys.unreadSummary(), [{ workspace_id: wsId, count: 3 }]);
    const summaryQuery = qc
      .getQueryCache()
      .find({ queryKey: inboxKeys.unreadSummary() });

    await onInboxInvalidate(qc, wsId);

    expect(summaryQuery?.state.isInvalidated).toBe(false);
  });
});

describe("onInboxInvalidate ordering", () => {
  it("cancels the in-flight list request BEFORE invalidating", async () => {
    // Same reason as the summary: a change during the list's first load must
    // not be answered by the request already on the wire. See the MUL-6967
    // regression at the bottom of this file for the end-to-end sequence.
    const qc = new QueryClient();
    const calls: string[] = [];
    vi.spyOn(qc, "cancelQueries").mockImplementation(async () => {
      calls.push("cancel");
    });
    vi.spyOn(qc, "invalidateQueries").mockImplementation(async () => {
      calls.push("invalidate");
    });

    await onInboxInvalidate(qc, wsId);

    expect(calls).toEqual(["cancel", "invalidate"]);
  });
});

describe("onInboxSummaryInvalidate", () => {
  it("invalidates the account-level summary key regardless of active workspace", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    await onInboxSummaryInvalidate(qc);

    expect(spy).toHaveBeenCalledWith({ queryKey: inboxKeys.unreadSummary() });
  });

  it("cancels an in-flight summary request BEFORE invalidating", async () => {
    // Order is the whole point. TanStack skips its own cancel on a first fetch
    // (`Query.fetch` guards it on `state.data !== undefined`) and hands back
    // the request already on the wire, whose success then clears
    // `isInvalidated` — so invalidating without cancelling first can be
    // answered by a pre-change response and never asked again (MUL-6967).
    const qc = new QueryClient();
    const calls: string[] = [];
    vi.spyOn(qc, "cancelQueries").mockImplementation(async () => {
      calls.push("cancel");
    });
    vi.spyOn(qc, "invalidateQueries").mockImplementation(async () => {
      calls.push("invalidate");
    });

    await onInboxSummaryInvalidate(qc);

    expect(calls).toEqual(["cancel", "invalidate"]);
  });

  it("cancels only the summary key, never a workspace inbox list", async () => {
    // A list request in flight for the active workspace must survive: the
    // cancel is aimed at the account-level summary alone.
    const qc = new QueryClient();
    const cancel = vi.spyOn(qc, "cancelQueries");
    qc.setQueryData<InboxItem[]>(inboxKeys.list(wsId), [makeItem("i1", "issue-a")]);

    await onInboxSummaryInvalidate(qc);

    expect(cancel).toHaveBeenCalledWith({ queryKey: inboxKeys.unreadSummary() });
    expect(cancel).not.toHaveBeenCalledWith({ queryKey: inboxKeys.list(wsId) });
    // The list cache entry is untouched (different key); only the summary
    // query is marked stale.
    expect(qc.getQueryData<InboxItem[]>(inboxKeys.list(wsId))?.[0]?.id).toBe("i1");
  });
});

// MUL-6967 regression: the inbox list must pick up a change that happens while
// its FIRST load is still in flight. Plain invalidation cannot do that —
// TanStack only cancels an in-flight request on invalidation once the query
// holds data, and otherwise answers the refetch with the request already on
// the wire. That pre-change response then clears `isInvalidated`, and with
// `staleTime: Infinity` nothing asks again, so the list stays behind while the
// badge (whose refresh already cancels first) moves on — "2 unread" over a list
// with nothing unread. The first load is not rare: nothing outside the Inbox
// page observes the list, so on web every visit after the cache is collected
// is a first load again.
describe("inbox list refresh during the first load", () => {
  it.each([
    ["new notification", (qc: QueryClient) => onInboxNew(qc, wsId, makeItem("n2", "issue-b"))],
    ["read / archive event", (qc: QueryClient) => onInboxInvalidate(qc, wsId)],
  ])("re-reads the list after a %s arrives mid-load", async (_label, signal) => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    let releaseFirst!: (rows: InboxItem[]) => void;
    const firstResponse = new Promise<InboxItem[]>((resolve) => {
      releaseFirst = resolve;
    });
    let server: InboxItem[] = [makeItem("n1", "issue-a", { read: true })];
    const queryFn = vi
      .fn<() => Promise<InboxItem[]>>()
      .mockImplementationOnce(() => firstResponse)
      .mockImplementation(async () => server);
    const observer = new QueryObserver(qc, { queryKey: inboxKeys.list(wsId), queryFn });
    const unsubscribe = observer.subscribe(() => {});

    try {
      expect(queryFn).toHaveBeenCalledTimes(1);
      // The server changes while the first read is still on the wire...
      server = [makeItem("n2", "issue-b", { read: false }), ...server];
      await signal(qc);
      // ...and only then does the pre-change response land.
      releaseFirst([makeItem("n1", "issue-a", { read: true })]);

      await vi.waitFor(() =>
        expect(qc.getQueryData<InboxItem[]>(inboxKeys.list(wsId))?.map((i) => i.id)).toEqual([
          "n2",
          "n1",
        ]),
      );
      expect(queryFn.mock.calls.length).toBeGreaterThan(1);
    } finally {
      releaseFirst([]);
      unsubscribe();
      qc.clear();
    }
  });
});
