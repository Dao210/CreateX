// @vitest-environment node
import { describe, expect, it } from "vitest";
import { TankDefenseGame, PLAYER_TANK } from "./engine";
import type { TankBullet } from "./types";
import { BASE_WALLS, TANK_GRID, TANK_LEVELS, type TankLevel, type Terrain } from "./levels";

function arena(overrides: Partial<TankLevel> = {}): TankLevel {
  return { id: 1, key: "frontline", mechanisms: [], maxActive: 4, spawnInterval: 120, deploymentDelay: 30, terrain: Array<Terrain>(26 * 26).fill("floor"), enemies: ["scout"], playerSpawn: { x: 180, y: 500 }, enemySpawns: [{ x: 500, y: 20 }], ...overrides };
}
function advance(game: TankDefenseGame, ticks: number) { for (let n = 0; n < ticks; n++) game.step(); }
function bullet(values: Partial<TankBullet> = {}): TankBullet {
  return { id: 999, owner: 998, team: "enemy", x: 260, y: 476, direction: "down", speed: 300, power: 0, alive: true, ...values };
}

describe("classic tank defense", () => {
  it("ships six bounded maps with usable player spawns and growing enemy rosters", () => {
    expect(TANK_LEVELS.map(level => level.enemies.length)).toEqual([10, 12, 14, 16, 18, 20]);
    for (const level of TANK_LEVELS) {
      expect(level.terrain).toHaveLength(TANK_GRID * TANK_GRID);
      const game = new TankDefenseGame(level);
      expect(game.player).not.toBeNull();
      expect(game.canOccupy(game.player!, game.player!.x, game.player!.y)).toBe(true);
      expect(BASE_WALLS.every(cell => game.terrain[cell] === "brick")).toBe(true);
      game.terrain[0] = "steel";
      expect(level.terrain[0]).toBe("floor");
    }
  });

  it("moves only during a running, unpaused battle", () => {
    const game = new TankDefenseGame(arena());
    game.setInput("up", false); advance(game, 10);
    expect(game.player!.y).toBe(500);
    game.start(); advance(game, 18);
    expect(game.player!.y).toBeCloseTo(500 - PLAYER_TANK.speed * 18 / 60);
    const tick = game.tick, y = game.player!.y;
    game.setPaused(true); game.setInput("up", true); advance(game, 120);
    expect(game.tick).toBe(tick); expect(game.player!.y).toBe(y); expect(game.shots).toBe(0);
    game.setPaused(false); advance(game, 3);
    expect(game.player!.y).toBe(y);
  });

  it.each(["brick", "steel", "water"] as const)("blocks tank movement through %s", terrain => {
    const level = arena(); level.terrain[23 * 26 + 9] = terrain;
    const game = new TankDefenseGame(level); game.start(); game.setInput("up", false); advance(game, 60);
    expect(game.player!.y).toBeGreaterThanOrEqual(494);
    expect(game.player!.y).toBeLessThan(497);
  });

  it("damages and opens a brick passage with real projectiles", () => {
    const level = arena(); level.terrain[23 * 26 + 8] = "brick"; level.terrain[23 * 26 + 9] = "brick";
    const game = new TankDefenseGame(level); game.start(); game.setInput(null, true); advance(game, 26);
    expect(game.shots).toBe(2); expect(game.destroyedBricks).toBe(2);
    expect(game.terrain[23 * 26 + 9]).toBe("floor");
  });

  it("requires maximum player firepower to destroy steel", () => {
    const level = arena(); level.terrain[23 * 26 + 9] = "steel";
    for (const power of [0, 1, 2]) {
      const game = new TankDefenseGame(level); game.power = power; game.start(); game.setInput(null, true); advance(game, 10);
      expect(game.terrain[23 * 26 + 9]).toBe(power === 2 ? "floor" : "steel");
    }
  });

  it("lets projectiles pass through water", () => {
    const level = arena(); level.terrain[23 * 26 + 9] = "water";
    const game = new TankDefenseGame(level); game.start(); game.setInput(null, true); advance(game, 12);
    expect(game.bullets[0]!.y).toBeLessThan(460); expect(game.terrain[23 * 26 + 9]).toBe("water");
  });

  it.each(["enemy", "player"] as const)("loses immediately when a %s round hits the castle", team => {
    const game = new TankDefenseGame(arena({ enemies: [] })); game.start(); game.bullets.push(bullet({ team })); game.step();
    expect(game.phase).toBe("defeat"); expect(game.baseAlive).toBe(false); expect(game.defeatReason).toBe("base");
  });

  it("consumes a life, respawns the frozen player blueprint and grants a shield", () => {
    const blueprint = { ...PLAYER_TANK, id: "custom", speed: 90 };
    const game = new TankDefenseGame(arena(), { playerBlueprint: blueprint }); blueprint.speed = 999;
    game.start(); game.player!.invincibleUntil = 0;
    game.bullets.push(bullet({ x: 180, y: 517, direction: "up" })); game.step();
    expect(game.lives).toBe(2); expect(game.player).toBeNull();
    advance(game, 90);
    expect(game.player?.blueprint.speed).toBe(90); expect(game.player?.blueprint.id).toBe("custom");
    expect(game.snapshot().shield).toBe(true);
  });

  it("ends the battle when the last player life is lost", () => {
    const game = new TankDefenseGame(arena(), { lives: 1 }); game.start(); game.player!.invincibleUntil = 0;
    game.bullets.push(bullet({ x: 180, y: 517, direction: "up" })); game.step();
    expect(game.phase).toBe("defeat"); expect(game.defeatReason).toBe("lives");
  });

  it("defers blocked enemy spawns without dropping the remaining roster or declaring victory", () => {
    const game = new TankDefenseGame(arena({ enemySpawns: [{ x: 180, y: 500 }] })); game.start(); advance(game, 300);
    expect(game.phase).toBe("running"); expect(game.snapshot().activeEnemies).toBe(0); expect(game.snapshot().remaining).toBe(1);
    game.player!.x = 100; advance(game, 15);
    expect(game.snapshot().activeEnemies).toBe(1);
  });

  it("awards a cleared stage only after the final spawned tank is destroyed", () => {
    const game = new TankDefenseGame(arena()); game.start(); advance(game, 30);
    const enemy = game.tanks.find(tank => tank.team === "enemy")!;
    Object.assign(enemy, { x: 180, y: 420, invincibleUntil: 0, thinkAt: 10000 });
    game.setInput(null, true); advance(game, 30);
    expect(game.kills).toBe(1); expect(game.score).toBe(100); expect(game.phase).toBe("cleared");
  });

  it("cancels opposing projectiles instead of allowing duplicate impacts", () => {
    const game = new TankDefenseGame(arena()); game.start();
    game.bullets.push(bullet({ x: 200, y: 300, direction: "down", team: "player" }), bullet({ id: 1000, x: 200, y: 306, direction: "up" }));
    game.step(); expect(game.bullets).toHaveLength(0); expect(game.baseAlive).toBe(true);
  });

  it("collects firepower and fortifies the castle without changing the level source", () => {
    const level = arena(); const game = new TankDefenseGame(level); game.start();
    game.pickups.push({ x: 180, y: 500, id: 1000, kind: "star", expire: 1000 }); game.step();
    expect(game.power).toBe(1); expect(game.score).toBe(250);
    game.pickups.push({ x: 180, y: 500, id: 1001, kind: "fortify", expire: 1000 }); game.step();
    expect(BASE_WALLS.every(cell => game.terrain[cell] === "steel")).toBe(true);
    expect(BASE_WALLS.every(cell => level.terrain[cell] === "floor")).toBe(true);
  });

  it("a bomb clears active enemies but does not skip unspawned opponents", () => {
    const game = new TankDefenseGame(arena({ enemies: ["scout", "scout"] })); game.start(); advance(game, 30);
    game.pickups.push({ x: 180, y: 500, id: 1000, kind: "bomb", expire: 1000 }); game.step();
    expect(game.kills).toBe(1); expect(game.snapshot().remaining).toBe(1); expect(game.phase).toBe("running");
  });

  it("retains a short fire tap until the next fixed step and clears it on pause", () => {
    const game = new TankDefenseGame(arena()); game.start(); game.setInput(null, true); game.setInput(null, false); game.step();
    expect(game.shots).toBe(1);
    game.queueFire(); game.setPaused(true); game.setPaused(false); advance(game, 30);
    expect(game.shots).toBe(1);
  });

});

describe("arcade balance and field equipment", () => {
  it("allows two starting shells and three upgraded shells in flight", () => {
    for (const power of [0, 1, 2]) {
      const game = new TankDefenseGame(arena()); game.power = power; game.start();
      game.setInput(null, true); advance(game, 67);
      expect(game.shots).toBe(power === 0 ? 2 : 3);
    }
  });

  it("loses one firepower tier on death instead of erasing every upgrade", () => {
    const game = new TankDefenseGame(arena(), { power: 2 }); game.start(); game.player!.invincibleUntil = 0;
    game.bullets.push(bullet({ x: 180, y: 517, direction: "up" })); game.step();
    expect(game.power).toBe(1); expect(game.lives).toBe(2);
  });

  it("keeps the campaign running beyond the old third-stage ending", () => {
    const third = new TankDefenseGame(arena({ id: 3, enemies: [] })); third.start(); third.step();
    expect(third.phase).toBe("cleared");
    const final = new TankDefenseGame(arena({ id: TANK_LEVELS.length, enemies: [] })); final.start(); final.step();
    expect(final.phase).toBe("victory");
  });

  it("gives blitz a real deadline that freezes while paused", () => {
    const game = new TankDefenseGame(arena({ enemySpawns: [{ x: 180, y: 500 }] }), { mode: "blitz" }); game.start();
    expect(game.power).toBe(1); expect(game.snapshot().timeLeft).toBe(90);
    advance(game, 60); game.setPaused(true); advance(game, 600);
    expect(game.snapshot().timeLeft).toBe(89);
    game.setPaused(false); advance(game, 89 * 60);
    expect(game.phase).toBe("defeat"); expect(game.defeatReason).toBe("time");
  });

  it("ends a blitz on a single cleared map", () => {
    const game = new TankDefenseGame(arena({ enemies: [] }), { mode: "blitz" }); game.start(); game.step();
    expect(game.phase).toBe("victory");
  });

  it("respects each campaign map's active-enemy cap", () => {
    const game = new TankDefenseGame(arena({ enemySpawns: [{ x: 20, y: 20 }, { x: 260, y: 20 }, { x: 500, y: 20 }], maxActive: 2, enemies: Array(8).fill("scout") })); game.start();
    for (let n = 0; n < 1000; n++) {
      for (const enemy of game.tanks.filter(tank => tank.team === "enemy")) { enemy.blueprint.speed = 0; enemy.reloadAt = Infinity; }
      game.step();
      expect(game.snapshot().activeEnemies).toBeLessThanOrEqual(2);
    }
    expect(game.snapshot().activeEnemies).toBe(2); expect(game.phase).toBe("running");
  });

  it("rests between survival waves, increases the roster, and restores a life on wave three", () => {
    const game = new TankDefenseGame(arena(), { mode: "survival", lives: 1 }); game.start();
    const clearWave = () => {
      for (let n = 0; n < 5000 && !game.snapshot().intermission; n++) {
        if (game.snapshot().activeEnemies) game.pickups.push({ ...game.player!, id: 9000 + n, kind: "bomb", expire: game.tick + 2 });
        game.step();
      }
      expect(game.phase).toBe("running"); expect(game.snapshot().intermission).toBe(5);
    };
    expect(game.snapshot().waveTotal).toBe(8); clearWave();
    advance(game, 299); expect(game.wave).toBe(1); expect(game.snapshot().activeEnemies).toBe(0);
    game.step(); expect(game.wave).toBe(2); expect(game.snapshot().waveTotal).toBe(10); expect(game.waveKills).toBe(0);
    clearWave(); advance(game, 300);
    expect(game.wave).toBe(3); expect(game.lives).toBe(2); expect(game.snapshot().waveTotal).toBe(12);
    expect(game.kills).toBe(18);
  });

  it("drops the first upgrade on kill three into a reachable lane", () => {
    const level = arena({ enemies: ["scout", "scout", "scout", "scout"] });
    // Seal off the east half. Supplies must remain on the player's side.
    for (let row = 0; row < 26; row++) level.terrain[row * 26 + 10] = "steel";
    level.enemySpawns = [{ x: 20, y: 20 }];
    const game = new TankDefenseGame(level); game.start();
    for (let n = 0; n < 1000 && game.kills < 3; n++) {
      const enemy = game.tanks.find(tank => tank.team === "enemy");
      if (enemy) {
        Object.assign(enemy, { x: 100, y: 200, invincibleUntil: 0, reloadAt: Infinity }); enemy.blueprint.speed = 0;
        game.bullets.push(bullet({ x: 100, y: 217, direction: "up", team: "player", id: 10000 + n }));
      }
      game.step();
    }
    expect(game.kills).toBe(3); expect(game.pickups).toHaveLength(1);
    expect(game.pickups[0]!.kind).toBe("star"); expect(game.pickups[0]!.x).toBeLessThan(200);
  });

  it("caps chain scoring at three and resets it after four seconds", () => {
    const game = new TankDefenseGame(arena({ spawnInterval: 30, enemies: Array(8).fill("scout"), enemySpawns: [{ x: 20, y: 20 }, { x: 260, y: 20 }, { x: 500, y: 20 }] }));
    game.start(); advance(game, 91);
    game.pickups.push({ ...game.player!, id: 9000, kind: "bomb", expire: 1000 }); game.step();
    expect(game.kills).toBe(3); expect(game.score).toBe(850); expect(game.snapshot().combo).toBe(3);
    for (let n = 0; n < 241; n++) { for (const enemy of game.tanks) if (enemy.team === "enemy") enemy.reloadAt = Infinity; game.step(); }
    expect(game.snapshot().combo).toBe(0);
    const before = game.score, count = game.snapshot().activeEnemies;
    game.pickups.push({ ...game.player!, id: 9001, kind: "bomb", expire: 1000 }); game.step();
    expect(count).toBe(4); expect(game.score - before).toBe(250 + 100 + 200 + 300 + 300);
  });

  it("pushes both sides on conveyors without changing aim or crossing solid walls", () => {
    const level = arena({ mechanisms: [{ kind: "conveyor", x: 160, y: 480, width: 80, height: 40, direction: "right" }] });
    const game = new TankDefenseGame(level); game.start(); advance(game, 20);
    expect(game.player!.x).toBe(190); expect(game.player!.direction).toBe("up");
    advance(game, 120); expect(game.player!.x).toBeLessThanOrEqual(226);
    game.player!.x = 100;
    const enemy = game.tanks.find(tank => tank.team === "enemy")!;
    Object.assign(enemy, { x: 180, y: 500, direction: "up", thinkAt: Infinity }); enemy.blueprint.speed = 0;
    const before = enemy.x; game.step(); expect(enemy.x).toBe(before + 0.5);
  });

  it("warns before a pulse, stuns once per cycle, and leaves firing available", () => {
    const game = new TankDefenseGame(arena({ mechanisms: [{ kind: "pulse", x: 160, y: 480, width: 80, height: 40, offset: 0 }] }));
    game.start(); game.player!.invincibleUntil = 0; advance(game, 299); expect(game.snapshot().stunned).toBe(false);
    game.step(); expect(game.snapshot().stunned).toBe(true);
    game.setInput("left", true); const x = game.player!.x; game.step();
    expect(game.player!.x).toBe(x); expect(game.shots).toBe(1);
    advance(game, 30); expect(game.player!.x).toBeLessThan(x); expect(game.snapshot().stunned).toBe(false);
  });

  it("repairs only lost lives and consumes a station once, without exceeding three", () => {
    const source = arena({ mechanisms: [{ kind: "repair", x: 180, y: 500 }] });
    const game = new TankDefenseGame(source); game.start(); game.step();
    expect(game.mechanisms[0]!.spent).toBe(false);
    game.lives = 1; game.step(); expect(game.lives).toBe(2); expect(game.mechanisms[0]!.spent).toBe(true);
    advance(game, 10); expect(game.lives).toBe(2);
    expect("spent" in source.mechanisms[0]!).toBe(false);
  });

  it("chains barrels, opens brick, respects steel and damages nearby armor", () => {
    const level = arena({ mechanisms: [{ kind: "barrel", x: 100, y: 200 }, { kind: "barrel", x: 140, y: 200 }], enemies: ["armor"] });
    level.terrain[8 * 26 + 4] = "brick"; level.terrain[8 * 26 + 5] = "steel";
    const game = new TankDefenseGame(level); game.start(); advance(game, 30);
    const enemy = game.tanks.find(tank => tank.team === "enemy")!;
    Object.assign(enemy, { x: 180, y: 200, invincibleUntil: 0, reloadAt: Infinity }); enemy.blueprint.speed = 0;
    game.bullets.push(bullet({ x: 100, y: 216, direction: "up", team: "player" })); game.step();
    expect(game.mechanisms.every(device => device.spent)).toBe(true);
    expect(enemy.hp).toBe(1); expect(game.terrain[8 * 26 + 4]).toBe("floor"); expect(game.terrain[8 * 26 + 5]).toBe("steel");
    expect(game.effects.filter(effect => effect.kind === "blast")).toHaveLength(2);
  });

  it("lets a barrel blast hurt the player but respects a spawn shield", () => {
    for (const shielded of [false, true]) {
      const game = new TankDefenseGame(arena({ mechanisms: [{ kind: "barrel", x: 180, y: 440 }] })); game.start();
      if (!shielded) game.player!.invincibleUntil = 0;
      game.bullets.push(bullet({ x: 180, y: 455, direction: "up", team: "player" })); game.step();
      expect(game.lives).toBe(shielded ? 3 : 2);
    }
  });
});

describe("tank difficulty", () => {
  it("gives casual play five lives, bonus armor and upgraded firepower without mutating a character", () => {
    const blueprint = { ...PLAYER_TANK, armor: 3 };
    const game = new TankDefenseGame(arena(), { difficulty: "casual", playerBlueprint: blueprint });
    expect(game.lives).toBe(5); expect(game.player!.hp).toBe(4); expect(game.power).toBe(1);
    expect(game.player!.blueprint.armor).toBe(3); expect(blueprint.armor).toBe(3);
    expect(game.snapshot()).toMatchObject({ difficulty: "casual", baseHP: 3, maxBaseHP: 3, maxLives: 5, playerHP: 4, maxPlayerHP: 4 });
  });

  it("absorbs successive base hits during a short recovery and disables casual friendly fire", () => {
    const game = new TankDefenseGame(arena(), { difficulty: "casual" }); game.start();
    game.bullets.push(bullet({ team: "player" })); game.step(); expect(game.snapshot().baseHP).toBe(3);
    game.bullets.push(bullet(), bullet({ id: 1001 })); game.step();
    expect(game.snapshot().baseHP).toBe(2); expect(game.baseAlive).toBe(true);
    advance(game, 90); game.bullets.push(bullet()); game.step(); expect(game.snapshot().baseHP).toBe(1);
    advance(game, 90); game.bullets.push(bullet()); game.step();
    expect(game.phase).toBe("defeat"); expect(game.defeatReason).toBe("base");
  });

  it("grants armor-hit protection and preserves casual firepower after losing a life", () => {
    const game = new TankDefenseGame(arena(), { difficulty: "casual", power: 2 }); game.start(); game.player!.invincibleUntil = 0;
    const hit = () => { game.bullets.push(bullet({ x: 180, y: 517, direction: "up" })); game.step(); };
    hit(); expect(game.player!.hp).toBe(1); expect(game.lives).toBe(5);
    hit(); expect(game.player!.hp).toBe(1);
    advance(game, 90); hit(); expect(game.player).toBeNull(); expect(game.lives).toBe(4); expect(game.power).toBe(2);
  });

  it("slows casual reinforcement, tank movement and enemy shells across all modes", () => {
    for (const mode of ["campaign", "blitz", "survival"] as const) {
      const standard = new TankDefenseGame(arena(), { difficulty: "standard", mode });
      const casual = new TankDefenseGame(arena(), { difficulty: "casual", mode });
      standard.start(); casual.start(); advance(standard, 60); advance(casual, 60);
      const standardEnemy = standard.tanks.find(tank => tank.team === "enemy")!;
      const casualEnemy = casual.tanks.find(tank => tank.team === "enemy")!;
      // Survival has a longer opening, so advance both until their first reinforcement.
      if (mode === "survival") { advance(standard, 120); advance(casual, 120); }
      const normal = standardEnemy ?? standard.tanks.find(tank => tank.team === "enemy")!;
      const easy = casualEnemy ?? casual.tanks.find(tank => tank.team === "enemy")!;
      expect(easy.blueprint.speed).toBeLessThan(normal.blueprint.speed);
      expect(easy.blueprint.projectileSpeed).toBeLessThan(normal.blueprint.projectileSpeed);
      expect(easy.blueprint.fireInterval).toBeGreaterThan(normal.blueprint.fireInterval);
    }
  });

  it("keeps casual repairs bounded by five lives", () => {
    const game = new TankDefenseGame(arena({ mechanisms: [{ kind: "repair", x: 180, y: 500 }] }), { difficulty: "casual", lives: 4 });
    game.start(); game.step(); expect(game.lives).toBe(5); expect(game.mechanisms[0]!.spent).toBe(true);
  });
});
