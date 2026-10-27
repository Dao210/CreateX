import { queryOptions } from "@tanstack/react-query";
import { authenticatedFetch } from "../api";
import { SiegeClient } from "./client";

export interface SiegeScope { workspaceId: string; workspaceSlug: string; userId: string }
export const siegeKeys = {
  status: (scope: SiegeScope) => ["siege", scope.workspaceId, scope.userId, "status"] as const,
  library: (scope: SiegeScope) => ["siege", scope.workspaceId, scope.userId, "library"] as const,
  session: (scope: SiegeScope, id: string) => ["siege", scope.workspaceId, scope.userId, "session", id] as const,
};

/** Pin the destination even if a different workspace becomes active mid-request. */
export function createSiegeClient(scope: SiegeScope): SiegeClient {
  return new SiegeClient("/api/siege", (input, init) => authenticatedFetch(input, {
    ...init,
    headers: { ...init?.headers, "X-Workspace-ID": scope.workspaceId, "X-Workspace-Slug": scope.workspaceSlug },
  }));
}
export function siegeStatusOptions(client: SiegeClient, scope: SiegeScope) {
  return queryOptions({ queryKey: siegeKeys.status(scope), queryFn: () => client.status(), staleTime: 60_000 });
}
export function siegeLibraryOptions(client: SiegeClient, scope: SiegeScope) {
  return queryOptions({ queryKey: siegeKeys.library(scope), queryFn: () => client.library(), staleTime: 15_000 });
}
export function siegeSessionOptions(client: SiegeClient, scope: SiegeScope, id: string) {
  return queryOptions({ queryKey: siegeKeys.session(scope, id), queryFn: () => client.read(id), enabled: !!id, retry: false });
}
