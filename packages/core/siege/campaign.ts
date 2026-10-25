import { z } from "zod";
import { CannonDesignSchema, DrawingSchema, RULES_VERSION, WeaponSpecSchema, type CannonDesign } from "./schema";
import { compileWeapon, type WeaponDefinition } from "./compiler";
import { createCannonDrawing, createCannonSpec, DEFAULT_CANNON } from "./cannon";
import { SAMPLES, sampleSpec } from "./samples";

export const CAMPAIGN_VERSION = "woodland-1";
export const CAMPAIGN_WIDTH = 24;
export const CAMPAIGN_HEIGHT = 14;
export const WeaponKindSchema = z.enum(["cannon", "frost", "blade", "hammer", "burst"]);
export type WeaponKind = z.infer<typeof WeaponKindSchema>;
export type EnemyKind = "scout" | "runner" | "armor" | "swarm" | "banner" | "boss";
export interface Position { x: number; y: number }
export interface WeaponRecipe { name: string; tag: string; detail: string; color: string; baseCost: number; unlock: number }
export const WEAPON_RECIPES: Record<WeaponKind, WeaponRecipe> = {
  cannon: { name: "林地火炮", tag: "单体 · 远程", detail: "稳定输出；长炮管更远，转向更慢。", color: "#496b4b", baseCost: 100, unlock: 1 },
  frost: { name: "霜露炮", tag: "减速 · 控制", detail: "减速不叠加，配合其他武器。", color: "#5594a0", baseCost: 115, unlock: 3 },
  blade: { name: "旋转刃", tag: "近战 · 群攻", detail: "覆盖弯道；对重甲效果较弱。", color: "#938259", baseCost: 110, unlock: 4 },
  hammer: { name: "重锤", tag: "破甲 · 击退", detail: "冲击重甲；需要靠近道路。", color: "#ae7852", baseCost: 135, unlock: 5 },
  burst: { name: "松果爆破炮", tag: "溅射 · 清障", detail: "范围伤害；装填更慢。", color: "#c5763c", baseCost: 145, unlock: 7 },
};
export const ENEMY_RECIPES: Record<EnemyKind, { name: string; hp: number; speed: number; reward: number; leak: number; armor: number; radius: number; detail: string }> = {
  scout: { name: "林地小兵", hp: 30, speed: 1.3, reward: 12, leak: 10, armor: 0, radius: 0.25, detail: "普通步兵，留意道路末端。" },
  runner: { name: "疾跑兵", hp: 24, speed: 2.3, reward: 14, leak: 10, armor: 0, radius: 0.21, detail: "速度快，短炮管与减速更合适。" },
  armor: { name: "重甲兵", hp: 72, speed: 0.9, reward: 23, leak: 15, armor: 0.6, radius: 0.34, detail: "远程伤害减弱；重锤可以破甲。" },
  swarm: { name: "小群怪", hp: 15, speed: 1.65, reward: 7, leak: 5, armor: 0, radius: 0.18, detail: "数量密集，适合溅射与旋转刃。" },
  banner: { name: "护旗手", hp: 62, speed: 1.05, reward: 26, leak: 15, armor: 0.15, radius: 0.29, detail: "周围 3 米内的同伴加速；可优先集火。" },
  boss: { name: "林地巨兽", hp: 900, speed: 0.65, reward: 100, leak: 100, armor: 0.3, radius: 0.6, detail: "半血召援军；减速和击退效果减半。" },
};
export const CampaignBlueprintSchema = z.object({
  name: z.string().max(80), drawing: DrawingSchema, spec: WeaponSpecSchema,
  cannonDesign: CannonDesignSchema.nullable(), rulesVersion: z.literal(RULES_VERSION),
});
export type CampaignBlueprint = z.infer<typeof CampaignBlueprintSchema>;
export const CampaignLoadoutSchema = z.object({ version: z.literal(1), blueprints: z.record(WeaponKindSchema, CampaignBlueprintSchema) });
export interface CompiledCampaignWeapon { blueprint: CampaignBlueprint; definition: WeaponDefinition; kind: WeaponKind; cost: number; range: number }

export function compileCampaignWeapon(kind: WeaponKind, input: CampaignBlueprint): CompiledCampaignWeapon {
  const blueprint = CampaignBlueprintSchema.parse(input);
  const definition = compileWeapon(blueprint.drawing, blueprint.spec, blueprint.spec.drawingHash, blueprint.cannonDesign);
  if (definition.reach > 5 || definition.ink > 100) throw new Error("武器超过阵位尺寸或材料预算，请在工坊缩小。 ");
  if (["cannon", "frost", "burst"].includes(kind) !== !!definition.launcher) throw new Error("这个蓝图不支持所选武器类别。");
  if (kind === "blade" && !blueprint.spec.parts.some(p => p.type === "blade")) throw new Error("旋转刃需要刀刃部件。");
  if (kind === "hammer" && !blueprint.spec.parts.some(p => p.type === "hammer")) throw new Error("重锤需要锤头部件。");
  if (kind === "blade" && blueprint.spec.parts.some(p => p.type === "hammer") || kind === "hammer" && blueprint.spec.parts.some(p => p.type === "blade")) throw new Error("战役蓝图每座使用一种近战类别，请拆分刀刃和锤头。");
  if (blueprint.spec.parts.some(p => p.type === "shield")) throw new Error("盾牌暂用于工坊测试，请选火炮、刀刃或重锤。");
  const range = definition.launcher?.range ?? definition.reach;
  const cost = Math.max(50, Math.ceil((WEAPON_RECIPES[kind].baseCost + definition.ink * 0.8 + range * 2 - 55) / 5) * 5);
  return { kind, blueprint, definition, cost, range };
}
export function presetBlueprint(kind: WeaponKind, design: CannonDesign = DEFAULT_CANNON): CampaignBlueprint {
  const hash = "0".repeat(64);
  if (!["blade", "hammer"].includes(kind)) {
    const drawing = createCannonDrawing(design);
    return { name: WEAPON_RECIPES[kind].name, drawing, spec: createCannonSpec(drawing, hash), cannonDesign: design, rulesVersion: RULES_VERSION };
  }
  const source = kind === "hammer" ? SAMPLES[0]! : { ...SAMPLES[1]!, drawing: { ...SAMPLES[1]!.drawing, strokes: [SAMPLES[0]!.drawing.strokes[0]!, ...SAMPLES[1]!.drawing.strokes] }, types: ["wheel", "structure", "blade"] as const };
  const spec = sampleSpec({ ...source, types: [...source.types] }, hash);
  return { name: WEAPON_RECIPES[kind].name, drawing: source.drawing, spec, cannonDesign: null, rulesVersion: RULES_VERSION };
}
export const upgradePrice = (base: number, level: number) => Math.ceil(base * (level === 1 ? 0.7 : 1.1));
export const damageMultiplier = (level: number) => [1, 1.45, 2.05][level - 1] ?? 1;
export const investedGold = (base: number, level: number) => base + (level > 1 ? upgradePrice(base, 1) : 0) + (level > 2 ? upgradePrice(base, 2) : 0);
export const sellPrice = (base: number, level: number) => Math.floor(investedGold(base, level) * 0.7);
export interface CampaignObstacle extends Position { id: string; kind: "crate" | "stump" | "chest"; hp: number; reward: number; slot: number | null }
export interface SpawnEntry { kind: EnemyKind; route: number; tick: number }
export interface CampaignLevel {
  id: number; name: string; note: string; lesson: string; gold: number;
  routes: Position[][]; slots: Position[]; obstacles: CampaignObstacle[]; weapons: WeaponKind[]; waves: SpawnEntry[][];
}
const points = (values: number[][]): Position[] => values.map(([x, y]) => ({ x: x!, y: y! }));
const maps: Array<{ routes: number[][][]; slots: number[][] }> = [
  { routes: [[[0, 7], [24, 7]]], slots: [[4, 4.6], [8, 9.4], [12, 4.6], [16, 9.4], [20, 4.6], [21, 10.6]] },
  { routes: [[[0, 3], [8, 3], [8, 10], [18, 10], [18, 7], [24, 7]]], slots: [[4, 5.3], [10.3, 5.7], [5.7, 9], [12.3, 7.5], [15, 12.2], [20.4, 9.5], [20.4, 4.5]] },
  { routes: [[[0, 10], [6, 10], [6, 4], [17, 4], [17, 8], [24, 8]]], slots: [[3, 7.5], [8.5, 7], [10, 1.8], [14, 6.4], [19.4, 5.4], [20.5, 10.6]] },
  { routes: [[[0, 3], [20, 3], [20, 10], [4, 10], [4, 6.5], [14, 6.5], [14, 8.5], [24, 8.5]]], slots: [[3, 1], [8, 4.8], [13, 4.8], [17.5, 7], [7, 8], [11, 12], [22, 5], [20, 12]] },
  { routes: [[[0, 7], [6, 7], [6, 3], [17, 3], [17, 10], [24, 10]]], slots: [[3, 4.6], [8.4, 6], [11.5, 5.3], [14.7, 7.6], [19.5, 5.5], [20.5, 12.3], [21, 7.6]] },
  { routes: [[[0, 3], [10, 3], [10, 7], [24, 7]], [[0, 11], [10, 11], [10, 7], [24, 7]]], slots: [[4, 5.3], [4, 8.7], [8, 5.3], [8, 8.7], [13, 4.7], [13, 9.3], [18, 4.7], [20, 9.3]] },
  { routes: [[[0, 3], [18, 3], [18, 10], [7, 10], [7, 7], [24, 7]]], slots: [[4, 5.3], [10, 5.2], [15.5, 5.2], [20.5, 4.8], [20.4, 9.5], [13, 8.5], [4.7, 9.3], [11, 12.2]] },
  { routes: [[[0, 2.8], [16, 2.8], [16, 7], [24, 7]], [[0, 11.2], [7, 11.2], [7, 7], [24, 7]]], slots: [[3, 5], [5, 8.6], [9.5, 5.2], [11, 9.4], [14, 5], [18.4, 4.4], [18.4, 9.4], [21.7, 10.5]] },
];
const names = ["第一座炮台", "箱子后面", "跑得太快", "一处两用", "铁甲来袭", "两头夹击", "贪一点还是稳一点", "林地守门战"];
const lessons = ["点一个阵位，建造火炮，再开始进攻。", "点击木箱集火。清障赚金币，也会暂时分走火力。", "疾跑兵接近了。试试霜露炮，或缩短炮管。", "道路绕回来时，同一个位置可以打两次。", "重甲兵不怕轻弹。把重锤放在道路旁。", "看清下一波的入口，把金币分给两条路。", "先打护旗手，还是先开宝箱？留意最后一波。", "巨兽半血会召来援军。留一笔钱给最后的防线。"];
export const CAMPAIGN_LEVELS: CampaignLevel[] = maps.map((map, index) => {
  const id = index + 1, slots = points(map.slots), routes = map.routes.map(points);
  const weapons = (Object.keys(WEAPON_RECIPES) as WeaponKind[]).filter(k => WEAPON_RECIPES[k].unlock <= id);
  const obstacles: CampaignObstacle[] = id === 1 ? [] : slots.slice(-Math.min(3, id - 1)).map((p, n) => ({
    ...p, id: `obstacle-${n}`, kind: n === 2 ? "chest" : n === 1 ? "stump" : "crate",
    slot: slots.length - Math.min(3, id - 1) + n, hp: n === 2 ? 170 : n === 1 ? 90 : 55, reward: n === 2 ? 95 : n === 1 ? 50 : 35,
  }));
  const waves: SpawnEntry[][] = Array.from({ length: id === 1 ? 5 : id < 5 ? 6 : 8 }, (_, wave) => {
    const count = id === 1 ? 5 + wave : 7 + wave + Math.floor(id / 3);
    const entries: SpawnEntry[] = Array.from({ length: count }, (_, n) => {
      let kind: EnemyKind = "scout";
      if (id >= 3 && wave >= 1 && n % 3 === 0) kind = "runner";
      if (id >= 4 && wave % 2 === 1 && n % 2 === 0) kind = "swarm";
      if (id >= 5 && wave >= 2 && n % 4 === 1) kind = "armor";
      if (id >= 7 && wave >= 3 && n === 2) kind = "banner";
      return { kind, route: routes.length > 1 ? (n + wave) % routes.length : 0, tick: 30 + n * (kind === "swarm" ? 35 : 85) };
    });
    entries.sort((a, b) => a.tick - b.tick);
    if (id === 8 && wave === 7) entries.unshift({ kind: "boss", route: 0, tick: 1 });
    return entries;
  });
  return { id, name: names[index]!, note: ["初次布防", "清障与投资", "追踪与控制", "重复覆盖", "武器克制", "分路防守", "投资时机", "组合考验"][index]!, lesson: lessons[index]!, gold: id === 1 ? 260 : 300 + index * 15, slots, routes, obstacles, weapons, waves };
});
export function routeLength(route: Position[]) {
  return route.slice(1).reduce((total, p, i) => total + Math.hypot(p.x - route[i]!.x, p.y - route[i]!.y), 0);
}
export function pointOnRoute(route: Position[], progress: number): Position {
  let remaining = Math.max(0, progress);
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!, b = route[i]!, length = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= length) return { x: a.x + (b.x - a.x) * remaining / length, y: a.y + (b.y - a.y) * remaining / length };
    remaining -= length;
  }
  return { ...route[route.length - 1]! };
}
const SavedTowerSchema = z.object({ id: z.number().int().positive(), slot: z.number().int().min(0).max(11), kind: WeaponKindSchema, level: z.number().int().min(1).max(3), blueprint: CampaignBlueprintSchema,
  damage: z.number().min(0).max(10000000), kills: z.number().int().min(0).max(10000), shots: z.number().int().min(0).max(100000), control: z.number().int().min(0).max(100000) });
export const CheckpointSchema = z.object({
  version: z.literal(CAMPAIGN_VERSION), levelId: z.number().int().min(1).max(8), completedWaves: z.number().int().min(0).max(8),
  gold: z.number().int().min(0).max(100000), hp: z.number().int().min(1).max(100), tick: z.number().int().min(0).max(10000000),
  towers: z.array(SavedTowerSchema).max(12), obstacles: z.array(z.object({ id: z.string(), hp: z.number().min(0).max(1000) })).max(12),
  kills: z.number().int().min(0).max(10000), leaks: z.array(z.object({ wave: z.number().int().min(1).max(8), kind: z.enum(["scout", "runner", "armor", "swarm", "banner", "boss"]), route: z.number().int().min(0).max(1) })).max(1000),
});
export type CampaignCheckpoint = z.infer<typeof CheckpointSchema>;
export function validCheckpoint(input: unknown): CampaignCheckpoint | null {
  const parsed = CheckpointSchema.safeParse(input);
  if (!parsed.success) return null;
  const value = parsed.data, level = CAMPAIGN_LEVELS[value.levelId - 1]!;
  if (value.completedWaves >= level.waves.length || new Set(value.towers.map(t => t.slot)).size !== value.towers.length || new Set(value.towers.map(t => t.id)).size !== value.towers.length) return null;
  if (value.obstacles.length !== level.obstacles.length || new Set(value.obstacles.map(o => o.id)).size !== value.obstacles.length) return null;
  if (value.obstacles.some(o => !level.obstacles.some(source => source.id === o.id && o.hp <= source.hp))) return null;
  try {
    for (const tower of value.towers) {
      if (!level.slots[tower.slot] || !level.weapons.includes(tower.kind)) return null;
      if (level.obstacles.some(o => o.slot === tower.slot && (value.obstacles.find(v => v.id === o.id)?.hp ?? 1) > 0)) return null;
      compileCampaignWeapon(tower.kind, tower.blueprint);
    }
  } catch { return null; }
  return value;
}
export const CampaignProgressSchema = z.object({ version: z.literal(1), stars: z.array(z.number().int().min(0).max(3)).length(8), sound: z.boolean(), volume: z.number().min(0).max(1).default(0.5), speed: z.union([z.literal(1), z.literal(2)]).default(1), selectedLevel: z.number().int().min(1).max(8) });
export type CampaignProgress = z.infer<typeof CampaignProgressSchema>;
export const defaultProgress = (): CampaignProgress => ({ version: 1, stars: Array(8).fill(0), sound: true, volume: 0.5, speed: 1, selectedLevel: 1 });
export const unlockedLevel = (stars: number[]) => Math.min(8, stars.findIndex(n => n === 0) === -1 ? 8 : stars.findIndex(n => n === 0) + 1);
export const campaignStars = (hp: number, obstaclesRemaining: number) => hp <= 0 ? 0 : 1 + Number(hp === 100) + Number(obstaclesRemaining === 0);
