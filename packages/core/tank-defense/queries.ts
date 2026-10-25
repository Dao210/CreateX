import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { CreateTankSessionInput, SaveTankCharacterInput } from "./characters";

export const tankKeys = {
  characters: (wsId: string) => ["tanks", wsId, "characters"] as const,
  session: (wsId: string, userId: string, id: string) => ["tanks", wsId, userId, "session", id] as const,
};
export function tankCharactersOptions(wsId: string) {
  return queryOptions({ queryKey: tankKeys.characters(wsId), queryFn: () => api.listTankCharacters(wsId), staleTime: 10000, refetchInterval: 15000 });
}
export function tankSessionOptions(wsId: string, userId: string, id: string) {
  return queryOptions({ queryKey: tankKeys.session(wsId, userId, id), queryFn: async () => {
    const session = await api.getTankSession(wsId, id);
    if (session.ownerId !== userId) throw new Error("invalid_tank_response");
    return session;
  }, enabled: Boolean(id), retry: false, staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false });
}
export function useSaveTankCharacter(wsId: string) {
  const client = useQueryClient();
  return useMutation({ mutationFn: (input: SaveTankCharacterInput) => api.saveTankCharacter(wsId, input), onSuccess: () => client.invalidateQueries({ queryKey: tankKeys.characters(wsId) }) });
}
export function useCreateTankSession(wsId: string) {
  return useMutation({ mutationFn: (input: CreateTankSessionInput) => api.createTankSession(wsId, input) });
}
