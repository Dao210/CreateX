// @vitest-environment node
import { describe, expect, it } from "vitest";
import { InboxListSchema, InboxUnreadSummarySchema } from "./schemas";

/** Optional detail drift must not make the whole message list disappear. */
describe("inbox list schema", () => {
  it("parses a row shaped like the documented server payload", () => {
    const serverRow = {
      id: "inbox-1",
      workspace_id: "ws-1",
      recipient_type: "member",
      recipient_id: "user-1",
      type: "status_changed",
      severity: "info",
      title: "P0: delegated subscription rule",
      body: "",
      actor_type: "agent",
      actor_id: "agent-1",
      read: false,
      archived: false,
      created_at: "2026-07-30T00:00:00Z",
      // String details retain their typed values.
      details: { from: "in_progress", to: "in_review" },
    };

    const parsed = InboxListSchema.safeParse([serverRow]);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data[0]?.type).toBe("status_changed");
    expect(parsed.success && parsed.data[0]?.details?.to).toBe("in_review");
  });

  it("discards malformed optional details while retaining the message", () => {
    const badRow = {
      id: "inbox-2",
      recipient_type: "member",
      type: "status_changed",
      details: { child_count: 3 },
    };

    const parsed = InboxListSchema.parse([badRow]);
    expect(parsed[0]?.details).toBeNull();
  });

  it("keeps one malformed detail field from emptying the entire list", () => {
    const good = {
      id: "inbox-3",
      recipient_type: "member",
      type: "status_changed",
      details: { from: "todo", to: "in_review" },
    };
    const bad = {
      id: "inbox-4",
      recipient_type: "member",
      type: "status_changed",
      details: { child_count: 3 },
    };

    expect(InboxListSchema.safeParse([good]).success).toBe(true);
    const parsed = InboxListSchema.parse([good, bad]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.details).toEqual(good.details);
    expect(parsed[1]?.details).toBeNull();
  });

  it("renders an unknown server type instead of dropping the row", () => {
    // Mirrors the root CLAUDE.md API-compatibility rule and mobile's own
    // "render every inbox type, never silently drop a category" parity rule: a
    // type this build has never heard of must still parse.
    const future = {
      id: "inbox-5",
      recipient_type: "member",
      type: "some_future_type",
      details: { anything: "still a string" },
    };

    const parsed = InboxListSchema.safeParse([future]);
    expect(parsed.success).toBe(true);
  });
});

/**
 * GET /api/inbox/unread-summary — the source of the inbox tab badge.
 *
 * Blast radius differs from the list above: `getInboxUnreadSummary` falls back
 * to an empty array, which reads as "nothing unread" and simply hides the
 * badge. A wrong number would be worse than no number, so the schema stays
 * strict about the shape and lenient only about extra fields.
 */
describe("inbox unread summary schema", () => {
  it("parses the documented server payload", () => {
    const parsed = InboxUnreadSummarySchema.safeParse([
      { workspace_id: "ws-1", count: 3 },
      { workspace_id: "ws-2", count: 1 },
    ]);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data[1]?.count).toBe(1);
  });

  it("passes through a field this client does not know yet", () => {
    const parsed = InboxUnreadSummarySchema.safeParse([
      { workspace_id: "ws-1", count: 3, unread_mentions: 2 },
    ]);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data[0]?.count).toBe(3);
  });

  it("reads a non-numeric count as zero rather than failing the list", () => {
    // One malformed row must not blank every other workspace's count.
    const parsed = InboxUnreadSummarySchema.safeParse([
      { workspace_id: "ws-1", count: "many" },
      { workspace_id: "ws-2", count: 5 },
    ]);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data[0]?.count).toBe(0);
    expect(parsed.success && parsed.data[1]?.count).toBe(5);
  });

  it("rejects a row with no workspace id", () => {
    // Without an id the entry can never be matched to a workspace, so it would
    // silently contribute nothing — fail loudly into the empty fallback.
    expect(
      InboxUnreadSummarySchema.safeParse([{ count: 3 }]).success,
    ).toBe(false);
  });
});

it("keeps malformed optional world content from breaking mobile inbox rows", () => {
  const parsed = InboxListSchema.parse([{ id: "digest", type: "world_digest", content: { entries: "broken" } }]);
  expect(parsed[0]?.type).toBe("world_digest");
  expect(parsed[0]?.content).toBeNull();
});
