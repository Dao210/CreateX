import { newMatch, tickMatch } from "./engine.js";
import type { Frame, Match, Side, Strategy } from "./types";

export function frameOf(match: Match): Frame {
  return {
    tick: match.tick,
    time: match.time,
    result: match.result,
    units: match.units.map((u) => ({
      id: u.id,
      team: u.team,
      unitType: u.unitType,
      x: u.x,
      y: u.y,
      hp: u.hp,
      maxHp: u.maxHp,
      range: u.range,
      state: u.state,
      deathCount: u.deathCount,
      respawnRemaining: u.respawnRemaining,
      isFlagCarrier: u.isFlagCarrier,
      captureProgress: u.captureProgress,
      isCapturing: u.isCapturing,
      isAttacking: u.isAttacking,
    })),
    flags: structuredClone(match.flags),
    decisions: structuredClone(match.decisions),
    logs: match.logs.slice(-20),
  };
}

export function simulate(
  seed: number,
  strategies: Record<Side, Strategy>,
  onFrame?: (frame: Frame) => void,
) {
  const match = newMatch(seed, strategies);
  onFrame?.(frameOf(match));
  while (!match.result && match.tick < 1920) {
    tickMatch(match, { headless: true });
    if (match.tick % 4 === 0 || match.result) onFrame?.(frameOf(match));
  }
  if (!match.result) throw new Error("incomplete_match");
  return { result: match.result, ticks: match.tick, duration: match.time };
}
