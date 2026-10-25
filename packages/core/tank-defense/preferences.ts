import { z } from "zod";
import type { TankDifficulty } from "./difficulty";
import { TANK_LEVELS } from "./levels";

/** Stable identities keep records isolated across account and workspace switches. */
export function tankPreferencesKey(userId: string, workspaceId: string): string {
  if (!userId || !workspaceId) throw new Error("Tank records require a user and workspace");
  return `auro:tanks:${encodeURIComponent(userId)}:${encodeURIComponent(workspaceId)}`;
}

const PreferencesSchema = z.object({
  version: z.literal(1),
  best: z.number().int().min(0).max(1000000).catch(0),
  unlocked: z.number().int().min(1).max(TANK_LEVELS.length).catch(1),
  sound: z.boolean().catch(true),
  difficulty: z.enum(["casual", "standard"]).catch("casual"),
});

export function parseTankPreferences(serialized: string | null): { best: number; unlocked: number; sound: boolean; difficulty: TankDifficulty } {
  try {
    const parsed = PreferencesSchema.safeParse(JSON.parse(serialized ?? "null"));
    if (parsed.success) return { best: parsed.data.best, unlocked: parsed.data.unlocked, sound: parsed.data.sound, difficulty: parsed.data.difficulty };
  } catch { /* Invalid local records must not prevent a new game. */ }
  return { best: 0, unlocked: 1, sound: true, difficulty: "casual" };
}
