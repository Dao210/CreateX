import { z } from "zod";

const number = z.number().finite();
const count = number.int().nonnegative();
const text = z.string().max(1000);
const palette = z.array(z.string().regex(/^#[\da-f]{6}$/i)).min(3).max(8).catch(["#14161A", "#C8622D", "#E8E1D5"]);
const list = <T extends z.ZodType>(schema: T) => z.array(schema).nullish().transform((value) => value ?? []);

export const worldSnapshotSchema = z.object({
  season: text,
  beat: count,
  version: count,
  rulesVersion: text,
  digest: text,
  rifts: list(number),
  supplies: list(z.object({ id: text, x: number, y: number, charge: number })),
  entities: list(z.object({
    id: text, name: text, kind: z.enum(["weapon", "character"]).catch("character"),
    x: number, y: number, hp: number,
    status: z.enum(["alive", "dead"]).catch("dead"),
    kills: count.default(0), survived: count.default(0),
    palette, silhouette: z.enum(["slim", "broad", "tall", "low"]).catch("slim"),
    form: text.optional(), geometry: text.optional(), generator: text.default("unknown"),
  })),
  wrecks: list(z.object({ id: text, name: text, x: number, y: number, beat: count, claimed: z.boolean().default(false) })),
  chronicle: list(z.object({
    seq: count, beat: count, kind: z.enum(["kill", "first_blood", "death", "claim", "catastrophe"]).catch("kill"),
    entities: z.array(text).optional(), belt: count.optional(), text: z.object({ en: text, zh: text, ja: text.optional(), ko: text.optional() }),
  })),
});

export const seasonInfoSchema = z.object({
  id: text, beat: count, beatsLeft: count, beatSeconds: number.positive().max(86400),
  rulesVersion: text, entities: count, alive: count, wrecks: count,
});
