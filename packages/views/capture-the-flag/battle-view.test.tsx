import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  frameOf,
  makeBaselineStrategy,
  newMatch,
  tickMatch,
  type Frame,
} from "@auro/core/capture-the-flag";
import { renderWithI18n } from "../test/i18n";
import { BattleView } from "./battle-view";
vi.mock("./battle-canvas", () => ({
  BattleCanvas: () => <div data-testid="field" />,
}));
function sample() {
  const match = newMatch(12027, {
    red: makeBaselineStrategy("red", "Red", "red"),
    blue: makeBaselineStrategy("blue", "Blue", "blue"),
  });
  for (let i = 0; i < 80; i++) tickMatch(match, { headless: true });
  return frameOf(match);
}
describe("battle decisions and event review", () => {
  it("selects units with readable rules and separates archer movement from an attack", () => {
    const frame = sample();
    const archer = frame.units.find((u) => u.id === "red_archer")!;
    archer.range = 10;
    archer.isAttacking = false;
    archer.shootLockTicks = 0;
    frame.decisions[archer.id] = {
      rule_name: "Retreat",
      rule_priority: 90,
      movement: "MOVE_AWAY_FROM",
      attack: "ATTACK_NEAREST_ENEMY",
      action_mode: "MOVE_ONLY",
      observation_facts: [
        {
          source: "nearest_enemy.distance",
          actual: 1.5,
          expected: 4,
          operator: "<",
        },
      ],
      matched_rules: [
        { name: "Retreat", priority: 90 },
        { name: "Guard", priority: 10 },
      ],
    };
    renderWithI18n(
      <BattleView frame={frame} playing={false} controls={null} />,
    );
    const panel = within(
      screen.getByRole("complementary", { name: "Decisions" }),
    );
    expect(panel.getByText(/Nearest enemy distance/)).toBeVisible();
    expect(panel.getByText("10 cells")).toBeVisible();
    expect(panel.getByText("Retreat")).toBeVisible();
    expect(panel.getByText("Priority 90")).toBeVisible();
    expect(
      panel.getByText("Moving this Tick, without shooting."),
    ).toBeVisible();
    expect(panel.getByText(/^Also matches/)).toBeVisible();
    expect(panel.queryByText(/Attacked .* this Tick/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /^Blue · Heavy infantry/ }),
    );
    expect(
      panel.getByRole("heading", { name: "Heavy infantry" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /^Blue · Heavy infantry/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });
  it("keeps event identities unique across samples and seeks the actual recorded frame", () => {
    const frame = sample(),
      seek = vi.fn();
    const event = {
      id: "4:0",
      tick: 4,
      time: 1,
      kind: "flag" as const,
      team: "red" as const,
      x: 7,
      y: 25,
      flagState: "DROPPED",
    };
    const frames: Frame[] = [
      { ...frame, tick: 4, events: [event] },
      { ...frame, tick: 8, events: [event] },
    ];
    renderWithI18n(
      <BattleView
        frame={frames[1]!}
        playing={false}
        controls={null}
        timeline={frames}
        onSeek={seek}
      />,
    );
    const button = screen.getByRole("button", { name: /Red flag · Dropped/ });
    fireEvent.click(button);
    expect(seek).toHaveBeenCalledWith(0);
    expect(screen.getAllByText("Red flag · Dropped")).toHaveLength(1);
  });
});
