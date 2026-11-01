// @vitest-environment node
import { describe, expect, it } from "vitest";
import { InboxContentSchema, inboxCategory, inboxContent, parseInboxCategory } from "./messages";
import { isVisibleInboxItem } from "./system-notifications";
import { InboxItemListSchema } from "../api/schemas";

const content = {
  entries: [{ id: "00000000-0000-4000-8000-000000000001", kind: "tank_created", subjectId: "00000000-0000-4000-8000-000000000002", name: "Scout", revision: 1, origin: "mcp", occurredAt: "2026-11-01T02:30:00Z" }],
  totals: { created: 1, updated: 0, milestones: 0 }, totalEntries: 1,
  windowStart: "2026-11-01T02:00:00Z", windowEnd: "2026-11-01T03:00:00Z",
};

describe("creation and world inbox messages", () => {
  it.each(["creation_ready", "character_milestone", "world_digest"] as const)("shows %s without reopening retired task notifications", type => {
    expect(isVisibleInboxItem({ type, issue_id: null })).toBe(true);
    expect(isVisibleInboxItem({ type, issue_id: "retired-issue" })).toBe(false);
  });
  it("classifies categories and safely normalizes a URL filter", () => {
    expect(inboxCategory({ type: "world_digest" })).toBe("world");
    expect(inboxCategory({ type: "creation_ready" })).toBe("creations");
    expect(inboxCategory({ type: "autopilot_paused" })).toBe("system");
    expect(parseInboxCategory("world")).toBe("world");
    expect(parseInboxCategory("unknown")).toBe("all");
  });
  it("validates bounded factual content and rejects unsafe navigation identifiers", () => {
    expect(InboxContentSchema.safeParse(content).success).toBe(true);
    expect(InboxContentSchema.safeParse({ ...content, entries: Array(13).fill(content.entries[0]) }).success).toBe(false);
    expect(InboxContentSchema.safeParse({ ...content, entries: [{ ...content.entries[0], subjectId: "https://example.com" }] }).success).toBe(false);
    expect(inboxContent({ content: null })).toBeNull();
  });
  it("keeps an older response and a malformed new content field readable", () => {
    const row = { id: "n", workspace_id: "w", recipient_type: "member", recipient_id: "u", type: "world_digest", severity: "info", title: "World digest", read: false, archived: false, created_at: "2026-11-01T03:00:00Z" };
    expect(InboxItemListSchema.parse([row])[0]?.content).toBeUndefined();
    expect(InboxItemListSchema.parse([{ ...row, content: { entries: "bad" } }])[0]?.content).toBeNull();
    expect(InboxItemListSchema.parse([{ ...row, content }])[0]?.content?.totalEntries).toBe(1);
  });
});
