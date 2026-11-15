"use client";
import { useEffect, useRef } from "react";
import type { Frame } from "@auro/core/capture-the-flag";
import {
  ATLAS_URL,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  drawBattle,
  drawBoard,
  unitAt,
} from "./battle-art";

export function BattleCanvas({
  frame,
  label,
  selectedId,
  targetId,
  onSelect,
  playing = false,
  interval = 250,
}: {
  frame: Frame;
  label: string;
  selectedId?: string;
  targetId?: string;
  onSelect?: (id: string) => void;
  playing?: boolean;
  interval?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ frame, selectedId, targetId, playing, interval });
  useEffect(() => {
    latest.current = { frame, selectedId, targetId, playing, interval };
  }, [frame, selectedId, targetId, playing, interval]);
  useEffect(() => {
    const el = canvas.current,
      ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const board = document.createElement("canvas");
    board.width = FIELD_WIDTH;
    board.height = FIELD_HEIGHT;
    const ground = board.getContext("2d");
    if (!ground) return;
    drawBoard(ground);
    const atlas = new Image();
    atlas.src = ATLAS_URL;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const facing = new Map<string, number>();
    let target = latest.current.frame,
      previous = target,
      changedAt = performance.now(),
      request = 0;
    let lastFrame: Frame | null = null,
      lastSelected: string | undefined,
      lastLoaded = false,
      lastPlaying = false;
    const paint = (now: number) => {
      const current = latest.current;
      if (current.frame !== target) {
        previous =
          current.frame.tick > target.tick && current.frame.time > target.time
            ? target
            : current.frame;
        if (previous === current.frame) facing.clear();
        target = current.frame;
        changedAt = now;
      }
      const ratio = Math.min(devicePixelRatio || 1, 2);
      const resized = el.width !== FIELD_WIDTH * ratio;
      if (resized) {
        el.width = FIELD_WIDTH * ratio;
        el.height = FIELD_HEIGHT * ratio;
      }
      const loaded = atlas.complete && atlas.naturalWidth > 0;
      if (
        !document.hidden &&
        (current.playing ||
          resized ||
          lastFrame !== target ||
          lastSelected !== current.selectedId ||
          lastLoaded !== loaded ||
          lastPlaying !== current.playing)
      ) {
        const blend = !current.playing
          ? 1
          : Math.min(1, (now - changedAt) / Math.max(16, current.interval));
        const time = previous.time + (target.time - previous.time) * blend;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT);
        ctx.drawImage(board, 0, 0);
        drawBattle(
          ctx,
          atlas,
          target,
          previous,
          blend,
          time,
          current.selectedId,
          reduced.matches,
          facing,
          current.targetId,
        );
        lastFrame = target;
        lastSelected = current.selectedId;
        lastLoaded = loaded;
        lastPlaying = current.playing;
      }
      request = requestAnimationFrame(paint);
    };
    request = requestAnimationFrame(paint);
    return () => {
      cancelAnimationFrame(request);
      atlas.src = "";
    };
  }, []);
  return (
    <canvas
      ref={canvas}
      className="ctf-canvas"
      role="img"
      aria-label={label}
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        const id = unitAt(
          frame,
          ((event.clientX - box.left) / box.width) * FIELD_WIDTH,
          ((event.clientY - box.top) / box.height) * FIELD_HEIGHT,
          selectedId,
        );
        if (id) onSelect?.(id);
      }}
    />
  );
}
