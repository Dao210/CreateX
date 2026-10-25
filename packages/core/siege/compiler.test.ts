// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalDrawing, compileWeapon, SAMPLES, sampleSpec, type Drawing } from "./index";
import { convex } from "./geometry";

const hash = (drawing: Drawing) => createHash("sha256").update(canonicalDrawing(drawing)).digest("hex");
const base = () => {
  const sample = structuredClone(SAMPLES[0]!);
  return { drawing: sample.drawing, spec: sampleSpec(sample, hash(sample.drawing)) };
};
describe("siege geometry and compilation", () => {
  it("preserves real dimensions, and adds inertia for a longer arm", () => {
    const a = base(), b = base();
    b.drawing.strokes.forEach(s => { s.points = s.points.map(p => [950 + Math.round((p[0] - 950) * 1.25), p[1]]); });
    b.spec.drawingHash = hash(b.drawing);
    const first = compileWeapon(a.drawing, a.spec, hash(a.drawing));
    const longer = compileWeapon(b.drawing, b.spec, hash(b.drawing));
    expect(longer.reach).toBeGreaterThan(first.reach);
    expect(longer.inertia).toBeGreaterThan(first.inertia);
    expect(longer.ink).toBeGreaterThan(first.ink);
    expect(first.motion).toBe("rotating");
  });
  it("keeps a shield passive and accepts supported samples", () => {
    for (const sample of SAMPLES) {
      const definition = compileWeapon(sample.drawing, sampleSpec(sample, hash(sample.drawing)), hash(sample.drawing));
      expect(definition.ink).toBeLessThanOrEqual(100);
      expect(definition.colliders.length).toBeLessThanOrEqual(24);
      if (sample.id === "shield") expect(definition.motion).toBe("static");
    }
  });
  it("rejects reused geometry, unsupported types and disconnected mechanisms", () => {
    const a = base();
    a.spec.parts[1]!.strokeRefs.push(...a.spec.parts[0]!.strokeRefs);
    expect(() => compileWeapon(a.drawing, a.spec, hash(a.drawing))).toThrow("overlapping_parts");
    const b = base(); b.spec.links = [];
    expect(() => compileWeapon(b.drawing, b.spec, hash(b.drawing))).toThrow("disconnected_parts");
    const c = base(); Object.assign(c.spec.parts[0]!, { type: "unlimited_laser" });
    expect(() => compileWeapon(c.drawing, c.spec, hash(c.drawing))).toThrow("invalid_blueprint");
  });
  it("does not bind changed strokes to an old recognition", () => {
    const a = base(); a.drawing.strokes[0]!.points[0]![0] += 1;
    expect(() => compileWeapon(a.drawing, a.spec, hash(a.drawing))).toThrow("drawing_changed");
    expect(canonicalDrawing({ ...a.drawing, revision: 99 })).toBe(canonicalDrawing(a.drawing));
  });
  it("allows a mount inside a solid outline and rejects detached painted pieces", () => {
    const sample = structuredClone(SAMPLES[2]!);
    const spec = sampleSpec(sample, hash(sample.drawing)); spec.mountHint = [2450, 2000];
    expect(() => compileWeapon(sample.drawing, spec, hash(sample.drawing))).not.toThrow();
    const a = base();
    a.drawing.strokes[2]!.points.forEach(point => { point[1] -= 1000; });
    a.spec.drawingHash = hash(a.drawing);
    expect(() => compileWeapon(a.drawing, a.spec, hash(a.drawing))).toThrow("detached_geometry");
  });
  it("rejects a self-crossing star instead of filling its convex hull", () => {
    const points = [0, 2, 4, 1, 3].map(i => [2000 + Math.cos(i * Math.PI * 2 / 5) * 800, 2000 + Math.sin(i * Math.PI * 2 / 5) * 800] as [number, number]);
    expect(convex(points)).toBe(false);
  });
  it("derives cannon performance from barrel geometry and inertia", () => {
    const sample = structuredClone(SAMPLES[3]!);
    const first = compileWeapon(sample.drawing, sampleSpec(sample, hash(sample.drawing)), hash(sample.drawing));
    const longer = structuredClone(sample);
    longer.drawing.strokes[2]!.points.forEach(p => { if (p[0] === 2850) p[0] = 3250; });
    longer.muzzle = [3250, 2048]; longer.direction = [3750, 2048];
    const next = compileWeapon(longer.drawing, sampleSpec(longer, hash(longer.drawing)), hash(longer.drawing));
    expect(first.motion).toBe("tracking");
    expect(first.launcher!.muzzle).toEqual([(2850 - 1400) * 8 / 4096, 0]);
    expect(next.launcher!.range).toBeGreaterThan(first.launcher!.range);
    expect(next.launcher!.projectileSpeed).toBeGreaterThan(first.launcher!.projectileSpeed);
    expect(next.launcher!.reloadTicks).toBeGreaterThan(first.launcher!.reloadTicks);
    expect(next.launcher!.maxTurnSpeed).toBeLessThanOrEqual(first.launcher!.maxTurnSpeed);
    expect(next.ink).toBeGreaterThan(first.ink);
  });
  it("requires a real muzzle on the forward end and an unambiguous barrel", () => {
    const sample = SAMPLES[3]!, drawing = sample.drawing, h = hash(drawing);
    const make = () => sampleSpec(sample, h);
    const missing = make(); missing.parts[2]!.anchorHint = null;
    expect(() => compileWeapon(drawing, missing, h)).toThrow("missing_muzzle");
    const floating = make(); floating.parts[2]!.anchorHint = [3200, 2048];
    expect(() => compileWeapon(drawing, floating, h)).toThrow("muzzle_outside_barrel");
    const same = make(); same.parts[2]!.directionHint = same.parts[2]!.anchorHint;
    expect(() => compileWeapon(drawing, same, h)).toThrow("invalid_cannon_direction");
    const reversed = make(); reversed.parts[2]!.directionHint = [2000, 2048];
    expect(() => compileWeapon(drawing, reversed, h)).toThrow("muzzle_not_forward");
    const sideways = make(); sideways.parts[2]!.directionHint = [2850, 2700];
    expect(() => compileWeapon(drawing, sideways, h)).toThrow("invalid_barrel_shape");
    const multiple = make(); multiple.parts[1]!.type = "cannon";
    expect(() => compileWeapon(drawing, multiple, h)).toThrow("multiple_cannons");
    const mixed = make(); mixed.parts[1]!.type = "blade";
    expect(() => compileWeapon(drawing, mixed, h)).toThrow("mixed_attacks");
  });
});
