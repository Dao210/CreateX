// @vitest-environment node
import { describe, expect, it } from "vitest";
import { newMatch, tickMatch } from "./engine.js";
import { frameOf, simulate } from "./simulation";
import { FrameSchema, StrategySchema } from "./schema";
import { DecisionSchema } from "./decision";
import type { BattleEvent } from "./types";
import red from "./ZS01.json";
import blue from "./ZS02.json";
const strategies = {
  red: StrategySchema.parse(red),
  blue: StrategySchema.parse(blue),
};
describe("authoritative presentation events", () => {
  it("records attacks at their real positions and preserves every event across recording samples", () => {
    const match = newMatch(12027, strategies),
      events = new Map<string, BattleEvent>();
    while (!match.result) {
      const before = frameOf(match);
      tickMatch(match, { headless: true });
      const frame = frameOf(match);
      expect(FrameSchema.safeParse(frame).success).toBe(true);
      for (const event of frame.events ?? []) {
        events.set(event.id, event);
        if (event.tick !== frame.tick || event.kind !== "attack") continue;
        const actor = before.units.find((u) => u.id === event.unitId)!;
        expect([event.x, event.y]).toEqual([actor.x, actor.y]);
        expect(
          Math.hypot(event.targetX! - event.x, event.targetY! - event.y),
        ).toBeLessThanOrEqual(actor.range + 0.02);
      }
      for (const target of before.units.filter((u) => u.state === "ALIVE")) {
        const damage = (frame.events ?? [])
          .filter(
            (e) =>
              e.tick === frame.tick &&
              e.kind === "attack" &&
              e.targetId === target.id,
          )
          .reduce((sum, e) => sum + e.damage!, 0);
        expect(frame.units.find((u) => u.id === target.id)!.hp).toBe(
          Math.max(0, target.hp - damage),
        );
      }
    }
    expect([...events.values()].some((e) => e.kind === "attack")).toBe(true);
    expect([...events.values()].some((e) => e.kind === "death")).toBe(true);
    expect([...events.values()].some((e) => e.kind === "respawn")).toBe(true);
    expect([...events.values()].some((e) => e.kind === "flag")).toBe(true);
    const recorded = new Map<string, BattleEvent>();
    simulate(12027, strategies, (f) => {
      for (const e of f.events ?? []) recorded.set(e.id, e);
    });
    expect(recorded).toEqual(events);
  });
  it("reads old recordings without inventing combat events, and rejects malformed new events", () => {
    const frame = frameOf(newMatch(1, strategies));
    const { events: _events, ...old } = frame;
    expect(FrameSchema.parse(old).events).toEqual([]);
    expect(
      FrameSchema.safeParse({
        ...old,
        events: [{ kind: "attack", damage: "critical" }],
      }).success,
    ).toBe(false);
    expect(
      FrameSchema.parse({
        ...old,
        events: [
          {
            id: "future",
            tick: 1,
            time: 0.25,
            kind: "future",
            team: "red",
            x: 0,
            y: 0,
          },
        ],
      }).events[0]?.kind,
    ).toBe("unknown");
    expect(
      DecisionSchema.parse({ action_mode: "FUTURE_MODE" }).action_mode,
    ).toBe("UNKNOWN");
  });
});
