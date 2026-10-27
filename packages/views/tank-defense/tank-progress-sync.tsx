"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { gameProgressOptions, mergeTankAchievements, useSyncTankProgress } from "@auro/core/game-progress";

export interface TankAchievements {
  best: number;
  unlocked: number;
}

/**
 * Keeps the battle's local best/unlocked pair in step with the personal cloud
 * record. Mounted only for a resolved workspace, so the battle stays usable in
 * hosts (and tests) that do not provide a query client.
 */
export function TankProgressSync({ workspaceId, preferences, onMerge }: {
  workspaceId: string;
  preferences: TankAchievements;
  onMerge: (merged: TankAchievements) => void;
}) {
  const remote = useQuery(gameProgressOptions(workspaceId));
  const sync = useSyncTankProgress(workspaceId);
  const preferencesRef = useRef(preferences); preferencesRef.current = preferences;
  const syncRef = useRef(sync.mutate); syncRef.current = sync.mutate;
  const remoteApplied = useRef(false);
  const synced = useRef<TankAchievements>({ best: preferences.best, unlocked: preferences.unlocked });

  useEffect(() => {
    if (remoteApplied.current || !remote.data) return;
    remoteApplied.current = true;
    const local = preferencesRef.current;
    const stored = remote.data.tanks;
    const merged = mergeTankAchievements(local, stored);
    synced.current = merged;
    if (merged.best !== local.best || merged.unlocked !== local.unlocked) onMerge(merged);
    const pushesLocal = !stored && (merged.best > 0 || merged.unlocked > 1);
    const pushesHigherLocal = !!stored && (merged.best !== stored.best || merged.unlocked !== stored.unlocked);
    if (pushesLocal || pushesHigherLocal) syncRef.current(merged);
  }, [onMerge, remote.data]);

  useEffect(() => {
    const last = synced.current;
    if (preferences.best === last.best && preferences.unlocked === last.unlocked) return;
    synced.current = { best: preferences.best, unlocked: preferences.unlocked };
    syncRef.current({ best: preferences.best, unlocked: preferences.unlocked });
  }, [preferences.best, preferences.unlocked]);

  return null;
}
