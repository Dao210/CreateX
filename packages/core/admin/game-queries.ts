import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { UpdateGamePolicyInput } from "./game-schema";

export const gameAdminKeys = {
  all: (userId: string) => ["admin", userId, "games"] as const,
  activity: (userId: string, gameId: string, cursor: string) => ["admin", userId, "games", "activity", gameId, cursor] as const,
  worlds: (userId: string, search: string, cursor: string) => ["admin", userId, "games", "worlds", search, cursor] as const,
  preview: (userId: string, gameId: string, input: UpdateGamePolicyInput) => ["admin", userId, "games", "preview", gameId, input] as const,
  effective: (wsId: string) => ["world-games", wsId] as const,
};
export function adminGamesOptions(userId: string) {
  return queryOptions({ queryKey: gameAdminKeys.all(userId), queryFn: () => api.listAdminGames(), enabled: Boolean(userId), refetchInterval: 15000, retry: false });
}
export function gameWorldsOptions(userId: string, search: string, cursor = "") {
  return queryOptions({ queryKey: gameAdminKeys.worlds(userId, search, cursor), queryFn: () => api.searchGameAdminWorlds(search, cursor), enabled: Boolean(userId), staleTime: 15000 });
}
export function gameAuditOptions(userId: string, gameId: string, cursor = "") {
  return queryOptions({ queryKey: gameAdminKeys.activity(userId, gameId, cursor), queryFn: () => api.getGamePolicyActivity(gameId, cursor), enabled: Boolean(userId && gameId), refetchInterval: cursor ? false : 15000 });
}
export function gamePreviewOptions(userId: string, gameId: string, input: UpdateGamePolicyInput, enabled: boolean) {
  return queryOptions({ queryKey: gameAdminKeys.preview(userId, gameId, input), queryFn: () => api.previewGamePolicy(gameId, input), enabled: Boolean(userId && enabled), retry: false });
}
export function worldGamesOptions(wsId: string) {
  return queryOptions({ queryKey: gameAdminKeys.effective(wsId), queryFn: () => api.getWorldGames(wsId), enabled: Boolean(wsId), staleTime: 15000, refetchInterval: 30000, refetchOnWindowFocus: "always" as const, retry: false });
}
export function useWorldGames(wsId: string) { return useQuery(worldGamesOptions(wsId)); }
export function useUpdateGamePolicy(userId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ gameId, input }: { gameId: string; input: UpdateGamePolicyInput }) => api.updateGamePolicy(gameId, input),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: gameAdminKeys.all(userId) }),
        client.invalidateQueries({ queryKey: ["world-games"] }),
      ]);
    },
  });
}
