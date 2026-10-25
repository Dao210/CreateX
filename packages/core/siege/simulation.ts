import type { PartType } from "./schema";
export type ArenaMode = "practice" | "defense";
export const DEFENSE_WAVES = 3;
export const ENEMIES_PER_WAVE = 5;
export const WAVE_INTERVAL = 900;
export interface ArenaStats {
  tick: number; wave: number; hits: number; kills: number; knockouts: number; blocked: number;
  shots: number; projectileHits: number; damage: number; angularSpeed: number;
  targetId: number | null; targetDistance: number | null; aimError: number | null;
  reloadRemaining: number; cannonState: "idle" | "tracking" | "loading" | "firing" | "limited";
  castleHP: number; shieldHP: number; phase: "ready" | "running" | "finished";
  feedback: string;
  spawned: number; enemiesRemaining: number; outcome: "victory" | "defeat" | null;
}
export const initialStats = (): ArenaStats => ({
  tick: 0, wave: 1, hits: 0, kills: 0, knockouts: 0, blocked: 0, castleHP: 100, shieldHP: 100,
  shots: 0, projectileHits: 0, damage: 0, angularSpeed: 0,
  targetId: null, targetDistance: null, aimError: null, reloadRemaining: 0, cannonState: "idle",
  phase: "ready", feedback: "开始测试，看看你的设计如何工作。",
  spawned: 0, enemiesRemaining: 0, outcome: null,
});
export function hitDamage(type: PartType, mass: number, contactSpeed: number, armor: number): number {
  if ((type !== "blade" && type !== "hammer") || contactSpeed < 0.35) return 0;
  const energy = mass * contactSpeed * contactSpeed / 2;
  const raw = type === "hammer" ? 8 + Math.sqrt(energy) * 8 : 6 + contactSpeed * 8;
  return Math.max(1, Math.round(Math.min(65, raw) * (type === "hammer" ? 1 : 1 - armor)));
}
export function summary(stats: ArenaStats, motion: string, mode: ArenaMode = "practice"): string {
  if (mode === "defense" && !stats.castleHP) return "城堡失守了。调整攻击覆盖或防御位置，再试一次。";
  if (mode === "defense") return "守住三波了！调整设计，看看能否减少损伤。";
  if (motion === "static") return stats.blocked ? "盾挡住了进攻。试着改变覆盖面积。" : "这是被动防御，需要敌人碰到它。";
  if (motion === "tracking") {
    if (!stats.shots) return "没有开火。检查射程、炮口方向和追踪速度。";
    if (!stats.projectileHits) return "炮弹没有命中。试着提高弹速，或减轻炮台让它更快转向。";
    return "炮台完成了测试。比较命中率、实际伤害与装填时间，再调整炮管。";
  }
  if (!stats.hits) return "没有命中。调整转轴、长度或攻击方向，再试一次。";
  if (!stats.kills && !stats.knockouts) return "打中了，但冲击不足。试着减轻重量，或让锤头离转轴更远。";
  return "这个设计有效。改变长度和重量，比较下一次的结果。";
}
