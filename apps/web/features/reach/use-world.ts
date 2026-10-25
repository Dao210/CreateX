"use client";

import { useEffect, useState } from "react";
import { fetchSeason, fetchSnapshot, previewSnapshot } from "./api";
import type { SeasonInfo, WorldSnapshot } from "./types";

export type WorldSource = "connecting" | "live" | "paused" | "preview";

type World = {
  snapshot: WorldSnapshot;
  season: SeasonInfo | null;
  source: WorldSource;
  reducedMotion: boolean;
};

const LIVE_INTERVAL = 8_000;
const RETRY_INTERVAL = 15_000;

/**
 * Polls the world. Three states matter to the reader and to the copy:
 * - live: real data, refreshed on the beat
 * - paused: we had data, then lost the service; keep the last snapshot visible
 * - preview: never reached the service, so show the labelled fixture
 */
export function useWorld(): World {
  const [snapshot, setSnapshot] = useState<WorldSnapshot>(() => previewSnapshot());
  const [season, setSeason] = useState<SeasonInfo | null>(null);
  const [source, setSource] = useState<WorldSource>("connecting");
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let reached = false;

    const tick = async () => {
      const [next, info] = await Promise.all([fetchSnapshot(), fetchSeason()]);
      if (cancelled) return;
      if (next) {
        reached = true;
        setSnapshot(next);
        setSeason(info);
        setSource("live");
        timer = setTimeout(tick, LIVE_INTERVAL);
        return;
      }
      setSource(reached ? "paused" : "preview");
      timer = setTimeout(tick, RETRY_INTERVAL);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { snapshot, season, source, reducedMotion };
}
