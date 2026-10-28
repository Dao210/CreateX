import type { EntityView } from "./types";

// Decorative cartography only: these strokes do not add terrain or collision rules.
export const WORLD_INK = { ground: "#111916", line: "#465247", paper: "#E4DDC9", muted: "#A6AD99", accent: "#D78D56", shadow: "#080E0C", supply: "#A9C5B8" } as const;

export const LAND_FORMS = [
  { fill: "#1B2720", d: "M-80 140Q190-90 530 70T1020 15L1040 210Q800 100 690 255T290 345Q60 330-80 440Z" },
  { fill: "#202B23", d: "M-60 780Q160 580 410 695T920 680Q1100 720 1150 1070H-60Z" },
  { fill: "#202921", d: "M990-40Q1200 250 1430 145T2110 230V680Q1830 490 1650 585T1260 390Q1150 230 990-40Z" },
  { fill: "#263027", d: "M1260 1050Q1250 770 1490 780T1790 675Q1960 565 2110 780V1070Z" },
];

export const CONTOURS = Array.from({ length: 16 }, (_, i) => {
  const x = i % 2 ? 1250 : 80;
  const y = 90 + Math.floor(i / 2) * 125;
  return `M${x} ${y}q110-70 230-26t235-18m-440 33q110-48 218-14t212-25`;
});

export const ROCKS = Array.from({ length: 44 }, (_, i) => ({
  x: (i * 293 + 94) % 2048, y: (i * 173 + 71) % 1024, size: 4 + i % 5 * 2,
}));

export function riftPath(x: number) {
  return `M${x} 0l-9 78 16 60-12 82 7 84-13 55 14 85-8 78 13 64-17 90 12 75-8 82 7 104-2 92`;
}

type ArtPart = { d: string; fill: string; stroke?: string };
const WEAPONS: Record<string, string> = {
  blade: "M25 10L35-35 40-46 43-31 31 14Z",
  hammer: "M28 15l7-46h-12l2-12 32 4-2 13-12-2-7 44Z",
  cannon: "M20-8l35-9 3 18-36 9Z",
  shield: "M22-18l25 3-2 29-15 10-12-14Z",
  wheel: "M26-15a18 18 0 1 0 0 36 18 18 0 1 0 0-36Z",
  structure: "M20-22h28v35H20Zm5 7v20h18v-20Z",
};
const LOOSE_WEAPONS: Record<string, string> = {
  blade: "M-6 16l3-55 11-19 10 21-11 55Zm-12 2 35 3-1 7-13-2-2 21-8-1 2-21-13-1Z",
  hammer: "M-8 42l8-68-29-4 4-27 66 9-4 26-28-3-8 69Z",
  cannon: "M-36-20l69-10 7 32-68 12ZM-22 11l-10 24h17l13-20m20-3 8 24h15L30 8Z",
  shield: "M-34-43l67 8-4 55-30 27-30-30Z",
  wheel: "M0-43a39 39 0 1 0 0 78 39 39 0 1 0 0-78Zm0 13v52m-26-26h52",
  structure: "M-31-35h62v65h-62Zm8 9v47h46v-47Z",
};

export function creationParts(entity: Pick<EntityView, "kind" | "silhouette" | "form" | "palette">): ArtPart[] {
  const [dark = "#29352E", color = WORLD_INK.accent, light = WORLD_INK.paper] = entity.palette;
  const weapon = WEAPONS[entity.form ?? "blade"] ?? WEAPONS.blade!;
  if (entity.kind === "weapon") return [{ d: LOOSE_WEAPONS[entity.form ?? "blade"] ?? LOOSE_WEAPONS.blade!, fill: color, stroke: light }];
  const wide = entity.silhouette === "broad" ? 25 : entity.silhouette === "slim" ? 13 : 18;
  const body = entity.silhouette === "low"
    ? "M-27-5Q-5-22 23-5l8 26-60 1Z"
    : `M-${wide}-15Q0-26 ${wide}-15l8 45Q0 43-${wide + 8} 30Z`;
  return [
    { d: "M-15 25l-5 19 10 2 10-19M8 26l5 20 10-2-7-20", fill: light, stroke: dark },
    { d: body, fill: color, stroke: light },
    { d: `M-${wide + 2}-9Q0-27 ${wide}-10L4 35l-12-18Z`, fill: dark },
    { d: "M-13-26Q-14-47 0-50q17 2 15 26l-14 9Z", fill: color, stroke: light },
    { d: "M-7-31q8-6 16 0l-3 9H-5Z", fill: dark },
    { d: "M-4-29h3m5 0h3M-18 13l11-5m18-1 14 5", fill: "none", stroke: light },
    { d: weapon, fill: light, stroke: dark },
    ...(entity.silhouette === "tall" ? [{ d: "M-6-49l4-20 10 24", fill: color, stroke: light }] : []),
  ];
}
