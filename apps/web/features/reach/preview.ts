import { WORLD_HEIGHT, WORLD_WIDTH, type WorldSnapshot } from "./types";
import { previewNames } from "./preview-names";

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

const PALETTES = [
  ["#14161A", "#C8622D", "#E8E1D5"],
  ["#14161A", "#6F8FA6", "#E8E1D5"],
  ["#14161A", "#8C7A5B", "#E8E1D5"],
  ["#14161A", "#9C5C6B", "#E8E1D5"],
] as const;
const SILHOUETTES = ["slim", "broad", "tall", "low"] as const;
const FORMS = ["blade", "hammer", "cannon", "wheel", "shield", "structure"];

export function previewSnapshot(): WorldSnapshot {
  const count = 68;
  // People gather where the caches are. A uniform scatter reads as a starfield;
  // a few dense pockets read as a map with reasons.
  const clusters = Array.from({ length: 9 }, (_, c) => ({
    x: 200 + unit(c * 101 + 7) * (WORLD_WIDTH - 400),
    y: 150 + unit(c * 103 + 9) * (WORLD_HEIGHT - 300),
  }));
  const entities = Array.from({ length: count }, (_, i) => {
    const dead = unit(i * 7 + 3) > 0.86;
    const name = previewNames.en[`preview-${i}`]!;
    const clustered = unit(i * 23 + 13) < 0.78;
    const anchor =
      pick(clusters, i * 13 + 3, clusters[0]) ?? { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
    return {
      id: `preview-${i}`,
      name,
      kind: i === 9 ? "weapon" as const : "character" as const,
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

  // Named preview participants make the sample chronicle navigable by IDs.
  const cast = [
    { x: 1580, y: 490, silhouette: "broad" as const, form: "hammer", hp: 8, kills: 1, status: "alive" as const },
    { x: 1710, y: 580, silhouette: "slim" as const, form: "blade", hp: 0, status: "dead" as const },
    { x: 1700, y: 775, silhouette: "tall" as const, form: "shield", hp: 92, status: "alive" as const },
    { x: 1790, y: 805, silhouette: "broad" as const, form: "cannon", hp: 0, kills: 1, status: "dead" as const },
    { x: 1000, y: 340, silhouette: "low" as const, form: "cannon", hp: 64, status: "alive" as const },
    { x: 1590, y: 280, silhouette: "tall" as const, form: "blade", hp: 88, kills: 1, status: "alive" as const },
    { x: 1750, y: 230, silhouette: "slim" as const, form: "blade", hp: 0, status: "dead" as const },
    { x: 350, y: 690, silhouette: "slim" as const, form: "shield", hp: 0, status: "dead" as const },
    { x: 290, y: 370, silhouette: "broad" as const, form: "hammer", hp: 0, status: "dead" as const },
    { x: 1150, y: 640, silhouette: "slim" as const, form: "blade", hp: 100, status: "alive" as const },
  ];
  for (const [index, member] of cast.entries()) Object.assign(entities[index]!, member);
  for (const [index, entity] of entities.entries()) entity.survived = Math.min(412, 85 + index * 7);

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
          en: "A rift opened in the second belt. Enemies poured out. The fight over supplies could wait.",
          zh: "第二地带的裂缝突然打开，敌人涌了出来。补给先不抢了，保命要紧。",
          ja: "第2帯の亀裂から敵があふれ出した。物資の取り合いは後回し。まずは生き残れ。",
          ko: "제2 구역의 균열에서 적들이 쏟아졌다. 보급품 싸움은 나중이다. 일단 살아야 한다.",
        },
      },
      {
        seq: 2,
        entities: ["preview-8"],
        beat: 371,
        kind: "death" as const,
        belt: 0,
        text: {
          en: "Max spent all his energy getting to the supplies. He stopped one step short.",
          zh: "马克斯一路冲向补给，却在最后一步耗尽能量。补给就在眼前，他没能走过去。",
          ja: "物資に向かって走り続けたマックス。あと一歩でエネルギーが尽きた。目の前なのに、届かなかった。",
          ko: "보급품을 향해 달리던 맥스가 마지막 한 걸음 앞에서 에너지를 다 썼다. 눈앞에 있었지만 닿지 못했다.",
        },
      },
      {
        seq: 3,
        entities: ["preview-3"],
        beat: 379,
        kind: "first_blood" as const,
        belt: 2,
        text: {
          en: "Rex scored the season's first kill and spent his last energy doing it. One win, no next round.",
          zh: "雷克斯拿下本赛季首杀，也耗光了最后的能量。赢了第一场，没能等到第二场。",
          ja: "レックスが今シーズン最初の撃破を決めた。代償は最後のエネルギー。初戦は勝ったが、次の戦いは来なかった。",
          ko: "렉스가 시즌 첫 처치를 기록하며 마지막 에너지까지 썼다. 첫판은 이겼지만 다음 판은 없었다.",
        },
      },
      {
        seq: 4,
        entities: ["preview-4", "preview-8"],
        beat: 386,
        kind: "claim" as const,
        belt: 1,
        text: {
          en: "Anna claimed Max's wreck: 31% health became 64%. A moment ago she was running away. Now she's moving forward.",
          zh: "安娜回收了马克斯的残骸，生命从 31% 回到 64%。刚才还在逃命，现在又敢往前冲了。",
          ja: "アンナはマックスの残骸を回収し、体力が31%から64%に。さっきまで逃げていたのに、今は前へ進んでいる。",
          ko: "안나가 맥스의 잔해를 회수해 체력이 31%에서 64%로 올랐다. 방금까지 도망치던 안나가 다시 앞으로 나선다.",
        },
      },
      {
        seq: 5,
        entities: ["preview-5", "preview-6"],
        beat: 391,
        kind: "kill" as const,
        belt: 2,
        text: {
          en: "Leon led Jack around a rift, then turned and landed the final hit. The hunter fell first.",
          zh: "里昂把杰克引到裂缝旁，回身一刀结束战斗。追人的，反倒先倒下了。",
          ja: "レオンはジャックを亀裂のそばへ誘い、振り向きざまの一撃で倒した。追っていた側が、先に倒れた。",
          ko: "레온이 잭을 균열 옆으로 유인한 뒤 돌아서서 마지막 일격을 날렸다. 쫓던 쪽이 먼저 쓰러졌다.",
        },
      },
      {
        seq: 6,
        entities: ["preview-7"],
        beat: 398,
        kind: "death" as const,
        belt: 0,
        text: {
          en: "Lily held the supply point in the first belt, but couldn't hold on herself. The supplies outlasted their guard.",
          zh: "莉莉守住了第一地带的补给点，自己却没能撑到最后。补给还在，守它的人倒下了。",
          ja: "リリーは第1帯の物資を守り抜いたが、自分は最後まで持たなかった。物資は残り、守った者は倒れた。",
          ko: "릴리는 제1 구역의 보급 지점을 지켰지만 끝까지 버티지 못했다. 보급품은 남았고 지키던 이는 쓰러졌다.",
        },
      },
      {
        seq: 7,
        beat: 404,
        kind: "catastrophe" as const,
        belt: 1,
        text: {
          en: "The second belt collapsed. The race for supplies became a race to get out.",
          zh: "第二地带突然塌陷。刚才还在抢补给的人，转身开始抢着逃命。",
          ja: "第2帯が突然崩れた。物資を奪い合っていた者たちが、今度は逃げ足を競っている。",
          ko: "제2 구역이 갑자기 무너졌다. 보급품을 먼저 챙기려던 이들이 이제 먼저 도망치려 한다.",
        },
      },
      {
        seq: 8,
        entities: ["preview-2", "preview-3"],
        beat: 409,
        kind: "claim" as const,
        belt: 2,
        text: {
          en: "Luna missed the supplies and found Rex's wreck instead. Back to 92% health. Not a bad trade.",
          zh: "露娜没抢到补给，却捡到了雷克斯的残骸。生命回到 92%，这一趟反而赚了。",
          ja: "物資を逃したルナが見つけたのは、レックスの残骸。体力は92%まで回復。結果的には得をした。",
          ko: "루나는 보급품을 놓쳤지만 렉스의 잔해를 발견했다. 체력은 92%로 회복. 오히려 이득이었다.",
        },
      },
      {
        seq: 9,
        entities: ["preview-0", "preview-1"],
        beat: 412,
        kind: "kill" as const,
        belt: 2,
        text: {
          en: "At 8% health, Arthur looked like an easy kill. Kai rushed in. One hammer swing proved him wrong.",
          zh: "亚瑟只剩 8% 生命。凯追上来想收尾，却被他回身一锤反杀。",
          ja: "体力8%のアーサーを、カイは倒せると思った。飛び込んだ先で待っていたのは、最後のハンマーの一撃だった。",
          ko: "체력 8%의 아서를 본 카이가 마무리하러 달려들었다. 하지만 돌아선 아서의 망치 한 방에 오히려 쓰러졌다.",
        },
      },
    ],
  };
}
