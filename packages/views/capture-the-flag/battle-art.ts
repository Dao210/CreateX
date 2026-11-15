import type { BattleEvent, Frame, Unit } from "@auro/core/capture-the-flag";
import { FLAG_ANCHORS } from "@auro/core/capture-the-flag";
import unitAtlas from "./assets/units.webp";

function assetUrl(asset: string | { src: string }) {
  return typeof asset === "string" ? asset : asset.src;
}
export const ATLAS_URL = assetUrl(unitAtlas);
export const FIELD_WIDTH = 1200;
export const FIELD_HEIGHT = 640;
const SCALE = 11.6;
const COLORS = { red: "#c85843", blue: "#3c78aa" };
export const fieldPoint = (x: number, y: number) => ({
  x: 20 + x * SCALE,
  y: 30 + y * SCALE,
});
export function unitAt(frame: Frame, x: number, y: number, selected?: string) {
  return frame.units
    .filter((u) => u.state === "ALIVE")
    .map((u) => ({
      unit: u,
      distance: Math.hypot(
        fieldPoint(u.x, u.y).x - x,
        fieldPoint(u.x, u.y).y - y,
      ),
    }))
    .filter((item) => item.distance < 40)
    .sort(
      (a, b) =>
        (a.unit.id === selected ? 1 : 0) - (b.unit.id === selected ? 1 : 0) ||
        a.distance - b.distance,
    )[0]?.unit.id;
}

export function drawBoard(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#746b4e";
  ctx.fillRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT);
  const ground = ctx.createLinearGradient(0, 30, 1200, 610);
  ground.addColorStop(0, "#84945b");
  ground.addColorStop(0.5, "#8b9c60");
  ground.addColorStop(1, "#74874e");
  ctx.fillStyle = ground;
  ctx.fillRect(20, 30, 1160, 580);
  let seed = 4281;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let n = 0; n < 6500; n++) {
    const x = 22 + random() * 1156,
      y = 32 + random() * 576;
    ctx.strokeStyle = n % 3 === 0 ? "#c1c68b32" : "#40563220";
    ctx.lineWidth = 0.6 + random();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + random() * 3 - 1.5, y - 1 - random() * 4);
    ctx.stroke();
  }
  for (const side of ["red", "blue"] as const) {
    const left = side === "red" ? 20 : 1006;
    const tint = ctx.createLinearGradient(left, 0, left + 174, 0);
    tint.addColorStop(
      side === "red" ? 0 : 1,
      side === "red" ? "#a8593b36" : "#3b7eac36",
    );
    tint.addColorStop(side === "red" ? 1 : 0, "#ffffff00");
    ctx.fillStyle = tint;
    ctx.fillRect(left, 30, 174, 580);
  }
  ctx.strokeStyle = "#eef0c31b";
  ctx.lineWidth = 1;
  for (let n = 0; n <= 100; n += 5) {
    const p = fieldPoint(n, 0);
    ctx.beginPath();
    ctx.moveTo(p.x, 30);
    ctx.lineTo(p.x, 610);
    ctx.stroke();
  }
  for (let n = 0; n <= 50; n += 5) {
    const p = fieldPoint(0, n);
    ctx.beginPath();
    ctx.moveTo(20, p.y);
    ctx.lineTo(1180, p.y);
    ctx.stroke();
  }
  ctx.setLineDash([4, 8]);
  ctx.strokeStyle = "#f5efc938";
  ctx.beginPath();
  ctx.moveTo(600, 30);
  ctx.lineTo(600, 610);
  ctx.stroke();
  ctx.setLineDash([]);
  const stone = (x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = ["#a19c83", "#aaa58b", "#8d8c74"][
      Math.floor(random() * 3)
    ]!;
    ctx.strokeStyle = "#524f3ba8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#dcd5ad80";
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 3);
    ctx.lineTo(x + w - 4, y + 3);
    ctx.stroke();
  };
  for (let x = 9; x < 1180; x += 35) {
    stone(x, 12, 33, 16);
    stone(x, 612, 33, 16);
  }
  for (let y = 30; y < 610; y += 32) {
    stone(4, y, 14, 30);
    stone(1182, y, 14, 30);
  }
  for (const side of ["red", "blue"] as const) {
    const p = fieldPoint(FLAG_ANCHORS[side].x, FLAG_ANCHORS[side].y);
    ctx.fillStyle = "#43513244";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 5, 26, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#aaa58b";
    ctx.strokeStyle = "#ded8b7";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 23, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = COLORS[side];
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 15, 10, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function flag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  side: "red" | "blue",
  time: number,
) {
  ctx.strokeStyle = "#4b3b26";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y + 2);
  ctx.lineTo(x, y - 45);
  ctx.stroke();
  ctx.fillStyle = "#ead4a0";
  ctx.beginPath();
  ctx.arc(x, y - 47, 3, 0, Math.PI * 2);
  ctx.fill();
  const wind = Math.sin(time * 3) * 2;
  ctx.fillStyle = COLORS[side];
  ctx.strokeStyle = "#f0dbb5b3";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 2, y - 43);
  ctx.bezierCurveTo(x + 12, y - 46, x + 20, y - 34 + wind, x + 31, y - 37);
  ctx.lineTo(x + 29, y - 17);
  ctx.bezierCurveTo(x + 17, y - 12 + wind, x + 12, y - 27, x + 2, y - 21);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function sprite(
  ctx: CanvasRenderingContext2D,
  atlas: HTMLImageElement,
  u: Unit,
  time: number,
  moving: boolean,
  facing: number,
  reduced: boolean,
  alpha = 1,
  recoil = 0,
) {
  if (!atlas.complete || !atlas.naturalWidth) return;
  const p = fieldPoint(u.x, u.y),
    size =
      u.unitType === "cavalry" ? 88 : u.unitType === "heavy_infantry" ? 72 : 76;
  const col =
    u.unitType === "heavy_infantry" ? 0 : u.unitType === "cavalry" ? 1 : 2;
  const bob =
    moving && !reduced
      ? Math.sin(time * (u.unitType === "cavalry" ? 15 : 12)) * 1.8
      : 0;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#263b3240";
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + 2, size * 0.21, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(p.x + facing * recoil, p.y + bob);
  ctx.scale(facing, 1);
  ctx.rotate(recoil / 80);
  ctx.drawImage(
    atlas,
    (col * atlas.naturalWidth) / 3,
    ((u.team === "red" ? 0 : 1) * atlas.naturalHeight) / 2,
    atlas.naturalWidth / 3,
    atlas.naturalHeight / 2,
    -size / 2,
    -size * 0.9,
    size,
    size,
  );
  ctx.restore();
}

function drawEvent(
  ctx: CanvasRenderingContext2D,
  event: BattleEvent,
  age: number,
  selected?: string,
  damage: number | null = event.damage ?? null,
) {
  if (age < 0 || age > 1) return;
  const p = fieldPoint(event.x, event.y),
    alpha = Math.max(0, 1 - age);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (
    event.kind === "attack" &&
    event.targetX !== undefined &&
    event.targetY !== undefined
  ) {
    const q = fieldPoint(event.targetX, event.targetY),
      phase = Math.min(1, age / 0.35);
    ctx.strokeStyle = "#f7e7bd";
    ctx.fillStyle = COLORS[event.team];
    ctx.lineWidth = 2;
    if (event.unitType === "archer") {
      const x = p.x + (q.x - p.x) * phase,
        y = p.y + (q.y - p.y) * phase - Math.sin(phase * Math.PI) * 9 - 20;
      const a = Math.atan2(q.y - p.y, q.x - p.x);
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(-13, 0);
      ctx.lineTo(5, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(1, -3);
      ctx.lineTo(1, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = alpha;
    } else {
      ctx.strokeStyle = "#f4e1b0";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(
        (p.x + q.x) / 2,
        (p.y + q.y) / 2 - 14,
        17,
        -0.8 + phase,
        1 + phase,
      );
      ctx.stroke();
    }
    if (damage !== null) {
      ctx.font = "600 15px sans-serif";
      ctx.textAlign = "center";
      ctx.strokeStyle = "#443c2b";
      ctx.lineWidth = 3;
      ctx.strokeText(`−${damage}`, q.x, q.y - 46 - age * 18);
      ctx.fillStyle = "#fff2d2";
      ctx.fillText(`−${damage}`, q.x, q.y - 46 - age * 18);
    }
  } else if (event.kind === "respawn" || event.kind === "flag") {
    ctx.strokeStyle = event.kind === "flag" ? "#f5d17e" : "#d6efc4";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 18 + age * 22, 9 + age * 12, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (event.kind === "death") {
    ctx.strokeStyle = COLORS[event.team];
    ctx.lineWidth = event.unitId === selected ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(p.x - 6, p.y - 8);
    ctx.lineTo(p.x + 6, p.y + 4);
    ctx.moveTo(p.x + 6, p.y - 8);
    ctx.lineTo(p.x - 6, p.y + 4);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawBattle(
  ctx: CanvasRenderingContext2D,
  atlas: HTMLImageElement,
  frame: Frame,
  previous: Frame,
  blend: number,
  time: number,
  selected: string | undefined,
  reduced: boolean,
  facing: Map<string, number>,
  targetId?: string,
) {
  const units = frame.units.map((u) => {
    const from = previous.units.find((p) => p.id === u.id);
    const moving =
      !!from &&
      from.state === u.state &&
      Math.hypot(from.x - u.x, from.y - u.y) > 0.01 &&
      Math.hypot(from.x - u.x, from.y - u.y) < 12;
    if (moving && Math.abs(u.x - from.x) > 0.01)
      facing.set(u.id, Math.sign(u.x - from.x));
    const attack = frame.events?.findLast(
      (event) =>
        event.kind === "attack" &&
        event.unitId === u.id &&
        event.time <= time &&
        time - event.time < 0.4,
    );
    if (
      attack?.targetX !== undefined &&
      Math.abs(attack.targetX - attack.x) > 0.01
    )
      facing.set(u.id, Math.sign(attack.targetX - attack.x));
    return {
      unit: moving
        ? {
            ...u,
            x: from.x + (u.x - from.x) * blend,
            y: from.y + (u.y - from.y) * blend,
          }
        : u,
      moving: moving && blend < 1,
    };
  });
  const chosen = units.find((item) => item.unit.id === selected)?.unit;
  if (chosen?.state === "ALIVE") {
    const p = fieldPoint(chosen.x, chosen.y);
    ctx.fillStyle = COLORS[chosen.team] + "0b";
    ctx.strokeStyle = "#e8e6bf55";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, chosen.range * SCALE, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const target = units.find(
      (item) => item.unit.id === targetId && item.unit.state === "ALIVE",
    )?.unit;
    if (target) {
      const q = fieldPoint(target.x, target.y);
      ctx.strokeStyle = "#f4d89680";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 7]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#f3d595";
      ctx.beginPath();
      ctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const side of ["red", "blue"] as const) {
    const f = frame.flags[side];
    if (f.state !== "CARRIED") {
      const p = fieldPoint(f.x, f.y);
      flag(ctx, p.x, p.y, side, reduced ? 0 : time);
    }
  }
  for (const { unit: u, moving } of units.sort((a, b) => a.unit.y - b.unit.y)) {
    if (u.state !== "ALIVE") continue;
    const p = fieldPoint(u.x, u.y),
      dir = facing.get(u.id) ?? (u.team === "red" ? 1 : -1);
    if (u.id === selected) {
      ctx.strokeStyle = "#ffe7a3";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 2, 23, 9, 0, 0, 2 * Math.PI);
      ctx.stroke();
    }
    const attack = frame.events?.findLast(
      (event) =>
        event.kind === "attack" &&
        event.unitId === u.id &&
        event.time <= time &&
        time - event.time < 0.35,
    );
    const recoil =
      attack && !reduced
        ? Math.sin(((time - attack.time) / 0.35) * Math.PI) *
          (u.unitType === "archer" ? -3 : 3)
        : 0;
    sprite(ctx, atlas, u, time, moving, dir, reduced, 1, recoil);
    const width = 34,
      y = p.y - (u.unitType === "cavalry" ? 76 : 62);
    ctx.fillStyle = "#243328aa";
    ctx.fillRect(p.x - width / 2 - 1, y - 1, width + 2, 5);
    ctx.fillStyle = u.hp / u.maxHp < 0.35 ? "#e79366" : "#b2d780";
    ctx.fillRect(p.x - width / 2, y, width * Math.max(0, u.hp / u.maxHp), 3);
    if (u.isCapturing) {
      ctx.strokeStyle = "#ffdb88";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(
        p.x,
        p.y,
        25,
        -Math.PI / 2,
        -Math.PI / 2 + (Math.PI * 2 * u.captureProgress) / 3,
      );
      ctx.stroke();
    }
    if (u.isFlagCarrier) {
      const side = frame.flags.red.carrierId === u.id ? "red" : "blue";
      flag(ctx, p.x - dir * 16, p.y - 45, side, reduced ? 0 : time);
    }
  }
  const shownDamage = new Set<string>();
  for (const event of frame.events ?? []) {
    const age = time - event.time;
    if (event.kind === "death" && !reduced && age >= 0 && age < 0.45) {
      const unit = frame.units.find((u) => u.id === event.unitId);
      if (unit)
        sprite(
          ctx,
          atlas,
          { ...unit, x: event.x, y: event.y },
          time,
          false,
          facing.get(unit.id) ?? 1,
          reduced,
          0.4 * (1 - age / 0.45),
        );
    }
    let damage: number | null = null;
    if (event.kind === "attack") {
      const key = `${event.tick}:${event.targetId}`;
      if (!shownDamage.has(key))
        damage = (frame.events ?? [])
          .filter(
            (e) =>
              e.kind === "attack" &&
              e.tick === event.tick &&
              e.targetId === event.targetId,
          )
          .reduce((sum, e) => sum + (e.damage ?? 0), 0);
      shownDamage.add(key);
    }
    drawEvent(ctx, event, age, selected, damage);
  }
}
