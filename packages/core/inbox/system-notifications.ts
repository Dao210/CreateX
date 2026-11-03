import type { InboxItem } from "../types/inbox";

/** Only system notices remain after the task-management routes are retired. */
export function isSystemInboxItem(item: Pick<InboxItem, "type">): boolean {
  return (item.type === "autopilot_paused" || item.type === "autopilot_quota_exceeded");
}

/** Retired task notifications stay excluded, including issue-less outcomes. */
export function isVisibleInboxItem(item: Pick<InboxItem, "type">): boolean {
  return (isSystemInboxItem(item) || item.type === "creation_ready" || item.type === "character_milestone" || item.type === "world_digest");
}
