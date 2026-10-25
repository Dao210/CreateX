"use client";

import { useAuthStore } from "@auro/core/auth";
import { useCurrentWorkspace } from "@auro/core/paths";
import type { StorageAdapter } from "@auro/core/types";
import { tankPreferencesKey } from "@auro/core/tank-defense";
import { TankGarage } from "./tank-garage";

export interface TankDefensePageProps { storage: StorageAdapter }

/** Resolve route-owned identity before reading records or server characters. */
export function TankDefensePage({ storage }: TankDefensePageProps) {
  const workspace = useCurrentWorkspace();
  const userId = useAuthStore(state => state.user?.id);
  if (!workspace || !userId) return null;
  const storageKey = tankPreferencesKey(userId, workspace.id);
  return <TankGarage key={storageKey} storage={storage} storageKey={storageKey} workspace={workspace} userId={userId} />;
}
