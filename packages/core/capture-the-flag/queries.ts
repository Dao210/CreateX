import { useCallback } from "react";
import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { authenticatedFetch, parseWithFallback } from "../api";
import { z } from "zod";
import {
  StateSchema,
  StrategyRecordSchema,
  MatchRecordSchema,
  BatchSchema,
  type SaveStrategyInput,
} from "./schema";

export async function ctfRequest<T>(
  wsId: string,
  path: string,
  schema: z.ZodType<T>,
  input?: unknown,
): Promise<T> {
  const endpoint = `/api/ctf/v1/${path}`;
  const response = await authenticatedFetch(endpoint, {
    headers: {
      "X-Workspace-ID": wsId,
      "X-Workspace-Slug": "",
      "Content-Type": "application/json",
    },
    ...(input === undefined
      ? {}
      : { method: "POST", body: JSON.stringify(input) }),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const problem = z.object({ error: z.string() }).safeParse(body);
    throw new Error(
      problem.success ? problem.data.error : "service_unavailable",
    );
  }
  const parsed = parseWithFallback<T | null>(
    await response.json(),
    schema,
    null,
    { endpoint, redact: true },
  );
  if (parsed === null) throw new Error("invalid_ctf_response");
  if (
    typeof parsed === "object" &&
    "workspaceId" in parsed &&
    parsed.workspaceId !== wsId
  )
    throw new Error("invalid_ctf_response");
  return parsed;
}
export const ctfKeys = { root: (wsId: string) => ["ctf", wsId] as const };
export const ctfStateOptions = (wsId: string, userId: string) =>
  queryOptions({
    queryKey: [...ctfKeys.root(wsId), userId, "state"],
    queryFn: async () => {
      const state = await ctfRequest(wsId, "state", StateSchema);
      if (
        state.workspaceId !== wsId ||
        state.mine.some((s) => s.ownerId !== userId) ||
        [...state.mine, ...state.library, ...state.entries].some(
          (s) => s.workspaceId !== wsId,
        ) ||
        state.batches.some((b) => b.workspaceId !== wsId) ||
        state.matches.some(
          (m) =>
            m.workspaceId !== wsId ||
            m.red.workspaceId !== wsId ||
            m.blue.workspaceId !== wsId,
        )
      )
        throw new Error("invalid_ctf_response");
      return state;
    },
    refetchInterval: 3000,
  });
export const ctfMatchOptions = (wsId: string, id: string) =>
  queryOptions({
    queryKey: [...ctfKeys.root(wsId), "match", id],
    enabled: !!id,
    queryFn: async () => {
      const match = await ctfRequest(
        wsId,
        `matches/${encodeURIComponent(id)}`,
        MatchRecordSchema,
      );
      if (match.id !== id || match.workspaceId !== wsId)
        throw new Error("invalid_ctf_response");
      return match;
    },
    refetchInterval: (query) =>
      query.state.data?.status === "running" ||
      query.state.data?.status === "queued"
        ? 1000
        : false,
  });
export function useCTFActions(wsId: string) {
  const query = useQueryClient();
  const refresh = () =>
    query.invalidateQueries({ queryKey: ctfKeys.root(wsId) });
  return {
    save: useMutation({
      mutationFn: (input: SaveStrategyInput) =>
        ctfRequest(wsId, "strategies", StrategyRecordSchema, input),
      onSuccess: refresh,
    }),
    enroll: useMutation({
      mutationFn: (input: {
        requestId: string;
        id: string;
        revision: number;
        hash: string;
        publish: true;
      }) => ctfRequest(wsId, "entries", StrategyRecordSchema, input),
      onSuccess: refresh,
    }),
    withdraw: useMutation({
      mutationFn: () =>
        ctfRequest(wsId, "entries/withdraw", z.object({ ok: z.boolean() }), {}),
      onSuccess: refresh,
    }),
    archive: useMutation({
      mutationFn: (input: { id: string; archived: boolean }) =>
        ctfRequest(
          wsId,
          "strategies/archive",
          z.object({ ok: z.boolean() }),
          input,
        ),
      onSuccess: refresh,
    }),
    start: useMutation({
      mutationFn: (requestId: string) =>
        ctfRequest(wsId, "batches", BatchSchema, { requestId }),
      onSuccess: refresh,
    }),
    control: useMutation({
      mutationFn: (input: {
        id: string;
        action: "pause" | "resume" | "stop" | "publish";
      }) => ctfRequest(wsId, "batches/control", BatchSchema, input),
      onSuccess: refresh,
    }),
  };
}

export const ctfStrategyOptions = (
  wsId: string,
  userId: string,
  id: string,
  revision: number,
) =>
  queryOptions({
    queryKey: [...ctfKeys.root(wsId), userId, "strategy", id, revision],
    queryFn: async () => {
      const record = await ctfRequest(
        wsId,
        `strategies/${encodeURIComponent(id)}?revision=${revision}`,
        StrategyRecordSchema,
      );
      if (
        record.id !== id ||
        record.revision !== revision ||
        record.workspaceId !== wsId
      )
        throw new Error("invalid_ctf_response");
      return record;
    },
    staleTime: 60_000,
  });
export function useCTFStrategyLoader(wsId: string, userId: string) {
  const query = useQueryClient();
  return useCallback(
    (id: string, revision: number) =>
      query.fetchQuery(ctfStrategyOptions(wsId, userId, id, revision)),
    [query, wsId, userId],
  );
}
