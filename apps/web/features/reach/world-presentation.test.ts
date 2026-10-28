// @vitest-environment node
import { describe, expect, it } from "vitest";
import { previewSnapshot } from "./preview";
import { eventLocation, featuredEntity, hitEntity, resolveSelection, worldView } from "./world-presentation";

describe("world story navigation", () => {
  it("follows a living participant in a recent event, including after the feed changes", () => {
    const snapshot = previewSnapshot();
    const selected = featuredEntity(snapshot)!;
    expect(selected.status).toBe("alive");
    expect(snapshot.chronicle.at(-1)?.entities).toContain(selected.id);
    expect(resolveSelection({ ...snapshot, entities: [] }, { kind: "entity", id: selected.id }).entity).toBeUndefined();
    expect(resolveSelection(snapshot, { kind: "event", seq: -1 }).entity).toEqual(selected);
  });

  it("locates events by participant IDs or a valid belt without guessing from event text", () => {
    const snapshot = previewSnapshot();
    expect(eventLocation(snapshot, snapshot.chronicle.at(-1)!)).toEqual(featuredEntity(snapshot));
    const event = { ...snapshot.chronicle[0]!, entities: ["missing"], belt: 2 };
    expect(eventLocation(snapshot, event)).toEqual({ x: 2048 * 2.5 / 3, y: 512 });
    expect(eventLocation(snapshot, { ...event, belt: 8 })).toBeUndefined();
    expect(eventLocation(snapshot, { ...event, belt: undefined })).toBeUndefined();
  });

  it("fits the whole world in overview and keeps a followed edge entity on screen on mobile", () => {
    const overview = worldView(360, 380);
    expect(overview.offsetX).toBeGreaterThanOrEqual(0);
    expect(overview.offsetY).toBeGreaterThanOrEqual(0);
    for (const point of [{ x: 0, y: 0 }, { x: 2048, y: 1024 }]) {
      const camera = worldView(360, 380, point);
      expect(point.x * camera.scale + camera.offsetX).toBeGreaterThanOrEqual(48);
      expect(point.x * camera.scale + camera.offsetX).toBeLessThanOrEqual(360 - 48);
    }
  });

  it("selects the nearest living entity and ignores empty space and fallen entities", () => {
    const entity = previewSnapshot().entities[0]!;
    const other = { ...entity, id: "other", x: entity.x + 80, status: "alive" as const };
    expect(hitEntity([{ ...entity, status: "dead" }, other], entity, 30)).toBeUndefined();
    expect(hitEntity([entity, other], other, 30)?.id).toBe("other");
    expect(resolveSelection(previewSnapshot(), { kind: "overview" }).focus).toBeUndefined();
  });
});
