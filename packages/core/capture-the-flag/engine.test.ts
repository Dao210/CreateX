// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { newMatch, tickMatch, makeBaselineStrategy } from "./engine.js";
import { frameOf, simulate } from "./simulation";
import { validateStrategy } from "./validator.js";
import { StrategySchema } from "./schema";
import fixtures from "./original-fixtures.json";
import red from "./ZS01.json";
import blue from "./ZS02.json";
const strategies = {
  red: StrategySchema.parse(red),
  blue: StrategySchema.parse(blue),
};
describe("v4 battle semantics", () => {
  for (const fixture of fixtures)
    it(`matches the original trajectory for seed ${fixture.seed}`, () => {
      const match = newMatch(fixture.seed, strategies),
        hash = createHash("sha256");
      while (!match.result) {
        tickMatch(match, { headless: true });
        hash.update(
          JSON.stringify(frameOf(match), (_, o) =>
            o && typeof o === "object" && !Array.isArray(o)
              ? Object.fromEntries(
                  Object.entries(o).sort(([a], [b]) => a.localeCompare(b)),
                )
              : o,
          ),
        );
      }
      expect({
        ticks: match.tick,
        result: match.result,
        digest: hash.digest("hex"),
      }).toEqual({
        ticks: fixture.ticks,
        result: fixture.result,
        digest: fixture.digest,
      });
    });
  it("ends idle strategies at 480 seconds and produces portable bounded recordings", () => {
    const hold = makeBaselineStrategy("idle", "Idle", "red");
    for (const unit of Object.values(hold.strategies)) unit.rules = [];
    const frames: unknown[] = [];
    expect(
      simulate(1, { red: hold, blue: hold }, (f) => frames.push(f)).result
        .winner,
    ).toBe("draw");
    expect(frames).toHaveLength(481);
    expect(() => JSON.stringify(frames)).not.toThrow();
  });
  it("does not treat temporarily respawning units as a defeated team", () => {
    const match = newMatch(1, strategies);
    for (const unit of match.units.filter((u) => u.team === "red")) {
      unit.state = "RESPAWNING";
      unit.hp = 0;
      unit.deathCount = 1;
      unit.respawnRemaining = 5;
    }
    tickMatch(match, { headless: true });
    expect(match.result).toBeNull();
    for (const unit of match.units.filter((u) => u.team === "red")) {
      unit.state = "ELIMINATED";
      unit.deathCount = 4;
    }
    tickMatch(match, { headless: true });
    expect(match.result?.winner).toBe("blue");
  });
});
describe("strategy input boundary", () => {
  it("accepts shipped examples and rejects unknown actions", () => {
    expect(validateStrategy(red)).toEqual([]);
    const invalid = structuredClone(strategies.red);
    invalid.strategies.cavalry.rules[0]!.movement.type = "TELEPORT";
    expect(validateStrategy(invalid)).not.toEqual([]);
  });
  it("bounds every JSON node, including empty logical groups", () => {
    const invalid = structuredClone(strategies.red);
    invalid.strategies.cavalry.rules[0]!.condition = {
      all: Array.from({ length: 7000 }, () => ({ all: [] })),
    };
    expect(validateStrategy(invalid)).not.toEqual([]);
  });
  it("rejects object-valued conditions before they reach comparison operators", () => {
    const invalid = {
      ...strategies.red,
      strategies: {
        ...strategies.red.strategies,
        cavalry: {
          rules: [
            {
              ...strategies.red.strategies.cavalry.rules[0]!,
              condition: {
                source: "self.hp",
                operator: ">",
                value: { toString: null, valueOf: null },
              },
            },
          ],
        },
      },
    };
    expect(validateStrategy(invalid)).not.toEqual([]);
  });
});
