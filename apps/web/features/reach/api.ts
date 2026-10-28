import { parseWithFallback } from "@auro/core/api/schema";
import type { ZodType } from "zod";
import { seasonInfoSchema, worldSnapshotSchema } from "./schema";
import type { SeasonInfo, WorldSnapshot } from "./types";

const BASE = process.env.NEXT_PUBLIC_REACH_API ?? "/api/reach";

async function getJSON<T>(path: string, schema: ZodType, signal?: AbortSignal): Promise<T | null> {
  try {
    const response = await fetch(`${BASE}${path}`, {
      headers: { accept: "application/json" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    return parseWithFallback<T | null>(await response.json(), schema, null, { endpoint: `reach${path}` });
  } catch {
    return null;
  }
}

export function fetchSnapshot(signal?: AbortSignal) {
  return getJSON<WorldSnapshot>("/state", worldSnapshotSchema, signal);
}

export function fetchSeason(signal?: AbortSignal) {
  return getJSON<SeasonInfo>("/season/current", seasonInfoSchema, signal);
}
