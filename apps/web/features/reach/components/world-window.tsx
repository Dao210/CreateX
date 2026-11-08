"use client";

import { useEffect, useRef, useState } from "react";
import type { WorldSnapshot } from "../types";
import { drawWorldScene } from "../world-canvas";
import { hitEntity, worldView, type WorldPoint } from "../world-presentation";
import styles from "./world-preview.module.css";

type Props = {
  snapshot: WorldSnapshot;
  active?: boolean;
  label: string;
  selectedId?: string;
  selectedName?: string;
  focus?: WorldPoint;
  onSelect?: (id: string) => void;
  onReady?: () => void;
  beatSeconds?: number;
  reducedMotion?: boolean;
};

export function WorldWindow({ snapshot, active = true, label, selectedId, selectedName, focus, onSelect, onReady, beatSeconds = 60, reducedMotion = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const trailRef = useRef<{ id?: string; points: WorldPoint[] }>({ points: [] });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const focusX = focus?.x;
  const focusY = focus?.y;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active || typeof Path2D === "undefined") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let announcedReady = false;
    let paintedWidth = 0;
    let paintedHeight = 0;
    const currentFocus = focusX !== undefined && focusY !== undefined ? { x: focusX, y: focusY } : undefined;
    const selected = snapshot.entities.find((entity) => entity.id === selectedId);
    const trail = trailRef.current;
    if (trail.id !== selectedId) { trail.id = selectedId; trail.points = []; }
    if (selected && (trail.points.at(-1)?.x !== selected.x || trail.points.at(-1)?.y !== selected.y)) {
      trail.points = [...trail.points.slice(-7), { x: selected.x, y: selected.y }];
    }

    const draw = () => {
      frameRef.current = null;
      const { width, height } = canvas.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      paintedWidth = width;
      paintedHeight = height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      drawWorldScene(ctx, width, height, snapshot, currentFocus, selectedId, trail.points);
      setViewport((previous) => previous.width === width && previous.height === height ? previous : { width, height });
      if (!announcedReady) { announcedReady = true; onReady?.(); }
    };

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (width === paintedWidth && height === paintedHeight) return;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => { observer.disconnect(); if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); };
  }, [active, snapshot, selectedId, focusX, focusY, onReady]);

  const view = viewport.width > 0 ? worldView(viewport.width, viewport.height, focus) : undefined;
  const selected = snapshot.entities.find((entity) => entity.id === selectedId);
  const left = selected && view ? selected.x * view.scale + view.offsetX : -100;
  const top = selected && view ? selected.y * view.scale + view.offsetY : -100;
  const markerVisible = left > 35 && left < viewport.width - 35 && top > 85 && top < viewport.height - 45;

  return (
    <div className={styles.canvasLayer}>
      <canvas ref={canvasRef} role="img" aria-label={label} className={styles.canvas} onPointerUp={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const camera = worldView(rect.width, rect.height, focus);
        const entity = hitEntity(snapshot.entities, { x: (event.clientX - rect.left - camera.offsetX) / camera.scale, y: (event.clientY - rect.top - camera.offsetY) / camera.scale }, 28 / camera.scale);
        if (entity) onSelect?.(entity.id);
      }} />
      {selected && view && <span aria-hidden="true" className={styles.mapPulse} data-active={active && !reducedMotion} style={{ left, top: top + 25 * view.scale, animationDuration: `${Math.max(1, beatSeconds)}s` }} />}
      {selected && markerVisible && <span className={styles.mapName} style={{ left, top }}>{selectedName ?? selected.name}</span>}
    </div>
  );
}
