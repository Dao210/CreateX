// @vitest-environment node
import { describe, expect, it } from "vitest";
import cases from "./character-cases.json";
import { compileTankCharacter, TankCharacterDraftSchema, TankCharacterSchema, TankPlaySessionSchema, TANK_CHARACTER_CATALOG } from "./characters";
import { TankDefenseGame } from "./engine";
import { TANK_LEVELS } from "./levels";

describe("tank character contract", () => {
  it.each(cases)("matches the shared Go/TS fixture: $name", ({ draft, expected }) => {
    if (!expected) { expect(() => compileTankCharacter(draft)).toThrow("character_budget_exceeded"); return; }
    const compiled = compileTankCharacter(draft);
    expect(compiled.cost).toBe(expected.cost);
    const { cost: _cost, ...stats } = expected;
    expect(compiled.blueprint).toMatchObject(stats);
  });
  it("publishes every packaged map with the same stable key and level", () => {
    expect(TANK_CHARACTER_CATALOG.maps.map(map => ({ id: map.id, levelId: map.levelId }))).toEqual(TANK_LEVELS.map(level => ({ id: level.key, levelId: level.id })));
  });
  it("loads one compiled character into all packaged maps and modes", () => {
    const { blueprint } = compileTankCharacter(cases[2]!.draft);
    for (const level of TANK_LEVELS) for (const mode of ["campaign", "blitz", "survival"] as const) {
      const game = new TankDefenseGame(level, { playerBlueprint: blueprint, mode });
      expect(game.player).not.toBeNull();
      expect(game.player!.blueprint.speed).toBe(50);
      expect(game.player!.hp).toBe(4);
    }
  });
  it("rejects submitted combat stats, unsafe colors, unknown parts and future profiles", () => {
    const draft = cases[0]!.draft;
    for (const invalid of [{ ...draft, speed: 9999 }, { ...draft, profile: "ground2d@1" }, { ...draft, parts: { ...draft.parts, cannon: "script" } }, { ...draft, appearance: { ...draft.appearance, body: "url(https://example.invalid)" } }]) expect(TankCharacterDraftSchema.safeParse(invalid).success).toBe(false);
    expect(TankCharacterDraftSchema.safeParse({ ...draft, name: "😀".repeat(40) }).success).toBe(true);
    expect(TankCharacterDraftSchema.safeParse({ ...draft, name: "\u0085bad" }).success).toBe(false);
  });
  it("freezes the submitted stats and nested appearance for this battle", () => {
    const { blueprint } = compileTankCharacter(cases[1]!.draft);
    const game = new TankDefenseGame(TANK_LEVELS[0]!, { playerBlueprint: blueprint });
    blueprint.speed = 999; blueprint.appearance!.body = "#000000";
    expect(game.player!.blueprint.speed).toBe(106);
    expect(game.player!.blueprint.appearance!.body).toBe("#26834a");
    game.start(); game.setInput("up", true); game.step();
    expect(game.snapshot().shots).toBe(1);
  });
  it("refuses malformed, tampered or future compiled packages and sessions", () => {
    const id = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222";
    const draft = cases[0]!.draft;
    const compiled = compileTankCharacter(draft, `${id}@1`);
    const character = { id, workspaceId, ownerId: id, revision: 1, rulesVersion: 1, compilerVersion: 1, contentHash: `sha256:${"a".repeat(64)}`, draft, ...compiled, createdAt: "2026-10-24T00:00:00Z" };
    expect(TankCharacterSchema.safeParse(character).success).toBe(true);
    expect(TankCharacterSchema.safeParse({ ...character, blueprint: { ...character.blueprint, speed: 999 } }).success).toBe(false);
    expect(TankCharacterSchema.safeParse({ ...character, compilerVersion: 2 }).success).toBe(false);
    const playPath = `/acme/tanks?session=${id}`;
    const session = { id, workspaceId, ownerId: id, rulesVersion: 1, mapId: "river", mapVersion: 1, levelId: 2, mode: "campaign", character, createdAt: "2026-10-24T00:00:00Z", expiresAt: "2026-10-25T00:00:00Z", playPath, playUrl: `https://example.invalid${playPath}` };
    expect(TankPlaySessionSchema.safeParse(session).success).toBe(true);
    expect(TankPlaySessionSchema.safeParse({ ...session, levelId: 1 }).success).toBe(false);
    expect(TankPlaySessionSchema.safeParse({ ...session, rulesVersion: 2 }).success).toBe(false);
    expect(TankPlaySessionSchema.safeParse({ ...session, playPath: "//evil.invalid/tanks" }).success).toBe(false);
  });
});
