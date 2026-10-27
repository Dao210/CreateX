// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GameProgressSchema, mergeSiegeStars, mergeTankAchievements } from "./schema";

describe("game progress", () => {
  it("merges siege stars level by level without rolling back", () => {
    expect(mergeSiegeStars([3, 0, 2, 0, 0, 0, 0, 0], [1, 3, 0, 1, 0, 0, 0, 0])).toEqual([3, 3, 2, 1, 0, 0, 0, 0]);
    expect(mergeSiegeStars([0, 0, 0, 0, 0, 0, 0, 0], null)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("merges tank achievements monotonically and clamps unlocks", () => {
    expect(mergeTankAchievements({ best: 900, unlocked: 2 }, { best: 1200, unlocked: 1 })).toEqual({ best: 1200, unlocked: 2 });
    expect(mergeTankAchievements({ best: 900, unlocked: 6 }, { best: 100, unlocked: 3 })).toEqual({ best: 900, unlocked: 6 });
    expect(mergeTankAchievements({ best: 0, unlocked: 1 }, null)).toEqual({ best: 0, unlocked: 1 });
  });

  it("accepts a missing cloud record but rejects a mismatched workspace", () => {
    expect(GameProgressSchema.parse({ workspaceId: "11111111-1111-4111-8111-111111111111", siege: null, tanks: null })).toMatchObject({ siege: null, tanks: null });
    expect(GameProgressSchema.safeParse({ workspaceId: "not-a-uuid", siege: null, tanks: null }).success).toBe(false);
  });
});
