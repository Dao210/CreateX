import { BASE_BOUNDS, tankPulsePhase, TANK_PULSE_PERIOD, TANK_CELL, TANK_GRID, TANK_WORLD, type TankActor, type TankDefenseGame, type TankDirection, type TankPoint } from "@auro/core/tank-defense";

const angle: Record<TankDirection, number> = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 };
const ink = { ground: "#111915", brick: "#aa6244", brickLight: "#d99060", steel: "#a5b6a2", steelShade: "#617467", water: "#244c58", waterLight: "#497c88", forest: "#395a39", gold: "#f1ca68" };

export function paintTank(ctx: CanvasRenderingContext2D, tank: Pick<TankActor, "x" | "y" | "direction" | "team" | "blueprint" | "hp" | "moving">, tick: number) {
  ctx.save(); ctx.translate(Math.round(tank.x), Math.round(tank.y)); ctx.rotate(angle[tank.direction]);
  const player = tank.team === "player", armor = tank.blueprint.id === "armor";
  const appearance = player ? tank.blueprint.appearance : undefined;
  const color = appearance?.body ?? (player ? "#e7bd59" : armor ? tank.hp > 1 ? "#9cac97" : "#d28d75" : tank.blueprint.id === "runner" ? "#c38e7d" : "#b7c2ae");
  ctx.fillStyle = "#080e0a"; ctx.fillRect(-15, -13, 30, 29);
  ctx.fillStyle = player ? "#8d713b" : "#536356"; ctx.fillRect(-14, -12, 6, 26); ctx.fillRect(8, -12, 6, 26);
  const tread = tank.moving ? Math.floor(tick / 4) % 2 * 3 : 0;
  ctx.fillStyle = color;
  for (let y = -11 + tread; y < 13; y += 6) { ctx.fillRect(-14, y, 5, 3); ctx.fillRect(9, y, 5, 3); }
  ctx.fillRect(-8, -11, 16, 24); ctx.fillStyle = appearance?.accent ?? (player ? "#b58b42" : "#768773"); ctx.fillRect(-6, -8, 12, 19);
  ctx.fillStyle = color; ctx.fillRect(-6, -5, 12, 12); ctx.fillRect(-3, -18, 6, 15);
  ctx.fillStyle = appearance?.accent ?? (player ? "#ffdf91" : "#e0e8d6"); ctx.fillRect(-5, -4, 3, 8); ctx.fillRect(-2, -18, 2, 8);
  if (appearance?.pattern === "stripe") { ctx.fillRect(-6, 8, 12, 2); ctx.fillRect(-6, -9, 12, 2); }
  if (appearance?.pattern === "cross") { ctx.fillRect(-5, 0, 10, 2); ctx.fillRect(-1, -4, 2, 10); }
  ctx.fillStyle = "#344131"; ctx.fillRect(-2, -1, 5, 5); ctx.fillRect(-3, -19, 6, 2);
  if (armor && tank.hp > 1) { ctx.strokeStyle = "#e1e9d5"; ctx.lineWidth = 1; ctx.strokeRect(-8.5, -11.5, 17, 24); }
  ctx.restore();
}

export function paintFortress(ctx: CanvasRenderingContext2D, alive: boolean, position: TankPoint = { x: BASE_BOUNDS.x, y: BASE_BOUNDS.y }, scale = 1) {
  ctx.save(); ctx.translate(position.x, position.y); ctx.scale(scale, scale);
  ctx.fillStyle = alive ? "#5a5138" : "#554a43"; ctx.fillRect(4, 4, 32, 32);
  ctx.fillStyle = alive ? "#e5c779" : "#8e6c54";
  ctx.fillRect(7, 8, 7, 22); ctx.fillRect(26, 8, 7, 22); ctx.fillRect(11, 17, 18, 15);
  for (const x of [6, 11, 25, 30]) ctx.fillRect(x, 5, 4, 6);
  ctx.fillRect(17, 12, 6, 8); ctx.fillRect(19, 5, 2, 9);
  ctx.fillStyle = alive ? "#e98e5d" : "#554a43"; ctx.fillRect(21, 5, 7, 5);
  ctx.fillStyle = "#20261b"; ctx.fillRect(17, 24, 6, 9); ctx.fillRect(9, 13, 3, 5); ctx.fillRect(28, 13, 3, 5);
  if (!alive) { ctx.fillStyle = "#171d17"; ctx.fillRect(13, 6, 8, 15); ctx.fillRect(8, 20, 10, 7); ctx.fillRect(25, 7, 10, 10); }
  ctx.restore();
}

function paintForest(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#24432d"; ctx.fillRect(x, y, 20, 20);
  ctx.fillStyle = ink.forest;
  ctx.fillRect(x + 2, y + 1, 7, 7); ctx.fillRect(x + 11, y + 6, 8, 7); ctx.fillRect(x + 3, y + 12, 8, 6);
  ctx.fillStyle = "#55724a"; ctx.fillRect(x + 4, y + 2, 4, 2); ctx.fillRect(x + 13, y + 7, 4, 2); ctx.fillRect(x + 4, y + 13, 3, 2);
}

const glyphs = {
  star: ["00100", "11111", "01110", "11011", "10001"],
  shield: ["11111", "10101", "10101", "01110", "00100"],
  bomb: ["00110", "00010", "01110", "11111", "01110"],
  fortify: ["10101", "11111", "10001", "10101", "11111"],
};

function paintMechanisms(ctx: CanvasRenderingContext2D, game: TankDefenseGame, reducedMotion: boolean) {
  for (const device of game.mechanisms) {
    ctx.save();
    if (device.kind === "conveyor") {
      ctx.fillStyle = "#303e31"; ctx.fillRect(device.x, device.y, device.width, device.height);
      ctx.strokeStyle = "#75815b"; ctx.lineWidth = 1; ctx.strokeRect(device.x + 2, device.y + 2, device.width - 4, device.height - 4);
      for (let y = device.y + 20; y < device.y + device.height; y += 40) for (let x = device.x + 20; x < device.x + device.width; x += 40) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(angle[device.direction]);
        const shift = reducedMotion ? 0 : Math.floor(game.tick / 12) % 3 - 1;
        ctx.strokeStyle = "#abb888"; ctx.lineWidth = 2;
        for (const row of [-5, 5]) { ctx.beginPath(); ctx.moveTo(-7, row + 4 - shift); ctx.lineTo(0, row - 3 - shift); ctx.lineTo(7, row + 4 - shift); ctx.stroke(); }
        ctx.restore();
      }
    } else if (device.kind === "pulse") {
      const phase = tankPulsePhase(game.tick, device.offset);
      ctx.fillStyle = phase === "active" ? "#23606c" : phase === "warning" ? "#665128" : "#1e3234";
      ctx.fillRect(device.x, device.y, device.width, device.height);
      ctx.strokeStyle = phase === "active" ? "#a5f2ef" : phase === "warning" ? "#f1ca68" : "#548082";
      ctx.lineWidth = phase === "safe" ? 1 : 2; ctx.setLineDash(phase === "safe" ? [4, 4] : []);
      ctx.strokeRect(device.x + 2, device.y + 2, device.width - 4, device.height - 4); ctx.setLineDash([]);
      for (let x = device.x + 20; x < device.x + device.width; x += 40) {
        const y = device.y + device.height / 2;
        ctx.beginPath(); ctx.moveTo(x + 3, y - 10); ctx.lineTo(x - 5, y + 1); ctx.lineTo(x + 3, y + 1); ctx.lineTo(x - 3, y + 10); ctx.stroke();
      }
      const progress = ((game.tick + device.offset) % TANK_PULSE_PERIOD) / TANK_PULSE_PERIOD;
      ctx.fillStyle = ctx.strokeStyle; ctx.fillRect(device.x + 4, device.y + device.height - 5, (device.width - 8) * progress, 2);
    } else if (device.kind === "barrel") {
      if (device.spent) { ctx.fillStyle = "#46392e"; ctx.fillRect(device.x - 8, device.y - 3, 16, 6); ctx.restore(); continue; }
      ctx.strokeStyle = "#c9865745"; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.arc(device.x, device.y, 72, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#a75038"; ctx.fillRect(device.x - 10, device.y - 12, 20, 24);
      ctx.fillStyle = "#e0b47a"; ctx.fillRect(device.x - 11, device.y - 9, 22, 3); ctx.fillRect(device.x - 11, device.y + 6, 22, 3);
      ctx.fillStyle = "#f5d37a"; ctx.fillRect(device.x - 2, device.y - 4, 4, 6); ctx.fillRect(device.x - 2, device.y + 4, 4, 2);
    } else {
      ctx.fillStyle = device.spent ? "#25332b" : "#254e3e"; ctx.fillRect(device.x - 16, device.y - 16, 32, 32);
      ctx.strokeStyle = device.spent ? "#526558" : "#9cdbad"; ctx.lineWidth = 1; ctx.strokeRect(device.x - 15, device.y - 15, 30, 30);
      ctx.fillStyle = device.spent ? "#526558" : "#b1e8bd"; ctx.fillRect(device.x - 3, device.y - 10, 6, 20); ctx.fillRect(device.x - 10, device.y - 3, 20, 6);
      if (device.spent) { ctx.strokeStyle = "#18271e"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(device.x - 11, device.y + 11); ctx.lineTo(device.x + 11, device.y - 11); ctx.stroke(); }
    }
    ctx.restore();
  }
}

export function paintTankBattle(ctx: CanvasRenderingContext2D, game: TankDefenseGame, reducedMotion: boolean) {
  const scale = ctx.canvas.width / TANK_WORLD;
  ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = ink.ground; ctx.fillRect(0, 0, TANK_WORLD, TANK_WORLD);
  for (let row = 0; row < TANK_GRID; row++) for (let col = 0; col < TANK_GRID; col++) {
    const index = row * TANK_GRID + col, x = col * TANK_CELL, y = row * TANK_CELL, kind = game.terrain[index];
    if (kind === "floor" || kind === "forest") {
      if ((row * 7 + col * 11) % 9 === 0) { ctx.fillStyle = "#243025"; ctx.fillRect(x + 6, y + 9, 2, 2); }
    } else if (kind === "brick") {
      ctx.fillStyle = "#593b2c"; ctx.fillRect(x, y, 20, 20);
      ctx.fillStyle = ink.brick;
      for (let n = 0; n < 3; n++) {
        const sy = y + n * 7;
        if (game.brickHP[index] === 1 && n === (row + col) % 3) continue;
        ctx.fillRect(x + 1, sy + 1, 18, 5); ctx.fillStyle = ink.brickLight; ctx.fillRect(x + 2, sy + 1, 16, 1); ctx.fillStyle = ink.brick;
        ctx.fillStyle = "#593b2c"; ctx.fillRect(x + (n % 2 ? 6 : 12), sy, 1, 7); ctx.fillStyle = ink.brick;
      }
    } else if (kind === "steel") {
      ctx.fillStyle = ink.steelShade; ctx.fillRect(x, y, 20, 20); ctx.fillStyle = ink.steel; ctx.fillRect(x + 1, y + 1, 17, 17);
      ctx.fillStyle = "#c8d4bf"; ctx.fillRect(x + 2, y + 2, 15, 2); ctx.fillRect(x + 2, y + 2, 2, 15);
      ctx.fillStyle = ink.steelShade; for (const [dx, dy] of [[4, 4], [14, 4], [4, 14], [14, 14]]) ctx.fillRect(x + dx!, y + dy!, 2, 2);
    } else if (kind === "water") {
      ctx.fillStyle = ink.water; ctx.fillRect(x, y, 20, 20); ctx.fillStyle = ink.waterLight;
      const shift = reducedMotion ? 0 : Math.floor(game.tick / 20) % 3;
      ctx.fillRect(x + 2 + shift, y + 5, 10, 2); ctx.fillRect(x + 7 - shift, y + 13, 10, 2);
    } else if (kind === "ice") {
      ctx.fillStyle = "#6c9894"; ctx.fillRect(x, y, 20, 20); ctx.fillStyle = "#a8c9ba";
      ctx.fillRect(x + 2, y + 2, 13, 1); ctx.fillRect(x + 12, y + 3, 1, 6); ctx.fillRect(x + 5, y + 10, 11, 1);
    }
  }
  paintMechanisms(ctx, game, reducedMotion);
  paintFortress(ctx, game.baseAlive);
  for (const tank of game.tanks) {
    paintTank(ctx, tank, game.tick);
    if (tank.hp > 1) { ctx.fillStyle = "#d4dfbf"; for (let n = 0; n < tank.hp; n++) ctx.fillRect(tank.x - 7 + n * 6, tank.y - 25, 4, 3); }
    if (game.tick < tank.stunnedUntil) { ctx.strokeStyle = "#a5f2ef"; ctx.lineWidth = 2; ctx.strokeRect(tank.x - 19, tank.y - 16, 38, 32); }
    if (game.tick < tank.invincibleUntil && (reducedMotion || Math.floor(game.tick / 7) % 2 === 0)) {
      ctx.strokeStyle = tank.team === "player" ? "#e9cc7b" : "#7eaa96"; ctx.lineWidth = 2;
      ctx.strokeRect(Math.round(tank.x) - 18, Math.round(tank.y) - 18, 36, 36);
    }
  }
  for (let row = 0; row < TANK_GRID; row++) for (let col = 0; col < TANK_GRID; col++) if (game.terrain[row * TANK_GRID + col] === "forest") paintForest(ctx, col * 20, row * 20);
  for (const bullet of game.bullets) {
    ctx.fillStyle = bullet.team === "player" ? "#ffe4a1" : "#efae8c";
    ctx.fillRect(Math.round(bullet.x) - 2, Math.round(bullet.y) - 2, 4, 4);
  }
  for (const pickup of game.pickups) {
    if (!reducedMotion && pickup.expire - game.tick < 180 && Math.floor(game.tick / 10) % 2) continue;
    ctx.fillStyle = "#263c31"; ctx.fillRect(pickup.x - 14, pickup.y - 14, 28, 28);
    ctx.strokeStyle = "#e6c77a"; ctx.lineWidth = 1; ctx.strokeRect(pickup.x - 13, pickup.y - 13, 26, 26);
    ctx.fillStyle = ink.gold;
    glyphs[pickup.kind].forEach((row, y) => [...row].forEach((pixel, x) => { if (pixel === "1") ctx.fillRect(pickup.x - 8 + x * 3, pickup.y - 8 + y * 3, 3, 3); }));
  }
  for (const effect of game.effects) {
    const age = game.tick - effect.tick;
    if (age > 32) continue;
    if (effect.kind === "blast") {
      ctx.globalAlpha = Math.max(0, (1 - age / 33) * 0.5); ctx.fillStyle = "#efae62";
      ctx.beginPath(); ctx.arc(effect.x, effect.y, 72, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; continue;
    }
    if (effect.kind === "spawn") {
      ctx.strokeStyle = "#b1be9a"; ctx.lineWidth = 1; const radius = reducedMotion ? 18 : Math.max(2, 26 - age);
      ctx.strokeRect(effect.x - radius, effect.y - radius, radius * 2, radius * 2); continue;
    }
    const radius = effect.kind === "explosion" ? reducedMotion ? 14 : 6 + age * 0.6 : 3 + age * 0.15;
    ctx.globalAlpha = Math.max(0, 1 - age / 33);
    ctx.fillStyle = age < 8 ? "#ffe6a0" : "#e49350";
    ctx.fillRect(Math.round(effect.x - radius), Math.round(effect.y - 3), Math.round(radius * 2), 6);
    ctx.fillRect(Math.round(effect.x - 3), Math.round(effect.y - radius), 6, Math.round(radius * 2));
    ctx.fillStyle = "#ffcb75"; ctx.fillRect(effect.x - 4, effect.y - 4, 8, 8); ctx.globalAlpha = 1;
  }
  if (game.player) {
    ctx.strokeStyle = "#ebc978"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(game.player.x - 19, game.player.y + 22); ctx.lineTo(game.player.x - 19, game.player.y + 25); ctx.lineTo(game.player.x - 10, game.player.y + 25); ctx.stroke();
  }
}
