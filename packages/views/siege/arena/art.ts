export const ART_IDS = [
  "woodland-battlefield", "practice-field", "workshop-paper",
  "castle-intact", "castle-damaged", "castle-ruined",
  "scout-1", "scout-2", "scout-3", "scout-4",
  "heavy-1", "heavy-2", "heavy-3", "heavy-4",
  "impact", "slash", "shield-block", "shield-break", "dust", "smoke", "victory", "defeat",
  "grass", "bush", "rocks", "stump", "banner", "crate", "flowers", "leaves",
] as const;

export type ArtId = typeof ART_IDS[number];
export type ArenaArt = Record<ArtId, HTMLImageElement>;
let pending: Promise<ArenaArt> | undefined;

// One cache per document: a host serves the game from exactly one base URL, so
// the first caller's assetBase wins. A second base would need its own page.
export function loadArenaArt(assetBase: string): Promise<ArenaArt> {
  const base = assetBase.endsWith("/") ? assetBase : assetBase + "/";
  if (!pending) {
    pending = Promise.all(ART_IDS.map(id => new Promise<readonly [ArtId, HTMLImageElement]>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve([id, image]);
      image.onerror = () => reject(new Error(`art_unavailable:${id}`));
      image.src = `${base}art/${id}.webp`;
    }))).then(entries => Object.fromEntries(entries) as ArenaArt).catch(error => {
      pending = undefined;
      throw error;
    });
  }
  return pending;
}

export function paintSprite(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, size: number) {
  const width = image.naturalWidth, height = image.naturalHeight;
  const scale = size / Math.max(width, height);
  ctx.drawImage(image, x - width * scale / 2, y - height * scale / 2, width * scale, height * scale);
}
