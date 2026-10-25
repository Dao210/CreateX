import type { TankDirection } from "./types";

export const TANK_CELL = 20;
export const TANK_GRID = 26;
export const TANK_WORLD = TANK_CELL * TANK_GRID;
export type Terrain = "floor" | "brick" | "steel" | "water" | "forest" | "ice";
export type EnemyModel = "scout" | "runner" | "armor";
export interface TankPoint { x: number; y: number }
export type TankMechanism = TankPoint & (
  | { kind: "barrel" }
  | { kind: "repair" }
  | { kind: "conveyor"; width: number; height: number; direction: TankDirection }
  | { kind: "pulse"; width: number; height: number; offset: number }
);
export interface TankLevel {
  id: number;
  key: "frontline" | "river" | "steel" | "depot" | "circuit" | "citadel";
  terrain: Terrain[];
  mechanisms: TankMechanism[];
  enemies: EnemyModel[];
  maxActive: number;
  spawnInterval: number;
  deploymentDelay: number;
  playerSpawn: TankPoint;
  enemySpawns: TankPoint[];
}
const symbols: Record<string, Terrain> = { ".": "floor", B: "brick", S: "steel", W: "water", F: "forest", I: "ice" };
const layouts = [
  [".............", ".BB.BB.BB.BB.", ".BB.BB.BB.BB.", ".BB.BB.SS.BB.", ".............", ".SS.BB.BB.SS.", "....F...F....", ".BB.BB.BB.BB.", ".BB.......BB.", "....SS.SS....", ".BB.BB.BB.BB.", ".BB.......BB.", "............."],
  [".............", ".BB.SS.SS.BB.", ".BB.......BB.", "....WW.WW....", ".SS.WW.WW.SS.", ".............", "III.BB.BB.III", "III.......III", ".BB.FF.FF.BB.", ".BB.......BB.", "....BB.BB....", ".SS.......SS.", "............."],
  [".............", ".SS.BB.BB.SS.", ".SS.......SS.", "....SS.SS....", ".BB.BB.BB.BB.", ".............", "FFS.BB.BB.SFF", "FFS.......SFF", ".BB.SS.SS.BB.", ".BB.......BB.", "....BB.BB....", ".BB.......BB.", "............."],
  [".............", ".BB.SS.SS.BB.", ".............", ".BB.BB.BB.BB.", ".............", ".SS.......SS.", "....BB.BB....", ".BB.......BB.", ".............", ".SS.BB.BB.SS.", ".............", ".BB.......BB.", "............."],
  [".............", ".SS.BB.BB.SS.", ".............", ".WW.......WW.", ".WW.SS.SS.WW.", ".............", ".BB.......BB.", "....SS.SS....", ".............", ".SS.BB.BB.SS.", ".............", ".BB.......BB.", "............."],
  [".............", ".SS.......SS.", "....BB.BB....", ".BB.WW.WW.BB.", "....WW.WW....", ".............", ".FF.SS.SS.FF.", ".FF.......FF.", "....BB.BB....", ".SS.......SS.", "....BB.BB....", ".BB.......BB.", "............."],
];
const mechanisms: TankMechanism[][] = [
  [{ kind: "barrel", x: 260, y: 180 }, { kind: "repair", x: 380, y: 460 }],
  [{ kind: "barrel", x: 140, y: 220 }, { kind: "barrel", x: 380, y: 220 }, { kind: "repair", x: 60, y: 420 }],
  [{ kind: "pulse", x: 200, y: 200, width: 120, height: 40, offset: 0 }, { kind: "barrel", x: 140, y: 300 }, { kind: "barrel", x: 380, y: 300 }, { kind: "repair", x: 380, y: 460 }],
  [{ kind: "conveyor", x: 40, y: 160, width: 440, height: 40, direction: "right" }, { kind: "conveyor", x: 40, y: 320, width: 440, height: 40, direction: "left" }, { kind: "barrel", x: 140, y: 100 }, { kind: "barrel", x: 180, y: 100 }, { kind: "barrel", x: 340, y: 300 }, { kind: "repair", x: 420, y: 420 }],
  [{ kind: "pulse", x: 120, y: 120, width: 280, height: 40, offset: 0 }, { kind: "pulse", x: 80, y: 320, width: 360, height: 40, offset: 180 }, { kind: "conveyor", x: 240, y: 200, width: 40, height: 120, direction: "down" }, { kind: "barrel", x: 60, y: 220 }, { kind: "repair", x: 420, y: 420 }],
  [{ kind: "pulse", x: 160, y: 200, width: 200, height: 40, offset: 0 }, { kind: "conveyor", x: 120, y: 280, width: 280, height: 40, direction: "left" }, { kind: "barrel", x: 140, y: 380 }, { kind: "barrel", x: 380, y: 380 }, { kind: "repair", x: 380, y: 460 }],
];
export const BASE_BOUNDS = { x: 240, y: 480, width: 40, height: 40 };
export const BASE_WALLS = [23 * 26 + 11, 23 * 26 + 12, 23 * 26 + 13, 23 * 26 + 14, 24 * 26 + 11, 24 * 26 + 14, 25 * 26 + 11, 25 * 26 + 14];
export const TANK_LEVELS: readonly TankLevel[] = layouts.map((rows, index) => {
  if (rows.length !== 13 || rows.some(row => row.length !== 13)) throw new Error("Invalid tank map dimensions");
  const terrain: Terrain[] = Array<Terrain>(TANK_GRID * TANK_GRID).fill("floor");
  rows.forEach((row, y) => [...row].forEach((symbol, x) => {
    const kind = symbols[symbol];
    if (!kind) throw new Error("Invalid tank map terrain");
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) terrain[(y * 2 + dy) * TANK_GRID + x * 2 + dx] = kind;
  }));
  for (const cell of BASE_WALLS) terrain[cell] = "brick";
  return {
    id: index + 1,
    key: (["frontline", "river", "steel", "depot", "circuit", "citadel"] as const)[index]!,
    terrain, mechanisms: mechanisms[index]!, maxActive: [3, 3, 4, 4, 4, 5][index]!, spawnInterval: 170 - index * 9, deploymentDelay: index < 2 ? 180 : 90,
    enemies: Array.from({ length: 10 + index * 2 }, (_, n): EnemyModel => index > 0 && n % 4 === 3 ? "armor" : n % 3 === 2 ? "runner" : "scout"),
    playerSpawn: { x: 180, y: 500 },
    enemySpawns: [{ x: 20, y: 20 }, { x: 260, y: 20 }, { x: 500, y: 20 }],
  };
});
