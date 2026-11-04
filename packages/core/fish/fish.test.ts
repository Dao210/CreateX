// @vitest-environment node
import { describe, expect, it } from "vitest";
import { z } from "zod";
import cases from "./contract-cases.json";
import { FishSpecSchema, FISH_CATALOG, FISH_EXAMPLES } from "./schema";
import { compileFishGeometry } from "./geometry";
import { stepFish, swimState } from "./engine";
describe("fish contract and ambient runtime", () => {
  it("accepts the canonical examples with the published schema and distinct geometry", () => {
    const jsonSchema = z.fromJSONSchema(FISH_CATALOG.draftSchema as Parameters<typeof z.fromJSONSchema>[0]);
    for (const spec of FISH_EXAMPLES) {
      expect(jsonSchema.safeParse(spec).success).toBe(true);
      const g = compileFishGeometry(spec);
      expect(g.positions.every(Number.isFinite)).toBe(true);
      expect(Math.max(...g.indices)).toBeLessThan(g.positions.length / 3);
      expect(g.colors.length).toBe(g.positions.length);
      expect(compileFishGeometry(spec)).toEqual(g);
    }
    expect(new Set(FISH_EXAMPLES.map(s => JSON.stringify(compileFishGeometry(s).positions))).size).toBe(6);
  });
  it("rejects invalid ordering, unknown scripts, detached and concave fins", () => {
    const spec = structuredClone(FISH_EXAMPLES[0]!);
    spec.body.sections[1]!.u = 0;
    expect(FishSpecSchema.safeParse(spec).success).toBe(false);
    expect(FishSpecSchema.safeParse({ ...FISH_EXAMPLES[0], script: "alert(1)" }).success).toBe(false);
    spec.body.sections[1]!.u = 180;
    spec.fins[0]!.outline[0]!.y = -1;
    expect(FishSpecSchema.safeParse(spec).success).toBe(false);
  });
  it("keeps a diverse school finite, bounded and repeatable over ten simulated minutes", () => {
    const make = () => Array.from({ length: 50 }, (_, i) => swimState(String(i), FISH_EXAMPLES[i % 6]!, i + 1));
    const a = make(), b = make();
    for (let i = 0; i < 12000; i++) { stepFish(a, 0.05, i * 0.05); stepFish(b, 0.05, i * 0.05); }
    expect(a).toEqual(b);
    for (const s of a) { expect(s.position.every(Number.isFinite)).toBe(true); expect(Math.abs(s.position[0])).toBeLessThanOrEqual(12); expect(s.position[1]).toBeGreaterThanOrEqual(0.7); expect(Math.abs(s.position[2])).toBeLessThanOrEqual(8); }
    const before = structuredClone(a); stepFish(a, 500, 800); expect(a).toEqual(before);
  }, 20000);
});

it.each(cases)("matches the shared contract case: $name", testCase => {
  const raw = JSON.parse(JSON.stringify(FISH_EXAMPLES[0]));
  for (const change of testCase.changes) { let parent = raw; for (const segment of change.path.slice(0, -1)) parent = parent[segment]; parent[change.path.at(-1)!] = change.value; }
  expect(FishSpecSchema.safeParse(raw).success).toBe(testCase.valid);
});
