import { WORLD_HEIGHT, WORLD_WIDTH, type WorldSnapshot } from "./types";

const BASE = process.env.NEXT_PUBLIC_REACH_API ?? "/api/reach";

// The world is a read-only surface for visitors. Both calls fail soft: the page
// falls back to a clearly labelled preview instead of showing an empty canvas
// (docs/reach-world-prd.md §10, "no white screen").
async function getJSON<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${BASE}${path}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function fetchSnapshot() {
  return getJSON<import("./types").WorldSnapshot>("/state");
}

export function fetchSeason() {
  return getJSON<import("./types").SeasonInfo>("/season/current");
}

// ---------------------------------------------------------------------------
// Preview fixture
//
// Used only when the world service is unreachable. It is deterministic so the
// layout can be judged without a backend, and every surface that renders it must
// say "preview" — a static map pretending to be live would be a lie about the
// one thing this page is selling.
// ---------------------------------------------------------------------------

function hash(value: number): number {
  let x = value | 0;
  x = Math.imul(x ^ (x >>> 16), 2246822507);
  x = Math.imul(x ^ (x >>> 13), 3266489909);
  return (x ^ (x >>> 16)) >>> 0;
}

function unit(seed: number): number {
  return hash(seed) / 4294967295;
}

function pick<T>(list: readonly T[], seed: number, fallback: T): T {
  return list[Math.floor(unit(seed) * list.length)] ?? fallback;
}

const FIRST = [
  "Rust",
  "Glass",
  "Iron",
  "Pale",
  "Long",
  "Quiet",
  "Salt",
  "Ash",
  "Copper",
  "Hollow",
  "Bright",
  "Slow",
];
const SECOND = [
  "Marshal",
  "Runner",
  "Deacon",
  "Widow",
  "Carter",
  "Lantern",
  "Harbor",
  "Sparrow",
  "Pilgrim",
  "Warden",
  "Falcon",
  "Mason",
];
const PALETTES = [
  ["#14161A", "#C8622D", "#E8E1D5"],
  ["#14161A", "#6F8FA6", "#E8E1D5"],
  ["#14161A", "#8C7A5B", "#E8E1D5"],
  ["#14161A", "#9C5C6B", "#E8E1D5"],
] as const;
const SILHOUETTES = ["slim", "broad", "tall", "low"] as const;
const FORMS = ["blade", "hammer", "cannon", "wheel", "shield", "structure"];

export function previewSnapshot(): WorldSnapshot {
  const count = 380;
  // People gather where the caches are. A uniform scatter reads as a starfield;
  // a few dense pockets read as a map with reasons.
  const clusters = Array.from({ length: 9 }, (_, c) => ({
    x: 200 + unit(c * 101 + 7) * (WORLD_WIDTH - 400),
    y: 150 + unit(c * 103 + 9) * (WORLD_HEIGHT - 300),
  }));
  const entities = Array.from({ length: count }, (_, i) => {
    const dead = unit(i * 7 + 3) > 0.86;
    const name = `${pick(FIRST, i * 11 + 1, "Rust")} ${pick(SECOND, i * 13 + 5, "Marshal")}`;
    const clustered = unit(i * 23 + 13) < 0.78;
    const anchor =
      pick(clusters, i * 13 + 3, clusters[0]) ?? { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
    return {
      id: `preview-${i}`,
      name,
      kind: "character" as const,
      x: Math.max(
        8,
        Math.min(
          WORLD_WIDTH - 8,
          Math.floor(
            clustered ? anchor.x + (unit(i * 17 + 2) - 0.5) * 260 : unit(i * 17 + 2) * WORLD_WIDTH,
          ),
        ),
      ),
      y: Math.max(
        8,
        Math.min(
          WORLD_HEIGHT - 8,
          Math.floor(
            clustered ? anchor.y + (unit(i * 19 + 4) - 0.5) * 190 : unit(i * 19 + 4) * WORLD_HEIGHT,
          ),
        ),
      ),
      hp: dead ? 0 : Math.floor(20 + unit(i * 23) * 80),
      status: dead ? ("dead" as const) : ("alive" as const),
      kills: Math.floor(unit(i * 29) * 4),
      survived: Math.floor(unit(i * 31) * 900),
      palette: [...pick(PALETTES, i * 37, PALETTES[0])],
      silhouette: pick(SILHOUETTES, i * 41, "slim"),
      form: pick(FORMS, i * 43, "blade"),
      generator: unit(i * 47) > 0.7 ? "workbuddy" : "human",
    };
  });

  return {
    season: "preview",
    beat: 412,
    version: 412,
    rulesVersion: "reach@1",
    digest: "preview",
    rifts: [512, 1480],
    supplies: clusters.flatMap((cluster, c) => [
      {
        id: `s-${c}-a`,
        x: Math.floor(cluster.x + (unit(c * 53 + 6) - 0.5) * 120),
        y: Math.floor(cluster.y + (unit(c * 59 + 8) - 0.5) * 90),
        charge: Math.floor(unit(c * 61) * 100),
      },
      {
        id: `s-${c}-b`,
        x: Math.floor(cluster.x + (unit(c * 67 + 2) - 0.5) * 260),
        y: Math.floor(cluster.y + (unit(c * 71 + 5) - 0.5) * 180),
        charge: Math.floor(unit(c * 73 + 1) * 100),
      },
    ]),
    entities,
    wrecks: entities
      .filter((e) => e.status === "dead")
      .slice(0, 12)
      .map((e, i) => ({
        id: `w-${i}`,
        name: e.name,
        x: e.x,
        y: e.y,
        beat: 400 - i,
        claimed: i % 3 === 0,
      })),
    chronicle: [
      {
        seq: 1,
        beat: 356,
        kind: "catastrophe" as const,
        belt: 1,
        text: {
          en: "A rift opened on the second belt. Drifters came through.",
          zh: "第二带裂开一道口子，漂移者涌了进来。",
        },
      },
      {
        seq: 2,
        beat: 371,
        kind: "death" as const,
        belt: 0,
        text: {
          en: "Hollow Warden ran out of charge at the first belt.",
          zh: "「空守望」在第一带耗尽能量。",
        },
      },
      {
        seq: 3,
        beat: 379,
        kind: "first_blood" as const,
        belt: 0,
        text: {
          en: "First blood of the season. The world noticed.",
          zh: "本赛季第一次见血。世界注意到了。",
        },
      },
      {
        seq: 4,
        beat: 386,
        kind: "claim" as const,
        belt: 1,
        text: {
          en: "Ash Lantern stripped a shield off the wreck and kept moving.",
          zh: "「灰灯」从残骸上卸下一面盾，继续走。",
        },
      },
      {
        seq: 5,
        beat: 391,
        kind: "kill" as const,
        belt: 2,
        text: {
          en: "Long Carter cut down Pale Falcon between the seams.",
          zh: "「长卡特」在缝隙之间砍倒了「苍白隼」。",
        },
      },
      {
        seq: 6,
        beat: 398,
        kind: "death" as const,
        belt: 0,
        text: {
          en: "Pale Sparrow fell at the first belt. Wreck intact.",
          zh: "「苍白雀」倒于第一带，残骸完好。",
        },
      },
      {
        seq: 7,
        beat: 404,
        kind: "catastrophe" as const,
        belt: 1,
        text: {
          en: "The second belt collapsed. Drifters came through.",
          zh: "第二带塌陷，漂移者涌了进来。",
        },
      },
      {
        seq: 8,
        beat: 409,
        kind: "claim" as const,
        belt: 2,
        text: {
          en: "Salt Widow picked over Copper Deacon’s wreck.",
          zh: "「盐寡」拾取了「铜执事」的残骸。",
        },
      },
      {
        seq: 9,
        beat: 412,
        kind: "kill" as const,
        belt: 2,
        text: {
          en: "Rust Marshal put down Glass Runner at the third belt.",
          zh: "「锈帅」在第三带放倒了「玻璃跑者」。",
        },
      },
    ],
  };
}
