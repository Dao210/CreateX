// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { InboxItem, InboxWorkspaceUnread } from "../types";
import {
  deduplicateArchivedInboxItems,
  deduplicateInboxItems,
  hasOtherWorkspaceUnread,
  inboxKeys,
  unreadCountForWorkspace,
  unreadWorkspaceIds,
} from "./queries";

function item(overrides: Partial<InboxItem>): InboxItem {
  return {
    id: "inbox-1",
    workspace_id: "workspace-1",
    recipient_type: "member",
    recipient_id: "member-1",
    actor_type: "agent",
    actor_id: "agent-1",
    type: "world_digest",
    severity: "info",
    title: "World digest",
    body: null,
    read: false,
    archived: false,
    created_at: "2026-06-15T08:00:00Z",
    details: null,
    ...overrides,
  };
}

describe("active inbox message history", () => {
  it("keeps distinct hourly messages for the same creation and does not merge their details", () => {
    const messages = deduplicateInboxItems([
      item({ id: "new-window", created_at: "2026-06-15T09:00:00Z", details: { character_id: "scout", window: "new" } }),
      item({ id: "old-window", created_at: "2026-06-15T08:00:00Z", details: { character_id: "scout", window: "old" } }),
    ]);
    expect(messages.map(message => message.id)).toEqual(["new-window", "old-window"]);
    expect(messages.map(message => message.details?.window)).toEqual(["new", "old"]);
  });

  it("keeps each message's read state independent", () => {
    const messages = deduplicateInboxItems([
      item({ id: "unread", read: false }), item({ id: "read", read: true }),
    ]);
    expect(messages).toHaveLength(2);
    expect(messages.filter(message => !message.read).map(message => message.id)).toEqual(["unread"]);
  });

  it("drops an archived message without changing other history", () => {
    const messages = deduplicateInboxItems([item({ id: "active" }), item({ id: "filed-away", archived: true })]);
    expect(messages.map(message => message.id)).toEqual(["active"]);
  });
});

describe("archived inbox message history", () => {
  it("keeps separate archived windows in the server's newest-first order", () => {
    const messages = deduplicateArchivedInboxItems([
      item({ id: "new-window", archived: true, created_at: "2026-06-15T09:00:00Z" }),
      item({ id: "old-window", archived: true, created_at: "2026-06-15T08:00:00Z" }),
      item({ id: "still-active" }),
    ]);
    expect(messages.map(message => message.id)).toEqual(["new-window", "old-window"]);
  });

  it("drops only a message restored to the active inbox", () => {
    expect(deduplicateArchivedInboxItems([item({ id: "restored", archived: false }),item({ id: "archived", archived: true })]).map(message => message.id)).toEqual(["archived"]);
  });

  it("preserves archived messages with the same source", () => {
    expect(deduplicateArchivedInboxItems([item({ id: "one", archived: true }), item({ id: "two", archived: true })])).toHaveLength(2);
  });
});

describe("hasOtherWorkspaceUnread", () => {
  const summary = (entries: InboxWorkspaceUnread[]) => entries;

  it("is true when a workspace other than the active one has unread", () => {
    expect(
      hasOtherWorkspaceUnread(
        summary([{ workspace_id: "ws-2", count: 3 }]),
        "ws-1",
      ),
    ).toBe(true);
  });

  it("excludes the active workspace's own unread", () => {
    expect(
      hasOtherWorkspaceUnread(
        summary([{ workspace_id: "ws-1", count: 5 }]),
        "ws-1",
      ),
    ).toBe(false);
  });

  it("ignores other workspaces whose count is zero", () => {
    expect(
      hasOtherWorkspaceUnread(
        summary([{ workspace_id: "ws-2", count: 0 }]),
        "ws-1",
      ),
    ).toBe(false);
  });

  it("is true when at least one non-active workspace has unread", () => {
    expect(
      hasOtherWorkspaceUnread(
        summary([
          { workspace_id: "ws-1", count: 4 },
          { workspace_id: "ws-2", count: 1 },
        ]),
        "ws-1",
      ),
    ).toBe(true);
  });

  it("is false for an empty summary", () => {
    expect(hasOtherWorkspaceUnread([], "ws-1")).toBe(false);
  });

  it("counts every workspace as 'other' when there is no active workspace", () => {
    expect(
      hasOtherWorkspaceUnread(
        summary([{ workspace_id: "ws-1", count: 2 }]),
        null,
      ),
    ).toBe(true);
  });
});

describe("unreadWorkspaceIds", () => {
  it("collects only workspaces with a non-zero count", () => {
    const ids = unreadWorkspaceIds([
      { workspace_id: "ws-1", count: 0 },
      { workspace_id: "ws-2", count: 3 },
      { workspace_id: "ws-3", count: 1 },
    ]);
    expect(ids.has("ws-1")).toBe(false);
    expect(ids.has("ws-2")).toBe(true);
    expect(ids.has("ws-3")).toBe(true);
    expect(ids.size).toBe(2);
  });

  it("returns an empty set for an empty summary", () => {
    expect(unreadWorkspaceIds([]).size).toBe(0);
  });
});

describe("inboxKeys.unreadSummary", () => {
  it("is a stable account-level key independent of any workspace", () => {
    expect(inboxKeys.unreadSummary()).toEqual(["inbox", "unread-summary"]);
  });
});

// The inbox nav / tab / dock badges all read this instead of counting the
// inbox list, so that the count costs no list fetch (MUL-6967).
describe("unreadCountForWorkspace", () => {
  const summary: InboxWorkspaceUnread[] = [
    { workspace_id: "ws-1", count: 3 },
    { workspace_id: "ws-2", count: 7 },
  ];

  it("returns the requested workspace's count", () => {
    expect(unreadCountForWorkspace(summary, "ws-2")).toBe(7);
  });

  it("reads an absent workspace as zero", () => {
    // The endpoint omits workspaces with nothing unread rather than sending a
    // zero row, so "missing" must mean 0 and not "unknown".
    expect(unreadCountForWorkspace(summary, "ws-3")).toBe(0);
  });

  it("returns zero without a workspace", () => {
    expect(unreadCountForWorkspace(summary, null)).toBe(0);
    expect(unreadCountForWorkspace(summary, undefined)).toBe(0);
  });

  it("returns zero for an empty summary", () => {
    expect(unreadCountForWorkspace([], "ws-1")).toBe(0);
  });
});
