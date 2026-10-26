// @vitest-environment node
import { expect, it } from "vitest";
import { CAMPAIGN_LEVELS, pointOnRoute, routeLength } from "./campaign";
import { compileRoute, pointOnCompiledRoute, selectCampaignTarget } from "./routes";

it("precomputed routes preserve movement, endpoints and knockback positions", () => {
  for (const level of CAMPAIGN_LEVELS) for (const points of level.routes) {
    const route = compileRoute(points);
    expect(route.total).toBe(routeLength(points));
    for (let progress = -1; progress < route.total + 2; progress += 0.13) expect(pointOnCompiledRoute(route, progress)).toEqual(pointOnRoute(points, progress));
  }
});
it("selects the nearest exit with stable ties and respects valid manual focus", () => {
  const routes = [compileRoute([{ x: 0, y: 0 }, { x: 10, y: 0 }])];
  const enemies = [3, 2, 1].map(id => ({ id, route: 0, progress: 5, hp: 10 }));
  expect(selectCampaignTarget(enemies, routes, () => true, null)?.id).toBe(1);
  expect(selectCampaignTarget(enemies, routes, () => true, "enemy:3")?.id).toBe(3);
  expect(selectCampaignTarget(enemies, routes, enemy => enemy.id !== 3, "enemy:3")?.id).toBe(1);
  enemies[0]!.progress = 8; enemies[0]!.hp = 0;
  expect(selectCampaignTarget(enemies, routes, () => true, "enemy:3")?.id).toBe(1);
});
