// Wire types mirroring server/internal/reach. Kept hand-written (not generated)
// because the frontend only needs the read models; see
// docs/reach-world-prd.md §6 for the contract they come from.

export type ChronicleText = {
  en: string;
  zh: string;
  ja?: string;
  ko?: string;
};

export type Chronicle = {
  seq: number;
  beat: number;
  kind: "kill" | "first_blood" | "death" | "claim" | "catastrophe";
  entities?: string[];
  belt?: number;
  text: ChronicleText;
};

export type EntityView = {
  id: string;
  name: string;
  kind: "weapon" | "character";
  x: number;
  y: number;
  hp: number;
  status: "alive" | "dead";
  kills: number;
  survived: number;
  palette: string[];
  silhouette: "slim" | "broad" | "tall" | "low";
  form?: string;
  geometry?: string;
  generator: string;
};

export type WreckView = {
  id: string;
  name: string;
  x: number;
  y: number;
  beat: number;
  claimed: boolean;
};

export type SupplyView = {
  id: string;
  x: number;
  y: number;
  charge: number;
};

export type WorldSnapshot = {
  season: string;
  beat: number;
  version: number;
  rulesVersion: string;
  digest: string;
  rifts: number[];
  supplies: SupplyView[];
  entities: EntityView[];
  wrecks: WreckView[];
  chronicle: Chronicle[];
};

export type SeasonInfo = {
  id: string;
  beat: number;
  beatsLeft: number;
  beatSeconds: number;
  rulesVersion: string;
  entities: number;
  alive: number;
  wrecks: number;
};

// World geometry is fixed by the engine; the window scales it, never the reverse.
export const WORLD_WIDTH = 2048;
export const WORLD_HEIGHT = 1024;

export function chronicleLine(text: ChronicleText, locale: string): string {
  if (locale === "ja" && text.ja) return text.ja;
  if (locale === "ko" && text.ko) return text.ko;
  return locale.startsWith("zh") ? text.zh : text.en;
}
