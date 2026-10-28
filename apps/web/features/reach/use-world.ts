"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSeason, fetchSnapshot } from "./api";
import { previewSnapshot } from "./preview";

export type WorldSource = "connecting" | "live" | "paused" | "preview";

/** Public queries use their own small cache and run only while the map is visible. */
export function useWorld(visible: boolean) {
  const [preview] = useState(previewSnapshot);
  const [foreground, setForeground] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReducedMotion(query.matches);
    const syncVisibility = () => setForeground(document.visibilityState !== "hidden");
    syncMotion();
    syncVisibility();
    query.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      query.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);
  const active = visible && foreground;
  const world = useQuery({
    queryKey: ["public-world", "snapshot"],
    queryFn: async ({ signal }) => {
      const snapshot = await fetchSnapshot(signal);
      if (!snapshot) throw new Error("World snapshot unavailable");
      return snapshot;
    },
    enabled: active,
    staleTime: 8000,
    refetchInterval: (query) => query.state.error ? 15000 : 8000,
    retry: false,
  });
  const season = useQuery({
    queryKey: ["public-world", "season"],
    queryFn: async ({ signal }) => {
      const info = await fetchSeason(signal);
      if (!info) throw new Error("World season unavailable");
      return info;
    },
    enabled: active,
    staleTime: 60000,
    refetchInterval: 60000,
    retry: false,
  });
  const source: WorldSource = world.data ? (world.isError ? "paused" : "live") : world.isError ? "preview" : "connecting";
  return { snapshot: world.data ?? preview, season: season.data ?? null, source, reducedMotion, active };
}
