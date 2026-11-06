// @vitest-environment node
import { expect, it } from "vitest";
import { LifeSnapshotSchema } from "./schema";
import { newTown } from "./town";
import { seedResidents } from "./engine";
import { emptyCivilization } from "./civilization-schema";

it("keeps pre-civilization towns readable and rejects malformed civic projections", () => {
  const agents = seedResidents(), town = newTown(agents);
  const old = JSON.parse(JSON.stringify(town)); delete old.civilization;
  expect(LifeSnapshotSchema.parse({ world: null, agents, town: old }).town?.civilization).toBeNull();
  town.civilization = emptyCivilization();
  const data = LifeSnapshotSchema.parse({ world: null, agents, town, futureField: true });
  expect(data.town?.civilization?.projects).toEqual([]);
  const bad = JSON.parse(JSON.stringify(town)); bad.civilization.prototypes.push({ id: agents[0]!.id, authorId: null, name: "Bad", variant: "unlimited", createdTick: 0 });
  expect(LifeSnapshotSchema.safeParse({ world: null, agents, town: bad }).success).toBe(false);
});
