import { z } from "zod";

export const GAME_IDS = ["siege", "life", "tanks", "fish"] as const;
export type GameId = typeof GAME_IDS[number];
export function isGameId(id: string): id is GameId { return GAME_IDS.some(game => game === id); }
export const GameWorldSchema = z.object({ id: z.string().uuid(), name: z.string(), slug: z.string() });
export const GameOverrideSchema = z.object({
  workspaceId: z.string().uuid(),
  access: z.enum(["inherit", "allow", "deny"]).catch("deny"),
  visibility: z.enum(["inherit", "show", "hide"]).catch("hide"),
});
export const GamePolicySchema = z.object({
  gameId: z.string().min(1), scope: z.enum(["all", "selected", "disabled"]).catch("disabled"),
  defaultVisible: z.boolean(), overrides: z.array(GameOverrideSchema), revision: z.number().int().nonnegative(),
  updatedBy: z.string().optional(), updatedAt: z.string().datetime({ offset: true }).nullish(),
});
export const GameImpactSchema = z.object({ total: z.number().int().nonnegative(), available: z.number().int().nonnegative(), visible: z.number().int().nonnegative() });
export const AdminGamesSchema = z.object({ games: z.array(z.object({
  policy: GamePolicySchema, worlds: z.array(GameWorldSchema), impact: GameImpactSchema,
  binding: z.object({ world: GameWorldSchema, updatedAt: z.string().datetime({ offset: true }) }).nullable(),
})) });
export const GameWorldPageSchema = z.object({ items: z.array(GameWorldSchema), nextCursor: z.string().optional() });
const HistoricalGamePolicySchema = GamePolicySchema.extend({ scope: z.enum(["all", "selected", "bound", "disabled"]).catch("disabled") });
export const GameAuditPageSchema = z.object({ items: z.array(z.object({
  revision: z.number().int().positive(), actorId: z.string().uuid(), actorName: z.string(), actorEmail: z.string(),
  previous: HistoricalGamePolicySchema, current: HistoricalGamePolicySchema, occurredAt: z.string().datetime({ offset: true }),
})), nextCursor: z.string().optional() });
export const WorldGamesSchema = z.object({ workspaceId: z.string().uuid(), games: z.array(z.object({
  gameId: z.string(), available: z.boolean(), visible: z.boolean(), reason: z.string().default("scope"),
})).superRefine((games, ctx) => {
  if (new Set(games.map(game => game.gameId)).size !== games.length) ctx.addIssue({ code: "custom", message: "Duplicate game decision" });
}) });
export type GameWorld = z.infer<typeof GameWorldSchema>;
export type GameOverride = z.infer<typeof GameOverrideSchema>;
export type GamePolicy = z.infer<typeof GamePolicySchema>;
export type GameImpact = z.infer<typeof GameImpactSchema>;
export type AdminGame = z.infer<typeof AdminGamesSchema>["games"][number];
export type GameWorldPage = z.infer<typeof GameWorldPageSchema>;
export type GameAuditPage = z.infer<typeof GameAuditPageSchema>;
export type WorldGames = z.infer<typeof WorldGamesSchema>;
export interface UpdateGamePolicyInput { expectedRevision: number; scope: GamePolicy["scope"]; defaultVisible: boolean; overrides: GameOverride[] }

/** Preview a single world's draft without granting authority on the client. */
export function previewGameForWorld(policy: UpdateGamePolicyInput, worldId: string): {
  available: boolean; visible: boolean;
  reason: "disabled" | "world_denied" | "scope" | "world_override" | "inherited";
} {
  const override = policy.overrides.find(item => item.workspaceId === worldId);
  const available = policy.scope !== "disabled" && override?.access !== "deny" && (policy.scope === "all" || policy.scope === "selected" && override?.access === "allow");
  const visible = available && (override?.visibility === "show" || override?.visibility !== "hide" && policy.defaultVisible);
  const reason = policy.scope === "disabled" ? "disabled" : override?.access === "deny" ? "world_denied" : !available ? "scope"
      : override && (override.access !== "inherit" || override.visibility !== "inherit") ? "world_override" : "inherited";
  return { available, visible, reason };
}
