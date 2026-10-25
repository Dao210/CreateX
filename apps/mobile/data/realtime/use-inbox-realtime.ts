/** System inbox notifications refresh only their list and unread summary. */
import { isSystemInboxItem } from "@auro/core/inbox/system-notifications";
import { useQueryClient } from "@tanstack/react-query";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";
import {
  refreshInboxList,
  refreshInboxUnreadSummary,
} from "./inbox-ws-updaters";

export function useInboxRealtime() {
  const qc = useQueryClient();

  useWSSubscriptions(
    (ws, wsId) => {
      const invalidate = () => {
        // Shared entry points: each cancels an in-flight request before
        // invalidating, which a plain invalidate cannot do on a first load.
        // Both caches, because the badge is rendered over the list it counts.
        void refreshInboxList(qc, wsId);
        void refreshInboxUnreadSummary(qc);
      };

      return [
        // Inbox-domain events: refetch the inbox list and the badge count.
        ws.on("inbox:new", ({ item }) => { if (isSystemInboxItem(item)) invalidate(); }),
        ws.on("inbox:read", invalidate),
        // Mobile has no mark-unread affordance yet (web/desktop right-click
        // only), but a mark-unread there must un-read the row here too —
        // otherwise the phone keeps showing it read and the unread dots
        // disagree across clients.
        ws.on("inbox:unread", invalidate),
        ws.on("inbox:archived", invalidate),
        // Mobile has no archived view yet (web/desktop only, MUL-3736), but an
        // unarchive there restores the item to THIS list — without refetching,
        // mobile keeps showing the pre-restore list.
        ws.on("inbox:unarchived", invalidate),
        ws.on("inbox:batch-read", invalidate),
        ws.on("inbox:batch-archived", invalidate),

        // After a reconnect we don't know what we missed during the
        // downtime — refresh from server.
        ws.onReconnect(invalidate),
      ];
    },
    [qc],
  );
}
