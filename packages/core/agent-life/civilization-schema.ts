import { z } from "zod";

export const StorageVariantSchema = z.enum(["light", "sturdy", "large"]);
export const DistributionSchema = z.enum(["equal", "contribution"]);
export const MaintenanceSchema = z.enum(["volunteer", "rotation"]);

export const STORAGE_DESIGNS = {
  light: { wood: 9, labor: 18, capacity: 24, shelter: 1 },
  sturdy: { wood: 15, labor: 30, capacity: 40, shelter: 2 },
  large: { wood: 24, labor: 48, capacity: 72, shelter: 1 },
} as const;

const id = z.string().uuid();
const tick = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = (max: number) => z.string().max(max);

export const StoragePrototypeSchema = z.strictObject({
  id,
  authorId: id.nullable(),
  name: text(60),
  variant: StorageVariantSchema,
  createdTick: tick,
});

export const ProjectMemberSchema = z.strictObject({
  residentId: id,
  joinedTick: tick,
  wood: z.number().int().min(0).max(10000),
  labor: z.number().int().min(0).max(10000),
  deposited: z.number().int().min(0).max(100000),
  withdrawn: z.number().int().min(0).max(100000),
  withdrawalDay: z.number().int().min(0),
  todayWithdrawn: z.number().int().min(0).max(100),
  lastMaintenance: tick,
});

export const CivicRuleSchema = z.strictObject({
  revision: z.number().int().min(1).max(100000),
  distribution: DistributionSchema,
  maintenance: MaintenanceSchema,
  enactedTick: tick,
  supporters: id.array().max(60),
});

export const RuleDebateSchema = z.strictObject({
  id,
  projectId: id,
  proposerId: id,
  distribution: DistributionSchema,
  maintenance: MaintenanceSchema,
  createdTick: tick,
  expiresTick: tick,
  status: z.enum(["open", "adopted", "rejected"]),
  knownBy: id.array().max(60),
  votes: z.strictObject({ residentId: id, approve: z.boolean(), tick }).array().max(60),
});

export const CivicProjectSchema = z.strictObject({
  id,
  organizerId: id,
  prototypeId: id,
  variant: StorageVariantSchema,
  position: z.strictObject({ x: z.number().int().min(0).max(11), y: z.number().int().min(0).max(7) }),
  status: z.enum(["proposed", "gathering", "building", "active", "paused", "abandoned"]),
  createdTick: tick,
  completedTick: tick.nullable(),
  knownBy: id.array().max(60),
  declinedBy: id.array().max(60).default([]),
  members: ProjectMemberSchema.array().min(1).max(60),
  wood: z.number().int().min(0).max(10000),
  labor: z.number().int().min(0).max(10000),
  food: z.number().int().min(0).max(1000),
  condition: z.number().int().min(0).max(100),
  rule: CivicRuleSchema,
  lastReviewTick: tick,
  lastGatheringDay: z.number().int().min(-1),
  gatheringIds: id.array().max(30),
  gatheringsCompleted: z.number().int().min(0).max(100000),
});

export const CivicNewsKindSchema = z.enum([
  "proposed", "discovered", "joined", "declined", "delivered", "construction",
  "completed", "deposited", "withdrawn", "maintenance", "rule_proposed",
  "rule_voted", "rule_adopted", "rule_rejected", "gathering", "tradition",
]);
export const CivicNewsSchema = z.strictObject({
  id,
  projectId: id,
  residentId: id,
  otherId: id.nullable(),
  tick,
  kind: CivicNewsKindSchema,
  amount: z.number().int().min(0).max(100000),
  sourceId: id.nullable(),
  evidence: id.array().max(6),
  rule: CivicRuleSchema.nullable().default(null),
});

export const PrototypeSuggestionSchema = z.strictObject({
  id, prototypeId: id, residentId: id, createdTick: tick,
  status: z.enum(["pending", "accepted", "declined"]),
});

export const CivilizationSchema = z.strictObject({
  version: z.literal(1),
  prototypes: StoragePrototypeSchema.array().max(24),
  projects: CivicProjectSchema.array().max(3),
  debates: RuleDebateSchema.array().max(24),
  news: CivicNewsSchema.array().max(96),
  suggestions: PrototypeSuggestionSchema.array().max(24),
});

export type Civilization = z.infer<typeof CivilizationSchema>;
export type CivicProject = z.infer<typeof CivicProjectSchema>;
export type CivicNews = z.infer<typeof CivicNewsSchema>;
export type StoragePrototype = z.infer<typeof StoragePrototypeSchema>;
export type StorageVariant = z.infer<typeof StorageVariantSchema>;
export type RuleDebate = z.infer<typeof RuleDebateSchema>;

export const emptyCivilization = (): Civilization => ({
  version: 1, prototypes: [], projects: [], debates: [], news: [], suggestions: [],
});

// Read boundaries tolerate new optional fields while the compute protocol stays strict.
export const CivilizationReadSchema = CivilizationSchema.strip().extend({
  prototypes: StoragePrototypeSchema.strip().array().max(24),
  projects: CivicProjectSchema.strip().extend({
    status: CivicProjectSchema.shape.status.catch("paused"),
    rule: CivicRuleSchema.strip(),
    members: ProjectMemberSchema.strip().array().max(60),
  }).array().max(3),
  debates: RuleDebateSchema.strip().array().max(24),
  news: CivicNewsSchema.strip().extend({ kind: CivicNewsKindSchema.catch("construction") }).array().max(96),
  suggestions: PrototypeSuggestionSchema.strip().array().max(24),
});
