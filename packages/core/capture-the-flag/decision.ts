import { z } from "zod";

export const DecisionSchema = z.object({
  tick: z.number().int().nonnegative().default(0),
  rule_name: z.string().default(""),
  rule_priority: z.number().default(0),
  matched_rules: z
    .array(z.object({ name: z.string(), priority: z.number() }))
    .max(20)
    .default([]),
  observation_facts: z
    .array(
      z.object({
        source: z.string(),
        operator: z.string(),
        actual: z.unknown(),
        expected: z.unknown(),
        negated: z.boolean().default(false),
      }),
    )
    .max(6000)
    .default([]),
  movement: z.string().default("HOLD_POSITION"),
  movement_target: z.string().default(""),
  movement_target_id: z.string().nullable().default(null),
  attack: z.string().default("NO_ATTACK"),
  attack_target: z.string().default(""),
  attack_target_id: z.string().nullable().default(null),
  action_mode: z
    .enum([
      "MOVE_ONLY",
      "MOVE_AND_ATTACK",
      "ATTACK_ONLY",
      "SHOOTING_LOCK",
      "UNKNOWN",
    ])
    .catch("UNKNOWN")
    .default("UNKNOWN"),
  special: z.string().default("NONE"),
});
export const emptyDecision = DecisionSchema.parse({});
export type Decision = z.infer<typeof DecisionSchema>;
