// @vitest-environment node
import { expect, it } from "vitest";
import { CAMPAIGN_LEVELS, compileCampaignWeapon, presetBlueprint } from "@auro/core/siege";
import { CampaignEngine, initializePhysics } from "./engine";

it("charges once, freezes pause, keeps blueprints immutable and refunds invested gold", async () => {
  await initializePhysics(); const engine = new CampaignEngine(CAMPAIGN_LEVELS[0]!);
  try {
    const blueprint = presetBlueprint("cannon"), price = compileCampaignWeapon("cannon", blueprint).cost;
    expect(engine.build(0, "cannon", blueprint)).toBeNull(); expect(engine.gold).toBe(engine.level.gold - price);
    const before = engine.gold; expect(engine.build(0, "cannon", blueprint)).not.toBeNull(); expect(engine.gold).toBe(before);
    const tower = [...engine.towers.values()][0]!;
    blueprint.name = "edited"; expect(tower.weapon.blueprint.name).not.toBe("edited");
    engine.startWave(); for (let i = 0; i < 120; i++) engine.step();
    engine.setPaused(true); const frozen = engine.snapshot();
    for (let i = 0; i < 100; i++) engine.step(); expect(engine.snapshot()).toEqual(frozen);
    engine.setPaused(false); engine.gold = 1000; expect(engine.upgrade(tower.id)).toBeNull();
    const gold = engine.gold; engine.sell(tower.id); expect(engine.gold - gold).toBe(Math.floor((price + Math.ceil(price * 0.7)) * 0.7));
    expect(engine.towers.size).toBe(0);
  } finally { engine.dispose(); }
});

it("wins the first level with real rounds, two placements and no model", async () => {
  await initializePhysics(); const engine = new CampaignEngine(CAMPAIGN_LEVELS[0]!);
  try {
    engine.build(0, "cannon", presetBlueprint("cannon")); engine.build(3, "cannon", presetBlueprint("cannon")); engine.startWave();
    for (let i = 0; i < 20000 && !["victory", "defeat"].includes(engine.phase); i++) {
      if (engine.phase === "intermission") {
        for (const tower of engine.towers.values()) if (tower.level < 3) engine.upgrade(tower.id);
        engine.startWave();
      }
      engine.step();
    }
    expect(engine.snapshot(), JSON.stringify(engine.snapshot())).toMatchObject({ phase: "victory", completedWaves: 5 });
    expect(engine.kills).toBeGreaterThan(10);
    expect([...engine.towers.values()].reduce((sum, tower) => sum + tower.shots, 0)).toBeGreaterThan(0);
  } finally { engine.dispose(); }
});

it("makes obstacle clearing consume fire, grants its reward once and opens the slot", async () => {
  await initializePhysics(); const engine = new CampaignEngine(CAMPAIGN_LEVELS[1]!);
  try {
    engine.build(5, "cannon", presetBlueprint("cannon"));
    const obstacle = engine.level.obstacles[0]!;
    expect(engine.build(obstacle.slot!, "cannon", presetBlueprint("cannon"))).not.toBeNull();
    engine.setFocus(`obstacle:${obstacle.id}`);
    for (let i = 0; i < 400; i++) engine.step(); expect(engine.obstacles.get(obstacle.id)!.hp).toBe(obstacle.hp);
    engine.startWave();
    for (let i = 0; i < 2000 && engine.obstacles.get(obstacle.id)!.hp; i++) engine.step();
    expect(engine.obstacles.get(obstacle.id)!.hp).toBe(0);
    expect(engine.events.filter(e => e.type === "clear")).toHaveLength(1);
    expect(engine.build(obstacle.slot!, "cannon", presetBlueprint("cannon"))).toBeNull();
  } finally { engine.dispose(); }
});

it("restores completed-wave economy without duplicating kills or wave rewards", async () => {
  await initializePhysics(); const engine = new CampaignEngine(CAMPAIGN_LEVELS[0]!);
  let restored: CampaignEngine | undefined;
  try {
    engine.build(0, "cannon", presetBlueprint("cannon")); engine.build(3, "cannon", presetBlueprint("cannon")); engine.startWave();
    for (let i = 0; i < 4000 && engine.phase === "running"; i++) engine.step();
    expect(engine.phase).toBe("intermission"); const checkpoint = engine.checkpoint()!;
    restored = new CampaignEngine(engine.level, checkpoint);
    expect(restored.snapshot()).toMatchObject({ phase: "ready", completedWaves: 1, hp: engine.hp, gold: engine.gold, kills: engine.kills });
    expect(restored.towers.size).toBe(2); expect(restored.enemies.size).toBe(0);
    expect([...restored.towers.values()].map(t => t.damage)).toEqual([...engine.towers.values()].map(t => t.damage));
    for (let i = 0; i < 100; i++) restored.step(); expect(restored.gold).toBe(checkpoint.gold);
  } finally { restored?.dispose(); engine.dispose(); }
});

it("fails at zero health before all enemies spawn, rather than declaring a timed victory", async () => {
  await initializePhysics(); const engine = new CampaignEngine(CAMPAIGN_LEVELS[0]!);
  try {
    engine.hp = 10; engine.startWave();
    for (let i = 0; i < 3000 && engine.phase === "running"; i++) engine.step();
    expect(engine.phase).toBe("defeat"); expect(engine.hp).toBe(0); expect(engine.kills).toBe(0);
    expect(engine.snapshot().stars).toBe(0);
  } finally { engine.dispose(); }
});

it("applies frost and finite hammer control only after real contact", async () => {
  await initializePhysics();
  for (const kind of ["frost", "hammer"] as const) {
    const level = { ...CAMPAIGN_LEVELS[4]!, gold: 1000, obstacles: [], slots: [{ x: 10, y: 4.1 }], weapons: [kind], waves: [[{ kind: "armor" as const, route: 0, tick: 1 }]] };
    const engine = new CampaignEngine(level);
    try {
      engine.build(0, kind, presetBlueprint(kind)); engine.startWave();
      for (let n = 0; n < 2500 && ![...engine.towers.values()][0]!.control; n++) engine.step();
      const tower = [...engine.towers.values()][0]!, enemy = [...engine.enemies.values()][0]!;
      expect(tower.control).toBeGreaterThan(0); expect(tower.damage).toBeGreaterThan(0);
      if (kind === "frost") {
        expect(enemy.slowUntil).toBeGreaterThan(engine.tick);
        const before = enemy.progress; engine.step(); expect(enemy.progress - before).toBeCloseTo(0.9 * 0.5 / 60);
      } else {
        expect(enemy.knockbackUntil).toBeGreaterThan(engine.tick); expect(enemy.stunUntil).toBeGreaterThan(engine.tick);
        const before = enemy.progress; engine.step(); expect(enemy.progress).toBe(before);
      }
    } finally { engine.dispose(); }
  }
});

it("splash damage hits each nearby enemy once per actual impact", async () => {
  await initializePhysics();
  const level = { ...CAMPAIGN_LEVELS[6]!, gold: 1000, obstacles: [], slots: [{ x: 5, y: 5.2 }], waves: [[{ kind: "scout" as const, route: 0, tick: 1 }, { kind: "scout" as const, route: 0, tick: 1 }]] };
  const engine = new CampaignEngine(level);
  try {
    engine.build(0, "burst", presetBlueprint("burst")); engine.startWave();
    for (let n = 0; n < 600 && !engine.effects.some(e => e.kind === "burst"); n++) engine.step();
    const tower = [...engine.towers.values()][0]!, enemies = [...engine.enemies.values()];
    expect(tower.shots).toBe(1); expect(enemies).toHaveLength(2);
    const damage = tower.weapon.definition.launcher!.damage;
    expect(tower.damage).toBe(damage * 2); expect(enemies.every(e => e.hp === e.maxHP - damage)).toBe(true);
  } finally { engine.dispose(); }
});

it("a rotating blade cuts a group while preventing duplicate part hits on one enemy", async () => {
  await initializePhysics();
  const level = { ...CAMPAIGN_LEVELS[3]!, gold: 1000, obstacles: [], slots: [{ x: 5, y: 4.1 }], waves: [[{ kind: "scout" as const, route: 0, tick: 1 }, { kind: "scout" as const, route: 0, tick: 1 }]] };
  const engine = new CampaignEngine(level);
  try {
    engine.build(0, "blade", presetBlueprint("blade")); engine.startWave();
    for (let n = 0; n < 1200 && ![...engine.towers.values()][0]!.damage; n++) engine.step();
    const hits = engine.effects.filter(e => e.kind === "hit");
    expect(hits).toHaveLength(2); expect(hits[0]!.value).toBe(hits[1]!.value);
    expect([...engine.towers.values()][0]!.damage).toBe(hits[0]!.value * 2);
  } finally { engine.dispose(); }
});
