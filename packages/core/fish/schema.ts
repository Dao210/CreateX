import { z } from "zod";
import catalog from "./catalog.json";

export const FISH_CATALOG = catalog;
const int = (min: number, max: number) => z.number().int().min(min).max(max);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const point = z.strictObject({ x: int(-500, 500), y: int(-700, 700) });
export const FishSpecSchema = z.strictObject({
  profile: z.literal("fish@1"), name: z.string().min(1).refine(s => Array.from(s).length <= 40 && s === s.trim() && !/\p{Cc}/u.test(s)),
  body: z.strictObject({ lengthMm: int(100, 2000), sections: z.array(z.strictObject({ u: int(0, 1000), height: int(5, 600), width: int(5, 600), offset: int(-200, 200) })).min(4).max(16) }),
  fins: z.array(z.strictObject({ at: int(100, 900), side: z.enum(["dorsal", "ventral", "left", "right"]), outline: z.array(point).min(3).max(12) })).max(8),
  tail: z.strictObject({ length: int(50, 700), spread: int(50, 600), fork: int(0, 800) }),
  eyes: z.strictObject({ at: int(50, 300), size: int(10, 70) }),
  appearance: z.strictObject({ body: color, belly: color, accent: color, pattern: z.enum(["solid", "stripes", "spots"]), glow: int(0, 300), opacity: int(650, 1000) }),
  motion: z.strictObject({ style: z.enum(["tail-beat", "body-wave", "fin-glide"]), speed: int(150, 1800), frequency: int(500, 4000), amplitude: int(20, 180) }),
  behavior: z.strictObject({ schooling: int(0, 1000), depth: int(100, 900), personalSpace: int(300, 2000) }),
}).superRefine((spec, ctx) => {
  const sections = spec.body.sections;
  if (sections[0]?.u !== 0 || sections.at(-1)?.u !== 1000 || sections.some((s, i) => i > 0 && s.u <= sections[i - 1]!.u)) ctx.addIssue({ code: "custom", path: ["body", "sections"], message: "Order body sections from head (0) to tail (1000)." });
  spec.fins.forEach((fin, i) => {
    let sign = 0, area = 0;
    const vertices = fin.outline;
    let convex = true;
    for (let j = 0; j < vertices.length; j++) {
      const a = vertices[j]!, b = vertices[(j + 1) % vertices.length]!, c = vertices[(j + 2) % vertices.length]!;
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (cross === 0 || (sign !== 0 && Math.sign(cross) !== sign)) convex = false;
      sign = Math.sign(cross); area += a.x * b.y - a.y * b.x;
    }
    // Every vertex must lie on the same side of every edge; local turns alone allow stars.
    for (let j = 0; j < vertices.length; j++) {
      const a = vertices[j]!, b = vertices[(j + 1) % vertices.length]!;
      for (const p of vertices) { const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); if (cross !== 0 && Math.sign(cross) !== sign) convex = false; }
    }
    if (!convex || area === 0 || vertices.some(p => p.y < 0) || vertices.filter(p => p.y === 0).length < 2) ctx.addIssue({ code: "custom", path: ["fins", i, "outline"], message: "Use a convex fin above its base, with two base vertices at y=0." });
  });
});
export type FishSpec = z.infer<typeof FishSpecSchema>;
export const FISH_EXAMPLES: FishSpec[] = catalog.examples.map(draft => FishSpecSchema.parse(draft));
export const FishCharacterSchema = z.object({
  id: z.string().uuid(), workspaceId: z.string().uuid(), ownerId: z.string().uuid(), revision: int(1, 50),
  contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/), compilerVersion: z.literal(1), rulesVersion: z.literal(1),
  draft: FishSpecSchema, origin: z.enum(["manual", "mcp"]).catch("manual"), archived: z.boolean().default(false), createdAt: z.string().datetime({ offset: true }),
});
export type FishCharacter = z.infer<typeof FishCharacterSchema>;
export const FishResidentSchema = z.object({ id: z.string().uuid(), oceanId: z.string().uuid(), revision: int(1, 10000), seed: int(0, 2147483647), fish: FishCharacterSchema });
export type FishResident = z.infer<typeof FishResidentSchema>;
export const FishOceanSchema = z.object({ id: z.string().uuid(), workspaceId: z.string().uuid(), ownerId: z.string().uuid(), visibility: z.enum(["private", "world"]).catch("private"), revision: int(1, 2147483647), capacity: int(1, 50), residents: z.array(FishResidentSchema).max(50) }).superRefine((o, ctx) => {
  if (o.residents.some(r => r.oceanId !== o.id || r.fish.workspaceId !== o.workspaceId || r.fish.ownerId !== o.ownerId) || new Set(o.residents.map(r => r.id)).size !== o.residents.length) ctx.addIssue({ code: "custom", message: "Invalid ocean resident scope." });
});
export type FishOcean = z.infer<typeof FishOceanSchema>;
export const PUBLIC_FISH_OCEAN_ID = "a429ac92-8e79-4bee-b88d-5cc4f637e187";
export const PublishedFishSchema = FishCharacterSchema.omit({ workspaceId: true, archived: true, origin: true, createdAt: true });
export type PublishedFish = z.infer<typeof PublishedFishSchema>;
export const PublicFishResidentSchema = FishResidentSchema.extend({
  oceanId: z.literal(PUBLIC_FISH_OCEAN_ID), fish: PublishedFishSchema, canManage: z.boolean().default(false),
});
export type PublicFishResident = z.infer<typeof PublicFishResidentSchema>;
export const PublicFishOceanSchema = z.object({
  id: z.literal(PUBLIC_FISH_OCEAN_ID), total: z.number().int().min(0),
  residents: z.array(PublicFishResidentSchema).max(40),
  focus: PublicFishResidentSchema.optional(), nextCursor: z.string().uuid().optional(),
}).superRefine((ocean, ctx) => {
  if (new Set(ocean.residents.map(resident => resident.id)).size !== ocean.residents.length) ctx.addIssue({ code: "custom", message: "Duplicate public resident." });
});
export type PublicFishOcean = z.infer<typeof PublicFishOceanSchema>;
export type FishSceneResident = Pick<FishResident, "id" | "revision" | "seed"> & {
  fish: Pick<FishCharacter, "draft" | "contentHash">;
};
export interface PublicFishOceanSelection { cursor?: string; residentId?: string; fishId?: string }
export interface SaveFishInput { requestId: string; draft: FishSpec; fishId?: string; expectedRevision?: number }
export interface ReleaseFishInput {
  requestId: string;
  oceanId?: string;
  destination?: "public";
  fishId: string;
  revision: number;
  contentHash: string;
}
export interface ChangeFishResidentInput extends Omit<ReleaseFishInput, "destination"> {
  oceanId: string;
  residentId: string;
  expectedResidentRevision: number;
}
export interface RecallFishInput { destination?: "public"; requestId: string; residentId: string; expectedResidentRevision: number }
