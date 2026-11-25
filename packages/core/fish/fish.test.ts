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
      expect(g.finFlex.length).toBe(g.positions.length / 3);
      expect(compileFishGeometry(spec)).toEqual(g);
    }
    expect(new Set(FISH_EXAMPLES.map(s => JSON.stringify(compileFishGeometry(s).positions))).size).toBe(6);
  });
  it("interpolates a glider's fin flex from its stationary roots to the tips", () => {
    const spec = FISH_EXAMPLES.find(example => example.motion.style === "fin-glide")!;
    const geometry = compileFishGeometry(spec);
    const tip = Math.max(...geometry.finFlex);
    expect(tip).toBeGreaterThan(0);
    expect(geometry.finFlex.some(weight => weight > 0 && weight < tip)).toBe(true);
    expect(geometry.finFlex[0]).toBe(0);
    const distant = compileFishGeometry(spec, "distant");
    expect(distant.positions.length).toBeLessThan(geometry.positions.length);
    expect(Math.max(...distant.finFlex)).toBe(tip);
  });
  it.each(FISH_EXAMPLES)("builds bounded high-detail geometry for $name without changing the design", spec => {
    const source = structuredClone(spec);
    const standard = compileFishGeometry(spec);
    const high = compileFishGeometry(spec, "high");
    expect(high.positions.length).toBeGreaterThan(standard.positions.length);
    expect(high.positions.length / 3).toBeLessThan(10_000);
    expect(high.positions.every(Number.isFinite)).toBe(true);
    expect(high.indices.every(index => Number.isInteger(index) && index >= 0 && index < high.positions.length / 3)).toBe(true);
    expect(high.colors.length).toBe(high.positions.length);
    expect(high.finFlex.length).toBe(high.positions.length / 3);
    expect(high.surface.length).toBe(high.positions.length);
    expect(high.surface.every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    expect(Math.max(...high.finFlex)).toBe(Math.max(...standard.finFlex));
    expect(high).toEqual(compileFishGeometry(spec, "high"));
    expect(spec).toEqual(source);
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
