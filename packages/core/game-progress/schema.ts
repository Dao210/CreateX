import { z } from "zod";

/** Campaign level count shipped by Doodle Siege. */
export const SIEGE_LEVELS = 8;
/** Stage count shipped by Tank Defense. */
export const TANK_LEVELS = 6;

const starsSchema = z.array(z.number().int().min(0).max(3)).length(SIEGE_LEVELS);

export const SiegeProgressSchema = z.object({
  stars: starsSchema,
  updatedAt: z.string(),
});
export const TankProgressSchema = z.object({
  best: z.number().int().min(0).max(1_000_000),
  unlocked: z.number().int().min(1).max(TANK_LEVELS),
  updatedAt: z.string(),
});
export const GameProgressSchema = z.object({
  workspaceId: z.string().uuid(),
  siege: SiegeProgressSchema.nullable().default(null),
  tanks: TankProgressSchema.nullable().default(null),
});
export const SiegeProgressResponseSchema = SiegeProgressSchema.extend({ workspaceId: z.string().uuid() });
export const TankProgressResponseSchema = TankProgressSchema.extend({ workspaceId: z.string().uuid() });

export type SiegeProgress = z.infer<typeof SiegeProgressSchema>;
export type TankProgress = z.infer<typeof TankProgressSchema>;
export type GameProgress = z.infer<typeof GameProgressSchema>;

/** Merge two achievement snapshots; progress never moves backwards. */
export function mergeSiegeStars(local: readonly number[], remote: readonly number[] | null | undefined): number[] {
  const other = remote?.length === SIEGE_LEVELS ? remote : [];
  return Array.from({ length: SIEGE_LEVELS }, (_, index) => Math.max(local[index] ?? 0, other[index] ?? 0));
}

export function mergeTankAchievements(
  local: { best: number; unlocked: number },
  remote: { best: number; unlocked: number } | null | undefined,
): { best: number; unlocked: number } {
  return {
    best: Math.max(local.best, remote?.best ?? 0),
    unlocked: Math.min(TANK_LEVELS, Math.max(local.unlocked, remote?.unlocked ?? 1)),
  };
}
