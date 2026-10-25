import type { ArenaEngine } from "../runtime/engine";
import { paintSprite, type ArenaArt, type ArtId } from "./art";

interface Burst { id: ArtId; x: number; y: number; size: number; tick: number }
interface EnemyFrame { x: number; y: number; lastHit: number }

/** Visual bursts follow simulation ticks, including pauses and completed runs. */
export class ArenaEffects {
  private bursts: Burst[] = [];
  private enemies = new Map<number, EnemyFrame>();
  private blocked = 0;
  private castleHP = 100;
  private shieldHP = 100;
  private lastShot = -1;

  update(engine: ArenaEngine) {
    const { tick, blocked, castleHP, shieldHP } = engine.stats;
    this.bursts = this.bursts.filter(burst => tick - burst.tick < 30);
    const burst = (id: ArtId, x: number, y: number, size: number) => {
      this.bursts.push({ id, x, y, size, tick });
      if (this.bursts.length > 24) this.bursts.shift();
    };
    const next = new Map<number, EnemyFrame>();
    if (engine.lastShot && engine.lastShot.tick !== this.lastShot) {
      burst("smoke", engine.lastShot.x, engine.lastShot.y, 0.65);
      this.lastShot = engine.lastShot.tick;
    }
    const hasBlade = engine.definition.spec.parts.some(part => part.type === "blade");
    for (const enemy of engine.enemies.values()) {
      const p = enemy.body.translation();
      const previous = this.enemies.get(enemy.id);
      if (enemy.lastHit === tick && previous?.lastHit !== tick) {
        burst("impact", p.x, p.y, 0.8);
        if (hasBlade) burst("slash", p.x, p.y, 0.9);
      }
      next.set(enemy.id, { ...p, lastHit: enemy.lastHit });
    }
    for (const [id, enemy] of this.enemies) {
      if (!next.has(id) && enemy.x >= 1.6) burst("dust", enemy.x, enemy.y, 0.7);
    }
    const shieldParts = new Set<string>();
    for (const part of engine.weaponParts.values()) {
      if (part.type !== "shield" || shieldParts.has(part.partId)) continue;
      shieldParts.add(part.partId);
      if (blocked === this.blocked && (shieldHP > 0 || this.shieldHP === 0)) continue;
      const center = part.shape === "polygon"
        ? part.vertices.reduce((sum, point) => [sum[0] + point[0] / part.vertices.length, sum[1] + point[1] / part.vertices.length], [0, 0])
        : part.center;
      const cosine = Math.cos(engine.angle), sine = Math.sin(engine.angle);
      const x = engine.mount.x + center[0]! * cosine - center[1]! * sine;
      const y = engine.mount.y + center[0]! * sine + center[1]! * cosine;
      if (blocked > this.blocked) burst("shield-block", x, y, 0.8);
      if (!shieldHP && this.shieldHP > 0) burst("shield-break", x, y, 1.1);
    }
    if (castleHP < this.castleHP) burst("smoke", 1, 4.45, 1.3);
    this.enemies = next;
    this.blocked = blocked;
    this.castleHP = castleHP;
    this.shieldHP = shieldHP;
  }

  paint(ctx: CanvasRenderingContext2D, art: ArenaArt, engine: ArenaEngine, reducedMotion: boolean) {
    for (const burst of this.bursts) {
      const age = (engine.stats.tick - burst.tick) / 30;
      ctx.globalAlpha = 1 - age;
      paintSprite(ctx, art[burst.id], burst.x, burst.y, burst.size * (reducedMotion ? 1 : 0.8 + age * 0.4));
    }
    ctx.globalAlpha = 1;
    if (engine.mode === "defense" && engine.stats.phase === "finished") {
      paintSprite(ctx, art[engine.stats.castleHP > 0 ? "victory" : "defeat"], 7, 2.4, 1.4);
    }
  }
}
