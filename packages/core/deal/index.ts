import { z } from "zod";
import { parseWithFallback } from "../api/schema";

const pose = z
  .enum([
    "calm",
    "interested",
    "suspicious",
    "amused",
    "angry",
    "nervous",
    "afraid",
    "decisive",
  ])
  .catch("calm");
const action = z.enum(["inspect", "show", "give", "backup"]);
const entry = z.object({
  turn: z.number().int(),
  player: z.string(),
  dialogue: z.string(),
  reaction: z.string(),
  pose,
  discoveries: z.array(z.string()).default([]),
  action: z.string().default("continue"),
  time_cost: z.number().int().min(0).max(20).default(0),
});
export const DealSessionSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  scenario_version: z.string(),
  remaining_seconds: z.number().int().min(0).max(480),
  debt_remaining: z.number().int().nonnegative(),
  cash: z.number().int().nonnegative(),
  pose,
  dialogue: z.string(),
  reaction: z.string(),
  marco_away: z.boolean().default(false),
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      owner: z.string(),
      description: z.string(),
      content: z.string().default(""),
      seen: z.boolean().default(false),
      shown: z.boolean().default(false),
      given: z.boolean().default(false),
      actions: z
        .array(z.string())
        .transform((list) =>
          list.filter(
            (value): value is z.infer<typeof action> =>
              action.safeParse(value).success,
          ),
        )
        .default([]),
    }),
  ),
  discoveries: z.array(z.string()).default([]),
  history: z.array(entry).default([]),
  ending: z
    .object({
      id: z.string(),
      title: z.string(),
      summary: z.string(),
      reasons: z.array(z.string()).default([]),
      promises: z.array(z.string()).default([]),
      profile: z.string().default("谈判者"),
    })
    .nullable()
    .default(null),
});
export const DealStatusSchema = z.object({
  mode: z.string().default("unknown"),
  ready: z.boolean().default(false),
  scenario_version: z.string().default(""),
});
export type DealSession = z.infer<typeof DealSessionSchema>;
export type DealStatus = z.infer<typeof DealStatusSchema>;
export type DealItem = DealSession["items"][number];
export interface DealInput {
  request_id: string;
  expected_version: number;
  kind: "talk" | "item" | "wait";
  text?: string;
  item_id?: string;
  action?: z.infer<typeof action>;
}

export class DealError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "DealError";
  }
}

export class DealClient {
  constructor(
    private readonly baseURL = "/api/deal",
    private readonly transport: typeof fetch = (...args) => fetch(...args),
  ) {}
  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.transport(`${this.baseURL}${path}`, {
        method: body === undefined ? "GET" : "POST",
        credentials: "include",
        headers:
          body === undefined
            ? undefined
            : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new DealError("network_unavailable");
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new DealError("invalid_response");
    }
    if (!response.ok) {
      const error = parseWithFallback(
        data,
        z.object({ code: z.string() }),
        { code: "service_unavailable" },
        { endpoint: `deal${path}` },
      );
      throw new DealError(error.code);
    }
    const parsed = parseWithFallback<T | null>(data, schema, null, {
      endpoint: `deal${path}`,
    });
    if (parsed === null) throw new DealError("invalid_response");
    return parsed;
  }
  status() {
    return this.request("/status", DealStatusSchema);
  }
  create() {
    return this.request("/sessions", DealSessionSchema, {});
  }
  read(id: string) {
    return this.request(
      `/sessions/${encodeURIComponent(id)}`,
      DealSessionSchema,
    );
  }
  turn(id: string, input: DealInput) {
    return this.request(
      `/sessions/${encodeURIComponent(id)}/turns`,
      DealSessionSchema,
      input,
    );
  }
}

export function formatDealTime(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
export function dealRecap(session: DealSession): string {
  return [
    `DEAL · ${session.ending?.title || "谈判记录"}`,
    session.ending?.summary || "",
    `关卡：${session.scenario_version}`,
    `剩余债务：$${session.debt_remaining.toLocaleString("en-US")}`,
    ...(session.ending?.reasons || []),
    ...(session.ending?.promises || []),
    ...session.history.flatMap((item) => [
      `\n${item.turn}. 你：${item.player}`,
      `Marco：${item.dialogue}`,
      item.reaction,
    ]),
    "\n你的发现",
    ...session.discoveries.map((value) => `· ${value}`),
  ].join("\n");
}
