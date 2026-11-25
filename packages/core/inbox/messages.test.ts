// @vitest-environment node
import { describe, expect, it } from "vitest";
import { autopilotNoticeId, InboxContentSchema, inboxCategory, inboxContent, parseInboxCategory } from "./messages";
import { isVisibleInboxItem } from "./system-notifications";
import { InboxItemListSchema } from "../api/schemas";

const content = {
  entries: [{ id: "00000000-0000-4000-8000-000000000001", kind: "tank_created", subjectId: "00000000-0000-4000-8000-000000000002", name: "Scout", revision: 1, origin: "mcp", occurredAt: "2026-11-01T02:30:00Z" }],
  totals: { created: 1, updated: 0, milestones: 0 }, totalEntries: 1,
  windowStart: "2026-11-01T02:00:00Z", windowEnd: "2026-11-01T03:00:00Z",
};

describe("creation and world inbox messages", () => {
  it.each(["creation_ready", "character_milestone", "world_digest", "fish_letter"] as const)("shows %s without reopening retired task notifications", type => {
    expect(isVisibleInboxItem({ type, })).toBe(true);
  });
  it("classifies categories and safely normalizes a URL filter", () => {
    expect(inboxCategory({ type: "world_digest" })).toBe("world");
    expect(inboxCategory({ type: "creation_ready" })).toBe("creations");
    expect(inboxCategory({ type: "fish_letter" })).toBe("creations");
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

it("requires bounded, recorded fish sightings and keeps malformed letters readable", () => {
  const entry = { id: "00000000-0000-4000-8000-000000000001", kind: "fish_letter", subjectId: "00000000-0000-4000-8000-000000000002", name: "Azure", revision: 1, occurredAt: "2026-11-11T02:30:00Z", sightings: [{ kind: "encounter", peerId: "00000000-0000-4000-8000-000000000003", peerName: "Neighbor", pattern: "stripes", position: [1, 3, -2], occurredAt: "2026-11-11T02:29:00Z" }] };
  const letter = { entries: [entry], totals: { created: 0, updated: 0, milestones: 0 }, totalEntries: 1 };
  expect(InboxContentSchema.safeParse(letter).success).toBe(true);
  for (const sightings of [[], Array(4).fill(entry.sightings[0]), [{ ...entry.sightings[0], peerId: "javascript:alert(1)" }], [{ ...entry.sightings[0], position: [0, 30, 0] }], [{ kind: "imagined_adventure" }]]) {
    expect(InboxContentSchema.safeParse({ ...letter, entries: [{ ...entry, sightings }] }).success).toBe(false);
  }
  const row = { id: "letter", workspace_id: "w", recipient_type: "member", recipient_id: "u", type: "fish_letter", severity: "info", title: "A letter from Azure", body: "Recorded ocean sightings", read: false, archived: false, created_at: entry.occurredAt, content: { ...letter, entries: [{ ...entry, sightings: [] }] } };
  expect(InboxItemListSchema.parse([row])[0]).toMatchObject({ content: null, title: row.title, body: row.body });
});

it("keeps malformed optional details from hiding a whole-world message", () => {
  const row = { id: "n", workspace_id: "w", recipient_type: "member", recipient_id: "u", type: "autopilot_paused", severity: "attention", title: "Paused", body: "Actionable fallback", read: false, archived: false, created_at: "2026-11-01T03:00:00Z", details: { failed_runs: 5 } };
  const parsed = InboxItemListSchema.parse([row]);
  expect(parsed[0]?.details).toBeNull();
  expect(parsed[0]?.body).toBe("Actionable fallback");
});

it("only constructs an automation detail destination from a valid resource UUID", () => {
  expect(autopilotNoticeId({ details: { autopilot_id: "00000000-0000-4000-8000-000000000001" } })).toBe("00000000-0000-4000-8000-000000000001");
  expect(autopilotNoticeId({ details: { autopilot_id: "https://example.com" } })).toBeNull();
  expect(autopilotNoticeId({ details: null })).toBeNull();
});
