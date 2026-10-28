import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorldWindow } from "./world-window";
import { previewSnapshot } from "../preview";

const gradient = { addColorStop: vi.fn() };
const context = {
  setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), createRadialGradient: () => gradient,
  createLinearGradient: () => gradient, setLineDash: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
  stroke: vi.fn(), fillText: vi.fn(), rect: vi.fn(), ellipse: vi.fn(), closePath: vi.fn(),
  fill: vi.fn(), arc: vi.fn(), save: vi.fn(), translate: vi.fn(), restore: vi.fn(),
  scale: vi.fn(), strokeRect: vi.fn(), drawImage: vi.fn(),
};
let frames: FrameRequestCallback[];
beforeEach(() => {
  frames = [];
  vi.stubGlobal("Path2D", class { constructor(_path: string) {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 1024, height: 512, left: 0, top: 0 } as DOMRect);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.clearAllMocks();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("world map rendering", () => {
  it("draws each silhouette at its own map coordinates", () => {
    const snapshot = { ...previewSnapshot(), entities: [{ ...previewSnapshot().entities[0]!, x: 640, y: 320, status: "alive" as const }] };
    const ready = vi.fn();
    render(<WorldWindow snapshot={snapshot} label="Map" onReady={ready} />);
    act(() => frames.shift()?.(100));
    expect(context.translate).toHaveBeenCalledWith(640, 320);
    expect(context.drawImage).toHaveBeenCalledOnce();
    const sceneDraws = context.fill.mock.calls.length;
    act(() => frames.shift()?.(200));
    expect(context.drawImage).toHaveBeenCalledTimes(2);
    expect(context.fill).toHaveBeenCalledTimes(sceneDraws);
    expect(ready).toHaveBeenCalledOnce();
  });
  it("uses the same focused map transform for pointer selection", () => {
    const snapshot = { ...previewSnapshot(), entities: [{ ...previewSnapshot().entities[0]!, x: 1000, y: 512, status: "alive" as const }] };
    const select = vi.fn();
    const view = render(<WorldWindow snapshot={snapshot} label="Map" focus={{ x: 1000, y: 512 }} onSelect={select} />);
    act(() => frames.shift()?.(100));
    // The followed entity lies at the center of this viewport.
    act(() => view.getByRole("img").dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 512, clientY: 256 })));
    expect(select).toHaveBeenCalledWith(snapshot.entities[0]!.id);
  });
  it("draws once for reduced motion and again when data changes", () => {
    const snapshot = previewSnapshot();
    const view = render(<WorldWindow snapshot={snapshot} label="Map" reducedMotion />);
    act(() => frames.shift()?.(100));
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    view.rerender(<WorldWindow snapshot={{ ...snapshot, beat: 413 }} label="Map" reducedMotion />);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
  });
  it("does no rendering work while the map is off screen", () => {
    render(<WorldWindow snapshot={previewSnapshot()} label="Map" active={false} />);
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
  it("leaves the server poster in place when Canvas is unavailable", () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    const ready = vi.fn();
    render(<WorldWindow snapshot={previewSnapshot()} label="Map" onReady={ready} />);
    expect(ready).not.toHaveBeenCalled();
  });
});
