import { z } from "zod";
import { validateStrategy } from "./validator.js";
import type { Strategy } from "./types";

export const StrategySchema = z.custom<Strategy>(
  (v) => validateStrategy(v).length === 0,
);
const uuid = z.string().uuid();
export const StrategyRecordSchema = z.object({
  id: uuid,
  workspaceId: uuid,
  ownerId: uuid,
  ownerName: z.string(),
  name: z.string().max(128),
  revision: z.number().int().positive(),
  hash: z.string().length(64),
  strategy: StrategySchema,
  archived: z.boolean().default(false),
  published: z.boolean().default(false),
  createdAt: z.string(),
});
export const StrategySummarySchema = StrategyRecordSchema.omit({
  strategy: true,
});
const unit = z.object({
  id: z.string(),
  team: z.enum(["red", "blue"]),
  unitType: z.enum(["heavy_infantry", "cavalry", "archer"]),
  x: z.number().finite(),
  y: z.number().finite(),
  hp: z.number(),
  maxHp: z.number().positive(),
  range: z.number(),
  state: z.string(),
  deathCount: z.number(),
  respawnRemaining: z.number(),
  isFlagCarrier: z.boolean(),
  captureProgress: z.number(),
  isCapturing: z.boolean(),
  isAttacking: z.boolean(),
  attackCooldown: z.number().nonnegative().default(0),
  shootLockTicks: z.number().int().nonnegative().default(0),
});
const flag = z.object({
  team: z.enum(["red", "blue"]),
  x: z.number(),
  y: z.number(),
  state: z.string(),
  carrierId: z.string().nullable(),
});
export const ResultSchema = z.object({
  winner: z.enum(["red", "blue", "draw", "unknown"]).catch("unknown"),
  method: z.string(),
  text: z.string(),
});
export const BattleEventSchema = z.object({
  id: z.string().max(64),
  tick: z.number().int().nonnegative(),
  time: z.number().nonnegative(),
  kind: z
    .enum(["attack", "death", "respawn", "flag", "unknown"])
    .catch("unknown"),
  team: z.enum(["red", "blue"]),
  x: z.number().finite(),
  y: z.number().finite(),
  unitId: z.string().optional(),
  unitType: z.enum(["heavy_infantry", "cavalry", "archer"]).optional(),
  targetId: z.string().optional(),
  targetX: z.number().finite().optional(),
  targetY: z.number().finite().optional(),
  damage: z.number().nonnegative().optional(),
  flagState: z.string().optional(),
});
export const FrameSchema = z.object({
  tick: z.number().int().nonnegative(),
  time: z.number(),
  units: z.array(unit).length(6),
  flags: z.object({ red: flag, blue: flag }),
  result: ResultSchema.nullable(),
  decisions: z.record(z.string(), z.unknown()),
  logs: z.array(z.string()).max(30),
  events: z.array(BattleEventSchema).max(128).default([]),
});
export const BatchSchema = z.object({
  id: uuid,
  workspaceId: uuid,
  status: z
    .enum(["running", "paused", "stopped", "completed", "failed", "unknown"])
    .catch("unknown"),
  createdAt: z.string(),
  total: z.number().int(),
  completed: z.number().int(),
  error: z.string().default(""),
});
export const MatchRecordSchema = z.object({
  id: uuid,
  batchId: uuid,
  workspaceId: uuid,
  status: z
    .enum(["queued", "running", "completed", "failed", "unknown"])
    .catch("unknown"),
  red: StrategySummarySchema,
  blue: StrategySummarySchema,
  seed: z.number().int(),
  result: ResultSchema.nullable(),
  duration: z.number().default(0),
  frames: z.array(FrameSchema).max(482).default([]),
  createdAt: z.string(),
  error: z.string().default(""),
});
export const RankingSchema = z.object({
  strategy_id: z.string(),
  strategy_name: z.string(),
  revision: z.number().int().positive().default(1),
  rating: z.number(),
  conservative_rating: z.number(),
  games: z.number(),
  wins: z.number(),
  draws: z.number(),
  losses: z.number(),
  rank: z.number(),
  provisional: z.boolean(),
});
export const StateSchema = z.object({
  workspaceId: uuid,
  canManage: z.boolean(),
  mine: z.array(StrategySummarySchema).max(128),
  library: z.array(StrategySummarySchema).max(512),
  entries: z.array(StrategySummarySchema).max(48),
  batches: z.array(BatchSchema).max(20),
  matches: z.array(MatchRecordSchema).max(100),
  leaderboard: z.array(RankingSchema).max(512),
});
export type StrategySummary = z.infer<typeof StrategySummarySchema>;
export type StrategyRecord = z.infer<typeof StrategyRecordSchema>;
export type MatchRecord = z.infer<typeof MatchRecordSchema>;
export type CTFState = z.infer<typeof StateSchema>;
export interface SaveStrategyInput {
  requestId: string;
  id?: string;
  expectedRevision: number;
  name: string;
  strategy: Strategy;
}
