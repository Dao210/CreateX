import { z } from "zod";
import { WorldGamesSchema } from "./game-schema";

const Count = z.number().int().nonnegative();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Timestamp = z.iso.datetime({ offset: true });

export const WorldOpsRowSchema = z.object({
  id: z.uuid(), name: z.string(), slug: z.string(), createdAt: Timestamp,
  members: Count, visitors: Count, returning: Count, actions: Count,
  activeMembers: Count, priorMembers: Count, creations: Count, priorCreations: Count,
  firstCreation: Timestamp.nullable().default(null), lastAction: Timestamp.nullable().default(null),
  covered: z.boolean(), previousCovered: z.boolean(), following: z.boolean(),
  mine: z.boolean(), dueOn: Day.nullable().default(null),
});

export const WorldOpsPageSchema = z.object({
  from: Day, to: Day, timeZone: z.string(), asOf: Timestamp, coverageStart: Timestamp,
  coveredVisitDays: Count, matched: Count,
  totals: z.object({
    total: Count, new: Count, visited: Count, browsing: Count, returning: Count,
    active: Count, creative: Count, cohort: Count, first: Count, covered: Count,
  }),
  items: z.array(WorldOpsRowSchema),
  trend: z.array(z.object({
    day: Day, new: Count, visited: Count, visitors: Count, returning: Count, returnVisitors: Count, active: Count, members: Count,
    creative: Count, creations: Count,
  })),
  games: z.array(z.object({ game: z.string(), total: Count, creations: Count, manual: Count, mcp: Count })),
  activity: z.array(z.object({
    game: z.string(), occurredAt: Timestamp,
    kind: z.enum(["creation", "revision", "release", "progress"]).catch("progress"),
    origin: z.enum(["manual", "mcp", "unknown"]).catch("unknown"),
  })),
});

export const WorldOpsDetailSchema = WorldOpsPageSchema.extend({
  diagnostics: z.object({ calls: Count, failed: Count, simulation_events: Count, simulation_bound: z.boolean() }),
  policies: WorldGamesSchema.shape.games,
});

export const WorldOpsAssigneesSchema = z.array(z.object({ id: z.uuid(), name: z.string() }));
export const WorldOpsFollowupSchema = z.object({
  id: z.uuid(), workspace_id: z.uuid(), assignee_id: z.uuid(), assignee: z.string(),
  reason: z.string(), due_on: Day.nullable(), version: Count,
  closed_at: Timestamp.nullable(), created_at: Timestamp,
});
export const WorldOpsFollowupsSchema = z.object({ items: z.array(WorldOpsFollowupSchema), more: z.boolean() });
export const WorldOpsEntriesSchema = z.object({
  items: z.array(z.object({
    version: Count, actor: z.string(), assignee: z.string(), due_on: Day.nullable(),
    action: z.enum(["opened", "updated", "closed"]).catch("updated"),
    note: z.string(), created_at: Timestamp,
  })),
  more: z.boolean(),
});

export type WorldOpsPage = z.infer<typeof WorldOpsPageSchema>;
export type WorldOpsDetail = z.infer<typeof WorldOpsDetailSchema>;
export type WorldOpsRow = z.infer<typeof WorldOpsRowSchema>;
export type WorldOpsFollowup = z.infer<typeof WorldOpsFollowupSchema>;
export type WorldOpsFollowupInput = {
  expectedVersion: number;
  assigneeId: string;
  dueOn: string;
  note: string;
  close: boolean;
};
