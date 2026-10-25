// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { CannonDesignSchema, DrawingSchema, WeaponSpecSchema, canonicalDrawing } from "./schema";
import { CANNON_LIMITS, DEFAULT_CANNON, createCannonDrawing, createCannonSpec } from "./cannon";
import { compileWeapon } from "./compiler";

const definition = (design = DEFAULT_CANNON) => {
  const drawing = createCannonDrawing(design);
  const hash = createHash("sha256").update(canonicalDrawing(drawing)).digest("hex");
  return compileWeapon(drawing, createCannonSpec(drawing, hash), hash, design);
};

it("keeps every selectable size connected, in budget, and inside the drawing grid", () => {
  for (let length = CANNON_LIMITS.length.min; length <= CANNON_LIMITS.length.max; length += CANNON_LIMITS.step)
    for (let width = CANNON_LIMITS.width.min; width <= CANNON_LIMITS.width.max; width += CANNON_LIMITS.step) {
      const compiled = definition({ ...DEFAULT_CANNON, barrelLengthMm: length, barrelWidthMm: width });
      expect(compiled.ink).toBeLessThanOrEqual(100);
      expect(compiled.launcher!.barrelLength).toBeCloseTo(length / 1000, 2);
      expect(compiled.launcher!.muzzle[0]).toBeCloseTo(0.625 + length / 1000, 2);
      expect(compiled.motion).toBe("tracking");
    }
});

it("makes length and width affect geometry, cost, reload and firing performance", () => {
  const base = definition(), longer = definition({ ...DEFAULT_CANNON, barrelLengthMm: 3200 });
  const thinner = definition({ ...DEFAULT_CANNON, barrelWidthMm: 450 });
  expect(longer.launcher!.range).toBeGreaterThan(base.launcher!.range);
  expect(longer.launcher!.projectileSpeed).toBeGreaterThan(base.launcher!.projectileSpeed);
  expect(longer.launcher!.reloadTicks).toBeGreaterThan(base.launcher!.reloadTicks);
  expect(longer.launcher!.maxTurnSpeed).toBeLessThan(base.launcher!.maxTurnSpeed);
  expect(longer.ink).toBeGreaterThan(base.ink);
  expect(thinner.mass).toBeLessThan(base.mass);
  expect(thinner.launcher!.damage).toBeLessThan(base.launcher!.damage);
  expect(thinner.launcher!.reloadTicks).toBeLessThan(base.launcher!.reloadTicks);
});

it("rejects mismatched saved parameters and shares a versioned fixture with Go", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/cannon-design-v1.json", import.meta.url), "utf8"));
  const design = CannonDesignSchema.parse(fixture.cannonDesign), drawing = DrawingSchema.parse(fixture.drawing);
  const hash = createHash("sha256").update(canonicalDrawing(drawing)).digest("hex");
  const spec = WeaponSpecSchema.parse(fixture.spec);
  expect(createCannonDrawing(design, drawing.revision)).toEqual(drawing);
  expect(WeaponSpecSchema.parse(createCannonSpec(drawing, hash))).toEqual(spec);
  expect(() => compileWeapon(drawing, spec, hash, design)).not.toThrow();
  expect(() => compileWeapon(drawing, spec, hash, { ...design, barrelLengthMm: 3200 })).toThrow("cannon_design_mismatch");
  expect(CannonDesignSchema.safeParse({ ...design, barrelWidthMm: 99999 }).success).toBe(false);
  expect(CannonDesignSchema.safeParse({ ...design, barrelWidthMm: 951 }).success).toBe(false);
});
