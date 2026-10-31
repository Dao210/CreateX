import { z } from "zod";
import catalog from "./character-catalog.json";
import type { TankBlueprint } from "./types";

export const TANK_GROWTH_RULES = catalog.progression;
export const TANK_MAX_XP = TANK_GROWTH_RULES.levels.at(-1)!.xp;
export const TankGrowthSchema = z.object({ xp: z.number().int().min(0).max(TANK_MAX_XP) });
export type TankGrowth = z.infer<typeof TankGrowthSchema>;

export function tankGrowth(xp = 0) {
  const experience = Math.min(TANK_MAX_XP, Math.max(0, Number.isFinite(xp) ? Math.floor(xp) : 0));
  const index = TANK_GROWTH_RULES.levels.findLastIndex(level => experience >= level.xp);
  const current = TANK_GROWTH_RULES.levels[index]!;
  const next = TANK_GROWTH_RULES.levels[index + 1];
  return { ...current, xp: experience, level: index + 1, earned: experience - current.xp, required: next ? next.xp - current.xp : 0, remaining: next ? next.xp - experience : 0 };
}

/** Derive deployment stats without changing the saved nine-point design. */
export function applyTankGrowth(blueprint: TankBlueprint, xp = 0): TankBlueprint {
  const growth = tankGrowth(xp);
  return { ...blueprint, speed: blueprint.speed + growth.speed, armor: blueprint.armor + growth.armor, fireInterval: Math.max(1, blueprint.fireInterval - growth.fireIntervalReduction), evolution: growth.evolution };
}

export const TankTrainingRunSchema = z.object({
  id: z.string().uuid(), sessionId: z.string().uuid(), characterId: z.string().uuid(), levelId: z.number().int().min(1).max(6),
});
export type TankTrainingRun = z.infer<typeof TankTrainingRunSchema>;
export interface StartTankTrainingInput { requestId: string; levelId: number }
export interface SettleTankTrainingInput { ticks: number; kills: number; outcome: "cleared" | "victory" | "defeat" | "abandoned" }
export const TankTrainingResultSchema = z.object({
  runId: z.string().uuid(), characterId: z.string().uuid(), awardedXp: z.number().int().min(0).max(TANK_GROWTH_RULES.maxRunXp), progression: TankGrowthSchema,
});
export type TankTrainingResult = z.infer<typeof TankTrainingResultSchema>;
