import type { StorageAdapter } from "../types/storage";

/** Campaign stars live inside the identity-scoped preference namespace. */
export const SIEGE_CAMPAIGN_PROGRESS_KEY = "siege-campaign-progress";

export function siegePreferencesKey(userId: string, workspaceId: string): string {
  if (!userId || !workspaceId) throw new Error("Siege records require a user and workspace");
  return `auro:siege:${encodeURIComponent(userId)}:${encodeURIComponent(workspaceId)}`;
}

/** Bind every preference to the identity that mounted this game. */
export function scopedSiegeStorage(storage: StorageAdapter, namespace: string): StorageAdapter {
  return {
    getItem: key => storage.getItem(`${namespace}:${key}`),
    setItem: (key, value) => storage.setItem(`${namespace}:${key}`, value),
    removeItem: key => storage.removeItem(`${namespace}:${key}`),
  };
}
