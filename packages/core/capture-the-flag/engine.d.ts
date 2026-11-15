import type { Match, Side, Strategy, UnitType } from "./types";
export function newMatch(
  seed?: number,
  strategies?: Record<Side, Strategy>,
): Match;
export function tickMatch(match: Match, options?: { headless?: boolean }): void;
export function makeBaselineStrategy(
  id: string,
  name: string,
  side: Side,
): Strategy;
export const FORMAT_VERSION: "1.0";
export const GAME_VERSION: "12-rts-1.0";
export const TICK_SECONDS: 0.25;
export const UNIT_STATS: Record<
  UnitType,
  {
    maxHp: number;
    damage: number;
    speed: number;
    range: number;
    moveAttack: boolean;
  }
>;
export const FLAG_ANCHORS: Record<Side, { x: number; y: number }>;
export const MAP_W: 100;
export const MAP_H: 50;
export const BASE_W: 15;
export const BASE_SPAWN_AREAS: Readonly<
  Record<
    Side,
    Readonly<{
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
    }>
  >
>;
