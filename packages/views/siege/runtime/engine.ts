import RAPIER from "@dimforge/rapier2d-compat";
import { hitDamage, initialStats, summary, DEFENSE_WAVES, ENEMIES_PER_WAVE, WAVE_INTERVAL, type ArenaMode, type ArenaStats, type WeaponDefinition, type ColliderDefinition } from "@auro/core/siege";

let initialization: Promise<void> | undefined;
export const initializePhysics = () => initialization ??= RAPIER.init();
export interface Enemy {
  id: number; body: RAPIER.RigidBody; collider: RAPIER.Collider;
  hp: number; maxHP: number; heavy: boolean; stunUntil: number; lastHit: number;
}
export interface Projectile {
  body: RAPIER.RigidBody; collider: RAPIER.Collider;
  origin: { x: number; y: number }; direction: { x: number; y: number }; expiresAt: number;
}
export const PROJECTILE_LIMIT = 24;
const groups = { weapon: 0x00010002, enemy: 0x00020007, projectile: 0x00040002 };
const angleDifference = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
export class ArenaEngine {
  readonly world = new RAPIER.World({ x: 0, y: 0 });
  readonly queue = new RAPIER.EventQueue(true);
  readonly enemies = new Map<number, Enemy>();
  readonly projectiles = new Map<number, Projectile>();
  readonly weaponParts = new Map<number, ColliderDefinition>();
  readonly body: RAPIER.RigidBody;
  readonly mount = { x: 4, y: 4 };
  stats = initialStats();
  angle = 0;
  previousAngle = 0;
  lastShot: { x: number; y: number; heading: number; tick: number } | null = null;
  private nextId = 1;
  private nextShotAt = 0;
  private targetId: number | null = null;
  private shieldContact = new Map<number, number>();
  constructor(readonly definition: WeaponDefinition, readonly mode: ArenaMode) {
    this.world.timestep = 1 / 60;
    const pin = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(this.mount.x, this.mount.y));
    const description = definition.motion === "static" ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic().setGravityScale(0).setAngularDamping(0.15).setCcdEnabled(true);
    this.body = this.world.createRigidBody(description.setTranslation(this.mount.x, this.mount.y));
    for (const shape of definition.colliders) {
      let desc: RAPIER.ColliderDesc | null;
      if (shape.shape === "ball") desc = RAPIER.ColliderDesc.ball(shape.radius);
      else if (shape.shape === "capsule") desc = RAPIER.ColliderDesc.capsule(shape.halfLength, shape.radius);
      else desc = RAPIER.ColliderDesc.convexHull(new Float32Array(shape.vertices.flat()));
      if (!desc) throw new Error("invalid_collider");
      const collider = this.world.createCollider(desc.setTranslation(shape.center[0], shape.center[1])
        .setRotation(shape.rotation).setDensity(0).setFriction(0.1).setCollisionGroups(groups.weapon)
        .setSensor(!!definition.launcher && shape.type !== "shield")
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), this.body);
      this.weaponParts.set(collider.handle, shape);
    }
    if (definition.motion !== "static") {
      this.body.setAdditionalMassProperties(definition.mass, { x: definition.centerOfMass[0], y: definition.centerOfMass[1] }, definition.inertia, true);
      this.world.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0 }, { x: 0, y: 0 }), pin, this.body, true);
    }
  }
  start() { this.stats.phase = "running"; }
  private spawn() {
    const heavy = this.mode === "defense" && this.stats.wave === 2;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(12.6, 4.45).setCcdEnabled(true).setLinearDamping(0.2).lockRotations());
    const collider = this.world.createCollider(RAPIER.ColliderDesc.ball(heavy ? 0.34 : 0.23).setDensity(heavy ? 14 : 5).setFriction(0.2).setRestitution(0.1).setCollisionGroups(groups.enemy).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    this.enemies.set(collider.handle, { id: this.nextId++, body, collider, hp: heavy ? 80 : 35, maxHP: heavy ? 80 : 35, heavy, stunUntil: 0, lastHit: -60 });
    this.stats.spawned++;
  }
  muzzlePosition() {
    const muzzle = this.definition.launcher?.muzzle ?? [0, 0];
    const cosine = Math.cos(this.angle), sine = Math.sin(this.angle);
    return { x: this.mount.x + muzzle[0]! * cosine - muzzle[1]! * sine,
      y: this.mount.y + muzzle[0]! * sine + muzzle[1]! * cosine };
  }
  private aim() {
    const launcher = this.definition.launcher;
    if (!launcher) return null;
    const muzzle = this.muzzlePosition();
    const cosine = Math.cos(launcher.heading), sine = Math.sin(launcher.heading);
    const along = launcher.muzzle[0] * cosine + launcher.muzzle[1] * sine;
    const lateral = -launcher.muzzle[0] * sine + launcher.muzzle[1] * cosine;
    const lane = (p: { x: number; y: number }) => {
      const dx = p.x - this.mount.x, dy = p.y - this.mount.y;
      const squared = dx * dx + dy * dy - lateral * lateral;
      if (squared <= 0) return null;
      const forward = Math.sqrt(squared), travel = forward - along;
      return { travel, heading: Math.atan2(dy, dx) - launcher.heading - Math.atan2(lateral, forward) };
    };
    const valid = (enemy: Enemy) => {
      const p = enemy.body.translation(), shot = lane(p);
      return enemy.hp > 0 && p.x >= 1.6 && p.x <= 15 && shot !== null &&
        shot.travel > launcher.projectileRadius + 0.04 && shot.travel <= launcher.range;
    };
    const candidates = [...this.enemies.values()].filter(valid);
    const enemy = candidates.find(e => e.id === this.targetId) ?? candidates.sort((a, b) =>
      a.body.translation().x - b.body.translation().x || a.id - b.id)[0];
    this.targetId = enemy?.id ?? null;
    this.stats.targetId = this.targetId;
    if (!enemy) {
      this.stats.targetDistance = null; this.stats.aimError = null;
      return null;
    }
    const p = enemy.body.translation(), velocity = enemy.body.linvel();
    const distance = Math.hypot(p.x - muzzle.x, p.y - muzzle.y);
    // Bounded lead accounts for a muzzle offset from the pivot; rounds never home.
    let shot = lane(p)!;
    for (let i = 0; i < 2; i++) {
      const time = Math.max(0, Math.min(launcher.range / launcher.projectileSpeed, shot.travel / launcher.projectileSpeed));
      const predicted = lane({ x: p.x + velocity.x * time, y: p.y + velocity.y * time });
      if (predicted) shot = predicted;
    }
    const error = angleDifference(shot.heading - this.angle);
    this.stats.targetDistance = distance; this.stats.aimError = Math.abs(error);
    return error;
  }
  private updateCannon(fire: boolean) {
    const launcher = this.definition.launcher;
    if (!launcher) return;
    const error = this.aim();
    this.stats.reloadRemaining = Math.max(0, this.nextShotAt - this.stats.tick) / 60;
    this.stats.cannonState = error === null ? "idle" : this.stats.reloadRemaining > 0 ? "loading" : "tracking";
    if (!fire) {
      const effectiveInertia = this.definition.inertia + this.definition.mass * (this.definition.centerOfMass[0] ** 2 + this.definition.centerOfMass[1] ** 2);
      const desiredSpeed = error === null ? 0 : Math.sign(error) * Math.min(launcher.maxTurnSpeed,
        Math.sqrt(2 * launcher.maxTorque / effectiveInertia * Math.abs(error)));
      this.body.resetTorques(true);
      this.body.addTorque(Math.max(-launcher.maxTorque, Math.min(launcher.maxTorque, (desiredSpeed - this.body.angvel()) * 20)), true);
      return;
    }
    if (error === null || Math.abs(error) > launcher.aimTolerance || this.stats.reloadRemaining > 0 || this.stats.targetDistance! > launcher.range) return;
    if (this.projectiles.size >= PROJECTILE_LIMIT) { this.stats.cannonState = "limited"; return; }
    const muzzle = this.muzzlePosition(), heading = this.angle + launcher.heading;
    const ux = Math.cos(heading), uy = Math.sin(heading), offset = launcher.projectileRadius + 0.04;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(muzzle.x + ux * offset, muzzle.y + uy * offset)
      .setLinvel(ux * launcher.projectileSpeed, uy * launcher.projectileSpeed).setCcdEnabled(true).lockRotations());
    const collider = this.world.createCollider(RAPIER.ColliderDesc.ball(launcher.projectileRadius)
      .setDensity(3).setCollisionGroups(groups.projectile).setRestitution(0)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    this.projectiles.set(collider.handle, { body, collider, origin: muzzle, direction: { x: ux, y: uy },
      expiresAt: this.stats.tick + Math.ceil((launcher.range - offset) / launcher.projectileSpeed * 60) });
    this.nextShotAt = this.stats.tick + launcher.reloadTicks;
    this.stats.shots++; this.stats.reloadRemaining = launcher.reloadTicks / 60;
    this.stats.cannonState = "firing"; this.stats.feedback = "炮台正在自动追踪并开火。";
    this.lastShot = { ...muzzle, heading, tick: this.stats.tick };
  }
  private removeProjectile(handle: number) {
    const projectile = this.projectiles.get(handle);
    if (!projectile) return;
    this.world.removeRigidBody(projectile.body); this.projectiles.delete(handle);
  }
  private damageEnemy(enemy: Enemy, damage: number) {
    const applied = Math.min(enemy.hp, damage);
    enemy.hp = Math.max(0, enemy.hp - damage);
    this.stats.damage += applied; enemy.lastHit = this.stats.tick;
  }
  step() {
    if (this.stats.phase !== "running") return;
    this.stats.tick++;
    const tick = this.stats.tick;
    const waveStart = (this.stats.wave - 1) * WAVE_INTERVAL;
    if (tick >= waveStart + 20 && tick < waveStart + 560 && (tick - waveStart - 20) % 110 === 0) this.spawn();
    if (this.definition.launcher) this.updateCannon(false);
    else if (this.definition.motion !== "static") {
      this.body.resetTorques(true);
      const target = this.definition.motion === "rotating" ? 2.5 : 1.3 * Math.sin(tick / 85);
      const torque = Math.max(-12, Math.min(12, (target - this.body.angvel()) * 8));
      this.body.addTorque(torque, true);
    }
    for (const enemy of this.enemies.values()) {
      if (tick > enemy.stunUntil) {
        const velocity = enemy.body.linvel();
        const speed = enemy.heavy ? 0.9 : 1.45;
        enemy.body.applyImpulse({ x: Math.max(-0.12, Math.min(0.12, (-speed - velocity.x) * enemy.body.mass() * 0.08)),
          y: Math.max(-0.08, Math.min(0.08, (4.45 - enemy.body.translation().y) * 0.03 - velocity.y * 0.04)) }, true);
      }
    }
    this.previousAngle = this.angle;
    this.world.step(this.queue);
    this.angle = this.body.rotation();
    this.stats.angularSpeed = Math.abs(this.body.angvel());
    const contacts: Array<[number, number]> = [];
    this.queue.drainCollisionEvents((a, b, started) => {
      if (started) contacts.push([a, b]);
      else {
        const enemy = this.enemies.get(a) ?? this.enemies.get(b);
        const part = this.weaponParts.get(a) ?? this.weaponParts.get(b);
        if (enemy && part?.type === "shield") this.shieldContact.delete(enemy.collider.handle);
      }
    });
    contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [a, b] of contacts) {
      const enemy = this.enemies.get(a) ?? this.enemies.get(b);
      const projectile = this.projectiles.get(a) ?? this.projectiles.get(b);
      if (projectile && enemy) {
        if (enemy.hp > 0) {
          const launcher = this.definition.launcher!;
          this.damageEnemy(enemy, Math.max(1, Math.round(launcher.damage * (enemy.heavy ? 0.6 : 1))));
          enemy.stunUntil = tick + 20;
          const impulse = Math.min(3, launcher.projectileRadius * 12);
          enemy.body.applyImpulse({ x: projectile.direction.x * impulse, y: projectile.direction.y * impulse }, true);
          this.stats.projectileHits++; this.stats.hits++; this.stats.feedback = "炮弹命中了目标。";
        }
        this.removeProjectile(projectile.collider.handle); continue;
      }
      const part = this.weaponParts.get(a) ?? this.weaponParts.get(b);
      if (!part || !enemy || enemy.hp <= 0 || tick - enemy.lastHit < 35) continue;
      if (part.type === "shield") {
        this.shieldContact.set(enemy.collider.handle, tick); this.stats.blocked++;
        this.stats.feedback = "盾牌挡住了进攻。"; continue;
      }
      const position = enemy.body.translation();
      const speed = Math.abs(this.body.angvel()) * Math.hypot(position.x - this.mount.x, position.y - this.mount.y);
      const damage = hitDamage(part.type, this.definition.mass, speed, enemy.heavy ? 0.65 : 0);
      if (!damage) continue;
      this.damageEnemy(enemy, damage); enemy.stunUntil = tick + 45;
      enemy.body.applyImpulse({ x: Math.min(9, speed * 1.2), y: -Math.min(5, speed) }, true);
      this.stats.hits++; this.stats.feedback = part.type === "hammer" ? "咚！锤头打中了目标。" : "刀刃命中了目标。";
    }
    for (const [handle, enemy] of this.enemies) {
      const position = enemy.body.translation();
      if (this.shieldContact.has(handle) && tick % 90 === 0) {
        this.stats.shieldHP = Math.max(0, this.stats.shieldHP - (enemy.heavy ? 18 : 8));
        if (!this.stats.shieldHP) {
          for (const colliderHandle of this.weaponParts.keys()) {
            const collider = this.world.getCollider(colliderHandle);
            if (this.weaponParts.get(colliderHandle)?.type === "shield") collider.setSensor(true);
          }
          this.shieldContact.clear(); this.stats.feedback = "盾牌破了。加大覆盖，或试试主动攻击。";
        }
      }
      if (enemy.hp <= 0 || position.x > 15 || position.y > 9 || position.x < 1.6) {
        if (enemy.hp <= 0) this.stats.kills++;
        else if (position.x > 15) this.stats.knockouts++;
        else if (position.x < 1.6 && this.mode === "defense") this.stats.castleHP = Math.max(0, this.stats.castleHP - 12);
        this.shieldContact.delete(handle); this.world.removeRigidBody(enemy.body); this.enemies.delete(handle);
      }
    }
    for (const [handle, projectile] of this.projectiles) {
      const p = projectile.body.translation();
      if (tick >= projectile.expiresAt || Math.hypot(p.x - projectile.origin.x, p.y - projectile.origin.y) >= this.definition.launcher!.range ||
        p.x < -2 || p.x > 18 || p.y < -4 || p.y > 12) this.removeProjectile(handle);
    }
    this.updateCannon(true);
    this.stats.enemiesRemaining = this.enemies.size;
    if (this.mode === "defense" && tick >= this.stats.wave * WAVE_INTERVAL && this.stats.wave < DEFENSE_WAVES) this.stats.wave++;
    const cleared = this.stats.spawned === DEFENSE_WAVES * ENEMIES_PER_WAVE && !this.enemies.size;
    if ((this.mode === "practice" && tick >= 1200) || (this.mode === "defense" && (cleared || !this.stats.castleHP))) {
      if (this.mode === "defense") this.stats.outcome = this.stats.castleHP ? "victory" : "defeat";
      this.stats.phase = "finished"; this.stats.feedback = summary(this.stats, this.definition.motion, this.mode);
      for (const handle of this.projectiles.keys()) this.removeProjectile(handle);
    }
  }
  snapshot(): ArenaStats { return { ...this.stats }; }
  dispose() { this.queue.free(); this.world.free(); this.projectiles.clear(); this.enemies.clear(); this.weaponParts.clear(); }
}
