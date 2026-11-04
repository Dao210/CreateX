import { z } from "zod";
import { AgentSchema, ResourceSchema, ActionSchema } from "./schema";

export const LIFE_PROTOCOL_VERSION = 1;
export const SimulationSchema = z.strictObject({
  tick: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  agents: AgentSchema.array().min(1).max(60),
  resources: ResourceSchema.array().max(182),
  actions: ActionSchema.array().max(60),
});
export const SeedSchema = z.strictObject({ agents: AgentSchema.array().length(20), resources: ResourceSchema.array().length(62), tickMs: z.number().int().positive() });
export const TickResultSchema = z.strictObject({
  state: SimulationSchema, completed: ActionSchema.array().max(60), started: ActionSchema.array().max(60),
  events: z.strictObject({ actionId: z.string().uuid().nullable(), agentId: z.string().uuid().nullable(), kind: z.enum(["action_completed", "action_failed", "resources_replenished", "goal_reached"]), payload: z.record(z.string(), z.unknown()) }).array().max(121),
});
const header = { version: z.literal(LIFE_PROTOCOL_VERSION), requestId: z.string().uuid() };
export const RuntimeRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({ ...header, operation: z.literal("seed") }),
  z.strictObject({ ...header, operation: z.literal("tick"), state: SimulationSchema }),
]);
