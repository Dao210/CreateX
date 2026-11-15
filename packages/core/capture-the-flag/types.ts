export type Side = "red" | "blue";
export type UnitType = "heavy_infantry" | "cavalry" | "archer";
export type Condition = {
  all?: Condition[];
  any?: Condition[];
  not?: Condition;
  source?: string;
  operator?: string;
  value?: string | number | boolean;
};
export interface Intent {
  type: string;
  target?: string;
  coordinate?: { x: number; y: number };
  route?: string;
  lane_offset?: number;
  distance?: number;
  radius?: number;
  flag?: string;
}
export interface Strategy {
  format_version: "1.0";
  game_version: "12-rts-1.0";
  enhancement_mode?: "standard" | UnitType;
  team: { team_id: string; team_name: string };
  strategies: Record<
    UnitType,
    {
      rules: {
        id: string;
        name: string;
        enabled?: boolean;
        priority: number;
        condition: Condition;
        movement: Intent;
        attack: Intent;
        special: Intent;
      }[];
    }
  >;
}
export interface Unit {
  id: string;
  team: Side;
  unitType: UnitType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  range: number;
  state: string;
  deathCount: number;
  respawnRemaining: number;
  isFlagCarrier: boolean;
  captureProgress: number;
  isCapturing: boolean;
  isAttacking: boolean;
}
export interface Flag {
  team: Side;
  x: number;
  y: number;
  state: string;
  carrierId: string | null;
}
export interface Result {
  winner: Side | "draw" | "unknown";
  method: string;
  text: string;
}
export interface Frame {
  tick: number;
  time: number;
  units: Unit[];
  flags: Record<Side, Flag>;
  result: Result | null;
  decisions: Record<string, unknown>;
  logs: string[];
}
export interface Match extends Frame {
  seed: number;
  status: string;
}
