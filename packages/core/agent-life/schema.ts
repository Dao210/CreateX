import { z } from "zod";

export const PositionSchema = z.strictObject({ x: z.number().int().min(0).max(11), y: z.number().int().min(0).max(7) });
export const ActionIntentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("MOVE"), to: PositionSchema }),
  z.strictObject({ kind: z.literal("REST") }),
  z.strictObject({ kind: z.literal("EAT") }),
  z.strictObject({ kind: z.literal("GATHER_WOOD") }),
  z.strictObject({ kind: z.literal("WORK") }),
  z.strictObject({ kind: z.literal("TALK"), targetId: z.string().uuid() }),
]);
export const PlannerProposalSchema = z.strictObject({ intent: ActionIntentSchema, reason: z.string().min(1).max(240) });
export const PLANNER_JSON_SCHEMA = z.toJSONSchema(PlannerProposalSchema);
export type ActionIntent = z.infer<typeof ActionIntentSchema>;
export type Proposal = z.infer<typeof PlannerProposalSchema>;
export const ResourceSchema = z.object({ owner: z.string(), kind: z.enum(["food", "wood", "coins"]), amount: z.number().int().nonnegative() });
export const AgentSchema = z.object({
  id: z.string().uuid(), name: z.string(), position: PositionSchema,
  energy: z.number().int().min(0).max(100), fullness: z.number().int().min(0).max(100), social: z.number().int().min(0).max(100),
  personality: z.object({ diligence: z.number().min(0).max(100), sociability: z.number().min(0).max(100), curiosity: z.number().min(0).max(100) }),
  goal: z.object({ kind: z.enum(["wood", "coins"]), target: z.number().int().positive() }),
});
export const ActionSchema = z.object({
  id: z.string().uuid(), agentId: z.string().uuid(), intent: ActionIntentSchema,
  reason: z.string(), startedTick: z.number().int().nonnegative(), dueTick: z.number().int().positive(),
  status: z.enum(["running", "completed", "failed"]),
});
export const WorldSchema = z.object({
  id: z.string().uuid(), workspaceId: z.string().uuid(), tick: z.number().int().nonnegative(),
  tickMs: z.number().int().positive(), updatedAt: z.string(),
});
export const EventSchema = z.object({
  id: z.string().uuid(), tick: z.number().int().nonnegative(), actionId: z.string().uuid().nullable(),
  agentId: z.string().uuid().nullable(), kind: z.string(), payload: z.record(z.string(), z.unknown()), occurredAt: z.string(),
});
export const LifeSnapshotSchema = z.object({
  world: WorldSchema.nullable(), agents: z.array(AgentSchema).default([]), resources: z.array(ResourceSchema.extend({ kind: z.string() })).default([]),
  actions: z.array(ActionSchema.extend({ intent: z.object({ kind: z.string(), to: PositionSchema.optional(), targetId: z.string().optional() }), status: z.string() })).default([]), events: z.array(EventSchema).default([]),
});
export type Agent = z.infer<typeof AgentSchema>;
export type Resource = z.infer<typeof ResourceSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type LifeEvent = z.infer<typeof EventSchema>;
export type LifeSnapshot = z.infer<typeof LifeSnapshotSchema>;
