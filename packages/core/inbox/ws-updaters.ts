import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { inboxKeys } from "./queries";
import type { InboxItem } from "../types";

// Re-read a query because the server changed — in a way that is never answered
// by a request that was already on the wire before the change.
//
// Plain invalidation does not give that guarantee. TanStack only cancels an
// in-flight request on invalidation once the query already holds data —
// `Query.fetch` guards that branch on `state.data !== undefined` and otherwise
// hands back the request already in flight:
//
//     if (this.state.data !== undefined && fetchOptions?.cancelRefetch) {
//       this.cancel({ silent: true })
//     } else if (this.#retryer) {
//       return this.#retryer.promise      // ← the pre-change request
//     }
//
// That branch exists to dedupe concurrent mounts, not to carry freshness. So a
// change that lands during a query's FIRST load is answered by the pre-change
// response, which resolves successfully and clears `isInvalidated`; with
// `staleTime: Infinity` and no refetch on focus, nothing asks again. Cancelling
// first makes a refresh behave the same whether or not the query has loaded.
//
// Every inbox cache is refreshed through here — both lists and the unread
// summary. They are rendered side by side (the badge next to the rows it
// counts), so a hole in either one shows up as the two disagreeing (MUL-6967).
async function refreshInboxQuery(qc: QueryClient, queryKey: QueryKey) {
  await qc.cancelQueries({ queryKey });
  await qc.invalidateQueries({ queryKey });
}

export async function onInboxNew(
  qc: QueryClient,
  wsId: string,
  _item: InboxItem,
) {
  await onInboxInvalidate(qc, wsId);
}

// Refresh both active and archived messages after any inbox change.
export async function onInboxInvalidate(qc: QueryClient, wsId: string) {
  await refreshInboxQuery(qc, inboxKeys.all(wsId));
}

// Refresh account-level counts independently of the active world.
export async function onInboxSummaryInvalidate(qc: QueryClient) {
  await refreshInboxQuery(qc, inboxKeys.unreadSummary());
}
