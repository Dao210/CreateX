import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { WorldOpsFollowupInput } from "./world-schema";

const worldOpsKey = (user: string) => ["admin", user, "worlds"] as const;
export const worldOpsOptions = (user: string, query: string) => queryOptions({
  queryKey: [...worldOpsKey(user), "list", query],
  queryFn: () => api.listWorldOps(query), enabled: Boolean(user), staleTime: 30_000, retry: false,
});
export const worldOpsDetailOptions = (user: string, world: string, query: string) => queryOptions({
  queryKey: [...worldOpsKey(user), "detail", world, query],
  queryFn: () => api.getWorldOps(world, query), enabled: Boolean(user && world), staleTime: 30_000, retry: false,
});
export const worldOpsFollowupsOptions = (user: string, world: string, page: number) => queryOptions({
  queryKey: [...worldOpsKey(user), "followups", world, page],
  queryFn: () => api.listWorldOpsFollowups(world, page), enabled: Boolean(user && world), retry: false,
});
export const worldOpsEntriesOptions = (user: string, world: string, followup: string, page: number) => queryOptions({
  queryKey: [...worldOpsKey(user), "history", world, followup, page],
  queryFn: () => api.listWorldOpsEntries(world, followup, page), enabled: Boolean(user && world && followup), retry: false,
});
export const worldOpsAssigneesOptions = (user: string) => queryOptions({
  queryKey: [...worldOpsKey(user), "assignees"],
  queryFn: () => api.listWorldOpsAssignees(), enabled: Boolean(user), staleTime: 30_000, retry: false,
});
export function useSaveWorldOpsFollowup(user: string, world: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: WorldOpsFollowupInput }) => api.saveWorldOpsFollowup(world, id, input),
    onSuccess: () => client.invalidateQueries({ queryKey: worldOpsKey(user) }),
    onError: error => {
      if (error instanceof ApiError && error.status === 409) {
        void client.invalidateQueries({ queryKey: [...worldOpsKey(user), "followups", world] });
      }
    },
  });
}
