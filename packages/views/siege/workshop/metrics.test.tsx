import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { compileWeapon, sampleSpec, SAMPLES, initialStats } from "@auro/core/siege";
import { DesignMetrics, BattleMetrics } from "./metrics";

it("separates the edited design from the frozen test and shows measured cannon results", () => {
  const hash = "0".repeat(64), sample = SAMPLES[3]!;
  const running = compileWeapon(sample.drawing, sampleSpec(sample, hash), hash);
  const shield = SAMPLES[2]!;
  const edited = compileWeapon(shield.drawing, sampleSpec(shield, hash), hash);
  const stats = { ...initialStats(), phase: "running" as const, shots: 10, projectileHits: 7, damage: 142,
    tick: 600, targetDistance: 5.2, aimError: 0.1, reloadRemaining: 0.4 };
  render(<><DesignMetrics definition={edited} /><BattleMetrics definition={running} stats={stats} mode="practice" paused changed error="" /></>);
  const design = screen.getByRole("region", { name: "设计参数" }), battle = screen.getByRole("region", { name: "实时数据" });
  expect(within(design).getByText("防护覆盖半径")).toBeInTheDocument();
  expect(within(design).queryByText("射程")).not.toBeInTheDocument();
  expect(within(battle).getByText("已暂停")).toBeInTheDocument();
  expect(within(battle).getByText("设计已修改，重新测试后生效。")).toBeInTheDocument();
  expect(within(battle).getByText("70%")).toBeInTheDocument();
  expect(within(battle).getByTestId("damage")).toHaveTextContent("142 HP");
  expect(within(battle).getByTestId("elapsed")).toHaveTextContent("10.0 s");
  expect(within(battle).getByTestId("reload")).toHaveTextContent("0.4 s");
  expect(battle).not.toHaveAttribute("aria-live");
});
