import type { InboxItem } from "../types/inbox";

/** Only system notices remain after the task-management routes are retired. */
export function isSystemInboxItem(item: Pick<InboxItem, "type" | "issue_id">): boolean {
  return !item.issue_id && (item.type === "autopilot_paused" || item.type === "autopilot_quota_exceeded");
}
