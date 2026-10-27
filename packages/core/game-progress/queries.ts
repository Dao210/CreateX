import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

export const gameProgressKeys = {
  all: (wsId: string) => ["game-progress", wsId] as const,
};

export function gameProgressOptions(wsId: string) {
  return queryOptions({
    queryKey: gameProgressKeys.all(wsId),
    queryFn: () => api.getGameProgress(wsId),
    staleTime: 15_000,
  });
}

export function useSyncSiegeProgress(wsId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (stars: number[]) => api.saveSiegeProgress(wsId, stars),
    onSuccess: () => client.invalidateQueries({ queryKey: gameProgressKeys.all(wsId) }),
  });
}

export function useSyncTankProgress(wsId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { best: number; unlocked: number }) => api.saveTankProgress(wsId, input),
    onSuccess: () => client.invalidateQueries({ queryKey: gameProgressKeys.all(wsId) }),
  });
}
