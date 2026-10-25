import { cannonGeometry, CANNON_PIVOT, WORLD_SCALE, type CannonDesign } from "@auro/core/siege";

/** Both canvases paint in world units from the same quantized kit geometry. */
export function paintCannon(ctx: CanvasRenderingContext2D, design: CannonDesign, angle = 0, selected = false, recoil = 0) {
  const geometry = cannonGeometry(design);
  const start = (geometry.start - CANNON_PIVOT[0]) * WORLD_SCALE;
  const end = (geometry.end - CANNON_PIVOT[0]) * WORLD_SCALE;
  const half = geometry.halfWidth * WORLD_SCALE;
  const circle = (x: number, y: number, radius: number, fill: string) => {
    ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  };
  ctx.save();
  ctx.fillStyle = "#25392724"; ctx.beginPath(); ctx.ellipse(0.09, 0.16, 0.78, 0.59, 0, 0, Math.PI * 2); ctx.fill();
  // The stone foundation is decorative; the circular bearing is the moving collider.
  const stone = ctx.createLinearGradient(0, -0.65, 0, 0.65);
  stone.addColorStop(0, "#d7cbb0"); stone.addColorStop(0.6, "#b2a487"); stone.addColorStop(1, "#837b64");
  ctx.fillStyle = stone; ctx.strokeStyle = "#5f624c"; ctx.lineWidth = 0.025;
  ctx.beginPath(); ctx.roundRect(-0.62, -0.59, 1.24, 1.18, 0.12); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = "#eee5ce"; ctx.lineWidth = 0.018;
  ctx.beginPath(); ctx.moveTo(-0.48, -0.48); ctx.lineTo(0.46, -0.48); ctx.stroke();
  for (const x of [-0.47, 0.47]) for (const y of [-0.44, 0.44]) {
    circle(x, y, 0.065, "#4d5140"); circle(x - 0.01, y - 0.015, 0.026, "#b9ac84");
  }
  circle(0, 0.025, 0.51, "#565d47");
  circle(0, 0, 240 * WORLD_SCALE, "#b99b58");
  ctx.rotate(angle);
  const metal = ctx.createLinearGradient(0, -half, 0, half);
  metal.addColorStop(0, "#244536"); metal.addColorStop(0.22, "#8caa8b");
  metal.addColorStop(0.4, "#547e60"); metal.addColorStop(0.7, "#31513f"); metal.addColorStop(1, "#172f29");
  circle(0, 0, 0.41, "#263e32");
  circle(-0.025, -0.025, 0.35, "#52785b");
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    circle(Math.cos(a) * 0.39, Math.sin(a) * 0.39, 0.022, "#efdb98");
  }
  ctx.fillStyle = "#364f3b"; ctx.fillRect(0, -0.023, start + 0.055, 0.046);
  // Recoil moves only the internal breech slide, preserving the barrel and muzzle outline.
  ctx.fillStyle = "#c0a36a"; ctx.fillRect(-0.25 - recoil * 0.05, -0.19, 0.4, 0.38);
  ctx.strokeStyle = "#564d32"; ctx.lineWidth = 0.018;
  ctx.strokeRect(-0.25 - recoil * 0.05, -0.19, 0.4, 0.38);
  ctx.fillStyle = metal; ctx.fillRect(start, -half, end - start, half * 2);
  ctx.strokeStyle = "#1c362c"; ctx.lineWidth = 0.022; ctx.strokeRect(start, -half, end - start, half * 2);
  ctx.strokeStyle = "#bbccb08c"; ctx.lineWidth = 0.012;
  ctx.beginPath(); ctx.moveTo(start + 0.14, -half * 0.6); ctx.lineTo(end - 0.18, -half * 0.6); ctx.stroke();
  const brass = ctx.createLinearGradient(0, -half, 0, half);
  brass.addColorStop(0, "#80683d"); brass.addColorStop(0.22, "#efdc9c"); brass.addColorStop(0.65, "#b59351"); brass.addColorStop(1, "#655135");
  for (const x of [start + 0.025, end - 0.17]) {
    ctx.fillStyle = brass; ctx.fillRect(x, -half, 0.14, half * 2);
    ctx.strokeStyle = "#645034"; ctx.lineWidth = 0.015; ctx.strokeRect(x, -half, 0.14, half * 2);
    for (const y of [-half * 0.65, half * 0.65]) circle(x + 0.07, y, 0.025, "#f4e4af");
  }
  ctx.fillStyle = "#d1b477"; ctx.beginPath(); ctx.ellipse(end, 0, 0.045, half, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#625237"; ctx.lineWidth = 0.018; ctx.stroke();
  ctx.fillStyle = "#152c26"; ctx.beginPath(); ctx.ellipse(end + 0.004, 0, 0.025, half * 0.45, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#bea061"; ctx.fillRect(start + 0.3, -0.045, 0.11, 0.09);
  if (selected) {
    ctx.strokeStyle = "#df6b3c"; ctx.lineWidth = 0.022; ctx.setLineDash([0.07, 0.045]);
    ctx.strokeRect(start - 0.07, -half - 0.07, end - start + 0.14, half * 2 + 0.14);
  }
  ctx.restore();
}
