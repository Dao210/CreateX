import type { InboxItem } from "../types";

export interface InboxFilters {
  readonly actors: readonly string[];
  readonly unreadOnly: boolean;
}
export const EMPTY_INBOX_FILTERS: InboxFilters = Object.freeze({ actors: Object.freeze([]), unreadOnly: false });
export function inboxActorKey(item: InboxItem): string | null {
  if (!item.actor_type) return null;
  return item.actor_type === "system" ? "system" : item.actor_id ? `${item.actor_type}:${item.actor_id}` : null;
}
