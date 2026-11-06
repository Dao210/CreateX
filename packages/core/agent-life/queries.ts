import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { TownCommand } from "./town-schema";

export const lifeSnapshotOptions = (wsId: string) => queryOptions({
  queryKey: ["agent-life", wsId],
  queryFn: () => api.getLifeSnapshot(wsId),
  staleTime: 1_000,
  // Commit notifications drive updates; periodic reconciliation also heals missed frames.
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
});

export function useTownCommands(wsId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (command: TownCommand) => api.submitTownCommand(wsId, command),
    onSuccess: () => client.invalidateQueries({ queryKey: ["agent-life", wsId] }),
  });
}

export const lifeHistoryOptions = (wsId: string, userId: string, since: number) => queryOptions({
  queryKey: ["agent-life-history", wsId, userId, since], queryFn: () => api.getLifeHistory(wsId, since), staleTime: Infinity, refetchOnWindowFocus: false,
});
