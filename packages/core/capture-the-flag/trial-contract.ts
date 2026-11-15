import { z } from "zod";
import { StrategySchema, ResultSchema, FrameSchema } from "./schema";
export const TrialRequestSchema = z.object({
  seed: z.number().int().min(0).max(0xffffffff),
  challenger: StrategySchema,
  opponents: z
    .array(z.object({ name: z.string().max(128), strategy: StrategySchema }))
    .min(1)
    .max(48),
});
export const TrialMessageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("result"),
    name: z.string(),
    index: z.number().int(),
    total: z.number().int(),
    result: ResultSchema,
    duration: z.number(),
    seed: z.number().int().nonnegative(),
    frames: z.array(FrameSchema).max(482),
  }),
  z.object({ kind: z.literal("done") }),
  z.object({ kind: z.literal("error") }),
]);
export type TrialResult = Extract<
  z.infer<typeof TrialMessageSchema>,
  { kind: "result" }
>;
