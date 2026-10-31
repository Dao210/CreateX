import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { CreateTankSessionInput, SaveTankCharacterInput } from "./characters";
import type { StartTankTrainingInput, SettleTankTrainingInput } from "./progression";

export const tankKeys = {
  characters: (wsId: string) => ["tanks", wsId, "characters"] as const,
  mine: (wsId: string, userId: string) => ["tanks", wsId, userId, "characters"] as const,
  session: (wsId: string, userId: string, id: string) => ["tanks", wsId, userId, "session", id] as const,
};
export function tankCharactersOptions(wsId: string) {
  return queryOptions({ queryKey: tankKeys.characters(wsId), queryFn: () => api.listTankCharacters(wsId), staleTime: 10000, refetchInterval: 15000 });
}
export function myTankCharactersOptions(wsId: string, userId: string) {
  return queryOptions({ queryKey: tankKeys.mine(wsId, userId), queryFn: () => api.listTankCharacters(wsId, true), staleTime: 10000, refetchInterval: 15000 });
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
  return useMutation({ mutationFn: (input: SaveTankCharacterInput) => api.saveTankCharacter(wsId, input), onSuccess: () => invalidateTankLibraries(client, wsId) });
}

function invalidateTankLibraries(client: ReturnType<typeof useQueryClient>, wsId: string) {
  return client.invalidateQueries({ predicate: query => query.queryKey[0] === "tanks" && query.queryKey[1] === wsId && query.queryKey.at(-1) === "characters" });
}

export function useStartTankTraining(wsId: string) {
  return useMutation({ mutationFn: ({ sessionId, characterId, ...input }: StartTankTrainingInput & { sessionId: string; characterId: string }) => api.startTankTraining(wsId, sessionId, input).then(result => {
    if (result.characterId !== characterId) throw new Error("invalid_tank_response");
    return result;
  }) });
}

export function useSettleTankTraining(wsId: string) {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ sessionId, runId, characterId, ...input }: SettleTankTrainingInput & { sessionId: string; runId: string; characterId: string }) => api.settleTankTraining(wsId, sessionId, runId, input).then(result => {
    if (result.characterId !== characterId) throw new Error("invalid_tank_response");
    return result;
  }), onSuccess: () => invalidateTankLibraries(client, wsId) });
}
export function useCreateTankSession(wsId: string) {
  const client = useQueryClient();
  return useMutation({ mutationFn: (input: CreateTankSessionInput) => api.createTankSession(wsId, input), onSuccess: session => client.setQueryData(tankKeys.session(wsId, session.ownerId, session.id), session) });
}
