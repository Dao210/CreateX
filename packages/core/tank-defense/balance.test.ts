// @vitest-environment node
import { describe, expect, it } from "vitest";
import { TankDefenseGame } from "./engine";
import { BASE_WALLS, TANK_LEVELS } from "./levels";

/** Structural playability checks, not a substitute for human difficulty testing. */
describe("tank battlefield pressure", () => {
  it.each(TANK_LEVELS)("$key has usable equipment and spawn lanes", level => {
    const game = new TankDefenseGame(level);
    for (const point of level.enemySpawns) expect(game.canOccupy({ id: -1 }, point.x, point.y)).toBe(true);
    for (const device of level.mechanisms) {
      const points = device.kind === "barrel" || device.kind === "repair" ? [device] : Array.from({ length: device.width / 40 * device.height / 40 }, (_, n) => ({ x: device.x + 20 + n % (device.width / 40) * 40, y: device.y + 20 + Math.floor(n / (device.width / 40)) * 40 }));
      for (const point of points) expect(game.canOccupy({ id: -1 }, point.x, point.y), `${level.key}: ${device.kind} is buried in blocking terrain`).toBe(true);
    }
    expect(BASE_WALLS.every(cell => game.terrain[cell] === "brick")).toBe(true);
  });

  it.each(TANK_LEVELS)("$key threatens an undefended base within two minutes", level => {
    for (const seed of [17, 42, 2026, 3559, 7919]) {
      const game = new TankDefenseGame(level, { seed }); game.start();
      // Isolate enemy navigation/base pressure from the player's life count.
      game.player!.invincibleUntil = Infinity;
      for (let n = 0; n < 120 * 60 && game.phase === "running"; n++) game.step();
      expect(game.tick, `${level.key}: base falls before the initial reaction window`).toBeGreaterThan((level.id <= 2 ? 12 : 8) * 60);
      expect(game.defeatReason, `${level.key}, seed ${seed}: enemies never reached the base`).toBe("base");
    }
  });
});
