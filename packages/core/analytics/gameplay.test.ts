// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { BattleTelemetry } from "./gameplay";

const context = { game: "tanks" as const, workspace_id: "ws", mode: "campaign", level_id: 1, difficulty: "normal" };

describe("BattleTelemetry", () => {
  it("counts a real start once and excludes paused and intermission time", () => {
    const capture = vi.fn();
    const battle = new BattleTelemetry(context, capture);
    battle.observe("ready", false, 0);
    battle.observe("running", false, 100);
    battle.observe("running", false, 200);
    battle.observe("running", true, 500);
    battle.observe("running", false, 1500);
    battle.observe("intermission", false, 2000);
    battle.observe("running", false, 3000);
    battle.observe("cleared", false, 3500);
    battle.observe("cleared", false, 4000);
    expect(capture.mock.calls.map(([name]) => name)).toEqual(["battle_started", "battle_ended"]);
    expect(capture.mock.calls[1]![1]).toMatchObject({ ...context, result: "level_cleared", active_duration_ms: 1400, record_source: "client_reported" });
    expect(capture.mock.calls[0]![1].attempt_id).toBe(capture.mock.calls[1]![1].attempt_id);
  });

  it("does not count a paused checkpoint until play resumes or infer an abandoned attempt as a defeat", () => {
    const capture = vi.fn();
    const battle = new BattleTelemetry({ ...context, resumed: true }, capture);
    battle.observe("running", true, 0);
    expect(capture).not.toHaveBeenCalled();
    battle.observe("running", false, 100);
    battle.observe("running", true, 200);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0]![1]).toMatchObject({ resumed: true });
  });

  it("isolates retries and never propagates a telemetry failure to the game", () => {
    const capture = vi.fn();
    new BattleTelemetry(context, capture).observe("running", false, 0);
    new BattleTelemetry(context, capture).observe("running", false, 0);
    expect(capture.mock.calls[0]![1].attempt_id).not.toBe(capture.mock.calls[1]![1].attempt_id);
    const failing = new BattleTelemetry(context, () => { throw new Error("offline"); });
    expect(() => { failing.observe("running", false); failing.observe("defeat", false); }).not.toThrow();
  });
});
