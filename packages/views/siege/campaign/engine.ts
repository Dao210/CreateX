import RAPIER from "@dimforge/rapier2d-compat";
import { campaignStars, compileCampaignWeapon, damageMultiplier, ENEMY_RECIPES, hitDamage, pointOnRoute, routeLength, sellPrice, upgradePrice, validCheckpoint,
  CAMPAIGN_VERSION, type CampaignBlueprint, type CampaignCheckpoint, type CampaignLevel, type CompiledCampaignWeapon, type EnemyKind, type Position, type WeaponKind, type SpawnEntry, type ColliderDefinition } from "@auro/core/siege";
import { initializePhysics } from "../runtime/engine";

export { initializePhysics };
export type BattlePhase = "ready" | "running" | "intermission" | "victory" | "defeat";
export interface CampaignTower { id: number; slot: number; weapon: CompiledCampaignWeapon; level: number; body: RAPIER.RigidBody; pin: RAPIER.RigidBody; reloadAt: number; damage: number; kills: number; shots: number; control: number; lastShot: number }
export interface CampaignEnemy { id: number; kind: EnemyKind; route: number; progress: number; hp: number; maxHP: number; body: RAPIER.RigidBody; collider: RAPIER.Collider; slowUntil: number; stunUntil: number; knockbackUntil: number; summoned: boolean }
interface Obstacle { id: string; hp: number; body: RAPIER.RigidBody | null; collider: RAPIER.Collider | null }
interface Round { body: RAPIER.RigidBody; collider: RAPIER.Collider; towerId: number; origin: Position; expire: number; radius: number }
export interface CombatEffect extends Position { tick: number; kind: "hit" | "burst" | "frost" | "gold"; value: number }
export interface BattleEvent { tick: number; type: string; data: Record<string, string | number> }
export interface CampaignSnapshot {
  tick: number; phase: BattlePhase; wave: number; completedWaves: number; gold: number; hp: number; kills: number; paused: boolean;
  enemies: Array<Position & { id: number; kind: EnemyKind; hp: number; maxHP: number; slowed: boolean }>;
  towers: Array<{ id: number; slot: number; kind: WeaponKind; level: number; damage: number; kills: number; control: number; cost: number; name: string }>;
  obstacles: Array<{ id: string; hp: number }>; leaks: CampaignCheckpoint["leaks"]; focus: string | null; stars: number; revision: number; remainingSpawns: number; activeRounds: number; roundLimit: number;
}
const MAX_ENEMIES = 40, MAX_ROUNDS = 96;
const groups = { weapon: 0x0001000a, enemy: 0x00020005, round: 0x0004000a, obstacle: 0x00080005 };
const difference = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const separation = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.y - b.y);

export class CampaignEngine {
  readonly world = new RAPIER.World({ x: 0, y: 0 });
  readonly queue = new RAPIER.EventQueue(true);
  readonly towers = new Map<number, CampaignTower>();
  readonly enemies = new Map<number, CampaignEnemy>();
  readonly rounds = new Map<number, Round>();
  readonly obstacles = new Map<string, Obstacle>();
  readonly effects: CombatEffect[] = [];
  readonly events: BattleEvent[] = [];
  private readonly parts = new Map<number, { tower: number; shape: ColliderDefinition }>();
  private readonly contacts = new Map<string, [number, number]>();
  private readonly meleeCooldowns = new Map<string, number>();
  private spawnQueue: SpawnEntry[] = [];
  private waveStart = 0;
  private nextWaveAt = 0;
  private nextId = 1;
  private disposed = false;
  tick = 0; completedWaves = 0; gold: number; hp = 100; kills = 0;
  phase: BattlePhase = "ready"; paused = false; focus: string | null = null; revision = 0;
  leaks: CampaignCheckpoint["leaks"] = [];

  constructor(readonly level: CampaignLevel, checkpoint?: CampaignCheckpoint) {
    this.world.timestep = 1 / 60;
    this.gold = level.gold;
    for (const source of level.obstacles) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(source.x, source.y));
      const collider = this.world.createCollider(RAPIER.ColliderDesc.ball(0.55).setSensor(true).setCollisionGroups(groups.obstacle).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
      this.obstacles.set(source.id, { id: source.id, hp: source.hp, body, collider });
    }
    if (checkpoint) {
      const saved = validCheckpoint(checkpoint);
      if (!saved || saved.levelId !== level.id) { this.dispose(); throw new Error("这份断点不适用于当前关卡，请重新开局。"); }
      this.gold = saved.gold; this.hp = saved.hp; this.tick = saved.tick; this.completedWaves = saved.completedWaves;
      this.kills = saved.kills; this.leaks = saved.leaks;
      for (const savedObstacle of saved.obstacles) {
        const obstacle = this.obstacles.get(savedObstacle.id)!; obstacle.hp = savedObstacle.hp;
        if (!obstacle.hp) this.removeObstacleBody(obstacle);
      }
      for (const tower of saved.towers) {
        this.createTower(tower.slot, compileCampaignWeapon(tower.kind, tower.blueprint), tower.level, tower.id);
        Object.assign(this.towers.get(tower.id)!, { damage: tower.damage, kills: tower.kills, shots: tower.shots, control: tower.control });
      }
    }
  }
  private record(type: string, data: BattleEvent["data"] = {}) {
    if (this.events.length < 2000) this.events.push({ tick: this.tick, type, data });
  }
  build(slot: number, kind: WeaponKind, blueprint: CampaignBlueprint): string | null {
    if (this.phase === "victory" || this.phase === "defeat") return "本次战斗已经结束。";
    if (!this.level.slots[slot] || !this.level.weapons.includes(kind)) return "这关不能部署这种武器。";
    if ([...this.towers.values()].some(t => t.slot === slot)) return "这个阵位已有武器。";
    if (this.level.obstacles.some(o => o.slot === slot && this.obstacles.get(o.id)!.hp > 0)) return "先清除这个阵位上的障碍。";
    let weapon: CompiledCampaignWeapon;
    try { weapon = compileCampaignWeapon(kind, structuredClone(blueprint)); } catch (error) { return error instanceof Error ? error.message : "蓝图无法部署。"; }
    if (this.gold < weapon.cost) return `还差 ${weapon.cost - this.gold} 金币。`;
    this.createTower(slot, weapon, 1); this.gold -= weapon.cost;
    this.record("build", { slot, kind, cost: weapon.cost }); this.revision++;
    return null;
  }
  private createTower(slot: number, weapon: CompiledCampaignWeapon, level: number, id = this.nextId++) {
    this.nextId = Math.max(this.nextId, id + 1);
    const position = this.level.slots[slot]!;
    const pin = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y));
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y).setAngularDamping(0.2).setCcdEnabled(true));
    const definition = weapon.definition;
    body.setAdditionalMassProperties(definition.mass, { x: definition.centerOfMass[0], y: definition.centerOfMass[1] }, definition.inertia, true);
    this.world.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0 }, { x: 0, y: 0 }), pin, body, true);
    for (const shape of definition.colliders) {
      const collider = shape.shape === "ball" ? RAPIER.ColliderDesc.ball(shape.radius) : shape.shape === "capsule" ? RAPIER.ColliderDesc.capsule(shape.halfLength, shape.radius) : RAPIER.ColliderDesc.convexHull(new Float32Array(shape.vertices.flat()));
      if (!collider) throw new Error("invalid_collider");
      const part = this.world.createCollider(collider.setTranslation(...shape.center).setRotation(shape.rotation).setDensity(0).setSensor(true).setCollisionGroups(groups.weapon).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
      this.parts.set(part.handle, { tower: id, shape });
    }
    const toward = pointOnRoute(this.level.routes[0]!, this.level.id === 1 ? position.x : routeLength(this.level.routes[0]!) / 2);
    body.setRotation(Math.atan2(toward.y - position.y, toward.x - position.x), true);
    this.towers.set(id, { id, slot, weapon, level, body, pin, reloadAt: this.tick, damage: 0, kills: 0, shots: 0, control: 0, lastShot: -100 });
  }
  upgrade(id: number): string | null {
    const tower = this.towers.get(id);
    if (!tower || tower.level === 3 || ["victory", "defeat"].includes(this.phase)) return "这座武器无法继续升级。";
    const price = upgradePrice(tower.weapon.cost, tower.level);
    if (this.gold < price) return `还差 ${price - this.gold} 金币。`;
    this.gold -= price; tower.level++; this.record("upgrade", { tower: id, level: tower.level, price }); this.revision++;
    return null;
  }
  sell(id: number): string | null {
    const tower = this.towers.get(id);
    if (!tower || ["victory", "defeat"].includes(this.phase)) return "本次战斗无法出售。";
    const refund = sellPrice(tower.weapon.cost, tower.level); this.gold += refund;
    for (const [handle, part] of this.parts) if (part.tower === id) this.parts.delete(handle);
    // In-flight rounds keep their source alive until removal, so selling cannot create free hits.
    for (const [handle, round] of this.rounds) if (round.towerId === id) this.removeRound(handle);
    this.world.removeRigidBody(tower.body); this.world.removeRigidBody(tower.pin); this.towers.delete(id);
    this.record("sell", { tower: id, refund }); this.revision++;
    return null;
  }
  setFocus(target: string | null) {
    this.focus = target; this.record("focus", { target: target ?? "auto" });
  }
  startWave(): string | null {
    if (!["ready", "intermission"].includes(this.phase)) return "当前不能开始下一波。";
    this.phase = "running"; this.paused = false; this.waveStart = this.tick;
    this.spawnQueue = [...this.level.waves[this.completedWaves]!];
    this.record("wave", { wave: this.completedWaves + 1 }); this.revision++;
    return null;
  }
  setPaused(paused: boolean) { this.paused = paused; this.record(paused ? "pause" : "resume"); }
  private spawn(entry: SpawnEntry) {
    const recipe = ENEMY_RECIPES[entry.kind], position = this.level.routes[entry.route]![0]!;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.ball(recipe.radius).setCollisionGroups(groups.enemy).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS).setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL), body);
    const hp = Math.round(recipe.hp * (entry.kind === "boss" ? 1 : 1 + (this.level.id - 1) * 0.05 + this.completedWaves * 0.1));
    this.enemies.set(collider.handle, { id: this.nextId++, kind: entry.kind, route: entry.route, progress: 0, hp, maxHP: hp, body, collider, slowUntil: 0, stunUntil: 0, knockbackUntil: 0, summoned: false });
  }
  private targetFor(tower: CampaignTower): { position: Position; enemy?: CampaignEnemy; obstacle?: Obstacle } | null {
    const mount = this.level.slots[tower.slot]!;
    const inRange = (position: Position) => {
      const distance = separation(mount, position), launcher = tower.weapon.definition.launcher;
      return distance <= tower.weapon.range + 0.3 && (!launcher || distance > Math.hypot(...launcher.muzzle) + launcher.projectileRadius);
    };
    if (this.focus?.startsWith("obstacle:")) {
      const obstacle = this.obstacles.get(this.focus.slice(9)), source = this.level.obstacles.find(o => o.id === obstacle?.id);
      if (obstacle && source && obstacle.hp > 0 && inRange(source)) return { position: source, obstacle };
    }
    const candidates = [...this.enemies.values()].filter(e => e.hp > 0 && inRange(e.body.translation()));
    const selected = candidates.find(e => this.focus === `enemy:${e.id}`) ?? candidates.sort((a, b) =>
      (routeLength(this.level.routes[a.route]!) - a.progress) - (routeLength(this.level.routes[b.route]!) - b.progress) || a.id - b.id)[0];
    return selected ? { position: selected.body.translation(), enemy: selected } : null;
  }
  muzzle(tower: CampaignTower): Position {
    const mount = this.level.slots[tower.slot]!, muzzle = tower.weapon.definition.launcher?.muzzle ?? [0, 0], angle = tower.body.rotation();
    return { x: mount.x + muzzle[0] * Math.cos(angle) - muzzle[1] * Math.sin(angle), y: mount.y + muzzle[0] * Math.sin(angle) + muzzle[1] * Math.cos(angle) };
  }
  private updateTower(tower: CampaignTower, fire: boolean) {
    const definition = tower.weapon.definition, launcher = definition.launcher;
    const target = this.targetFor(tower);
    if (!launcher) {
      if (!fire) {
        const speed = definition.motion === "rotating" ? 2.5 : Math.sin(this.tick / 45) * 2;
        tower.body.resetTorques(true); tower.body.addTorque(Math.max(-12, Math.min(12, (speed - tower.body.angvel()) * 8)), true);
      }
      return;
    }
    const mount = this.level.slots[tower.slot]!, muzzle = this.muzzle(tower);
    let aim = target?.position;
    if (target?.enemy) {
      const enemy = target.enemy, time = Math.min(launcher.range / launcher.projectileSpeed, separation(muzzle, enemy.body.translation()) / launcher.projectileSpeed);
      aim = pointOnRoute(this.level.routes[enemy.route]!, enemy.progress + ENEMY_RECIPES[enemy.kind].speed * time * (enemy.slowUntil > this.tick ? enemy.kind === "boss" ? 0.75 : 0.5 : 1));
    }
    let error: number | null = null;
    if (aim) {
      const along = launcher.muzzle[0] * Math.cos(launcher.heading) + launcher.muzzle[1] * Math.sin(launcher.heading);
      const lateral = -launcher.muzzle[0] * Math.sin(launcher.heading) + launcher.muzzle[1] * Math.cos(launcher.heading);
      const square = separation(mount, aim) ** 2 - lateral ** 2;
      if (square > 0 && Math.sqrt(square) > along + launcher.projectileRadius) error = difference(Math.atan2(aim.y - mount.y, aim.x - mount.x) - launcher.heading - Math.atan2(lateral, Math.sqrt(square)) - tower.body.rotation());
    }
    if (!fire) {
      const inertia = definition.inertia + definition.mass * (definition.centerOfMass[0] ** 2 + definition.centerOfMass[1] ** 2);
      const speed = error === null ? 0 : Math.sign(error) * Math.min(launcher.maxTurnSpeed, Math.sqrt(2 * launcher.maxTorque / inertia * Math.abs(error)));
      tower.body.resetTorques(true); tower.body.addTorque(Math.max(-launcher.maxTorque, Math.min(launcher.maxTorque, (speed - tower.body.angvel()) * 20)), true);
      return;
    }
    if (error === null || Math.abs(error) > launcher.aimTolerance || this.tick < tower.reloadAt || !target || separation(muzzle, target.position) > launcher.range || this.rounds.size >= MAX_ROUNDS) return;
    const heading = tower.body.rotation() + launcher.heading, offset = launcher.projectileRadius + 0.04;
    const direction = { x: Math.cos(heading), y: Math.sin(heading) };
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(muzzle.x + direction.x * offset, muzzle.y + direction.y * offset)
      .setLinvel(direction.x * launcher.projectileSpeed, direction.y * launcher.projectileSpeed).setCcdEnabled(true).lockRotations());
    const collider = this.world.createCollider(RAPIER.ColliderDesc.ball(launcher.projectileRadius).setDensity(1).setSensor(false).setCollisionGroups(groups.round).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    this.rounds.set(collider.handle, { body, collider, towerId: tower.id, origin: muzzle, radius: launcher.projectileRadius, expire: this.tick + Math.ceil(launcher.range / launcher.projectileSpeed * 60) });
    tower.reloadAt = this.tick + Math.round(launcher.reloadTicks * (tower.weapon.kind === "burst" ? 1.35 : 1)); tower.shots++; tower.lastShot = this.tick;
  }
  private effect(position: Position, kind: CombatEffect["kind"], value = 0) {
    this.effects.push({ ...position, tick: this.tick, kind, value });
    if (this.effects.length > 40) this.effects.shift();
  }
  private damageEnemy(enemy: CampaignEnemy, raw: number, tower: CampaignTower) {
    if (enemy.hp <= 0) return;
    const applied = Math.min(enemy.hp, Math.max(1, Math.round(raw * (tower.weapon.kind === "hammer" ? 1 : 1 - ENEMY_RECIPES[enemy.kind].armor))));
    enemy.hp -= applied; tower.damage += applied;
    this.effect(enemy.body.translation(), tower.weapon.kind === "frost" ? "frost" : "hit", applied);
    if (tower.weapon.kind === "frost") { enemy.slowUntil = this.tick + 120 + (tower.level - 1) * 30; tower.control++; }
    if (tower.weapon.kind === "hammer" && this.tick >= enemy.knockbackUntil) {
      enemy.progress = Math.max(0, enemy.progress - (enemy.kind === "boss" ? 0.35 : 0.7));
      enemy.stunUntil = this.tick + (enemy.kind === "boss" ? 8 : 16); enemy.knockbackUntil = this.tick + 100; tower.control++;
    }
    if (enemy.hp <= 0) { this.gold += ENEMY_RECIPES[enemy.kind].reward; this.kills++; tower.kills++; this.effect(enemy.body.translation(), "gold", ENEMY_RECIPES[enemy.kind].reward); }
    else if (enemy.kind === "boss" && !enemy.summoned && enemy.hp <= enemy.maxHP / 2) {
      enemy.summoned = true;
      for (let n = 0; n < 6; n++) this.spawnQueue.push({ kind: n % 2 ? "runner" : "swarm", route: n % this.level.routes.length, tick: this.tick - this.waveStart + 60 + n * 35 });
      this.spawnQueue.sort((a, b) => a.tick - b.tick); this.record("reinforcements", { wave: this.completedWaves + 1 });
    }
  }
  private damageObstacle(obstacle: Obstacle, raw: number, tower: CampaignTower) {
    if (obstacle.hp <= 0) return;
    const source = this.level.obstacles.find(o => o.id === obstacle.id)!;
    const applied = Math.min(obstacle.hp, Math.max(1, Math.round(raw))); obstacle.hp -= applied; tower.damage += applied;
    this.effect(source, "hit", applied);
    if (obstacle.hp <= 0) {
      this.gold += source.reward; this.removeObstacleBody(obstacle); this.effect(source, "gold", source.reward);
      if (this.focus === `obstacle:${obstacle.id}`) this.focus = null;
      this.record("clear", { obstacle: source.id, reward: source.reward }); this.revision++;
    }
  }
  private removeObstacleBody(obstacle: Obstacle) {
    if (obstacle.body) this.world.removeRigidBody(obstacle.body);
    obstacle.body = null; obstacle.collider = null;
  }
  private removeRound(handle: number) {
    const round = this.rounds.get(handle); if (!round) return;
    this.world.removeRigidBody(round.body); this.rounds.delete(handle);
  }
  step() {
    if (this.disposed || this.paused || !["running", "intermission"].includes(this.phase)) return;
    this.tick++;
    if (this.phase === "intermission") { if (this.tick >= this.nextWaveAt) this.startWave(); else return; }
    while (this.spawnQueue[0] && this.spawnQueue[0].tick <= this.tick - this.waveStart && this.enemies.size < MAX_ENEMIES) this.spawn(this.spawnQueue.shift()!);
    for (const enemy of this.enemies.values()) {
      const position = enemy.body.translation();
      const boosted = [...this.enemies.values()].some(other => other.kind === "banner" && other.hp > 0 && other.id !== enemy.id && separation(position, other.body.translation()) <= 3);
      const slow = enemy.slowUntil > this.tick ? enemy.kind === "boss" ? 0.75 : 0.5 : 1;
      if (enemy.stunUntil <= this.tick) enemy.progress += ENEMY_RECIPES[enemy.kind].speed * slow * (boosted ? 1.25 : 1) / 60;
      enemy.body.setNextKinematicTranslation(pointOnRoute(this.level.routes[enemy.route]!, enemy.progress));
    }
    for (const tower of this.towers.values()) this.updateTower(tower, false);
    this.world.step(this.queue);
    const collisions: Array<[number, number]> = [];
    this.queue.drainCollisionEvents((a, b, started) => {
      const key = [Math.min(a, b), Math.max(a, b)].join(":");
      if (started) { collisions.push([a, b]); if (this.parts.has(a) || this.parts.has(b)) this.contacts.set(key, [a, b]); }
      else this.contacts.delete(key);
    });
    collisions.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [a, b] of collisions) {
      const round = this.rounds.get(a) ?? this.rounds.get(b); if (!round) continue;
      const tower = this.towers.get(round.towerId), enemy = this.enemies.get(a) ?? this.enemies.get(b);
      const obstacle = [...this.obstacles.values()].find(o => o.collider?.handle === a || o.collider?.handle === b);
      if (tower && (enemy || obstacle)) {
        const launcher = tower.weapon.definition.launcher!;
        const damage = launcher.damage * damageMultiplier(tower.level) * (tower.weapon.kind === "frost" ? 0.35 : 1);
        const impact = enemy?.body.translation() ?? this.level.obstacles.find(o => o.id === obstacle!.id)!;
        if (tower.weapon.kind === "burst") {
          this.effect(impact, "burst");
          for (const other of this.enemies.values()) if (separation(impact, other.body.translation()) <= 1.7) this.damageEnemy(other, damage, tower);
          for (const other of this.obstacles.values()) {
            const source = this.level.obstacles.find(o => o.id === other.id)!;
            if (separation(impact, source) <= 1.7) this.damageObstacle(other, damage, tower);
          }
        } else if (enemy) this.damageEnemy(enemy, damage, tower);
        else if (obstacle) this.damageObstacle(obstacle, damage, tower);
        this.removeRound(round.collider.handle);
      }
    }
    for (const [key, [a, b]] of this.contacts) if (!this.world.getCollider(a) || !this.world.getCollider(b)) this.contacts.delete(key);
    for (const [a, b] of this.contacts.values()) {
      const part = this.parts.get(a) ?? this.parts.get(b); if (!part) continue;
      const tower = this.towers.get(part.tower); if (!tower || tower.weapon.definition.launcher || this.tick < tower.reloadAt) continue;
      const enemy = this.enemies.get(a) ?? this.enemies.get(b);
      const obstacle = [...this.obstacles.values()].find(o => o.collider?.handle === a || o.collider?.handle === b);
      const p = enemy?.body.translation() ?? (obstacle ? this.level.obstacles.find(o => o.id === obstacle.id)! : null);
      if (!p || (enemy && enemy.hp <= 0) || (obstacle && obstacle.hp <= 0)) continue;
      const hitKey = `${tower.id}:${enemy ? `enemy-${enemy.id}` : `obstacle-${obstacle!.id}`}`;
      if ((this.meleeCooldowns.get(hitKey) ?? 0) > this.tick) continue;
      const speed = Math.abs(tower.body.angvel()) * separation(p, this.level.slots[tower.slot]!);
      const damage = hitDamage(part.shape.type, tower.weapon.definition.mass, speed, 0) * damageMultiplier(tower.level);
      if (!damage) continue;
      if (enemy) this.damageEnemy(enemy, damage, tower); else if (obstacle) this.damageObstacle(obstacle, damage, tower);
      // A blade can cut multiple enemies, while each target has its own hit interval.
      this.meleeCooldowns.set(hitKey, this.tick + 18);
      if (tower.weapon.kind === "hammer") tower.reloadAt = this.tick + 65;
    }
    if (this.tick % 60 === 0) for (const [key, until] of this.meleeCooldowns) if (until <= this.tick) this.meleeCooldowns.delete(key);
    for (const [handle, enemy] of this.enemies) {
      const escaped = enemy.progress >= routeLength(this.level.routes[enemy.route]!);
      if (enemy.hp <= 0 || escaped) {
        if (enemy.hp > 0 && escaped) {
          this.hp = Math.max(0, this.hp - ENEMY_RECIPES[enemy.kind].leak);
          this.leaks.push({ wave: this.completedWaves + 1, kind: enemy.kind, route: enemy.route });
          this.record("leak", { kind: enemy.kind, wave: this.completedWaves + 1, route: enemy.route, remainingHP: enemy.hp });
        }
        if (this.focus === `enemy:${enemy.id}`) this.focus = null;
        this.world.removeRigidBody(enemy.body); this.enemies.delete(handle);
      }
    }
    for (const [handle, round] of this.rounds) {
      const tower = this.towers.get(round.towerId);
      if (!tower || this.tick >= round.expire || separation(round.origin, round.body.translation()) >= tower.weapon.range) this.removeRound(handle);
    }
    for (const tower of this.towers.values()) this.updateTower(tower, true);
    if (this.hp <= 0) this.finish("defeat");
    else if (!this.enemies.size && !this.spawnQueue.length) {
      for (const handle of this.rounds.keys()) this.removeRound(handle);
      this.completedWaves++; this.gold += 25; this.focus = null; this.revision++;
      if (this.completedWaves === this.level.waves.length) this.finish("victory");
      else { this.phase = "intermission"; this.nextWaveAt = this.tick + 300; this.record("checkpoint", { wave: this.completedWaves }); }
    }
  }
  private finish(phase: "victory" | "defeat") {
    this.phase = phase; this.paused = false; this.focus = null;
    for (const handle of this.rounds.keys()) this.removeRound(handle);
    this.record(phase, { hp: this.hp, kills: this.kills }); this.revision++;
  }
  checkpoint(): CampaignCheckpoint | null {
    if (!["ready", "intermission"].includes(this.phase)) return null;
    return { version: CAMPAIGN_VERSION, levelId: this.level.id, completedWaves: this.completedWaves, gold: this.gold, hp: this.hp, tick: this.tick, kills: this.kills, leaks: structuredClone(this.leaks),
      obstacles: [...this.obstacles.values()].map(o => ({ id: o.id, hp: o.hp })),
      towers: [...this.towers.values()].map(t => ({ id: t.id, slot: t.slot, kind: t.weapon.kind, level: t.level, blueprint: structuredClone(t.weapon.blueprint), damage: t.damage, kills: t.kills, shots: t.shots, control: t.control })) };
  }
  snapshot(): CampaignSnapshot {
    return { tick: this.tick, phase: this.phase, completedWaves: this.completedWaves, wave: Math.min(this.completedWaves + 1, this.level.waves.length), gold: this.gold, hp: this.hp, kills: this.kills, paused: this.paused, focus: this.focus, revision: this.revision, remainingSpawns: this.spawnQueue.length, activeRounds: this.rounds.size, roundLimit: MAX_ROUNDS,
      enemies: [...this.enemies.values()].map(e => ({ ...e.body.translation(), id: e.id, kind: e.kind, hp: e.hp, maxHP: e.maxHP, slowed: e.slowUntil > this.tick })),
      towers: [...this.towers.values()].map(t => ({ id: t.id, slot: t.slot, kind: t.weapon.kind, level: t.level, damage: Math.round(t.damage), kills: t.kills, control: t.control, cost: t.weapon.cost, name: t.weapon.blueprint.name })),
      obstacles: [...this.obstacles.values()].map(o => ({ id: o.id, hp: o.hp })), leaks: [...this.leaks], stars: this.phase === "victory" ? campaignStars(this.hp, [...this.obstacles.values()].filter(o => o.hp > 0).length) : 0 };
  }
  dispose() { if (this.disposed) return; this.disposed = true; this.queue.free(); this.world.free(); this.rounds.clear(); this.enemies.clear(); this.towers.clear(); this.meleeCooldowns.clear(); this.contacts.clear(); }
}
