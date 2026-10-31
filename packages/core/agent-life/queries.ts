import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const lifeSnapshotOptions = (wsId: string) => queryOptions({
  queryKey: ["agent-life", wsId],
  queryFn: () => api.getLifeSnapshot(wsId),
  staleTime: 1_000,
  refetchInterval: 2_000,
  refetchIntervalInBackground: false,
});
