import { useCanvasResolution } from "../use-canvas-resolution";
import { useEffect, useLayoutEffect, useRef } from "react";
import { WORLD_SCALE, type WeaponDefinition, type ArenaMode, type ArenaStats } from "@auro/core/siege";
import type { ArenaEngine } from "../runtime/engine";
import { drawStrokes } from "../editor/drawing-canvas";
import { loadArenaArt, paintSprite, type ArenaArt } from "./art";
import { paintScenery } from "./art-layer";
import { ArenaEffects } from "./effects";
import { paintCannon } from "../workshop/cannon-painter";

const scoutFrames = ["scout-1", "scout-2", "scout-3", "scout-4"] as const;
const heavyFrames = ["heavy-1", "heavy-2", "heavy-3", "heavy-4"] as const;

interface Props {
  definition: WeaponDefinition | null; run: number; mode: ArenaMode; paused: boolean;
  collisions: boolean; onPause: () => void; onStats: (stats: ArenaStats) => void; onError: (code: string) => void;
  assetUrl: (id: string) => string;
}
export function Arena({ definition, run, mode, paused, collisions, onStats, onError, onPause, assetUrl }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const simulation = useRef<ArenaEngine | null>(null);
  const redraw = useRef<(() => void) | null>(null);
  useCanvasResolution(canvas, 1.75, redraw);
  const controls = useRef({ paused, collisions, onStats, onError, onPause });
  controls.current = { paused, collisions, onStats, onError, onPause };
  useLayoutEffect(() => {
    redraw.current?.();
    if (paused && simulation.current) onStats(simulation.current.snapshot());
  }, [paused, collisions, onStats]);
  useEffect(() => {
    let disposed = false, raf = 0, engine: ArenaEngine | null = null;
    let last = 0, accumulator = 0, lastHUD = 0;
    let art: ArenaArt | null = null;
    const effects = new ArenaEffects();
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const ctx = canvas.current?.getContext("2d");
    const render = () => {
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.fillStyle = "#f6f2e6"; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      const height = Math.max(8, (definition?.reach ?? 0) * 2 + 0.5), scale = ctx.canvas.height / height;
      ctx.setTransform(scale, 0, 0, scale, 0, (height / 2 - 4) * scale);
      if (art) paintScenery(ctx, art, mode, engine?.stats.castleHP ?? 100, height);
      if (engine && definition) {
        ctx.save(); ctx.translate(engine.mount.x, engine.mount.y);
        if (definition.cannonDesign) {
          const age = engine.lastShot ? engine.stats.tick - engine.lastShot.tick : 30;
          paintCannon(ctx, definition.cannonDesign, engine.angle, false, motion.matches ? 0 : Math.max(0, 1 - age / 12));
        } else {
          ctx.rotate(engine.angle); ctx.scale(WORLD_SCALE, WORLD_SCALE); ctx.translate(-definition.pivot[0], -definition.pivot[1]);
          drawStrokes(ctx, definition.drawing);
        }
        ctx.restore();
        for (const projectile of engine.projectiles.values()) {
          const p = projectile.body.translation(), radius = definition.launcher!.projectileRadius;
          ctx.fillStyle = "#293e34"; ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#e7683e"; ctx.beginPath(); ctx.arc(p.x - radius * 0.3, p.y - radius * 0.3, radius * 0.3, 0, Math.PI * 2); ctx.fill();
        }
        if (engine.lastShot && engine.stats.tick - engine.lastShot.tick < 5) {
          const shot = engine.lastShot;
          ctx.save(); ctx.translate(shot.x, shot.y); ctx.rotate(shot.heading);
        ctx.fillStyle = "#f9cc65"; ctx.beginPath(); ctx.moveTo(0, -0.12); ctx.lineTo(0.45, 0); ctx.lineTo(0, 0.12); ctx.fill(); ctx.restore();
        }
        if (!definition.cannonDesign) { ctx.fillStyle = "#e76b3e"; ctx.beginPath(); ctx.arc(engine.mount.x, engine.mount.y, 0.11, 0, Math.PI * 2); ctx.fill(); }
        for (const enemy of engine.enemies.values()) {
          const p = enemy.body.translation(), r = enemy.heavy ? 0.34 : 0.23;
          const frame = motion.matches ? 0 : Math.floor(engine.stats.tick / 9) % 4;
          if (art) paintSprite(ctx, art[(enemy.heavy ? heavyFrames : scoutFrames)[frame]!], p.x, p.y, r * 3);
          ctx.fillStyle = "#35463a33"; ctx.fillRect(p.x - r, p.y - r * 1.5 - 0.12, r * 2, 0.05);
          ctx.fillStyle = "#e76b3e"; ctx.fillRect(p.x - r, p.y - r * 1.5 - 0.12, r * 2 * enemy.hp / enemy.maxHP, 0.05);
        }
        if (art) effects.paint(ctx, art, engine, motion.matches);
        if (controls.current.collisions) {
          const debug = engine.world.debugRender();
          ctx.strokeStyle = "#df6640"; ctx.lineWidth = 0.02; ctx.globalAlpha = 0.65;
          for (let i = 0; i < debug.vertices.length; i += 4) {
            ctx.beginPath(); ctx.moveTo(debug.vertices[i] ?? 0, debug.vertices[i + 1] ?? 0);
            ctx.lineTo(debug.vertices[i + 2] ?? 0, debug.vertices[i + 3] ?? 0); ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
      }
    };
    render();
    if (definition && run) loadArenaArt(assetUrl).then(loaded => {
      if (disposed) return;
      art = loaded; render();
    }).catch(() => { if (!disposed) controls.current.onError("art_unavailable"); });
    if (definition && run) import("../runtime/engine").then(async ({ ArenaEngine, initializePhysics }) => {
      await initializePhysics();
      if (disposed) return;
      engine = new ArenaEngine(definition, mode); engine.start();
      simulation.current = engine;
      const frame = (now: number) => {
        raf = 0;
        if (disposed || !engine) return;
        const delta = Math.min(0.083, last ? (now - last) / 1000 : 0); last = now;
        if (!controls.current.paused && document.visibilityState === "visible") accumulator += delta;
        else accumulator = 0;
        let steps = 0;
        while (accumulator >= 1 / 60 && steps < 5) {
          if (engine.stats.phase === "running") { engine.step(); effects.update(engine); }
          accumulator -= 1 / 60; steps++;
        }
        render();
        if (now - lastHUD > 120 || engine.stats.phase === "finished") { controls.current.onStats(engine.snapshot()); lastHUD = now; }
        if (!controls.current.paused && document.visibilityState === "visible" && engine.stats.phase === "running") raf = requestAnimationFrame(frame);
      };
      redraw.current = () => { if (!disposed && !raf) { last = 0; raf = requestAnimationFrame(frame); } };
      redraw.current();
    }).catch(() => { if (!disposed) controls.current.onError("physics_unavailable"); });
    const suspend = () => controls.current.onPause();
    const visibility = () => { if (document.visibilityState === "hidden") suspend(); };
    window.addEventListener("blur", suspend); document.addEventListener("visibilitychange", visibility);
    return () => {
      redraw.current = null; window.removeEventListener("blur", suspend); document.removeEventListener("visibilitychange", visibility);
      disposed = true; cancelAnimationFrame(raf);
      if (simulation.current === engine) simulation.current = null;
      engine?.dispose();
    };
  }, [definition, run, mode, assetUrl]);
  return <canvas ref={canvas} className="arena-canvas" width={1120} height={640} aria-label="武器测试场" role="img" />;
}
