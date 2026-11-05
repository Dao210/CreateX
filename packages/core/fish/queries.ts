import { keepPreviousData, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { SaveFishInput, ReleaseFishInput, ChangeFishResidentInput, RecallFishInput, PublicFishOceanSelection } from "./schema";
export const fishKeys = { root: (wsId: string) => ["fish", wsId] as const, mine: (wsId: string, userId: string) => ["fish", wsId, userId, "creations"] as const, ocean: (wsId: string, userId: string, id = "") => ["fish", wsId, userId, "ocean", id] as const };
export const myFishOptions = (wsId: string, userId: string) => queryOptions({ queryKey: fishKeys.mine(wsId, userId), queryFn: async () => { const fish = await api.listFish(wsId); if (fish.some(f => f.ownerId !== userId)) throw new Error("invalid_fish_owner"); return fish; }, staleTime: 5000, refetchInterval: 10000 });
export const fishOceanOptions = (wsId: string, userId: string, id = "") => queryOptions({ queryKey: fishKeys.ocean(wsId, userId, id), queryFn: async () => { const ocean = await api.getFishOcean(wsId, id); if (!id && ocean && ocean.ownerId !== userId) throw new Error("invalid_fish_owner"); return ocean; }, staleTime: 2000, refetchInterval: 5000, retry: false });
export const publicFishOceanOptions = (wsId: string, userId: string, selection: PublicFishOceanSelection) => queryOptions({
  queryKey: [...fishKeys.root(wsId), userId, "public-ocean", selection],
  queryFn: () => api.getPublicFishOcean(wsId, selection),
  placeholderData: keepPreviousData, staleTime: 2000, refetchInterval: 5000, retry: false,
});
export function useFishActions(wsId: string) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: fishKeys.root(wsId) });
  return {
    save: useMutation({ mutationFn: (input: SaveFishInput) => api.saveFish(wsId, input), onSuccess: refresh }),
    release: useMutation({ mutationFn: (input: ReleaseFishInput) => api.releaseFish(wsId, input), onSuccess: refresh }),
    apply: useMutation({ mutationFn: (input: ChangeFishResidentInput) => api.applyFishRevision(wsId, input), onSuccess: refresh }),
    recall: useMutation({ mutationFn: (input: RecallFishInput) => api.recallFish(wsId, input), onSuccess: refresh }),
    archive: useMutation({ mutationFn: (input: { requestId: string; fishId: string; archived: boolean }) => api.archiveFish(wsId, input), onSuccess: refresh }),
    settings: useMutation({ mutationFn: (input: { requestId: string; oceanId: string; expectedRevision: number; visibility: "private" | "world" }) => api.setFishOceanSettings(wsId, input), onSuccess: refresh }),
  };
}
