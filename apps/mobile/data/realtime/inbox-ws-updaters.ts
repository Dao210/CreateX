import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { inboxKeys } from "@/data/queries/inbox";

async function refreshInboxQuery(qc: QueryClient, queryKey: QueryKey) {
  await qc.cancelQueries({ queryKey });
  await qc.invalidateQueries({ queryKey });
}

/**
 * THE entry point for refreshing the workspace inbox list. Inbox events,
 * mutations and reconnect all go through here. The list's first load is not
 * a one-off: the inbox tab is mounted lazily, so the first visit loads it
 * while notifications keep arriving.
 */
export async function refreshInboxList(qc: QueryClient, wsId: string) {
  await refreshInboxQuery(qc, inboxKeys.list(wsId));
}

/**
 * THE entry point for refreshing the cross-workspace unread summary that backs
 * the tab badge. Mutations, inbox events, issue deletion and reconnect all go
 * through here. Mirrors `onInboxSummaryInvalidate` in
 * packages/core/inbox/ws-updaters.ts.
 */
export async function refreshInboxUnreadSummary(qc: QueryClient) {
  await refreshInboxQuery(qc, inboxKeys.unreadSummary());
}

