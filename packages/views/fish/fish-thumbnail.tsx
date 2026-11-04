import { bodySection, type FishSpec } from "@auro/core/fish";
/** Static silhouette uses the same section interpolation as the 3D compiler. */
export function FishThumbnail({ spec }: { spec: FishSpec }) {
  const upper: string[] = [], lower: string[] = [];
  for (let i = 0; i <= 32; i++) { const s = bodySection(spec, i / 32 * 1000); const x = 75 - i / 32 * 48; upper.push(`${x},${32 - (s.height + s.offset) * 48}`); lower.unshift(`${x},${32 + (s.height - s.offset) * 48}`); }
  const end = bodySection(spec, 1000), tailX = 27 - spec.tail.length / 1000 * 48, tailY = 32 - end.offset * 48;
  return <svg viewBox="0 0 100 64" aria-hidden="true"><path d={`M27 ${tailY} L${tailX} ${tailY - spec.tail.spread / 1000 * 48} L${tailX + spec.tail.fork / 1000 * 10} ${tailY} L${tailX} ${tailY + spec.tail.spread / 1000 * 48} Z`} fill={spec.appearance.accent} /><polygon points={[...upper, ...lower].join(" ")} fill={spec.appearance.body} /><circle cx="68" cy="30" r="2" fill="#183C43" /></svg>;
}
