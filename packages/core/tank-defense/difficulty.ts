export type TankDifficulty = "casual" | "standard";

interface TankDifficultyRules {
  maxLives: number;
  playerArmorBonus: number;
  initialPower: number;
  baseHP: number;
  friendlyFire: boolean;
  enemySpeed: number;
  enemyProjectileSpeed: number;
  enemyFireInterval: number;
  reinforcementInterval: number;
  activeEnemyReduction: number;
  deploymentDelay: number;
  hitProtection: number;
  deathPowerLoss: number;
  supplyEvery: number;
}

/** Difficulty modifies the local battle, never the versioned character blueprint. */
export const TANK_DIFFICULTIES: Readonly<Record<TankDifficulty, Readonly<TankDifficultyRules>>> = {
  casual: Object.freeze({ maxLives: 5, playerArmorBonus: 1, initialPower: 1, baseHP: 3, friendlyFire: false, enemySpeed: 0.72, enemyProjectileSpeed: 0.75, enemyFireInterval: 1.6, reinforcementInterval: 1.5, activeEnemyReduction: 1, deploymentDelay: 1.5, hitProtection: 90, deathPowerLoss: 0, supplyEvery: 2 }),
  standard: Object.freeze({ maxLives: 3, playerArmorBonus: 0, initialPower: 0, baseHP: 1, friendlyFire: true, enemySpeed: 1, enemyProjectileSpeed: 1, enemyFireInterval: 1, reinforcementInterval: 1, activeEnemyReduction: 0, deploymentDelay: 1, hitProtection: 0, deathPowerLoss: 1, supplyEvery: 3 }),
};
