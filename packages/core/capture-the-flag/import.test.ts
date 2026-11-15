// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CTF_FILE_LIMIT, parseCTFImport } from "./import";
import sample from "./ZS01.json";

describe("CTF file import", () => {
  it("accepts a complete strategy unchanged, including a UTF-8 BOM", () => {
    expect(parseCTFImport(`\uFEFF${JSON.stringify(sample)}`)).toEqual({
      ok: true,
      strategy: sample,
    });
  });
  it.each([
    [
      "report",
      { engine: "local", strategy_sha256: "a".repeat(64), results: [] },
    ],
    ["reference", { gameVersion: "12-rts-1.0", files: ["example.json"] }],
    ["reference", { unit_types: ["archer"] }],
    ["invalid", { strategy: sample }],
    ["version", { ...sample, game_version: "other" }],
    ["version", { ...sample, format_version: 1 }],
    ["invalid", { ...sample, strategies: {} }],
  ])("identifies %s without converting the input", (reason, value) => {
    expect(parseCTFImport(JSON.stringify(value))).toMatchObject({
      ok: false,
      reason,
    });
  });
  it("rejects syntax errors and counts UTF-8 bytes before parsing", () => {
    expect(parseCTFImport("{ broken")).toMatchObject({
      ok: false,
      reason: "syntax",
    });
    expect(
      parseCTFImport("汉".repeat(Math.ceil(CTF_FILE_LIMIT / 3))),
    ).toMatchObject({ ok: false, reason: "tooLarge" });
  });
});
