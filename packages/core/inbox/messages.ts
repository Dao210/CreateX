import { z } from "zod";
import type { InboxItem } from "../types/inbox";

export const InboxEntrySchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["tank_created", "tank_updated", "tank_level_up", "resident_goal_reached"]),
  subjectId: z.string().uuid(),
  name: z.string().min(1).max(160),
  authorName: z.string().max(160).optional(),
  revision: z.number().int().positive().optional(),
  level: z.number().int().positive().optional(),
  origin: z.enum(["manual", "mcp"]).optional(),
  goalKind: z.enum(["wood", "coins"]).optional(),
  target: z.number().int().positive().optional(),
  occurredAt: z.iso.datetime({ offset: true }),
}).superRefine((entry, ctx) => {
  if ((entry.kind === "tank_created" || entry.kind === "tank_updated") && !entry.revision) ctx.addIssue({ code: "custom", message: "Missing creation revision" });
  if (entry.kind === "tank_level_up" && !entry.level) ctx.addIssue({ code: "custom", message: "Missing growth level" });
  if (entry.kind === "resident_goal_reached" && (!entry.goalKind || !entry.target)) ctx.addIssue({ code: "custom", message: "Missing resident goal" });
});

export const InboxContentSchema = z.object({
  entries: z.array(InboxEntrySchema).min(1).max(12),
  totals: z.object({
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    milestones: z.number().int().nonnegative(),
    residents: z.number().int().nonnegative().optional(),
  }),
  totalEntries: z.number().int().positive(),
  windowStart: z.iso.datetime({ offset: true }).optional(),
  windowEnd: z.iso.datetime({ offset: true }).optional(),
}).refine(content => content.totalEntries >= content.entries.length, "Invalid entry count");

export type InboxEntry = z.infer<typeof InboxEntrySchema>;
export type InboxContent = z.infer<typeof InboxContentSchema>;
export type InboxCategory = "all" | "creations" | "world" | "system";

export function inboxCategory(item: Pick<InboxItem, "type">): Exclude<InboxCategory, "all"> {
  if (item.type === "world_digest") return "world";
  if (item.type === "creation_ready" || item.type === "character_milestone") return "creations";
  return "system";
}

export function parseInboxCategory(value: string | null): InboxCategory {
  return value === "creations" || value === "world" || value === "system" ? value : "all";
}

/** Bounded validation also covers WebSocket payloads, which do not use GET parsers. */
export function inboxContent(item: Pick<InboxItem, "content">): InboxContent | null {
  const parsed = InboxContentSchema.safeParse(item.content);
  return parsed.success ? parsed.data : null;
}

export function autopilotNoticeId(item: Pick<InboxItem, "details">): string | null {
  const parsed = z.uuid().safeParse(item.details?.autopilot_id);
  return parsed.success ? parsed.data : null;
}
