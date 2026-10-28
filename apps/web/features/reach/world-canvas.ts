import { WORLD_HEIGHT, WORLD_WIDTH, type WorldSnapshot } from "./types";
import { CONTOURS, creationParts, LAND_FORMS, ROCKS, riftPath, WORLD_INK } from "./world-art";
import { worldView, type WorldPoint } from "./world-presentation";

const paths = new Map<string, Path2D>();
function inkPath(ctx: CanvasRenderingContext2D, d: string, fill?: string, stroke?: string) {
  let path = paths.get(d);
  if (!path) {
    // Rift coordinates and observed trails change over time; bound the cache.
    if (paths.size >= 256) paths.clear();
    path = new Path2D(d); paths.set(d, path);
  }
  if (fill) { ctx.fillStyle = fill; ctx.fill(path); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(path); }
}

/** Render once per snapshot/view; animation composites this cached scene. */
export function drawWorldScene(ctx: CanvasRenderingContext2D, width: number, height: number, snapshot: WorldSnapshot, focus?: WorldPoint, selectedId?: string, trail: WorldPoint[] = []) {
  const view = worldView(width, height, focus);
  ctx.fillStyle = WORLD_INK.ground;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.translate(view.offsetX, view.offsetY);
  ctx.scale(view.scale, view.scale);
  ctx.lineWidth = 1.6;
  for (const land of LAND_FORMS) inkPath(ctx, land.d, land.fill);
  ctx.globalAlpha = 0.45;
  for (const line of CONTOURS) inkPath(ctx, line, undefined, WORLD_INK.line);
  ctx.globalAlpha = 0.7;
  for (const rock of ROCKS) {
    inkPath(ctx, `M${rock.x} ${rock.y}l${rock.size} ${-rock.size * 1.4} ${rock.size * 1.1}m-${rock.size * 1.8} ${rock.size * 0.4}h${rock.size * 3}`, undefined, WORLD_INK.line);
  }
  // Belt-only events identify an area, not a fabricated exact coordinate.
  if (focus && !selectedId) {
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = WORLD_INK.accent;
    ctx.fillRect(Math.floor(focus.x / (WORLD_WIDTH / 3)) * WORLD_WIDTH / 3, 0, WORLD_WIDTH / 3, WORLD_HEIGHT);
  }
  ctx.globalAlpha = 1;
  for (const rift of snapshot.rifts) {
    ctx.lineWidth = 19;
    inkPath(ctx, riftPath(rift), undefined, WORLD_INK.shadow);
    ctx.lineWidth = 2.2;
    inkPath(ctx, riftPath(rift), undefined, WORLD_INK.accent);
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 42;
    inkPath(ctx, riftPath(rift), undefined, WORLD_INK.accent);
    ctx.globalAlpha = 1;
  }
  ctx.font = "24px ui-serif, Georgia, serif";
  ctx.fillStyle = WORLD_INK.muted;
  ctx.globalAlpha = 0.65;
  for (let i = 0; i < 3; i++) ctx.fillText(["Ⅰ", "Ⅱ", "Ⅲ"][i]!, WORLD_WIDTH * (i + 0.5) / 3, 70);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  for (const supply of snapshot.supplies) {
    ctx.save();
    ctx.translate(supply.x, supply.y);
    ctx.globalAlpha = 0.35 + Math.max(0, Math.min(100, supply.charge)) / 180;
    inkPath(ctx, "M-18 10l17-10 18 10-17 10ZM-12 5v-24l12-9 12 9V6M0-28v-15m-8 4H8", WORLD_INK.shadow, WORLD_INK.supply);
    inkPath(ctx, "M-4-18H4v14H-4Z", WORLD_INK.supply);
    ctx.restore();
  }
  for (const wreck of snapshot.wrecks) {
    ctx.globalAlpha = wreck.claimed ? 0.4 : 0.8;
    ctx.save();
    ctx.translate(wreck.x, wreck.y);
    inkPath(ctx, "M-15 2l8-9 6 11 12-6 5 7m-30 3 11 3 8-4 14 3", undefined, WORLD_INK.muted);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  if (trail.length > 1) {
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 9]);
    inkPath(ctx, trail.map((point, i) => `${i ? "L" : "M"}${point.x} ${point.y}`).join(" "), undefined, WORLD_INK.accent);
    ctx.setLineDash([]);
  }
  const entities = [...snapshot.entities].sort((a, b) => a.y - b.y);
  const fallen = entities.find((entity) => entity.id === selectedId && entity.status === "dead");
  if (fallen) {
    ctx.strokeStyle = WORLD_INK.accent;
    ctx.beginPath();
    ctx.ellipse(fallen.x, fallen.y, 40, 18, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const entity of entities) {
    if (entity.status !== "alive") continue;
    const px = entity.x * view.scale + view.offsetX;
    const py = entity.y * view.scale + view.offsetY;
    if (px < -60 || px > width + 60 || py < -80 || py > height + 60) continue;
    ctx.save();
    ctx.translate(entity.x, entity.y);
    const selected = selectedId === entity.id;
    ctx.globalAlpha = selectedId && !selected ? 0.72 : 1;
    ctx.fillStyle = WORLD_INK.shadow;
    ctx.beginPath();
    ctx.ellipse(0, 26, 25, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    if (selected) {
      ctx.strokeStyle = WORLD_INK.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 25, 40, 18, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.scale(0.75, 0.75);
    ctx.lineWidth = 1.8;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const part of creationParts(entity)) inkPath(ctx, part.d, part.fill === "none" ? undefined : part.fill, part.stroke);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.strokeStyle = "rgba(228,221,201,0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(view.offsetX, view.offsetY, WORLD_WIDTH * view.scale, WORLD_HEIGHT * view.scale);
}
