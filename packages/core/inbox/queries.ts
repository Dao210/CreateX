import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { ArchivedInboxPage } from "../types/inbox";
import { EMPTY_INBOX_FILTERS, type InboxFilters } from "./filter-store";
import { infiniteQueryOptions, queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { InboxItem, InboxWorkspaceUnread } from "../types";

export const inboxKeys = {
  all: (wsId: string) => ["inbox", wsId] as const,
  list: (wsId: string) => [...inboxKeys.all(wsId), "list"] as const,
  archived: (wsId: string) => [...inboxKeys.all(wsId), "archived"] as const,
  pages: (wsId: string) => [...inboxKeys.archived(wsId), "pages"] as const,
  lookup: (wsId: string) => [...inboxKeys.archived(wsId), "lookup"] as const,
  facets: (wsId: string) => [...inboxKeys.all(wsId), "archived-facets"] as const,
  // Account-level (not workspace-scoped): a single shared cache entry that
  // holds unread counts for every workspace the user belongs to.
  unreadSummary: () => ["inbox", "unread-summary"] as const,
};

export function inboxListOptions(wsId: string) {
  return queryOptions({
    queryKey: inboxKeys.list(wsId),
    queryFn: () => api.listInbox(),
  });
}

/**
 * @deprecated Legacy array endpoint, capped at 200 groups. New archive
 * consumers must use archivedInboxPagesOptions for the complete archive.
 * Retained for compatibility with legacy cache consumers.
 */
export function archivedInboxListOptions(wsId: string) {
  return queryOptions({
    queryKey: inboxKeys.archived(wsId),
    queryFn: () => api.listArchivedInbox(),
  });
}

function normalizedInboxFilters(filters: InboxFilters): InboxFilters {
  return { actors: [...filters.actors].sort(), unreadOnly: filters.unreadOnly };
}

export function archivedInboxPagesOptions(wsId: string, filters: InboxFilters) {
  return infiniteQueryOptions({
    queryKey: [...inboxKeys.pages(wsId), normalizedInboxFilters(filters)],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => api.listArchivedInboxPage(filters, { cursor: pageParam, signal }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
}

export function archivedInboxLookupOptions(wsId: string, groupId: string, filters: InboxFilters = EMPTY_INBOX_FILTERS) {
  return queryOptions({
    queryKey: [...inboxKeys.lookup(wsId), groupId, normalizedInboxFilters(filters)],
    queryFn: ({ signal }) => api.listArchivedInboxPage(filters, { groupId, signal }),
    enabled: !!groupId,
    retry: false,
  });
}

export function archivedInboxFacetsOptions(wsId: string, filters: InboxFilters) {
  return queryOptions({
    queryKey: [...inboxKeys.facets(wsId), normalizedInboxFilters(filters)],
    queryFn: ({ signal }) => api.getArchivedInboxFacets(filters, signal),
    retry: false,
  });
}

export type ArchivedInboxCache = InboxItem[] | ArchivedInboxPage | InfiniteData<ArchivedInboxPage>;

export function mapArchivedInboxCache(data: ArchivedInboxCache, patch: (items: InboxItem[]) => InboxItem[]): ArchivedInboxCache {
  if (Array.isArray(data)) return patch(data);
  if ("pages" in data) return { ...data, pages: data.pages.map((page) => ({ ...page, items: patch(page.items) })) };
  return { ...data, items: patch(data.items) };
}

export function patchArchivedInboxCaches(qc: QueryClient, wsId: string, patch: (items: InboxItem[]) => InboxItem[]) {
  const snapshot = qc.getQueriesData<ArchivedInboxCache>({ queryKey: inboxKeys.archived(wsId) });
  for (const [key, data] of snapshot) {
    if (data) qc.setQueryData(key, mapArchivedInboxCache(data, patch));
  }
  return snapshot;
}

/**
 * Cross-workspace unread inbox summary. One cache entry shared across all
 * workspaces — the data is account-level, so switching workspaces does not
 * refetch it; only the derived "is this for another workspace" view changes.
 */
export function inboxUnreadSummaryOptions() {
  return queryOptions({
    queryKey: inboxKeys.unreadSummary(),
    queryFn: () => api.getInboxUnreadSummary(),
  });
}

/**
 * Whether any workspace OTHER than `currentWsId` has unread inbox items.
 * Drives the workspace-switcher dot: the active workspace's own unread is
 * already surfaced by the Inbox nav count, so it is excluded here to avoid a
 * duplicate signal.
 */
export function hasOtherWorkspaceUnread(
  summary: InboxWorkspaceUnread[],
  currentWsId: string | null | undefined,
): boolean {
  return summary.some((s) => s.workspace_id !== currentWsId && s.count > 0);
}

/**
 * Set of workspace ids that have unread inbox items. Lets the workspace
 * switcher dropdown mark WHICH workspace a pending message lives in (the
 * aggregate switcher dot only says "somewhere else"). Workspaces with a zero
 * count are excluded.
 */
export function unreadWorkspaceIds(summary: InboxWorkspaceUnread[]): Set<string> {
  return new Set(summary.filter((s) => s.count > 0).map((s) => s.workspace_id));
}

/**
 * Unread inbox count for one workspace within the cross-workspace summary.
 * A workspace with nothing unread is absent from the response entirely, so a
 * missing entry means zero rather than "not loaded yet".
 */
export function unreadCountForWorkspace(
  summary: InboxWorkspaceUnread[],
  wsId: string | null | undefined,
): number {
  if (!wsId) return 0;
  return summary.find((s) => s.workspace_id === wsId)?.count ?? 0;
}

/**
 * Unread inbox count for the given workspace — the number the sidebar nav
 * badge and the desktop dock badge render.
 *
 * Read from the cross-workspace summary, NOT from the inbox list. The summary
 * is one small server-computed row per workspace and the sidebar already
 * fetches it for the workspace-switcher dot, so the badge costs no request of
 * its own; deriving it from `listInbox()` instead downloaded the entire
 * unbounded inbox on every app start just to render a number (MUL-6967).
 *
 */
export function useInboxUnreadCount(wsId: string | null | undefined): number {
  const { data } = useQuery({
    ...inboxUnreadSummaryOptions(),
    enabled: !!wsId,
    select: (summary: InboxWorkspaceUnread[]) =>
      unreadCountForWorkspace(summary, wsId),
  });
  return data ?? 0;
}

/** Select active messages and keep the server's newest-first order. */
export function deduplicateInboxItems(items: InboxItem[]): InboxItem[] {
  return items.filter((item) => !item.archived);
}
export function deduplicateArchivedInboxItems(items: InboxItem[]): InboxItem[] {
  return items.filter((item) => item.archived);
}
