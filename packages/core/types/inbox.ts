import type { InboxContent } from "../inbox/messages";

export type InboxSeverity = "action_required" | "attention" | "info";

export type InboxItemType = "creation_ready" | "character_milestone" | "world_digest" | "autopilot_paused" | "autopilot_quota_exceeded" | (string & {});

/**
 * One workspace's unread inbox count in the cross-workspace summary
 * (`GET /api/inbox/unread-summary`). The sidebar uses this to light a dot on
 * the workspace switcher when a workspace OTHER than the active one has
 * unread items.
 */
export interface InboxWorkspaceUnread {
  workspace_id: string;
  count: number;
}

export interface InboxItem {
  id: string;
  workspace_id: string;
  recipient_type: "member" | "agent";
  recipient_id: string;
  actor_type: "member" | "agent" | "system" | null;
  actor_id: string | null;
  type: InboxItemType;
  severity: InboxSeverity;
  issue_id: string | null;
  title: string;
  body: string | null;
  issue_status: string | null;
  /**
   * Current priority of the linked issue. Optional so an installed Desktop
   * client remains compatible with an older backend that predates this Inbox
   * projection; null also covers notifications without a linked issue.
   */
  issue_priority?: string | null;
  read: boolean;
  archived: boolean;
  created_at: string;
  details: Record<string, string> | null;
  content?: InboxContent | null;
}


export interface ArchivedInboxPage {
  items: InboxItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ArchivedInboxFacets {
  statuses: Record<string, number>;
  priorities: Record<string, number>;
  actors: Record<string, number>;
  unreadCount: number;
}
