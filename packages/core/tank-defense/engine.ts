import { TANK_DIFFICULTIES, type TankDifficulty } from "./difficulty";
import { BASE_BOUNDS, BASE_WALLS, TANK_LEVELS, TANK_CELL, TANK_GRID, TANK_WORLD, type EnemyModel, type TankLevel, type TankPoint, type TankMechanism, type Terrain } from "./levels";

import type { TankDirection, TankPhase, TankBlueprint, TankActor, TankBullet, TankPickup, TankEffect, TankCue, TankSnapshot, TankMode } from "./types";
export const PLAYER_TANK: Readonly<TankBlueprint> = Object.freeze({ id: "guardian", speed: 83, armor: 1, projectileSpeed: 260, fireInterval: 22, score: 0 });
export const ENEMY_TANKS: Readonly<Record<EnemyModel, TankBlueprint>> = {
  scout: { id: "scout", speed: 42, armor: 1, projectileSpeed: 145, fireInterval: 110, score: 100 },
  runner: { id: "runner", speed: 62, armor: 1, projectileSpeed: 170, fireInterval: 100, score: 200 },
  armor: { id: "armor", speed: 33, armor: 3, projectileSpeed: 160, fireInterval: 100, score: 400 },
};
const directions: TankDirection[] = ["up", "right", "down", "left"];
const vector: Record<TankDirection, TankPoint> = { up: { x: 0, y: -1 }, right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
const HALF = 14;
export const TANK_BLITZ_TICKS = 90 * 60;
export const TANK_FORTIFY_TICKS = 10 * 60;
export const TANK_PULSE_PERIOD = 360;
export function tankPulsePhase(tick: number, offset: number): "safe" | "warning" | "active" {
  const phase = (tick + offset) % TANK_PULSE_PERIOD;
  return phase >= 300 ? "active" : phase >= 240 ? "warning" : "safe";
}
function inArea(point: TankPoint, area: TankPoint & { width: number; height: number }) {
  return point.x >= area.x && point.x < area.x + area.width && point.y >= area.y && point.y < area.y + area.height;
}
function overlaps(a: TankPoint, b: TankPoint, distance: number) { return Math.abs(a.x - b.x) < distance && Math.abs(a.y - b.y) < distance; }
function insideBase(p: TankPoint, padding = 0) {
  return p.x > BASE_BOUNDS.x - padding && p.x < BASE_BOUNDS.x + BASE_BOUNDS.width + padding && p.y > BASE_BOUNDS.y - padding && p.y < BASE_BOUNDS.y + BASE_BOUNDS.height + padding;
}

/** Fixed-step, DOM-free rules for the classic four-direction defense game. */
export class TankDefenseGame {
  readonly terrain: Terrain[];
  readonly mechanisms: (TankMechanism & { spent: boolean })[];
  readonly mode: TankMode;
  readonly difficulty: TankDifficulty;
  private readonly rules: Readonly<(typeof TANK_DIFFICULTIES)[TankDifficulty]>;
  private baseHP: number;
  private baseInvincibleUntil = 0;
  wave = 1;
  waveKills = 0;
  private roster: EnemyModel[];
  private waveAt = 0;
  private lastKillAt = -1000;
  private combo = 0;
  readonly brickHP: number[];
  readonly tanks: TankActor[] = [];
  readonly bullets: TankBullet[] = [];
  readonly pickups: TankPickup[] = [];
  readonly effects: TankEffect[] = [];
  readonly cues: TankCue[] = [];
  phase: TankPhase = "ready";
  paused = false;
  tick = 0;
  score: number;
  lives: number;
  power: number;
  kills = 0;
  shots = 0;
  destroyedBricks = 0;
  baseAlive = true;
  defeatReason: TankSnapshot["defeatReason"] = null;
  player: TankActor | null = null;
  private nextId = 1;
  private spawned = 0;
  private spawnAt: number;
  private respawnAt = 0;
  private fortifyUntil = 0;
  private seed: number;
  private input: { direction: TankDirection | null; fire: boolean } = { direction: null, fire: false };
  private glideUntil = 0;
  private fireQueued = false;
  private readonly playerBlueprint: TankBlueprint;

  constructor(readonly level: TankLevel, carry: { score?: number; lives?: number; power?: number; seed?: number; playerBlueprint?: Readonly<TankBlueprint>; mode?: TankMode; difficulty?: TankDifficulty } = {}) {
    this.level = { ...level, mechanisms: level.mechanisms.map(device => ({ ...device })), terrain: [...level.terrain], enemies: [...level.enemies], playerSpawn: { ...level.playerSpawn }, enemySpawns: level.enemySpawns.map(point => ({ ...point })) };
    this.terrain = [...level.terrain];
    this.mechanisms = level.mechanisms.map(device => ({ ...device, spent: false }));
    this.mode = carry.mode ?? "campaign";
    this.difficulty = carry.difficulty ?? "standard";
    this.rules = TANK_DIFFICULTIES[this.difficulty];
    this.baseHP = this.rules.baseHP;
    this.spawnAt = Math.round((this.mode === "campaign" ? level.deploymentDelay : this.mode === "survival" ? 90 : 30) * this.rules.deploymentDelay);
    this.roster = this.mode === "survival" ? this.survivalRoster() : [...level.enemies];
    this.brickHP = this.terrain.map(kind => kind === "brick" ? 2 : 0);
    this.score = carry.score ?? 0; this.lives = carry.lives ?? this.rules.maxLives; this.power = carry.power ?? Math.max(this.rules.initialPower, this.mode === "campaign" ? 0 : 1);
    this.seed = carry.seed ?? level.id * 7919;
    const blueprint = carry.playerBlueprint ?? PLAYER_TANK;
    this.playerBlueprint = { ...blueprint, ...(blueprint.appearance ? { appearance: { ...blueprint.appearance } } : {}) };
    this.spawnPlayer(this.playerBlueprint);
  }
  private survivalRoster(): EnemyModel[] {
    return Array.from({ length: Math.min(24, 6 + this.wave * 2) }, (_, n) => this.wave > 1 && n % 4 === 3 ? "armor" : n % 3 === 2 ? "runner" : "scout");
  }
  private spawnInterval() {
    const interval = this.mode === "blitz" ? Math.round(this.level.spawnInterval * 0.65) : this.mode === "survival" ? Math.max(70, 170 - this.wave * 12) : this.level.spawnInterval;
    return Math.round(interval * this.rules.reinforcementInterval);
  }
  private maxActive() {
    const count = this.mode === "blitz" ? Math.min(6, this.level.maxActive + 1) : this.mode === "survival" ? Math.min(6, 3 + Math.floor((this.wave - 1) / 2)) : this.level.maxActive;
    return Math.max(1, count - this.rules.activeEnemyReduction);
  }
  private random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
  private cue(kind: TankCue) { if (this.cues.length < 12) this.cues.push(kind); }
  private effect(position: TankPoint, kind: TankEffect["kind"]) {
    this.effects.push({ ...position, kind, tick: this.tick });
    if (this.effects.length > 40) this.effects.shift();
  }
  private spawnPlayer(blueprint: Readonly<TankBlueprint>) {
    const actor: TankActor = { ...this.level.playerSpawn, id: this.nextId++, team: "player", blueprint: { ...blueprint }, direction: "up", hp: blueprint.armor + this.rules.playerArmorBonus, reloadAt: 0, invincibleUntil: this.tick + 180, thinkAt: 0, moving: false, stunnedUntil: 0, pulseHits: {} };
    if (!this.canOccupy(actor, actor.x, actor.y)) return false;
    this.player = actor; this.tanks.push(actor); this.effect(actor, "spawn"); return true;
  }
  start() { if (this.phase === "ready") this.phase = "running"; }
  setPaused(value: boolean) { if (this.phase === "running") { this.paused = value; this.clearInput(); } }
  setInput(direction: TankDirection | null, fire: boolean) { if (fire && !this.input.fire) this.fireQueued = true; this.input = { direction, fire }; }
  queueFire() { if (this.phase === "running" && !this.paused) this.fireQueued = true; }
  clearInput() { this.input = { direction: null, fire: false }; this.glideUntil = 0; this.fireQueued = false; }
  cellAt(p: TankPoint) { return Math.floor(p.y / TANK_CELL) * TANK_GRID + Math.floor(p.x / TANK_CELL); }
  canOccupy(actor: Pick<TankActor, "id">, x: number, y: number): boolean {
    if (x - HALF < 0 || y - HALF < 0 || x + HALF > TANK_WORLD || y + HALF > TANK_WORLD || insideBase({ x, y }, HALF)) return false;
    const minX = Math.floor((x - HALF) / TANK_CELL), maxX = Math.floor((x + HALF - 0.01) / TANK_CELL);
    const minY = Math.floor((y - HALF) / TANK_CELL), maxY = Math.floor((y + HALF - 0.01) / TANK_CELL);
    for (let row = minY; row <= maxY; row++) for (let col = minX; col <= maxX; col++) {
      if (["brick", "steel", "water"].includes(this.terrain[row * TANK_GRID + col]!)) return false;
    }
    return !this.tanks.some(other => other.id !== actor.id && overlaps({ x, y }, other, HALF * 2 + 1));
  }
  private move(actor: TankActor, direction: TankDirection, amount: number) {
    const dir = vector[direction];
    if ((vector[actor.direction].x === 0) !== (dir.x === 0)) {
      const axis = dir.x ? "y" : "x", nearest = Math.round((actor[axis] - 20) / 40) * 40 + 20;
      if (Math.abs(nearest - actor[axis]) < 7 && this.canOccupy(actor, axis === "x" ? nearest : actor.x, axis === "y" ? nearest : actor.y)) actor[axis] = nearest;
    }
    actor.direction = direction;
    const x = actor.x + dir.x * amount, y = actor.y + dir.y * amount;
    actor.moving = this.canOccupy(actor, x, y);
    if (actor.moving) { actor.x = x; actor.y = y; }
    return actor.moving;
  }
  private fire(actor: TankActor) {
    const limit = actor.team === "player" ? this.power > 0 ? 3 : 2 : 1;
    if (this.tick < actor.reloadAt || this.bullets.filter(b => b.alive && b.owner === actor.id).length >= limit || this.bullets.length >= 40) return;
    const dir = vector[actor.direction];
    this.bullets.push({ x: actor.x + dir.x * 17, y: actor.y + dir.y * 17, id: this.nextId++, owner: actor.id, team: actor.team, direction: actor.direction, speed: actor.blueprint.projectileSpeed + (actor.team === "player" ? this.power * 25 : 0), power: actor.team === "player" ? this.power : 0, alive: true });
    actor.reloadAt = this.tick + actor.blueprint.fireInterval;
    if (actor.team === "player") { this.shots++; this.cue("shot"); }
  }
  private spawnEnemy() {
    const model = this.roster[this.spawned];
    if (!model) return;
    const offset = this.spawned % this.level.enemySpawns.length;
    for (let n = 0; n < this.level.enemySpawns.length; n++) {
      const point = this.level.enemySpawns[(n + offset) % this.level.enemySpawns.length]!;
      const source = ENEMY_TANKS[model];
      const blueprint = { ...source, speed: source.speed * this.rules.enemySpeed, projectileSpeed: source.projectileSpeed * this.rules.enemyProjectileSpeed, fireInterval: Math.round(source.fireInterval * this.rules.enemyFireInterval) };
      const actor: TankActor = { ...point, id: this.nextId, team: "enemy", blueprint: { ...blueprint }, direction: "down", hp: blueprint.armor, reloadAt: this.tick + Math.round(80 * this.rules.enemyFireInterval), invincibleUntil: this.tick + 40, thinkAt: this.tick + 35, moving: false, stunnedUntil: 0, pulseHits: {} };
      if (!this.canOccupy(actor, point.x, point.y)) continue;
      this.nextId++; this.tanks.push(actor); this.spawned++; this.spawnAt = this.tick + this.spawnInterval(); this.effect(actor, "spawn"); return;
    }
    this.spawnAt = this.tick + 15;
  }
  private routeDirection(actor: TankActor): TankDirection {
    const startX = Math.min(12, Math.floor(actor.x / 40)), startY = Math.min(12, Math.floor(actor.y / 40));
    const costs = Array<number>(169).fill(Infinity), first = Array<TankDirection | null>(169).fill(null);
    const pending = new Set<number>([startY * 13 + startX]); costs[startY * 13 + startX] = 0;
    while (pending.size) {
      let current = -1;
      for (const cell of pending) if (current < 0 || costs[cell]! < costs[current]!) current = cell;
      pending.delete(current);
      if (current === 12 * 13 + 6) return first[current] ?? "down";
      const x = current % 13, y = Math.floor(current / 13);
      for (const direction of ["down", "left", "right", "up"] as const) {
        const nx = x + vector[direction].x, ny = y + vector[direction].y;
        if (nx < 0 || nx >= 13 || ny < 0 || ny >= 13) continue;
        const cells = [ny * 2 * 26 + nx * 2, ny * 2 * 26 + nx * 2 + 1, (ny * 2 + 1) * 26 + nx * 2, (ny * 2 + 1) * 26 + nx * 2 + 1];
        if (cells.some(cell => ["steel", "water"].includes(this.terrain[cell]!))) continue;
        const next = ny * 13 + nx, cost = costs[current]! + (cells.some(cell => this.terrain[cell] === "brick") ? 4 : 1);
        if (cost >= costs[next]!) continue;
        costs[next] = cost; first[next] = first[current] ?? direction; pending.add(next);
      }
    }
    return directions[Math.floor(this.random() * 4)]!;
  }
  private updateEnemy(actor: TankActor) {
    if (this.tick < actor.stunnedUntil) { actor.moving = false; this.fire(actor); return; }
    const atJunction = Math.abs((actor.x - 20) / 40 - Math.round((actor.x - 20) / 40)) < 0.04 && Math.abs((actor.y - 20) / 40 - Math.round((actor.y - 20) / 40)) < 0.04;
    if (this.tick >= actor.thinkAt && (atJunction || !actor.moving)) {
      const route = this.routeDirection(actor);
      const lineToPlayer = this.player && (Math.abs(this.player.x - actor.x) < 13 || Math.abs(this.player.y - actor.y) < 13);
      if (lineToPlayer && this.random() < 0.45) actor.direction = Math.abs(this.player!.x - actor.x) < 13 ? this.player!.y > actor.y ? "down" : "up" : this.player!.x > actor.x ? "right" : "left";
      else actor.direction = route;
      actor.thinkAt = this.tick + 40 + Math.floor(this.random() * 35);
    }
    if (!this.move(actor, actor.direction, actor.blueprint.speed / 60)) {
      const cell = this.cellAt({ x: actor.x + vector[actor.direction].x * 25, y: actor.y + vector[actor.direction].y * 25 });
      if (this.terrain[cell] !== "brick" && this.tick % 35 === actor.id % 35) { actor.direction = directions[Math.floor(this.random() * 4)]!; actor.thinkAt = this.tick + 45; }
    }
    this.fire(actor);
  }
  private destroyEnemy(actor: TankActor, drop = true) {
    const index = this.tanks.indexOf(actor); if (index < 0) return;
    this.tanks.splice(index, 1); this.kills++; this.waveKills++;
    this.combo = this.tick - this.lastKillAt <= 240 ? Math.min(3, this.combo + 1) : 1; this.lastKillAt = this.tick;
    this.score += actor.blueprint.score * this.combo; this.effect(actor, "explosion"); this.cue("gold");
    if (drop && this.kills % this.rules.supplyEvery === 0 && this.pickups.length < 3) {
      const kind = (["star", "shield", "star", "bomb", "fortify"] as const)[Math.floor(this.kills / this.rules.supplyEvery - 1) % 5]!;
      const point = this.supplyPosition();
      if (point) this.pickups.push({ ...point, id: this.nextId++, kind, expire: this.tick + 1500 });
    }
  }
  /** Flood-fill only traversable lanes, so a supply never lands behind sealed walls. */
  private supplyPosition(): TankPoint | null {
    const origin = this.player ?? this.level.playerSpawn;
    const start = Math.floor(origin.y / 40) * 13 + Math.floor(origin.x / 40);
    const visited = new Set<number>([start]), pending = [start], candidates: TankPoint[] = [];
    for (let n = 0; n < pending.length; n++) {
      const cell = pending[n]!, x = cell % 13, y = Math.floor(cell / 13);
      const point = { x: x * 40 + 20, y: y * 40 + 20 };
      if (y >= 4 && this.canOccupy({ id: this.player?.id ?? -1 }, point.x, point.y) && !this.pickups.some(p => overlaps(p, point, 30))) candidates.push(point);
      for (const dir of directions) {
        const nx = x + vector[dir].x, ny = y + vector[dir].y, next = ny * 13 + nx;
        if (nx < 0 || nx >= 13 || ny < 0 || ny >= 13 || visited.has(next)) continue;
        const px = nx * 40 + 20, py = ny * 40 + 20;
        // Other tanks are temporary obstacles; terrain determines reachability.
        if (insideBase({ x: px, y: py }, HALF)) continue;
        const cells = [ny * 2 * 26 + nx * 2, ny * 2 * 26 + nx * 2 + 1, (ny * 2 + 1) * 26 + nx * 2, (ny * 2 + 1) * 26 + nx * 2 + 1];
        if (cells.some(index => ["brick", "steel", "water"].includes(this.terrain[index]!))) continue;
        visited.add(next); pending.push(next);
      }
    }
    candidates.sort((a, b) => Math.abs(Math.hypot(a.x - origin.x, a.y - origin.y) - 100) - Math.abs(Math.hypot(b.x - origin.x, b.y - origin.y) - 100));
    return candidates[Math.floor(this.random() * Math.min(4, candidates.length))] ?? null;
  }

  private hitActor(actor: TankActor, bullet: TankBullet) {
    if (actor.team === bullet.team) return false;
    bullet.alive = false;
    return this.damageActor(actor);
  }
  private damageActor(actor: TankActor) {
    if (this.tick < actor.invincibleUntil) { this.effect(actor, "spark"); return true; }
    actor.hp--; this.effect(actor, "spark"); this.cue("hit");
    if (actor.hp > 0) {
      if (actor.team === "player") actor.invincibleUntil = this.tick + this.rules.hitProtection;
      return true;
    }
    if (actor.team === "enemy") this.destroyEnemy(actor);
    else {
      this.effect(actor, "explosion"); this.tanks.splice(this.tanks.indexOf(actor), 1);
      this.player = null; this.lives--; this.power = Math.max(0, this.power - this.rules.deathPowerLoss); this.respawnAt = this.tick + 90; this.cue("leak");
      if (!this.lives) this.finish("defeat", "lives");
    }
    return true;
  }
  private detonate(index: number) {
    const barrel = this.mechanisms[index];
    if (!barrel || barrel.spent || barrel.kind !== "barrel") return;
    barrel.spent = true; this.effect(barrel, "blast"); this.cue("hit");
    const near = (point: TankPoint) => Math.hypot(point.x - barrel.x, point.y - barrel.y) <= 72;
    for (const actor of [...this.tanks]) if (near(actor)) {
      const damage = actor.team === "enemy" ? 2 : 1;
      for (let n = 0; n < damage && this.tanks.includes(actor); n++) this.damageActor(actor);
    }
    for (let cell = 0; cell < this.terrain.length; cell++) if (this.terrain[cell] === "brick" && near({ x: cell % 26 * 20 + 10, y: Math.floor(cell / 26) * 20 + 10 })) {
      this.terrain[cell] = "floor"; this.brickHP[cell] = 0; this.destroyedBricks++;
    }
    for (const bullet of this.bullets) if (near(bullet)) bullet.alive = false;
    this.mechanisms.forEach((device, next) => { if (!device.spent && device.kind === "barrel" && near(device)) this.detonate(next); });
  }
  private updateMechanisms() {
    this.mechanisms.forEach((device, index) => {
      if (device.spent || device.kind === "barrel") return;
      if (device.kind === "repair") {
        if (this.player && overlaps(this.player, device, 22) && this.lives < this.rules.maxLives) {
          device.spent = true; this.lives++; this.player.hp = this.player.blueprint.armor + this.rules.playerArmorBonus;
          this.player.invincibleUntil = Math.max(this.player.invincibleUntil, this.tick + 180); this.effect(device, "spawn"); this.cue("upgrade");
        }
        return;
      }
      for (const actor of this.tanks) {
        if (!inArea(actor, device)) continue;
        if (device.kind === "conveyor") {
          const dir = vector[device.direction], x = actor.x + dir.x * 30 / 60, y = actor.y + dir.y * 30 / 60;
          if (this.canOccupy(actor, x, y)) { actor.x = x; actor.y = y; }
        } else if (tankPulsePhase(this.tick, device.offset) === "active") {
          const cycle = Math.floor((this.tick + device.offset) / TANK_PULSE_PERIOD);
          if (actor.pulseHits[index] === cycle || this.tick < actor.invincibleUntil) continue;
          actor.pulseHits[index] = cycle; actor.stunnedUntil = this.tick + (actor.team === "player" ? 30 : 90); this.effect(actor, "spark");
        }
      }
    });
  }
  private stepBullet(bullet: TankBullet) {
    if (!bullet.alive) return;
    const v = vector[bullet.direction], steps = Math.ceil(bullet.speed / 60), amount = bullet.speed / 60 / steps;
    for (let step = 0; step < steps && bullet.alive; step++) {
      bullet.x += v.x * amount; bullet.y += v.y * amount;
      if (bullet.x < 0 || bullet.y < 0 || bullet.x >= TANK_WORLD || bullet.y >= TANK_WORLD) { bullet.alive = false; break; }
      if (insideBase(bullet, 2)) {
        bullet.alive = false;
        if ((bullet.team === "enemy" || this.rules.friendlyFire) && this.tick >= this.baseInvincibleUntil) {
          this.baseHP--; this.baseInvincibleUntil = this.tick + this.rules.hitProtection;
          this.effect({ x: 260, y: 500 }, this.baseHP ? "spark" : "explosion"); this.cue("leak");
          if (!this.baseHP) { this.baseAlive = false; this.finish("defeat", "base"); }
        }
        break;
      }
      const barrel = this.mechanisms.findIndex(device => device.kind === "barrel" && !device.spent && overlaps(bullet, device, 13));
      if (barrel >= 0) { bullet.alive = false; this.detonate(barrel); break; }
      const index = this.cellAt(bullet), terrain = this.terrain[index];
      if (terrain === "brick" || terrain === "steel") {
        bullet.alive = false; this.effect(bullet, "spark");
        const adjacent = index + (v.x === 0 ? index % 2 === 0 ? 1 : -1 : Math.floor(index / 26) % 2 === 0 ? 26 : -26);
        const cells = [index, adjacent];
        for (const cell of cells) {
          if (this.terrain[cell] === "brick") {
            this.brickHP[cell] = Math.max(0, this.brickHP[cell]! - (bullet.power >= 1 ? 2 : 1));
            if (!this.brickHP[cell]) { this.terrain[cell] = "floor"; this.destroyedBricks++; }
          } else if (this.terrain[cell] === "steel" && bullet.team === "player" && bullet.power >= 2) this.terrain[cell] = "floor";
        }
        break;
      }
      const other = this.bullets.find(b => b !== bullet && b.alive && b.team !== bullet.team && overlaps(b, bullet, 5));
      if (other) { bullet.alive = false; other.alive = false; this.effect(bullet, "spark"); break; }
      const target = this.tanks.find(tank => tank.id !== bullet.owner && tank.team !== bullet.team && overlaps(tank, bullet, HALF + 2));
      if (target) this.hitActor(target, bullet);
    }
  }
  private collect(pickup: TankPickup) {
    this.score += 250; this.cue("upgrade");
    if (pickup.kind === "star" && this.power < 2) {
      this.power++;
      if (this.player) this.effect(this.player, "upgrade");
    }
    if (pickup.kind === "shield" && this.player) this.player.invincibleUntil = this.tick + 600;
    if (pickup.kind === "bomb") for (const enemy of [...this.tanks]) if (enemy.team === "enemy") this.destroyEnemy(enemy, false);
    if (pickup.kind === "fortify") {
      this.fortifyUntil = this.tick + TANK_FORTIFY_TICKS;
      for (const cell of BASE_WALLS) {
        const center = { x: cell % 26 * 20 + 10, y: Math.floor(cell / 26) * 20 + 10 };
        if (!this.tanks.some(actor => overlaps(actor, center, HALF + 10))) this.terrain[cell] = "steel";
      }
    }
  }
  private finish(phase: "defeat" | "cleared" | "victory", reason: TankSnapshot["defeatReason"] = null) {
    if (this.phase !== "running") return;
    this.phase = phase; this.paused = false; this.defeatReason = reason; this.clearInput();
    this.cue(phase === "defeat" ? "defeat" : "victory");
  }
  step() {
    if (this.phase !== "running" || this.paused) return;
    this.tick++;
    if (!this.player && this.lives > 0 && this.tick >= this.respawnAt) {
      if (!this.spawnPlayer(this.playerBlueprint)) this.respawnAt = this.tick + 15;
    }
    if (this.waveAt && this.tick >= this.waveAt) {
      this.wave++; this.waveKills = 0; this.roster = this.survivalRoster(); this.spawned = 0; this.waveAt = 0; this.spawnAt = this.tick + 60;
      if (this.wave % 3 === 0) this.lives = Math.min(this.rules.maxLives, this.lives + 1);
    }
    if (!this.waveAt && this.spawned < this.roster.length && this.tick >= this.spawnAt && this.tanks.filter(t => t.team === "enemy").length < this.maxActive()) this.spawnEnemy();
    this.updateMechanisms();
    const player = this.player;
    if (player) {
      const onIce = this.terrain[this.cellAt(player)] === "ice";
      if (this.tick < player.stunnedUntil) player.moving = false;
      else if (this.input.direction) { this.move(player, this.input.direction, player.blueprint.speed / 60); this.glideUntil = onIce ? this.tick + 18 : 0; }
      else if (onIce && this.tick < this.glideUntil) this.move(player, player.direction, player.blueprint.speed / 60);
      else player.moving = false;
      if (this.input.fire || this.fireQueued) this.fire(player);
      this.fireQueued = false;
    }
    for (const actor of [...this.tanks]) if (actor.team === "enemy") this.updateEnemy(actor);
    for (const bullet of this.bullets) { this.stepBullet(bullet); if (this.phase !== "running") break; }
    for (let n = this.bullets.length - 1; n >= 0; n--) if (!this.bullets[n]!.alive) this.bullets.splice(n, 1);
    if (this.phase !== "running") return;
    for (let n = this.pickups.length - 1; n >= 0; n--) {
      const pickup = this.pickups[n]!;
      if (this.player && overlaps(this.player, pickup, 22)) { this.pickups.splice(n, 1); this.collect(pickup); }
      else if (this.tick >= pickup.expire) this.pickups.splice(n, 1);
    }
    if (this.fortifyUntil && this.tick >= this.fortifyUntil) {
      for (const cell of BASE_WALLS) if (this.terrain[cell] === "steel") { this.terrain[cell] = "brick"; this.brickHP[cell] = 2; }
      this.fortifyUntil = 0;
    }
    while (this.effects[0] && this.tick - this.effects[0].tick > 45) this.effects.shift();
    if (this.phase === "running" && !this.waveAt && this.spawned === this.roster.length && !this.tanks.some(t => t.team === "enemy")) {
      if (this.mode === "survival") {
        this.waveAt = this.tick + 300; this.bullets.length = 0;
        if (this.player) this.player.invincibleUntil = Math.max(this.player.invincibleUntil, this.waveAt + 180);
        const point = this.supplyPosition();
        if (point && this.pickups.length < 3) this.pickups.push({ ...point, id: this.nextId++, kind: this.power < 2 ? "star" : "fortify", expire: this.waveAt + 1200 });
        this.cue("upgrade");
      } else this.finish(this.mode === "blitz" || this.level.id === TANK_LEVELS.length ? "victory" : "cleared");
    }
    if (this.mode === "blitz" && this.tick >= TANK_BLITZ_TICKS && this.phase === "running") this.finish("defeat", "time");
  }
  snapshot(): TankSnapshot {
    return { difficulty: this.difficulty, maxLives: this.rules.maxLives, baseHP: this.baseHP, maxBaseHP: this.rules.baseHP, playerHP: this.player?.hp ?? 0, maxPlayerHP: this.playerBlueprint.armor + this.rules.playerArmorBonus,
      mode: this.mode, wave: this.wave, waveKills: this.waveKills, waveTotal: this.roster.length, intermission: Math.max(0, Math.ceil((this.waveAt - this.tick) / 60)),
      timeLeft: this.mode === "blitz" ? Math.max(0, Math.ceil((TANK_BLITZ_TICKS - this.tick) / 60)) : null,
      combo: this.tick - this.lastKillAt <= 240 ? this.combo : 0, stunned: !!this.player && this.tick < this.player.stunnedUntil,
      phase: this.phase, paused: this.paused, tick: this.tick, score: this.score, lives: this.lives, kills: this.kills, total: this.roster.length, remaining: this.roster.length - this.waveKills,
      activeEnemies: this.tanks.filter(t => t.team === "enemy").length, baseAlive: this.baseAlive, fortifyTicks: Math.max(0, this.fortifyUntil - this.tick), power: this.power, shield: !!this.player && this.player.invincibleUntil > this.tick, respawning: !this.player && this.lives > 0,
      playerPosition: this.player ? { x: this.player.x, y: this.player.y } : null, shots: this.shots, destroyedBricks: this.destroyedBricks, defeatReason: this.defeatReason };
  }
}
