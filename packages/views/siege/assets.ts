import art0 from "./assets/banner.webp";
import art1 from "./assets/bush.webp";
import art2 from "./assets/castle-damaged.webp";
import art3 from "./assets/castle-intact.webp";
import art4 from "./assets/castle-ruined.webp";
import art5 from "./assets/crate.webp";
import art6 from "./assets/defeat.webp";
import art7 from "./assets/dust.webp";
import art8 from "./assets/flowers.webp";
import art9 from "./assets/grass.webp";
import art10 from "./assets/heavy-1.webp";
import art11 from "./assets/heavy-2.webp";
import art12 from "./assets/heavy-3.webp";
import art13 from "./assets/heavy-4.webp";
import art14 from "./assets/impact.webp";
import art15 from "./assets/leaves.webp";
import art16 from "./assets/practice-field.webp";
import art17 from "./assets/rocks.webp";
import art18 from "./assets/scout-1.webp";
import art19 from "./assets/scout-2.webp";
import art20 from "./assets/scout-3.webp";
import art21 from "./assets/scout-4.webp";
import art22 from "./assets/shield-block.webp";
import art23 from "./assets/shield-break.webp";
import art24 from "./assets/slash.webp";
import art25 from "./assets/smoke.webp";
import art26 from "./assets/stump.webp";
import art27 from "./assets/victory.webp";
import art28 from "./assets/woodland-battlefield.webp";
import art29 from "./assets/workshop-paper.webp";

const sources: Record<string, string | { src: string }> = {
  "banner": art0,
  "bush": art1,
  "castle-damaged": art2,
  "castle-intact": art3,
  "castle-ruined": art4,
  "crate": art5,
  "defeat": art6,
  "dust": art7,
  "flowers": art8,
  "grass": art9,
  "heavy-1": art10,
  "heavy-2": art11,
  "heavy-3": art12,
  "heavy-4": art13,
  "impact": art14,
  "leaves": art15,
  "practice-field": art16,
  "rocks": art17,
  "scout-1": art18,
  "scout-2": art19,
  "scout-3": art20,
  "scout-4": art21,
  "shield-block": art22,
  "shield-break": art23,
  "slash": art24,
  "smoke": art25,
  "stump": art26,
  "victory": art27,
  "woodland-battlefield": art28,
  "workshop-paper": art29,
};

export function siegeAssetUrl(id: string): string {
  const asset = sources[id];
  if (!asset) throw new Error(`Unknown Siege asset: ${id}`);
  return typeof asset === "string" ? asset : asset.src;
}
