// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PLAYER_TANK } from "@auro/core/tank-defense";
import { paintTank } from "./painter";

const player = { x: 100, y: 100, team: "player", direction: "up", blueprint: { ...PLAYER_TANK, appearance: { body: "#4f9a68", accent: "#d5ed99", pattern: "stripe" } }, hp: 1, moving: false } satisfies Parameters<typeof paintTank>[1];

function draw(tank: Parameters<typeof paintTank>[1], options: Parameters<typeof paintTank>[3]) {
  const operations: unknown[][] = [], values: Record<string, unknown> = {};
  const ctx = new Proxy(values, {
    get: (_, key) => values[String(key)] ?? ((...args: unknown[]) => operations.push([String(key), ...args])),
    set: (_, key, value) => { values[String(key)] = value; operations.push([String(key), value]); return true; },
  }) as unknown as CanvasRenderingContext2D;
  paintTank(ctx, tank, 120, options);
  return operations;
}

describe("tank transformation rendering", () => {
  it("keeps a pure black custom tank free of classic gold tracks and green hardware", () => {
    const black = { ...player, blueprint: { ...player.blueprint, appearance: { body: "#000000", accent: "#000000", pattern: "solid" as const } } };
    for (const power of [0, 1, 2]) {
      const colors = draw(black, { power }).filter(command => command[0] === "fillStyle").map(command => command[1]);
      expect(colors).toContain("#000000");
      expect(colors).not.toContain("#8d713b");
      expect(colors).not.toContain("#344131");
    }
  });

  it("gives each firepower tier a distinct shape while keeping both custom paint colors", () => {
    const tiers = [0, 1, 2].map(power => draw(player, { power }));
    const shapes = tiers.map(commands => JSON.stringify(commands.filter(command => command[0] === "fillRect")));
    expect(new Set(shapes).size).toBe(3);
    for (const commands of tiers) {
      expect(commands).toContainEqual(["fillStyle", player.blueprint.appearance.body]);
      expect(commands).toContainEqual(["fillStyle", player.blueprint.appearance.accent]);
    }
  });

  it("does not move an enemy's cannon when the player transforms", () => {
    const enemy = { ...player, team: "enemy" as const };
    expect(draw(enemy, { power: 2, upgradeAge: 0 })).toEqual(draw(enemy, { power: 0 }));
  });

  it("disables the deployment and flash for reduced motion while keeping the upgraded shape", () => {
    expect(draw(player, { power: 2, upgradeAge: 0, reducedMotion: true })).toEqual(draw(player, { power: 2 }));
    expect(draw(player, { power: 2, upgradeAge: 0 })).not.toEqual(draw(player, { power: 2 }));
  });
});
