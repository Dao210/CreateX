// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CAMPAIGN_LEVELS, campaignStars, compileCampaignWeapon, defaultProgress, pointOnRoute, presetBlueprint, routeLength, sellPrice, unlockedLevel, validCheckpoint, WEAPON_RECIPES } from "./campaign";
import type { CampaignCheckpoint, WeaponKind } from "./campaign";

describe("campaign rules", () => {
  it("compiles every recipe through the existing geometry and preserves size tradeoffs", () => {
    for (const kind of Object.keys(WEAPON_RECIPES) as WeaponKind[]) {
      const weapon = compileCampaignWeapon(kind, presetBlueprint(kind));
      expect(weapon.cost).toBeGreaterThan(0); expect(weapon.definition.ink).toBeLessThanOrEqual(100);
      if (kind === "blade") expect(weapon.definition.motion).toBe("rotating");
    }
    const short = compileCampaignWeapon("cannon", presetBlueprint("cannon", { kind: "cannon-kit", version: 1, barrelLengthMm: 1600, barrelWidthMm: 950 }));
    const long = compileCampaignWeapon("cannon", presetBlueprint("cannon", { kind: "cannon-kit", version: 1, barrelLengthMm: 3200, barrelWidthMm: 950 }));
    expect(long.range).toBeGreaterThan(short.range);
    expect(long.definition.launcher!.maxTurnSpeed).toBeLessThan(short.definition.launcher!.maxTurnSpeed);
    expect(long.cost).toBeGreaterThan(short.cost);
    expect(() => compileCampaignWeapon("hammer", presetBlueprint("cannon"))).toThrow();
  });
  it("advances along corners and never teleports beyond the castle", () => {
    const route = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }];
    expect(routeLength(route)).toBe(7); expect(pointOnRoute(route, 5)).toEqual({ x: 4, y: 1 });
    expect(pointOnRoute(route, 100)).toEqual({ x: 4, y: 3 });
    expect(pointOnRoute(route, -1)).toEqual(route[0]);
  });
  it("awards stars only on survival and unlocks consecutive cleared levels", () => {
    expect(campaignStars(0, 0)).toBe(0); expect(campaignStars(90, 2)).toBe(1); expect(campaignStars(100, 0)).toBe(3);
    const stars = defaultProgress().stars;
    expect(unlockedLevel(stars)).toBe(1); stars[0] = 1; expect(unlockedLevel(stars)).toBe(2);
    expect(sellPrice(100, 3)).toBe(196);
  });
  it("rejects inconsistent or future wave checkpoints before creating physics", () => {
    const level = CAMPAIGN_LEVELS[0]!;
    const input: CampaignCheckpoint = { version: "woodland-1", levelId: 1, completedWaves: 1, hp: 100, gold: 120, tick: 900, kills: 5, leaks: [], obstacles: [], towers: [] };
    expect(validCheckpoint(input)).toEqual(input);
    expect(validCheckpoint({ ...input, version: "future" })).toBeNull();
    expect(validCheckpoint({ ...input, completedWaves: level.waves.length })).toBeNull();
    const tower = { id: 1, slot: 0, level: 1, kind: "cannon", blueprint: presetBlueprint("cannon"), damage: 0, kills: 0, shots: 0, control: 0 };
    expect(validCheckpoint({ ...input, towers: [tower, { ...tower, id: 2 }] })).toBeNull();
    expect(validCheckpoint({ ...input, levelId: 2, towers: [], obstacles: [] })).toBeNull();
    expect(validCheckpoint({ ...input, towers: [{ ...tower, kind: "frost" }] })).toBeNull();
  });
});
