"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@auro/ui/components/ui/button";
import type { PlayCopy } from "./types";
import styles from "./play-landing.module.css";

type Props = {
  media: { video: string; poster: string; width: number; height: number };
  label: string;
  copy: Pick<PlayCopy, "play" | "pause" | "mediaError">;
};

export function GameplayVideo({ media, label, copy }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(true);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [manual, setManual] = useState<boolean | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const wanted = manual ?? autoEnabled;

  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const syncMotion = () => setAutoEnabled(!motion.matches && !connection?.saveData);
    const syncVisibility = () => setForeground(document.visibilityState !== "hidden");
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), { threshold: .1 });
    if (frame.current) observer.observe(frame.current);
    syncMotion(); syncVisibility();
    motion.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => { observer.disconnect(); motion.removeEventListener("change", syncMotion); document.removeEventListener("visibilitychange", syncVisibility); };
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (!visible || !foreground || !wanted || failed) { element.pause(); return; }
    if (!element.getAttribute("src")) element.src = media.video;
    void element.play().catch(() => setPlaying(false));
  }, [visible, foreground, wanted, failed, media.video]);

  useEffect(() => {
    const element = video.current;
    return () => { if (element) { element.pause(); element.removeAttribute("src"); element.load(); } };
  }, []);

  return (
    <div ref={frame} className={styles.mediaFrame} data-testid="gameplay-media" data-playing={playing}>
      <Image src={media.poster} width={media.width} height={media.height} alt={label} unoptimized loading="eager" fetchPriority="high" className={styles.poster} />
      <video ref={video} poster={media.poster} width={media.width} height={media.height} muted playsInline loop preload="none" aria-label={label} className={styles.video} onPlaying={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => { setFailed(true); setPlaying(false); }} />
      {failed && <p className={styles.mediaError} role="status">{copy.mediaError}</p>}
      <Button variant="ghost" size="icon-lg" className={styles.playback} aria-label={playing ? copy.pause : copy.play} onClick={() => {
        const element = video.current;
        if (!element) return;
        if (playing) { setManual(false); element.pause(); }
        else {
          setManual(true);
          if (!element.getAttribute("src")) element.src = media.video;
          if (failed) { setFailed(false); element.load(); }
          void element.play().catch(() => setPlaying(false));
        }
      }}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</Button>
    </div>
  );
}
