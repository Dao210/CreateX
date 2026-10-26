import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import { GRID, type Drawing, type Point, type Stroke, type WeaponSpec } from "@auro/core/siege";

const paths = new WeakMap<Drawing, Array<{ id: string; width: number; path: Path2D }>>();
export function drawStrokes(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, drawing: Drawing, selected: string[] = []) {
  let compiled = paths.get(drawing);
  if (!compiled) {
    compiled = drawing.strokes.map(stroke => {
      const path = new Path2D();
      stroke.points.forEach((point, i) => i ? path.lineTo(point[0], point[1]) : path.moveTo(point[0], point[1]));
      return { id: stroke.id, width: stroke.width, path };
    });
    paths.set(drawing, compiled);
  }
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const stroke of compiled) {
    ctx.lineWidth = stroke.width; ctx.strokeStyle = selected.includes(stroke.id) ? "#dd653b" : "#283f35";
    ctx.stroke(stroke.path);
  }
}
export type CanvasTool = "draw" | "mount" | "muzzle" | "direction";
interface Props {
  drawing: Drawing; spec: WeaponSpec | null; selected: string[]; width: 24 | 40;
  tool: CanvasTool; randomId: () => string; onChange: (drawing: Drawing) => void; onPlacement: (tool: Exclude<CanvasTool, "draw">, point: Point) => void;
}
export function DrawingCanvas({ drawing, spec, selected, width, tool, randomId, onChange, onPlacement }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const active = useRef<Stroke | null>(null);
  const pointer = useRef<number | null>(null);
  const current = useRef(drawing); current.current = drawing;
  const paint = useCallback(() => {
    const ctx = canvas.current?.getContext("2d"); if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, 1024, 1024);
    ctx.setTransform(1024 / GRID, 0, 0, 1024 / GRID, 0, 0);
    drawStrokes(ctx, current.current, selected);
    if (active.current) drawStrokes(ctx, { ...current.current, strokes: [active.current] });
    if (spec?.mountHint) {
      const [x, y] = spec.mountHint; ctx.lineWidth = 12; ctx.strokeStyle = "#dd653b";
      ctx.beginPath(); ctx.arc(x, y, 55, 0, Math.PI * 2); ctx.moveTo(x - 90, y); ctx.lineTo(x + 90, y); ctx.moveTo(x, y - 90); ctx.lineTo(x, y + 90); ctx.stroke();
    }
    const cannon = spec?.parts.find(p => p.type === "cannon");
    if (cannon?.anchorHint) {
      const [x, y] = cannon.anchorHint;
      ctx.strokeStyle = "#dd653b"; ctx.lineWidth = 14; ctx.beginPath(); ctx.arc(x, y, 40, 0, Math.PI * 2); ctx.stroke();
      if (cannon.directionHint) {
        const [dx, dy] = cannon.directionHint, angle = Math.atan2(dy - y, dx - x);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(dx, dy);
        ctx.lineTo(dx - Math.cos(angle - 0.5) * 85, dy - Math.sin(angle - 0.5) * 85);
        ctx.moveTo(dx, dy); ctx.lineTo(dx - Math.cos(angle + 0.5) * 85, dy - Math.sin(angle + 0.5) * 85); ctx.stroke();
      }
    }
  }, [selected, spec]);
  useEffect(() => { paint(); }, [drawing, paint]); // Canvas updates do not own the persisted drawing.
  const point = (e: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [Math.round(Math.max(0, Math.min(GRID, (e.clientX - rect.left) / rect.width * GRID))),
      Math.round(Math.max(0, Math.min(GRID, (e.clientY - rect.top) / rect.height * GRID)))];
  };
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (pointer.current !== null || e.button !== 0) return;
    if (tool !== "draw") { onPlacement(tool, point(e)); return; }
    if (drawing.strokes.length >= 64 || drawing.strokes.reduce((sum, s) => sum + s.points.length, 0) >= 4094) return;
    pointer.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId);
    active.current = { id: randomId(), points: [point(e)], width, color: "ink" }; paint();
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (pointer.current !== e.pointerId || !active.current) return;
    const p = point(e), last = active.current.points.at(-1);
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 12) return;
    if (current.current.strokes.reduce((n, s) => n + s.points.length, 0) + active.current.points.length >= 4096) return;
    active.current.points.push(p); paint();
  };
  const end = (e: PointerEvent<HTMLCanvasElement>, cancelled = false) => {
    if (pointer.current !== e.pointerId) return;
    const stroke = active.current; active.current = null; pointer.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!cancelled && stroke && stroke.points.length >= 2)
      onChange({ ...current.current, revision: current.current.revision + 1, strokes: [...current.current.strokes, stroke] });
    paint();
  };
  return <canvas ref={canvas} className={"drawing-canvas tool-" + tool} width={1024} height={1024}
    aria-label="武器画布" role="img" onPointerDown={down} onPointerMove={move}
    onPointerUp={e => end(e)} onPointerCancel={e => end(e, true)} onLostPointerCapture={e => end(e, true)} />;
}
