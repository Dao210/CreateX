"use client";

import { useEffect, useRef } from "react";
import type { TankBlueprint } from "@auro/core/tank-defense";
import { paintTank } from "./painter";

export function TankPreview({ blueprint, name, power = 0, className }: { blueprint: TankBlueprint; name: string; power?: number; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, 160, 160);
    ctx.setTransform(4, 0, 0, 4, 0, 0);
    ctx.imageSmoothingEnabled = false;
    paintTank(ctx, { x: 20, y: 23, direction: "up", team: "player", blueprint, hp: blueprint.armor, moving: false }, 0, { power, reducedMotion: true });
    ctx.resetTransform();
  }, [blueprint, power]);
  return <canvas ref={canvas} width={160} height={160} role="img" aria-label={name} data-character-id={blueprint.id} className={className} style={{ imageRendering: "pixelated" }} />;
}
