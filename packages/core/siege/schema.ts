import { z } from "zod";

export const GRID = 4096;
export const WORLD_SCALE = 8 / GRID;
export const RULES_VERSION = "p0.2";
export const PointSchema = z.tuple([
  z.number().int().min(0).max(GRID),
  z.number().int().min(0).max(GRID),
]);
export const DrawingSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  gridSize: z.literal(GRID),
  strokes: z.array(z.object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    points: z.array(PointSchema).min(2).max(4096),
    width: z.union([z.literal(24), z.literal(40)]),
    color: z.enum(["ink", "accent"]),
  }).strict()).max(64),
}).strict().superRefine((drawing, ctx) => {
  if (drawing.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0) > 4096)
    ctx.addIssue({ code: "custom", message: "too_many_points" });
  if (new Set(drawing.strokes.map(s => s.id)).size !== drawing.strokes.length)
    ctx.addIssue({ code: "custom", message: "duplicate_stroke" });
});
export const PartTypeSchema = z.enum(["blade", "hammer", "cannon", "wheel", "shield", "structure"]);
export const StrokeRefSchema = z.object({
  strokeId: z.string().min(1).max(64),
  fromPoint: z.number().int().nonnegative(),
  toPoint: z.number().int().positive(),
}).strict();
export const PartSchema = z.object({
  id: z.string().min(1).max(64),
  type: PartTypeSchema,
  strokeRefs: z.array(StrokeRefSchema).min(1).max(64),
  anchorHint: PointSchema.nullable(),
  directionHint: PointSchema.nullable(),
}).strict();
export const WeaponSpecSchema = z.object({
  schemaVersion: z.literal(1),
  drawingHash: z.string().regex(/^[a-f0-9]{64}$/),
  parts: z.array(PartSchema).min(1).max(12),
  decorations: z.array(z.object({
    strokeRefs: z.array(StrokeRefSchema).min(1).max(64),
    attachedTo: z.string().nullable(),
  }).strict()).max(64),
  links: z.array(z.object({
    from: z.string(), to: z.string(), kind: z.literal("fixed"),
    anchorHint: PointSchema.nullable(),
  }).strict()).max(11),
  mountHint: PointSchema.nullable(),
  unresolved: z.array(z.string().max(160)).max(8),
}).strict();
export const CannonDesignSchema = z.object({
  kind: z.literal("cannon-kit"), version: z.literal(1),
  barrelLengthMm: z.number().int().min(1600).max(3200).multipleOf(50),
  barrelWidthMm: z.number().int().min(450).max(1050).multipleOf(50),
}).strict();
export type CannonDesign = z.infer<typeof CannonDesignSchema>;
export const FreehandDraftSchema = z.object({ drawing: DrawingSchema, spec: WeaponSpecSchema.nullable().catch(null), name: z.string().max(80).default("我的防线") });
export const WorkshopDraftSchema = z.object({ mode: z.enum(["cannon", "drawing"]), cannonDesign: CannonDesignSchema, cannonName: z.string().max(80), freehand: FreehandDraftSchema });
export type FreehandDraft = z.infer<typeof FreehandDraftSchema>;
export type WorkshopDraft = z.infer<typeof WorkshopDraftSchema>;
export const BlueprintSchema = z.object({
  id: z.string().uuid(), name: z.string().max(80), drawing: DrawingSchema,
  spec: WeaponSpecSchema.nullable().catch(null), rulesVersion: z.string(), createdAt: z.string(),
  cannonDesign: CannonDesignSchema.nullable().default(null).catch(null),
});
export const SessionSchema = z.object({
  id: z.string().uuid(), version: z.number().int().positive(),
  blueprints: z.array(BlueprintSchema).default([]),
});
export const RecognitionSchema = z.object({
  requestId: z.string().uuid(), drawingHash: z.string(),
  state: z.string(), spec: WeaponSpecSchema.nullable().default(null),
  code: z.string().default(""), source: z.string().default("unknown"),
});
export const StatusSchema = z.object({
  mode: z.string().default("unknown"), ready: z.boolean().default(false),
  rulesVersion: z.string(), parts: z.array(z.string()).default([]),
});
export type Point = z.infer<typeof PointSchema>;
export type Drawing = z.infer<typeof DrawingSchema>;
export type Stroke = Drawing["strokes"][number];
export type PartType = z.infer<typeof PartTypeSchema>;
export type Part = z.infer<typeof PartSchema>;
export type WeaponSpec = z.infer<typeof WeaponSpecSchema>;
export type Blueprint = z.infer<typeof BlueprintSchema>;
export type SiegeSession = z.infer<typeof SessionSchema>;
export type Recognition = z.infer<typeof RecognitionSchema>;
export const emptyDrawing = (): Drawing => ({ schemaVersion: 1, revision: 0, gridSize: GRID, strokes: [] });
export function canonicalDrawing(drawing: Drawing): string {
  return JSON.stringify({
    schemaVersion: drawing.schemaVersion, gridSize: drawing.gridSize,
    strokes: drawing.strokes.map(s => ({ id: s.id, points: s.points, width: s.width, color: s.color })),
  });
}
