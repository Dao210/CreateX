import { z } from "zod";
import { CivilizationSchema, CivilizationReadSchema, StorageVariantSchema } from "./civilization-schema";

const text = (max: number) => z.string().refine(value => Array.from(value).length <= max);

export const PlaceIdSchema = z.enum(["home", "farm", "forest", "square", "cafe", "library", "shop"]);
export const OccupationSchema = z.enum(["farmer", "builder", "librarian", "artist", "baker", "merchant"]);
export const InterestSchema = z.enum(["reading", "art", "nature", "cooking", "community"]);
export const ProfileSchema = z.strictObject({
  residentId: z.string().uuid(), occupation: OccupationSchema, background: text(400),
  interests: InterestSchema.array().min(1).max(3), home: z.number().int().min(0).max(3),
});
export const MemorySchema = z.strictObject({
  id: z.string().uuid(), residentId: z.string().uuid(), tick: z.number().int().nonnegative(),
  kind: z.enum(["meeting", "invitation", "attended", "conversation", "reflection"]),
  sourceId: z.string().uuid(), otherId: z.string().uuid().nullable(), text: text(500),
  importance: z.number().int().min(1).max(10), evidence: z.string().uuid().array().max(12),
});
export const RelationshipSchema = z.strictObject({
  residentId: z.string().uuid(), otherId: z.string().uuid(), familiarity: z.number().int().min(0).max(100),
  trust: z.number().int().min(-100).max(100), lastTick: z.number().int().nonnegative(),
});
export const PlanSlotSchema = z.strictObject({
  start: z.number().int().min(0).max(1439), end: z.number().int().min(1).max(1440),
  place: PlaceIdSchema, purpose: z.enum(["sleep", "work", "read", "shop", "socialize", "rest"]),
  reason: text(200),
});
export const PlanSchema = z.strictObject({
  residentId: z.string().uuid(), day: z.number().int().nonnegative(), source: z.enum(["rules", "model"]),
  slots: PlanSlotSchema.array().min(1).max(10),
});
export const ActivitySchema = z.strictObject({
  id: z.string().uuid(), organizerId: z.string().uuid(), title: text(80).refine(value => value.length > 0),
  interest: InterestSchema, place: PlaceIdSchema, startTick: z.number().int().nonnegative(), endTick: z.number().int().nonnegative(),
  status: z.enum(["proposed", "scheduled", "active", "completed", "declined", "failed"]), decision: text(200), attendees: z.string().uuid().array().max(60),
});
export const ConversationSchema = z.strictObject({
  id: z.string().uuid(), tick: z.number().int().nonnegative(), residentId: z.string().uuid(),
  otherId: z.string().uuid().nullable(), source: z.enum(["rules", "model", "user"]),
  lines: z.strictObject({ speakerId: z.string().uuid().nullable(), text: text(1000) }).array().min(1).max(3),
  activityIds: z.string().uuid().array().max(3),
});
export const ModelJobSchema = z.strictObject({
  id: z.string().uuid(), residentId: z.string().uuid(), otherId: z.string().uuid().nullable(),
  kind: z.enum(["plan", "dialogue", "message", "activity"]), activityId: z.string().uuid().nullable(), status: z.enum(["queued", "running", "done", "error"]),
  createdTick: z.number().int().nonnegative(), day: z.number().int().nonnegative(), text: text(1000),
  lease: text(40), leaseUntil: z.number().int().nonnegative(), error: text(80),
});
export const ModelStatusSchema = z.strictObject({
  mode: z.enum(["rules", "llm"]), state: z.enum(["rules", "ready", "unconfigured", "budget", "error"]),
  residentLimit: z.number().int().min(1).max(60), dailyLimit: z.number().int().min(1).max(1000),
  budgetDay: text(10), calls: z.number().int().min(0).max(1000),
});
export const TownSchema = z.strictObject({
  version: z.literal(1), revision: z.number().int().nonnegative(),
  profiles: ProfileSchema.array().max(60), memories: MemorySchema.array().max(1200),
  relationships: RelationshipSchema.array().max(720), plans: PlanSchema.array().max(60),
  activities: ActivitySchema.array().max(32), conversations: ConversationSchema.array().max(80),
  jobs: ModelJobSchema.array().max(64), model: ModelStatusSchema,
  civilization: CivilizationSchema.nullable().default(null),
});
export type Town = z.infer<typeof TownSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Memory = z.infer<typeof MemorySchema>;
export type Activity = z.infer<typeof ActivitySchema>;
export type ModelJob = z.infer<typeof ModelJobSchema>;
export type PlanSlot = z.infer<typeof PlanSlotSchema>;
export type PlaceId = z.infer<typeof PlaceIdSchema>;

export const TownCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ requestId: z.string().uuid(), kind: z.literal("message"), residentId: z.string().uuid(), text: text(1000).refine(value => value.length > 0 && value === value.trim()) }),
  z.strictObject({ requestId: z.string().uuid(), kind: z.literal("activity"), residentId: z.string().uuid(), title: text(80).refine(value => value.length > 0 && value === value.trim()), interest: InterestSchema, place: PlaceIdSchema, startsIn: z.number().int().min(30).max(1200), duration: z.number().int().min(15).max(180) }),
  z.strictObject({ requestId: z.string().uuid(), kind: z.literal("resident"), name: text(40).refine(value => value.length > 0 && value === value.trim()), occupation: OccupationSchema, background: text(400).refine(value => value === value.trim()), interests: InterestSchema.array().min(1).max(3) }),
  z.strictObject({ requestId: z.string().uuid(), kind: z.literal("prototype"), name: text(60).refine(value => value.length > 0 && value === value.trim()), variant: StorageVariantSchema }),
  z.strictObject({ requestId: z.string().uuid(), kind: z.literal("suggest_project"), residentId: z.string().uuid(), prototypeId: z.string().uuid() }),
]);
export type TownCommand = z.infer<typeof TownCommandSchema>;
export const TownCommandResultSchema = z.object({ id: z.string().uuid(), kind: z.enum(["message", "activity", "resident", "prototype", "suggest_project"]) });

export type TownCommandResult = z.infer<typeof TownCommandResultSchema>;

// API readers tolerate additive fields and future enum values; compute remains strict.
export const TownReadSchema = TownSchema.strip().extend({
  civilization: CivilizationReadSchema.nullable().default(null),
  profiles: ProfileSchema.strip().extend({ occupation: OccupationSchema.catch("artist"), interests: InterestSchema.catch("community").array().min(1).max(3) }).array().max(60),
  memories: MemorySchema.strip().extend({ kind: MemorySchema.shape.kind.catch("conversation") }).array().max(1200),
  relationships: RelationshipSchema.strip().array().max(720),
  plans: PlanSchema.strip().extend({ source: PlanSchema.shape.source.catch("rules"), slots: PlanSlotSchema.strip().extend({ place: PlaceIdSchema.catch("square"), purpose: PlanSlotSchema.shape.purpose.catch("rest") }).array().max(10) }).array().max(60),
  activities: ActivitySchema.strip().extend({ interest: InterestSchema.catch("community"), place: PlaceIdSchema.catch("square"), status: ActivitySchema.shape.status.catch("failed") }).array().max(32),
  conversations: ConversationSchema.strip().extend({ source: ConversationSchema.shape.source.catch("user"), lines: ConversationSchema.shape.lines }).array().max(80),
  jobs: ModelJobSchema.strip().extend({ kind: ModelJobSchema.shape.kind.catch("message"), status: ModelJobSchema.shape.status.catch("error") }).array().max(64),
  model: ModelStatusSchema.strip().extend({ mode: ModelStatusSchema.shape.mode.catch("rules"), state: ModelStatusSchema.shape.state.catch("unconfigured") }),
});
