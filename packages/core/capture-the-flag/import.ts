import { z } from "zod";
import { StrategySchema } from "./schema";
import { validateStrategy } from "./validator.js";
import type { Strategy } from "./types";

export const CTF_FILE_LIMIT = 256 * 1024;
export type CTFImportProblem =
  | "tooLarge"
  | "syntax"
  | "report"
  | "reference"
  | "version"
  | "invalid";
export type CTFImportResult =
  | { ok: true; strategy: Strategy }
  | { ok: false; reason: CTFImportProblem; details: string[] };

export function parseCTFImport(text: string): CTFImportResult {
  if (new TextEncoder().encode(text).length > CTF_FILE_LIMIT)
    return { ok: false, reason: "tooLarge", details: [] };
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return { ok: false, reason: "syntax", details: [] };
  }
  const root = z.record(z.string(), z.unknown()).safeParse(value);
  if (root.success && !root.data.strategies) {
    if (
      Array.isArray(root.data.results) &&
      (typeof root.data.strategy_sha256 === "string" ||
        (typeof root.data.engine === "string" &&
          typeof root.data.assertions === "number"))
    )
      return { ok: false, reason: "report", details: [] };
    if (
      root.data.files ||
      root.data.unit_types ||
      root.data.$schema ||
      root.data.rule_required_fields
    )
      return { ok: false, reason: "reference", details: [] };
  }
  const result = StrategySchema.safeParse(value);
  if (result.success) return { ok: true, strategy: result.data };
  const versionMismatch =
    root.success &&
    !!root.data.strategies &&
    ((root.data.format_version !== undefined &&
      root.data.format_version !== "1.0") ||
      (root.data.game_version !== undefined &&
        root.data.game_version !== "12-rts-1.0"));
  return {
    ok: false,
    reason: versionMismatch ? "version" : "invalid",
    details: validateStrategy(value),
  };
}
