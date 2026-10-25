// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseTankPreferences, tankPreferencesKey } from "./preferences";

describe("tank records", () => {
  it("rejects future or corrupt records and bounds durable preferences", () => {
    expect(parseTankPreferences("bad-json")).toEqual({ best: 0, unlocked: 1, sound: true, difficulty: "casual" });
    expect(parseTankPreferences(JSON.stringify({ version: 2, best: 5000, unlocked: 3 }))).toEqual({ best: 0, unlocked: 1, sound: true, difficulty: "casual" });
    expect(parseTankPreferences(JSON.stringify({ version: 1, best: -1, unlocked: 999, sound: false }))).toEqual({ best: 0, unlocked: 1, sound: false, difficulty: "casual" });
  });

  it("retains old three-stage progress and accepts the expanded campaign", () => {
    for (const unlocked of [3, 6]) expect(parseTankPreferences(JSON.stringify({ version: 1, best: 100, unlocked, sound: true })).unlocked).toBe(unlocked);
  });

  it("retains difficulty and defaults old or invalid records to casual", () => {
    for (const difficulty of [undefined, "bad", "casual", "standard"]) {
      expect(parseTankPreferences(JSON.stringify({ version: 1, difficulty })).difficulty).toBe(difficulty === "standard" ? "standard" : "casual");
    }
  });

  it("isolates each account and workspace without namespace collisions", () => {
    const records = new Map<string, string>();
    records.set(tankPreferencesKey("user-1", "workspace-1"), JSON.stringify({ version: 1, best: 500, unlocked: 2, sound: false }));
    const read = (user: string, workspace: string) => parseTankPreferences(records.get(tankPreferencesKey(user, workspace)) ?? null);
    expect(read("user-1", "workspace-1")).toEqual({ best: 500, unlocked: 2, sound: false, difficulty: "casual" });
    expect(read("user-2", "workspace-1").best).toBe(0);
    expect(read("user-1", "workspace-2").unlocked).toBe(1);
    expect(tankPreferencesKey("a:b", "c")).not.toBe(tankPreferencesKey("a", "b:c"));
  });

  it("refuses to address anonymous or unresolved workspace records", () => {
    expect(() => tankPreferencesKey("", "workspace-1")).toThrow();
    expect(() => tankPreferencesKey("user-1", "")).toThrow();
  });
});
