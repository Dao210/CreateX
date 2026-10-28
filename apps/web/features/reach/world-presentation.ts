import { WORLD_HEIGHT, WORLD_WIDTH, type Chronicle, type EntityView, type WorldSnapshot } from "./types";

export type WorldPoint = { x: number; y: number };
export type WorldSelection = { kind: "entity"; id: string } | { kind: "event"; seq: number } | { kind: "overview" };

export function featuredEntity(snapshot: WorldSnapshot): EntityView | undefined {
  for (const event of [...snapshot.chronicle].reverse()) {
    const entity = snapshot.entities.find((item) => item.status === "alive" && event.entities?.includes(item.id));
    if (entity) return entity;
  }
  return snapshot.entities.find((entity) => entity.status === "alive") ?? snapshot.entities[0];
}

export function eventEntity(snapshot: WorldSnapshot, event: Chronicle): EntityView | undefined {
  const participants = (event.entities ?? []).flatMap((id) => snapshot.entities.filter((entity) => entity.id === id));
  return participants.find((entity) => entity.status === "alive") ?? participants[0];
}

export function eventLocation(snapshot: WorldSnapshot, event: Chronicle): WorldPoint | undefined {
  const entity = eventEntity(snapshot, event);
  if (entity) return entity;
  // A Chronicle belt is zero-based. Never infer positions from translated prose.
  if (event.belt !== undefined && event.belt >= 0 && event.belt < 3) {
    return { x: (event.belt + 0.5) * WORLD_WIDTH / 3, y: WORLD_HEIGHT / 2 };
  }
}

export function resolveSelection(snapshot: WorldSnapshot, selection: WorldSelection | null) {
  const event = selection?.kind === "event" ? snapshot.chronicle.find((item) => item.seq === selection.seq) : undefined;
  const entity = selection?.kind === "entity"
    ? snapshot.entities.find((item) => item.id === selection.id) ?? featuredEntity(snapshot)
    : event ? eventEntity(snapshot, event) : featuredEntity(snapshot);
  const focus = selection?.kind === "overview" ? undefined : event ? eventLocation(snapshot, event) : entity;
  return { entity, event, focus };
}

export function worldView(width: number, height: number, focus?: WorldPoint) {
  const scale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT) * (focus ? (width < 600 ? 2.7 : 1.7) : 0.94);
  const clampCenter = (value: number, viewport: number, world: number, inset: number) => viewport >= world ? world / 2 : Math.max(viewport / 2 - inset, Math.min(world - viewport / 2 + inset, value));
  const centerX = focus ? clampCenter(focus.x, width / scale, WORLD_WIDTH, 56 / scale) : WORLD_WIDTH / 2;
  const centerY = focus ? clampCenter(focus.y, height / scale, WORLD_HEIGHT, 96 / scale) : WORLD_HEIGHT / 2;
  const offsetX = width / 2 - centerX * scale;
  const offsetY = height / 2 - centerY * scale;
  return { scale, offsetX, offsetY };
}

export function hitEntity(entities: EntityView[], point: WorldPoint, radius: number): EntityView | undefined {
  let closest: EntityView | undefined;
  let distance = radius;
  for (const entity of entities) {
    if (entity.status !== "alive") continue;
    const next = Math.hypot(entity.x - point.x, entity.y - point.y);
    if (next < distance) { closest = entity; distance = next; }
  }
  return closest;
}

export function chronicleLanguage(event: Chronicle, locale: string): string {
  if (locale.startsWith("zh")) return "zh-Hans";
  if (locale === "ja" && event.text.ja) return "ja";
  if (locale === "ko" && event.text.ko) return "ko";
  return "en";
}
