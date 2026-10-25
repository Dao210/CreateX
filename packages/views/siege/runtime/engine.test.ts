// @vitest-environment node
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { canonicalDrawing, compileWeapon, sampleSpec, SAMPLES, DEFAULT_CANNON, createCannonDrawing, createCannonSpec } from "@auro/core/siege";
import { ArenaEngine, initializePhysics, PROJECTILE_LIMIT } from "./engine";
import RAPIER from "@dimforge/rapier2d-compat";

it("waits for the final enemies instead of declaring victory at 45 seconds", async () => {
  await initializePhysics();
  const engine = new ArenaEngine(cannonDefinition(), "defense");
  try {
    engine.start();
    for (let i = 0; i < 2700; i++) {
      engine.step();
      for (const enemy of engine.enemies.values()) {
        enemy.hp = 10_000;
        enemy.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
        enemy.body.setTranslation({ x: 10, y: 4.45 }, true);
      }
    }
    expect(engine.enemies.size).toBeGreaterThan(0);
    expect(engine.stats.phase).toBe("running");
    for (const [handle, enemy] of engine.enemies) { engine.world.removeRigidBody(enemy.body); engine.enemies.delete(handle); }
    engine.step();
    expect(engine.stats.phase).toBe("finished");
    expect(engine.stats.feedback).toContain("守住三波");
  } finally { engine.dispose(); }
});
it("runs real contacts, turns original geometry and releases the world", async () => {
  await initializePhysics();
  const sample = SAMPLES[0]!;
  const hash = createHash("sha256").update(canonicalDrawing(sample.drawing)).digest("hex");
  const definition = compileWeapon(sample.drawing, sampleSpec(sample, hash), hash);
  const engine = new ArenaEngine(definition, "practice");
  engine.start();
  for (let i = 0; i < 1200; i++) engine.step();
  expect(Math.abs(engine.body.rotation())).toBeGreaterThan(0.05);
  expect(engine.stats.hits).toBeGreaterThan(0);
  expect(engine.stats.phase).toBe("finished");
  expect(engine.stats.castleHP).toBe(100);
  engine.dispose();
});
const cannonDefinition = () => {
  const sample = SAMPLES[3]!;
  const hash = createHash("sha256").update(canonicalDrawing(sample.drawing)).digest("hex");
  return compileWeapon(sample.drawing, sampleSpec(sample, hash), hash);
};
it("tracks with finite rotation, fires real rounds, and counts applied damage once", async () => {
  await initializePhysics();
  const definition = cannonDefinition(), engine = new ArenaEngine(definition, "practice");
  try {
    engine.body.setRotation(-Math.PI / 2, true); engine.angle = -Math.PI / 2;
    engine.start();
    for (let i = 0; i < 20; i++) engine.step();
    expect(engine.stats.shots).toBe(0);
    expect(engine.angle).toBeCloseTo(-Math.PI / 2, 1);
    let maxProjectiles = 0, previousShots = 0, lastShot = -Infinity;
    for (let i = 0; i < 1180; i++) {
      engine.step(); maxProjectiles = Math.max(maxProjectiles, engine.projectiles.size);
      if (engine.stats.shots > previousShots) {
        expect(engine.stats.tick - lastShot).toBeGreaterThanOrEqual(definition.launcher!.reloadTicks);
        lastShot = engine.stats.tick; previousShots = engine.stats.shots;
      }
    }
    expect(engine.stats.shots).toBeGreaterThan(0);
    expect(engine.stats.projectileHits).toBeGreaterThan(0);
    expect(engine.stats.projectileHits).toBeLessThanOrEqual(engine.stats.shots);
    expect(engine.stats.damage).toBeGreaterThan(0);
    expect(engine.stats.damage).toBeLessThanOrEqual(5 * 35);
    expect(maxProjectiles).toBeGreaterThan(0);
    expect(maxProjectiles).toBeLessThanOrEqual(PROJECTILE_LIMIT);
    expect(engine.projectiles.size).toBe(0);
    const finished = engine.snapshot(); engine.step(); expect(engine.snapshot()).toEqual(finished);
  } finally { engine.dispose(); }
});
it("uses CCD at the maximum compiled round speed and excludes its own barrel", async () => {
  await initializePhysics();
  const definition = cannonDefinition(); definition.launcher!.projectileSpeed = 18;
  const engine = new ArenaEngine(definition, "practice");
  try {
    engine.start();
    for (let i = 0; i < 120; i++) engine.step();
    expect(engine.stats.projectileHits).toBeGreaterThan(0);
    expect(engine.stats.projectileHits).toBeLessThanOrEqual(engine.stats.shots);
  } finally { engine.dispose(); }
});
it("lets a fired round miss after its target disappears and expires it without counting a hit", async () => {
  await initializePhysics();
  const engine = new ArenaEngine(cannonDefinition(), "practice");
  try {
    engine.start();
    while (!engine.stats.shots && engine.stats.tick < 120) engine.step();
    expect(engine.projectiles.size).toBe(1);
    for (const [handle, enemy] of engine.enemies) { engine.world.removeRigidBody(enemy.body); engine.enemies.delete(handle); }
    for (let i = 0; i < 40; i++) engine.step();
    expect(engine.stats.shots).toBe(1);
    expect(engine.stats.projectileHits).toBe(0);
    expect(engine.stats.damage).toBe(0);
    expect(engine.stats.targetId).toBeNull();
    expect(engine.stats.targetDistance).toBeNull();
    expect(engine.projectiles.size).toBe(0);
  } finally { engine.dispose(); }
});
it("applies armor to cannon impacts and reports actual castle-defense damage", async () => {
  await initializePhysics();
  const definition = cannonDefinition(), engine = new ArenaEngine(definition, "defense");
  let armoredHit = false;
  try {
    engine.start();
    for (let i = 0; i < 4500 && engine.stats.phase === "running"; i++) {
      const previousHP = new Map([...engine.enemies.values()].map(enemy => [enemy.id, enemy.hp]));
      engine.step();
      for (const enemy of engine.enemies.values()) {
        if (!enemy.heavy || enemy.lastHit !== engine.stats.tick) continue;
        const before = previousHP.get(enemy.id) ?? enemy.maxHP;
        expect(before - enemy.hp).toBe(Math.min(before, Math.round(definition.launcher!.damage * 0.6)));
        armoredHit = true;
      }
    }
    expect(armoredHit).toBe(true);
    expect(engine.stats.damage).toBeLessThanOrEqual(10 * 35 + 5 * 80);
    expect(engine.stats.phase).toBe("finished");
    expect(engine.stats.feedback).toContain(engine.stats.castleHP ? "守住" : "失守");
  } finally { engine.dispose(); }
});
it("keeps a shield passive and reports the actual defense outcome", async () => {
  await initializePhysics();
  const sample = SAMPLES[2]!;
  const hash = createHash("sha256").update(canonicalDrawing(sample.drawing)).digest("hex");
  const engine = new ArenaEngine(compileWeapon(sample.drawing, sampleSpec(sample, hash), hash), "defense");
  engine.start();
  for (let i = 0; i < 4500; i++) engine.step();
  expect(engine.stats.hits).toBe(0);
  expect(engine.stats.blocked).toBeGreaterThan(0);
  expect(engine.stats.shieldHP).toBeLessThan(100);
  expect(engine.body.rotation()).toBe(0);
  expect(engine.stats.feedback).toContain(engine.stats.castleHP ? "守住" : "失守");
  engine.dispose();
});

it("finishes kit defense at every size corner and never traps enemies in its barrel", async () => {
  await initializePhysics();
  for (const [length, width] of [[1600, 450], [1600, 1050], [3200, 450], [3200, 1050], [2200, 950]]) {
    const design = { ...DEFAULT_CANNON, barrelLengthMm: length!, barrelWidthMm: width! };
    const drawing = createCannonDrawing(design), hash = createHash("sha256").update(canonicalDrawing(drawing)).digest("hex");
    const engine = new ArenaEngine(compileWeapon(drawing, createCannonSpec(drawing, hash), hash, design), "defense");
    try {
      engine.start();
      for (let i = 0; i < 4500 && engine.stats.phase === "running"; i++) engine.step();
      expect(engine.stats.phase).toBe("finished");
      expect(engine.stats.shots).toBeGreaterThan(0);
      if (engine.stats.castleHP) {
        expect(engine.stats.spawned).toBe(15);
        expect(engine.enemies.size).toBe(0);
        expect(engine.stats.outcome).toBe("victory");
      } else expect(engine.stats.outcome).toBe("defeat");
    } finally { engine.dispose(); }
  }
});

it("ends defense immediately when the castle falls, even before all waves have spawned", async () => {
  await initializePhysics();
  const engine = new ArenaEngine(cannonDefinition(), "defense");
  try {
    engine.start(); engine.stats.castleHP = 1;
    for (let i = 0; i < 20; i++) engine.step();
    engine.enemies.values().next().value!.body.setTranslation({ x: 1.5, y: 4.45 }, true);
    engine.step();
    expect(engine.stats.phase).toBe("finished");
    expect(engine.stats.outcome).toBe("defeat");
    expect(engine.stats.castleHP).toBe(0);
    expect(engine.stats.spawned).toBeLessThan(15);
  } finally { engine.dispose(); }
});
