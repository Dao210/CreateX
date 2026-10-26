"use client";

import { useEffect, useRef, useState } from "react";
import { WORLD_HEIGHT, WORLD_WIDTH, type EntityView, type WorldSnapshot } from "../types";

type Props = {
  snapshot: WorldSnapshot;
  /** Beat length drives the pulse of rifts; 0 freezes animation for reduced motion. */
  beatSeconds?: number;
  reducedMotion?: boolean;
};

type Position = { x: number; y: number };

const GRID = 64;

function silhouettePath(
  ctx: CanvasRenderingContext2D,
  silhouette: EntityView["silhouette"],
  size: number,
) {
  ctx.beginPath();
  switch (silhouette) {
    case "broad":
      ctx.moveTo(0, -size * 0.7);
      ctx.lineTo(size * 0.8, size * 0.55);
      ctx.lineTo(-size * 0.8, size * 0.55);
      break;
    case "tall":
      ctx.rect(-size * 0.32, -size * 0.95, size * 0.64, size * 1.9);
      break;
    case "low":
      ctx.ellipse(0, 0, size * 0.95, size * 0.42, 0, 0, Math.PI * 2);
      break;
    default:
      ctx.moveTo(0, -size);
      ctx.lineTo(size * 0.45, size * 0.7);
      ctx.lineTo(-size * 0.45, size * 0.7);
  }
  ctx.closePath();
}

export function WorldWindow({ snapshot, beatSeconds = 60, reducedMotion = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const positions = useRef<Map<string, Position>>(new Map());
  const snapshotRef = useRef(snapshot);
  const [hovered, setHovered] = useState<{ name: string; x: number; y: number } | null>(null);

  snapshotRef.current = snapshot;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    const start = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    // Cover-fit: the window always fills its frame, cropping the long axis on
    // narrow screens rather than letterboxing the world.
    const view = () => {
      const scale = Math.max(width / WORLD_WIDTH, height / WORLD_HEIGHT);
      return {
        scale,
        offsetX: (width - WORLD_WIDTH * scale) / 2,
        offsetY: (height - WORLD_HEIGHT * scale) / 2,
      };
    };

    const draw = () => {
      const current = snapshotRef.current;
      const { scale, offsetX, offsetY } = view();
      const toX = (x: number) => offsetX + x * scale;
      const toY = (y: number) => offsetY + y * scale;

      ctx.clearRect(0, 0, width, height);

      // Ground: a single flat plane with one warm glow from the north.
      ctx.fillStyle = "#0A0B0E";
      ctx.fillRect(0, 0, width, height);
      const glow = ctx.createRadialGradient(
        width * 0.5,
        -height * 0.35,
        0,
        width * 0.5,
        -height * 0.35,
        height * 1.6,
      );
      glow.addColorStop(0, "rgba(200,98,45,0.10)");
      glow.addColorStop(1, "rgba(200,98,45,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      // Grid: a surveyor's lattice, barely there.
      ctx.fillStyle = "rgba(232,225,213,0.05)";
      for (let x = 0; x <= WORLD_WIDTH; x += GRID) {
        for (let y = 0; y <= WORLD_HEIGHT; y += GRID) {
          const px = toX(x);
          const py = toY(y);
          if (px < -2 || px > width + 2 || py < -2 || py > height + 2) continue;
          ctx.fillRect(px, py, 1, 1);
        }
      }

      // Vignette: pulls the eye to the middle of the map and lets the frame
      // edge stay darker than the ground.
      const vignette = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.2,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.72,
      );
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);

      // Belt seams: the map's three lanes, numbered so a name in the chronicle
      // ("the third belt") has somewhere to point.
      ctx.strokeStyle = "rgba(232,225,213,0.10)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 7]);
      for (const belt of [1, 2]) {
        const x = (WORLD_WIDTH / 3) * belt;
        ctx.beginPath();
        ctx.moveTo(toX(x), 0);
        ctx.lineTo(toX(x), height);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = "rgba(232,225,213,0.30)";
      ctx.textBaseline = "top";
      for (const [belt, numeral] of ["I", "II", "III"].entries()) {
        const x = (WORLD_WIDTH / 3) * belt + 10;
        if (toX(x) < -20) continue;
        ctx.fillText(numeral, toX(x), 10);
      }

      // Rifts: the map's only moving terrain. They breathe with the beat.
      const pulse = reducedMotion
        ? 0.5
        : 0.5 + 0.5 * Math.sin(((performance.now() - start) / 1000 / Math.max(1, beatSeconds)) * Math.PI * 2);
      for (const rift of current.rifts ?? []) {
        const half = 24;
        const left = toX(rift - half);
        const right = toX(rift + half);
        const grad = ctx.createLinearGradient(left, 0, right, 0);
        grad.addColorStop(0, "rgba(200,98,45,0)");
        grad.addColorStop(0.5, `rgba(200,98,45,${0.07 + pulse * 0.05})`);
        grad.addColorStop(1, "rgba(200,98,45,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(left, 0, right - left, height);

        ctx.strokeStyle = `rgba(200,98,45,${0.20 + pulse * 0.14})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(toX(rift), 0);
        ctx.lineTo(toX(rift), height);
        ctx.stroke();
      }

      // Supplies: dormant caches, brightness is remaining charge.
      for (const supply of current.supplies ?? []) {
        const size = Math.max(3.5, 7 * scale);
        ctx.fillStyle = `rgba(111,143,166,${0.25 + (supply.charge / 100) * 0.55})`;
        ctx.fillRect(toX(supply.x) - size / 2, toY(supply.y) - size / 2, size, size);
      }

      // Wrecks: what is left after a fight.
      for (const wreck of current.wrecks ?? []) {
        const px = toX(wreck.x);
        const py = toY(wreck.y);
        const size = Math.max(3.5, 7.5 * scale);
        ctx.strokeStyle = wreck.claimed ? "rgba(120,124,132,0.35)" : "rgba(200,98,45,0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px - size, py);
        ctx.lineTo(px + size, py);
        ctx.moveTo(px, py - size);
        ctx.lineTo(px, py + size);
        ctx.stroke();
      }

      // Entities. Positions ease toward the last snapshot so the world reads as
      // continuous between beats; the data itself is never interpolated.
      const seen = new Set<string>();
      for (const entity of current.entities ?? []) {
        if (entity.status !== "alive") continue;
        seen.add(entity.id);
        const target = { x: entity.x, y: entity.y };
        const previous = positions.current.get(entity.id);
        let pos = target;
        if (previous && !reducedMotion) {
          pos = {
            x: previous.x + (target.x - previous.x) * 0.12,
            y: previous.y + (target.y - previous.y) * 0.12,
          };
        }
        positions.current.set(entity.id, pos);

        const px = toX(pos.x);
        const py = toY(pos.y);
        const base = Math.max(8.6, 19 * scale);

        ctx.globalAlpha = 0.95;
        ctx.fillStyle = entity.palette?.[1] ?? "#C8622D";
        silhouettePath(ctx, entity.silhouette, base);
        ctx.fill();

        // One pale core per entity. At this zoom the silhouette alone reads as
        // noise; the core is what lets a visitor count who is still standing.
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = entity.palette?.[2] ?? "#E8E1D5";
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1.3, base * 0.17), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        // A hairline in the ground color separates overlapping entities, which
        // happens wherever a cluster is dense.
        ctx.strokeStyle = "rgba(8,9,11,0.7)";
        ctx.lineWidth = 1;
        silhouettePath(ctx, entity.silhouette, base);
        ctx.stroke();

        if (entity.hp < 35) {
          ctx.fillStyle = "rgba(200,98,45,0.9)";
          ctx.fillRect(px - 1, py - base * 1.8, 2, 2);
        }
      }

      // Drop stale entries so a long session cannot grow without bound.
      for (const id of positions.current.keys()) {
        if (!seen.has(id)) positions.current.delete(id);
      }

      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => {
      observer.disconnect();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [beatSeconds, reducedMotion]);

  // Hover is resolved in world space so it stays correct while the canvas scales.
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.max(rect.width / WORLD_WIDTH, rect.height / WORLD_HEIGHT);
    const offsetX = (rect.width - WORLD_WIDTH * scale) / 2;
    const offsetY = (rect.height - WORLD_HEIGHT * scale) / 2;
    const wx = (event.clientX - rect.left - offsetX) / scale;
    const wy = (event.clientY - rect.top - offsetY) / scale;

    let best: EntityView | null = null;
    let bestDistance = 24 / scale;
    for (const entity of snapshot.entities) {
      if (entity.status !== "alive") continue;
      const distance = Math.hypot(entity.x - wx, entity.y - wy);
      if (distance < bestDistance) {
        best = entity;
        bestDistance = distance;
      }
    }
    if (!best) {
      setHovered(null);
      return;
    }
    setHovered({
      name: best.name,
      x: (best.x * scale + offsetX) / rect.width * 100,
      y: (best.y * scale + offsetY) / rect.height * 100,
    });
  };

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHovered(null)}
        className="h-full w-full"
        role="img"
        aria-label="The Weave a World map. Every shape is a weapon or character. The chronicle beside it describes the same events in text."
      />
      {hovered && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[150%] rounded-[4px] border border-white/12 bg-[#0A0B0E]/92 px-2 py-1 text-[11px] font-medium tracking-wide text-[#E8E1D5] shadow-[0_4px_16px_rgba(0,0,0,0.5)]"
          style={{ left: `${hovered.x}%`, top: `${hovered.y}%` }}
        >
          {hovered.name}
        </div>
      )}
    </div>
  );
}
