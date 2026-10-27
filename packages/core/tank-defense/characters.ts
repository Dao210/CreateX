import { z } from "zod";
import catalog from "./character-catalog.json";
import type { TankBlueprint, TankMode } from "./types";

export const TANK_CHARACTER_CATALOG = catalog;
const nameSchema = z.string().refine(value => [...value].length >= 1 && [...value].length <= 40 && value === value.trim() && !/\p{Cc}/u.test(value));
export const TankAppearanceSchema = z.object({
  body: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  pattern: z.enum(["solid", "stripe", "cross"]),
}).strict();
export const TankCharacterDraftSchema = z.object({
  profile: z.literal("tank-defense@1"),
  name: nameSchema,
  parts: z.object({ chassis: z.enum(["light", "standard", "heavy"]), armor: z.enum(["light", "standard", "heavy"]), cannon: z.enum(["rapid", "standard", "heavy"]) }).strict(),
  appearance: TankAppearanceSchema,
}).strict();
export type TankCharacterDraft = z.infer<typeof TankCharacterDraftSchema>;
export type TankAppearance = z.infer<typeof TankAppearanceSchema>;

/** Both runtimes read this versioned catalog; callers cannot submit combat stats. */
export function compileTankCharacter(input: unknown, id = "custom"): { blueprint: TankBlueprint; cost: number } {
  const draft = TankCharacterDraftSchema.parse(input);
  const chassis = catalog.chassis[draft.parts.chassis], armor = catalog.armor[draft.parts.armor], cannon = catalog.cannon[draft.parts.cannon];
  const cost = chassis.cost + armor.cost + cannon.cost;
  if (cost > catalog.budget) throw new Error("character_budget_exceeded");
  return { cost, blueprint: { id, speed: chassis.speed + armor.speed, armor: 1 + chassis.armor + armor.armor, projectileSpeed: cannon.projectileSpeed, fireInterval: cannon.fireInterval, score: 0, appearance: { ...draft.appearance } } };
}

const BlueprintSchema = z.object({
  id: z.string(), speed: z.number().finite(), armor: z.number().int().positive(), projectileSpeed: z.number().finite(), fireInterval: z.number().int().positive(), score: z.literal(0), appearance: TankAppearanceSchema,
});
export const TankCharacterSchema = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(), workspaceId: z.string().uuid(), ownerId: z.string().uuid(),
  rulesVersion: z.literal(1), compilerVersion: z.literal(1), contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  draft: TankCharacterDraftSchema, blueprint: BlueprintSchema, cost: z.number().int(), origin: z.enum(["manual", "mcp"]).default("manual").catch("manual"), createdAt: z.string().datetime({ offset: true }),
}).superRefine((value, ctx) => {
  try {
    const compiled = compileTankCharacter(value.draft, `${value.id}@${value.revision}`);
    if (compiled.cost !== value.cost || Object.keys(compiled.blueprint).some(key => JSON.stringify(compiled.blueprint[key as keyof TankBlueprint]) !== JSON.stringify(value.blueprint[key as keyof typeof value.blueprint]))) ctx.addIssue({ code: "custom", message: "Compiled tank does not match its draft" });
  } catch { ctx.addIssue({ code: "custom", message: "Unsupported tank character" }); }
});
export type TankCharacter = z.infer<typeof TankCharacterSchema>;
export const TankCharacterListSchema = z.object({ characters: z.array(TankCharacterSchema) });
export const TankPlaySessionSchema = z.object({
  id: z.string().uuid(), workspaceId: z.string().uuid(), ownerId: z.string().uuid(), rulesVersion: z.literal(1),
  mapId: z.enum(["frontline", "river", "steel", "depot", "circuit", "citadel"]), mapVersion: z.literal(1), levelId: z.number().int().min(1).max(6), mode: z.enum(["campaign", "blitz", "survival"]),
  character: TankCharacterSchema, createdAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }), playPath: z.string(), playUrl: z.string().url(),
}).superRefine((value, ctx) => {
  const map = catalog.maps.find(map => map.id === value.mapId);
  if (map?.levelId !== value.levelId || value.character.workspaceId !== value.workspaceId) ctx.addIssue({ code: "custom", message: "Session scope or map mismatch" });
  try {
    const path = new URL(value.playPath, "https://auro.invalid");
    const launch = new URL(value.playUrl);
    const segments = path.pathname.split("/").filter(Boolean);
    if (!value.playPath.startsWith("/") || path.origin !== "https://auro.invalid" || segments.length !== 2 || segments[1] !== "tanks" || path.searchParams.get("session") !== value.id || [...path.searchParams.keys()].length !== 1 || path.hash || launch.pathname + launch.search !== value.playPath || launch.hash || launch.username || launch.password || !["http:", "https:"].includes(launch.protocol)) ctx.addIssue({ code: "custom", message: "Invalid tank launch path" });
  } catch { ctx.addIssue({ code: "custom", message: "Invalid tank launch URL" }); }
});
export type TankPlaySession = z.infer<typeof TankPlaySessionSchema>;
export interface SaveTankCharacterInput { requestId: string; draft: TankCharacterDraft; characterId?: string; expectedRevision?: number }
export interface CreateTankSessionInput { requestId: string; characterId: string; revision: number; contentHash: string; mapId: "frontline" | "river" | "steel" | "depot" | "circuit" | "citadel"; mode?: TankMode }
