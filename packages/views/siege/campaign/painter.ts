import { CAMPAIGN_HEIGHT, CAMPAIGN_WIDTH, ENEMY_RECIPES, WEAPON_RECIPES, WORLD_SCALE } from "@auro/core/siege";
import { paintSprite, type ArenaArt } from "../arena/art";
import { drawStrokes } from "../editor/drawing-canvas";
import { paintCannon } from "../workshop/cannon-painter";
import type { CampaignEngine } from "./engine";

const landscapes = new WeakMap<CanvasRenderingContext2D, { canvas: OffscreenCanvas; level: CampaignEngine["level"]; art: ArenaArt | null }>();
function paintLandscape(ctx: OffscreenCanvasRenderingContext2D, engine: CampaignEngine, art: ArenaArt | null) {
  ctx.clearRect(0, 0, CAMPAIGN_WIDTH, CAMPAIGN_HEIGHT);
  ctx.fillStyle = "#dce2b8"; ctx.fillRect(0, 0, CAMPAIGN_WIDTH, CAMPAIGN_HEIGHT);
  // A quiet center keeps the authored routes legible over the woodland perimeter.
  if (art) {
    ctx.globalAlpha = 0.64; ctx.drawImage(art["woodland-battlefield"], 0, 0, 24, 14); ctx.globalAlpha = 1;
    const clearing = ctx.createRadialGradient(12, 7, 2, 12, 7, 14);
    clearing.addColorStop(0, "#e4e6bce8"); clearing.addColorStop(0.6, "#e4e6bcc9"); clearing.addColorStop(1, "#e4e6bc00");
    ctx.fillStyle = clearing; ctx.fillRect(0, 0, 24, 14);
    for (const [x, y] of [[2, 12.7], [10, 0.7], [22, 1.3]]) paintSprite(ctx, art.bush, x!, y!, 1.5);
    paintSprite(ctx, art.flowers, 15.2, 12.6, 0.8);
  }
  for (const route of engine.level.routes) {
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    const path = () => { ctx.beginPath(); route.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); };
    ctx.strokeStyle = "#8b977150"; ctx.lineWidth = 1.7; path(); ctx.stroke();
    ctx.strokeStyle = "#e7d5a7"; ctx.lineWidth = 1.35; path(); ctx.stroke();
    ctx.strokeStyle = "#b89f6b55"; ctx.lineWidth = 0.045; ctx.setLineDash([0.16, 0.3]); path(); ctx.stroke(); ctx.setLineDash([]);
    const entry = route[0]!;
    ctx.fillStyle = "#ba663f"; ctx.beginPath(); ctx.moveTo(entry.x + 0.3, entry.y - 0.23); ctx.lineTo(entry.x + 0.7, entry.y); ctx.lineTo(entry.x + 0.3, entry.y + 0.23); ctx.closePath(); ctx.fill();
  }
}

export function paintBattle(ctx: CanvasRenderingContext2D, engine: CampaignEngine, art: ArenaArt | null, selected: number | null, reducedMotion: boolean, preview: { range: number; color: string }) {
  const scale = ctx.canvas.width / CAMPAIGN_WIDTH;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  let cached = landscapes.get(ctx);
  if (!cached || cached.level !== engine.level || cached.art !== art || cached.canvas.width !== ctx.canvas.width || cached.canvas.height !== ctx.canvas.height) {
    const canvas = new OffscreenCanvas(ctx.canvas.width, ctx.canvas.height);
    const background = canvas.getContext("2d")!;
    background.setTransform(scale, 0, 0, scale, 0, 0);
    paintLandscape(background, engine, art);
    cached = { canvas, level: engine.level, art }; landscapes.set(ctx, cached);
  }
  ctx.drawImage(cached.canvas, 0, 0, CAMPAIGN_WIDTH, CAMPAIGN_HEIGHT);
  const endpoint = engine.level.routes[0]!.at(-1)!;
  if (art) paintSprite(ctx, art[engine.hp === 0 ? "castle-ruined" : engine.hp < 60 ? "castle-damaged" : "castle-intact"], endpoint.x - 0.6, endpoint.y, 2.6);
  if (selected !== null) {
    const tower = [...engine.towers.values()].find(t => t.slot === selected);
    if (engine.level.slots[selected]) {
      const p = engine.level.slots[selected]!;
      const color = tower ? WEAPON_RECIPES[tower.weapon.kind].color : preview.color;
      ctx.fillStyle = `${color}16`; ctx.strokeStyle = `${color}88`; ctx.lineWidth = 0.035;
      ctx.beginPath(); ctx.arc(p.x, p.y, tower?.weapon.range ?? preview.range, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
  for (const source of engine.level.obstacles) {
    const obstacle = engine.obstacles.get(source.id)!; if (obstacle.hp <= 0) continue;
    if (art) paintSprite(ctx, art[source.kind === "stump" ? "stump" : "crate"], source.x, source.y, source.kind === "chest" ? 1.5 : 1.25);
    else { ctx.fillStyle = "#936e42"; ctx.fillRect(source.x - 0.5, source.y - 0.5, 1, 1); }
    if (source.kind === "chest") { ctx.fillStyle = "#e0b548"; ctx.fillRect(source.x - 0.08, source.y - 0.45, 0.16, 0.9); }
    if (obstacle.hp < source.hp || engine.focus === `obstacle:${source.id}`) paintBar(ctx, source.x, source.y - 0.7, obstacle.hp / source.hp, "#c88d49");
  }
  for (const tower of engine.towers.values()) {
    const p = engine.level.slots[tower.slot]!;
    ctx.save(); ctx.translate(p.x, p.y);
    const age = engine.tick - tower.lastShot;
    if (tower.weapon.definition.cannonDesign) {
      paintCannon(ctx, tower.weapon.definition.cannonDesign, tower.body.rotation(), false, reducedMotion ? 0 : Math.max(0, 1 - age / 12));
      const color = WEAPON_RECIPES[tower.weapon.kind].color;
      ctx.fillStyle = color; ctx.strokeStyle = "#f3e6bc"; ctx.lineWidth = 0.04;
      ctx.beginPath(); ctx.arc(-0.3, 0.3, 0.19, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else {
      ctx.fillStyle = "#b7ab86"; ctx.beginPath(); ctx.arc(0, 0, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.rotate(tower.body.rotation()); ctx.scale(WORLD_SCALE, WORLD_SCALE); ctx.translate(-tower.weapon.definition.pivot[0], -tower.weapon.definition.pivot[1]);
      drawStrokes(ctx, tower.weapon.blueprint.drawing);
    }
    ctx.restore();
    ctx.fillStyle = "#faf1d6"; ctx.strokeStyle = "#40573b"; ctx.lineWidth = 0.035;
    ctx.beginPath(); ctx.arc(p.x - 0.42, p.y + 0.45, 0.23, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#334732"; ctx.font = "bold 0.25px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(tower.level), p.x - 0.42, p.y + 0.45);
    if (age < 5) { const muzzle = engine.muzzle(tower); ctx.fillStyle = "#ffde80"; ctx.beginPath(); ctx.arc(muzzle.x, muzzle.y, 0.28, 0, Math.PI * 2); ctx.fill(); }
  }
  for (const enemy of engine.enemies.values()) {
    const p = enemy.body.translation(), heavy = enemy.kind === "armor" || enemy.kind === "boss";
    const frame = reducedMotion ? 1 : Math.floor(engine.tick / 9) % 4 + 1;
    const size = enemy.kind === "boss" ? 2 : enemy.kind === "swarm" ? 0.65 : heavy ? 1.1 : 0.9;
    if (art) paintSprite(ctx, art[`${heavy ? "heavy" : "scout"}-${frame}` as "scout-1"], p.x, p.y, size);
    else { ctx.fillStyle = "#bb724b"; ctx.beginPath(); ctx.arc(p.x, p.y, ENEMY_RECIPES[enemy.kind].radius, 0, Math.PI * 2); ctx.fill(); }
    if (enemy.kind === "runner") { ctx.strokeStyle = "#b6683f"; ctx.lineWidth = 0.04; ctx.beginPath(); ctx.moveTo(p.x - 0.55, p.y); ctx.lineTo(p.x - 0.85, p.y); ctx.stroke(); }
    if (enemy.kind === "banner") {
      ctx.strokeStyle = "#a25134"; ctx.lineWidth = 0.045; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 0.9); ctx.stroke();
      ctx.fillStyle = "#d67b4a"; ctx.fillRect(p.x, p.y - 0.9, 0.45, 0.25);
      ctx.strokeStyle = "#c5794344"; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.stroke();
    }
    if (enemy.slowUntil > engine.tick) { ctx.strokeStyle = "#6caab8"; ctx.lineWidth = 0.06; ctx.beginPath(); ctx.ellipse(p.x, p.y + 0.15, size * 0.55, 0.24, 0, 0, Math.PI * 2); ctx.stroke(); }
    if (enemy.hp < enemy.maxHP || enemy.kind === "boss") paintBar(ctx, p.x, p.y - size / 2 - 0.15, enemy.hp / enemy.maxHP, enemy.kind === "boss" ? "#aa573f" : "#61764e");
    if (engine.focus === `enemy:${enemy.id}`) { ctx.strokeStyle = "#d86f3d"; ctx.lineWidth = 0.06; ctx.beginPath(); ctx.arc(p.x, p.y, size * 0.65, 0, Math.PI * 2); ctx.stroke(); }
  }
  for (const round of engine.rounds.values()) {
    const p = round.body.translation(); const kind = engine.towers.get(round.towerId)?.weapon.kind ?? "cannon";
    ctx.fillStyle = WEAPON_RECIPES[kind].color; ctx.beginPath(); ctx.arc(p.x, p.y, round.radius, 0, Math.PI * 2); ctx.fill();
  }
  for (const effect of engine.effects) {
    const age = engine.tick - effect.tick; if (age > 35 || age < 0) continue;
    ctx.save(); ctx.globalAlpha = 1 - age / 36;
    if (effect.kind === "burst") { ctx.strokeStyle = "#e49b50"; ctx.lineWidth = 0.13; ctx.beginPath(); ctx.arc(effect.x, effect.y, 0.3 + age / 30, 0, Math.PI * 2); ctx.stroke(); }
    else { ctx.fillStyle = effect.kind === "gold" ? "#7b6925" : effect.kind === "frost" ? "#3d8093" : "#874b31"; ctx.font = "bold 0.29px sans-serif"; ctx.textAlign = "center"; ctx.fillText(`${effect.kind === "gold" ? "+" : ""}${effect.value}`, effect.x, effect.y - 0.3 - (reducedMotion ? 0 : age / 40)); }
    ctx.restore();
  }
}
function paintBar(ctx: CanvasRenderingContext2D, x: number, y: number, ratio: number, color: string) {
  ctx.fillStyle = "#354d3a40"; ctx.fillRect(x - 0.4, y, 0.8, 0.07); ctx.fillStyle = color; ctx.fillRect(x - 0.4, y, 0.8 * ratio, 0.07);
}
