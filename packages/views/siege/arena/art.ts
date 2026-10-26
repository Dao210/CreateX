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
const images = new Map<string, Promise<HTMLImageElement>>();
const campaignIds = ART_IDS.filter(id => !["practice-field", "workshop-paper", "impact", "slash", "shield-block", "shield-break", "dust", "smoke", "victory", "defeat", "grass", "rocks", "banner", "leaves"].includes(id));

export async function loadArenaArt(assetUrl: (id: string) => string, scene: "arena" | "campaign" = "arena"): Promise<ArenaArt> {
  const ids = scene === "campaign" ? campaignIds : ART_IDS.filter(id => id !== "workshop-paper");
  const entries = await Promise.all(ids.map(async id => {
    const url = assetUrl(id);
    let pending = images.get(url);
    if (!pending) {
      pending = new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`art_unavailable:${id}`));
        image.src = url;
      }).catch(error => { images.delete(url); throw error; });
      images.set(url, pending);
    }
    return [id, await pending] as const;
  }));
  return Object.fromEntries(entries) as ArenaArt;
}

export function paintSprite(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, size: number) {
  const width = image.naturalWidth, height = image.naturalHeight;
  const scale = size / Math.max(width, height);
  ctx.drawImage(image, x - width * scale / 2, y - height * scale / 2, width * scale, height * scale);
}
