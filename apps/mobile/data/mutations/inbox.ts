/**
 * Mobile inbox mutations. Mirrors the optimistic-update + invalidate pattern
 * of packages/core/inbox/mutations.ts — written here in mobile-owned code
 * per Sharing Principles (no runtime imports from @auro/core mutations).
 *
 * Behavioral parity:
 *   - mark-read: flip `read` to true locally; rollback on error; settle invalidate.
 *     `onMutate` writes setQueryData BEFORE awaiting cancelQueries — this is
 *     load-bearing for iOS Stack push transitions: when the user taps an
 *     inbox row and we router.push to inbox/[id], iOS captures a snapshot of
 *     the source view for the slide animation; if the read-state flip hadn't
 *     landed in cache by that snapshot, the row appears unread frozen in
 *     the animation. Synchronous setQueryData ensures the next paint already
 *     has the flipped state. (Previously the caller did this hack at tap
 *     site; moved into the mutation so every caller benefits.)
 *   - archive single: patch only the selected message, preserving other
 *     digest windows and personal notices for the same creation.
 *   - mark-all-read: flip `read` to true on every non-archived row.
 *   - archive batch: await the server and invalidate because its selection
 *     may include messages that are not loaded locally.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { InboxItem } from "@auro/core/types";
import { api } from "@/data/api";
import { inboxKeys } from "@/data/queries/inbox";
import {
  refreshInboxList,
  refreshInboxUnreadSummary,
} from "@/data/realtime/inbox-ws-updaters";
import { useWorkspaceStore } from "@/data/workspace-store";

/**
 * Re-read both inbox caches a write can change: the workspace list and the
 * cross-workspace unread summary that backs the tab badge. The summary lives
 * under its own account-level key, so refreshing the list does not reach it —
 * every mutation here can change the number it holds.
 *
 * Deliberately the shared entry points rather than local copies: a mutation
 * racing a first load hits exactly the same in-flight hole a WS event does,
 * and a plain invalidate of the list would let it fall behind the badge.
 * Not awaited by `onSettled` — the mutation is done once the server answers.
 *
 * Rows are optimistic, the badge is not: it follows the server's confirmation.
 * Mirrors the same decision in packages/core/inbox/mutations.ts, whose comment
 * carries the reasoning — recomputing the count from the list cache and
 * writing it back cannot be made correct once the list is paginated, and races
 * an in-flight summary response that no `cancelQueries` here covers.
 */
function refreshInboxAfterWrite(qc: QueryClient, wsId: string | null) {
  if (wsId) void refreshInboxList(qc, wsId);
  void refreshInboxUnreadSummary(qc);
}

export function useMarkInboxRead() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (id: string) => api.markInboxRead(id),
    onMutate: async (id) => {
      const key = inboxKeys.list(wsId);
      const prev = qc.getQueryData<InboxItem[]>(key);
      // Snapshot before the synchronous patch so a failed write restores unread.
      qc.setQueryData<InboxItem[]>(key, (old) =>
        old?.map((item) => (item.id === id ? { ...item, read: true } : item)),
      );
      // Cancel an older response after the synchronous navigation-time patch.
      await qc.cancelQueries({ queryKey: key });
      return { prev, key };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      refreshInboxAfterWrite(qc, wsId);
    },
  });
}

export function useArchiveInbox() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (id: string) => api.archiveInbox(id),
    onMutate: async (id) => {
      const key = inboxKeys.list(wsId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<InboxItem[]>(key);
      qc.setQueryData<InboxItem[]>(key, (old) =>
        old?.map((item) =>
          item.id === id
            ? { ...item, archived: true }
            : item,
        ),
      );
      return { prev, key };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      refreshInboxAfterWrite(qc, wsId);
    },
  });
}

export function useMarkAllInboxRead() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: () => api.markAllInboxRead(),
    onMutate: async () => {
      const key = inboxKeys.list(wsId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<InboxItem[]>(key);
      qc.setQueryData<InboxItem[]>(key, (old) =>
        old?.map((item) =>
          !item.archived ? { ...item, read: true } : item,
        ),
      );
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      refreshInboxAfterWrite(qc, wsId);
    },
  });
}

// Batch archive predicates belong to the server; refresh after confirmation.
export function useArchiveAllInbox() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: () => api.archiveAllInbox(),
    onSettled: () => {
      refreshInboxAfterWrite(qc, wsId);
    },
  });
}

export function useArchiveAllReadInbox() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: () => api.archiveAllReadInbox(),
    onSettled: () => {
      refreshInboxAfterWrite(qc, wsId);
    },
  });
}
