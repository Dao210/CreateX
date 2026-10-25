import type { ArenaMode } from "@auro/core/siege";
import { paintSprite, type ArenaArt, type ArtId } from "./art";

const decorations: ReadonlyArray<readonly [ArtId, number, number, number]> = [
  ["banner", 1.75, 2.3, 0.65], ["crate", 1.8, 6.2, 0.42],
  ["grass", 3.2, 6.95, 0.35], ["bush", 10.7, 1.4, 0.55],
  ["rocks", 7.1, 1.15, 0.42], ["stump", 12.2, 6.6, 0.45],
  ["flowers", 6.5, 6.9, 0.35], ["leaves", 8.4, 1.6, 0.45],
];

export function paintScenery(ctx: CanvasRenderingContext2D, art: ArenaArt, mode: ArenaMode, castleHP: number, cameraHeight: number) {
  ctx.drawImage(art[mode === "practice" ? "practice-field" : "woodland-battlefield"], 0, 4 - cameraHeight / 2, cameraHeight * 1.75, cameraHeight);
  for (const [id, x, y, size] of decorations) paintSprite(ctx, art[id], x, y, size);
  const castle = art[castleHP === 0 ? "castle-ruined" : castleHP <= 60 ? "castle-damaged" : "castle-intact"];
  const scale = Math.min(1.45 / castle.naturalWidth, 2.7 / castle.naturalHeight);
  const width = castle.naturalWidth * scale, height = castle.naturalHeight * scale;
  ctx.drawImage(castle, 0.85 - width / 2, 4.45 - height / 2, width, height);
}
