// @vitest-environment node
import { expect, it } from "vitest";
import { CAMPAIGN_LEVELS, presetBlueprint, routeLength, type WeaponKind } from "@auro/core/siege";
import { CampaignEngine, initializePhysics } from "./engine";

// Two deterministic player policies exercise placement and investment, not physics mocks.
for (const reverse of [false, true]) {
  for (const level of CAMPAIGN_LEVELS) {
    it(`clears level ${level.id} with ${reverse ? "rear defense" : "forward defense"}`, async () => {
      await initializePhysics(); const engine = new CampaignEngine(level);
      try {
        const rawOrder = level.slots.map((_, i) => i); if (reverse) rawOrder.reverse();
        const order = [rawOrder[0]!, rawOrder[Math.floor(rawOrder.length / 2)]!, ...rawOrder.filter((_, i) => i !== 0 && i !== Math.floor(rawOrder.length / 2))];
        const invest = () => {
          if (engine.towers.size >= (level.routes.length > 1 ? 4 : 3)) for (const tower of engine.towers.values()) if (tower.level < 3) engine.upgrade(tower.id);
          for (const slot of order) {
            if ([...engine.towers.values()].some(t => t.slot === slot)) continue;
            let kind: WeaponKind = "cannon";
            if (engine.towers.size === 2 && level.weapons.includes(reverse ? "hammer" : "frost")) kind = reverse ? "hammer" : "frost";
            if (engine.towers.size === 3 && level.weapons.includes(reverse ? "burst" : "blade")) kind = reverse ? "burst" : "blade";
            engine.build(slot, kind, presetBlueprint(kind));
          }
        };
        invest(); engine.startWave();
        for (let tick = 0; tick < 80000 && !["victory", "defeat"].includes(engine.phase); tick++) {
          if (tick % 60 === 0) {
            invest();
            const endangered = [...engine.enemies.values()].some(e => routeLength(level.routes[e.route]!) - e.progress < 7);
            const obstacle = level.obstacles.find(o => engine.obstacles.get(o.id)!.hp > 0 && [...engine.towers.values()].some(t => t.weapon.definition.launcher && Math.hypot(level.slots[t.slot]!.x - o.x, level.slots[t.slot]!.y - o.y) < t.weapon.range));
            engine.setFocus(!endangered && obstacle ? `obstacle:${obstacle.id}` : null);
          }
          if (engine.phase === "intermission") engine.startWave();
          engine.step();
        }
        expect({ phase: engine.phase, hp: engine.hp, waves: engine.completedWaves, kills: engine.kills }).toMatchObject({ phase: "victory", waves: level.waves.length });
      } finally { engine.dispose(); }
    });
  }
}
