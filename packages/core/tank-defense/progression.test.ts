// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyTankGrowth, tankGrowth, TANK_MAX_XP } from "./progression";
import { compileTankCharacter } from "./characters";

const draft = { profile: "tank-defense@1", name: "Sky", parts: { chassis: "light", armor: "standard", cannon: "rapid" }, appearance: { body: "#38bdf8", accent: "#1d4ed8", pattern: "stripe" } };
describe("per-character permanent growth", () => {
  it("crosses exact thresholds, stops at level ten and keeps the base budget intact", () => {
    const base = compileTankCharacter(draft);
    expect(tankGrowth(99)).toMatchObject({ level: 1, remaining: 1 });
    expect(tankGrowth(100)).toMatchObject({ level: 2, earned: 0 });
    expect(applyTankGrowth(base.blueprint, 700)).toMatchObject({ speed: 104, armor: 2, fireInterval: 14, evolution: 1 });
    expect(applyTankGrowth(base.blueprint, TANK_MAX_XP)).toMatchObject({ speed: 110, armor: 3, fireInterval: 12, evolution: 2 });
    expect(tankGrowth(1e10)).toMatchObject({ level: 10, xp: TANK_MAX_XP, remaining: 0 });
    expect(base).toMatchObject({ cost: 9, blueprint: { speed: 98, armor: 2, fireInterval: 15 } });
  });
  it("applies the same experience to a revised design and keeps independent tanks independent", () => {
    const revised = compileTankCharacter({ ...draft, parts: { chassis: "heavy", armor: "standard", cannon: "rapid" } });
    expect(applyTankGrowth(revised.blueprint, 700).speed).toBe(revised.blueprint.speed + 6);
    expect(applyTankGrowth(revised.blueprint).speed).toBe(revised.blueprint.speed);
  });
});
