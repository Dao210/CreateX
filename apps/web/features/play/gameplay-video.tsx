"use client";

import { useEffect, useRef } from "react";
import { Pause, Play } from "lucide-react";
import "./gameplay-runtime";
import type { GameId, PlayCopy } from "./types";
import styles from "./play-landing.module.css";

type Props = {
  game: GameId;
  media: { video: string; mobileVideo: string; poster: string; width: number; height: number };
  label: string;
  copy: Pick<PlayCopy, "play" | "pause" | "mediaError">;
};

export function GameplayVideo({ game, media, label, copy }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const player = frame.current && window.auroGameplay?.mount(frame.current);
    return () => { player?.destroy(); };
  }, []);

  return (
    // The native controller owns playback attributes before and after hydration.
    <div ref={frame} className={styles.mediaFrame} data-gameplay={game} data-testid="gameplay-media" data-playing="false" suppressHydrationWarning>
      {/* eslint-disable-next-line @next/next/no-img-element -- Content-hashed WebP stills need no client image loader. */}
      <img src={media.poster} width={media.width} height={media.height} alt={label} decoding="async" loading="eager" fetchPriority="high" className={styles.poster} />
      <video src={media.video} data-mobile-src={media.mobileVideo} poster={media.poster} width={media.width} height={media.height} muted playsInline loop preload="none" aria-label={label} className={styles.video} suppressHydrationWarning />
      <p hidden className={styles.mediaError} role="status" suppressHydrationWarning>{copy.mediaError}</p>
      <button type="button" disabled className={styles.playback} aria-label={copy.play} data-play-label={copy.play} data-pause-label={copy.pause} suppressHydrationWarning>
        <Play className={styles.playIcon} aria-hidden="true" /><Pause className={styles.pauseIcon} aria-hidden="true" />
      </button>
    </div>
  );
}
