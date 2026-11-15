"use client";
import { useEffect, useRef } from "react";
import type { Frame } from "@auro/core/capture-the-flag";

export function BattleCanvas({
  frame,
  label,
}: {
  frame: Frame;
  label: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const target = useRef(frame);
  const previous = useRef(frame);
  const changedAt = useRef(0);
  useEffect(() => {
    previous.current = target.current;
    target.current = frame;
    changedAt.current = performance.now();
  }, [frame]);
  useEffect(() => {
    const el = canvas.current,
      ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    let request = 0;
    const paint = () => {
      const width = 1000,
        height = 500;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      if (el.width !== width * ratio) {
        el.width = width * ratio;
        el.height = height * ratio;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.fillStyle = "#e9e7d6";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#b9473b18";
      ctx.fillRect(0, 0, 150, height);
      ctx.fillStyle = "#3479a61c";
      ctx.fillRect(850, 0, 150, height);
      ctx.strokeStyle = "#354d3212";
      ctx.lineWidth = 1;
      for (let x = 0; x <= width; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y <= height; y += 50) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      ctx.setLineDash([6, 9]);
      ctx.strokeStyle = "#354d3240";
      ctx.beginPath();
      ctx.moveTo(500, 0);
      ctx.lineTo(500, 500);
      ctx.stroke();
      ctx.setLineDash([]);
      const state = target.current;
      const blend = Math.min(1, (performance.now() - changedAt.current) / 200);
      const position = (id: string) => {
        const unit = state.units.find((u) => u.id === id);
        if (!unit) return null;
        const from = previous.current.units.find((u) => u.id === id);
        if (
          !from ||
          from.state !== unit.state ||
          Math.hypot(from.x - unit.x, from.y - unit.y) > 10
        )
          return unit;
        return {
          ...unit,
          x: from.x + (unit.x - from.x) * blend,
          y: from.y + (unit.y - from.y) * blend,
        };
      };
      for (const side of ["red", "blue"] as const) {
        const flag = state.flags[side];
        const anchor = { x: side === "red" ? 70 : 920, y: 250 };
        ctx.strokeStyle = side === "red" ? "#b9473b45" : "#3479a645";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(anchor.x, anchor.y, 26, 0, Math.PI * 2);
        ctx.stroke();
        const carrier = flag.carrierId ? position(flag.carrierId) : null;
        const x = (carrier?.x ?? flag.x) * 10,
          y = (carrier?.y ?? flag.y) * 10 - (carrier ? 22 : 0);
        ctx.strokeStyle = "#384336";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y + 16);
        ctx.lineTo(x, y - 15);
        ctx.stroke();
        ctx.fillStyle = side === "red" ? "#b9473b" : "#3479a6";
        ctx.beginPath();
        ctx.moveTo(x + 1, y - 15);
        ctx.lineTo(x + 23, y - 10);
        ctx.lineTo(x + 1, y - 2);
        ctx.closePath();
        ctx.fill();
      }
      for (const original of state.units) {
        const u = position(original.id);
        if (!u || u.state !== "ALIVE") continue;
        const x = u.x * 10,
          y = u.y * 10,
          color = u.team === "red" ? "#ad4139" : "#2e6c9b";
        if (u.unitType === "archer") {
          ctx.strokeStyle = `${color}35`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, u.range * 10, 0, 2 * Math.PI);
          ctx.stroke();
        }
        ctx.shadowColor = "#263b2833";
        ctx.shadowBlur = 5;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, u.unitType === "heavy_infantry" ? 11 : 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.shadowOffsetY = 0;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#faf6e5";
        if (u.unitType === "heavy_infantry") {
          ctx.beginPath();
          ctx.moveTo(x - 5, y - 5);
          ctx.lineTo(x + 5, y - 5);
          ctx.lineTo(x + 5, y);
          ctx.lineTo(x, y + 6);
          ctx.lineTo(x - 5, y);
          ctx.closePath();
          ctx.stroke();
        } else if (u.unitType === "cavalry") {
          ctx.beginPath();
          ctx.moveTo(x - 4, y + 4);
          ctx.lineTo(x + 4, y - 5);
          ctx.lineTo(x + 4, y + 4);
          ctx.lineTo(x - 4, y - 1);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(x - 2, y, 6, -Math.PI / 2, Math.PI / 2);
          ctx.moveTo(x - 2, y - 6);
          ctx.lineTo(x - 2, y + 6);
          ctx.moveTo(x - 4, y);
          ctx.lineTo(x + 5, y);
          ctx.stroke();
        }
        ctx.fillStyle = "#30402d45";
        ctx.fillRect(x - 14, y - 20, 28, 3);
        ctx.fillStyle = color;
        ctx.fillRect(x - 14, y - 20, (28 * u.hp) / u.maxHp, 3);
        if (u.isCapturing) {
          ctx.strokeStyle = "#b38a30";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(
            x,
            y,
            16,
            -Math.PI / 2,
            -Math.PI / 2 + (Math.PI * 2 * u.captureProgress) / 3,
          );
          ctx.stroke();
        }
      }
      request = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(request);
  }, []);
  return (
    <canvas ref={canvas} className="ctf-canvas" aria-label={label} role="img" />
  );
}
