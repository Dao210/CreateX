import type { TankDifficulty } from "./difficulty";
import type { TankPoint } from "./levels";

export type TankDirection = "up" | "right" | "down" | "left";
export type TankPhase = "ready" | "running" | "cleared" | "victory" | "defeat";
export type TankMode = "campaign" | "blitz" | "survival";
export type PickupKind = "star" | "shield" | "bomb" | "fortify";

export interface TankBlueprint {
  id: string; speed: number; armor: number; projectileSpeed: number; fireInterval: number; score: number; evolution?: number;
  appearance?: { body: string; accent: string; pattern: "solid" | "stripe" | "cross" };
}
export interface TankActor extends TankPoint {
  id: number; team: "player" | "enemy"; blueprint: TankBlueprint; direction: TankDirection;
  hp: number; reloadAt: number; invincibleUntil: number; thinkAt: number; moving: boolean; stunnedUntil: number; pulseHits: Record<number, number>;
}
export interface TankBullet extends TankPoint { id: number; owner: number; team: TankActor["team"]; direction: TankDirection; speed: number; power: number; alive: boolean }
export interface TankPickup extends TankPoint { id: number; kind: PickupKind; expire: number }
export interface TankEffect extends TankPoint { kind: "spark" | "explosion" | "blast" | "spawn" | "upgrade"; tick: number }
export type TankCue = "shot" | "hit" | "gold" | "upgrade" | "leak" | "victory" | "defeat";
export interface TankSnapshot {
  difficulty: TankDifficulty; maxLives: number; baseHP: number; maxBaseHP: number; playerHP: number; maxPlayerHP: number;
  mode: TankMode; wave: number; waveKills: number; waveTotal: number; intermission: number; timeLeft: number | null; combo: number; stunned: boolean;
  phase: TankPhase; paused: boolean; tick: number; score: number; lives: number; kills: number; total: number;
  remaining: number; activeEnemies: number; baseAlive: boolean; fortifyTicks: number; power: number; shield: boolean; respawning: boolean;
  playerPosition: TankPoint | null; shots: number; destroyedBricks: number; defeatReason: "base" | "lives" | "time" | null;
}
