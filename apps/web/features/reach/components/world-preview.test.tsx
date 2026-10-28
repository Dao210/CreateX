import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewSnapshot } from "../preview";
import { worldCopy } from "../i18n/en";
import { WorldPreview } from "./world-preview";
import type { WorldSnapshot } from "../types";

let snapshot: WorldSnapshot;
vi.mock("../use-world", () => ({ useWorld: () => ({ snapshot, season: null, source: "preview", active: true, reducedMotion: true }) }));
vi.mock("next/dynamic", () => ({ default: () => function Map({ onReady }: { onReady: () => void }) {
  useEffect(() => onReady(), [onReady]);
  return <div data-testid="canvas-ready" />;
} }));

beforeEach(() => {
  snapshot = previewSnapshot();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() { this.callback([{ isIntersecting: true }]); }
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount() { return render(<WorldPreview locale="en" copy={worldCopy}><svg aria-label="Poster" /></WorldPreview>); }

describe("world explorer", () => {
  it("connects creation selection, the chronicle and overview without changing the preview source", async () => {
    mount();
    await screen.findByTestId("canvas-ready");
    const explorer = screen.getByTestId("world-explorer");
    expect(screen.getByTestId("world-character-name")).toHaveTextContent("Arthur");
    fireEvent.click(within(screen.getByRole("group", { name: "Meet a creation" })).getByRole("button", { name: /Luna/ }));
    expect(explorer).toHaveAttribute("data-selected-entity", "preview-2");
    fireEvent.click(screen.getByRole("button", { name: /second belt collapsed/i }));
    expect(explorer).toHaveAttribute("data-selected-event", "7");
    expect(explorer).not.toHaveAttribute("data-selected-entity");
    expect(screen.getByTestId("world-character-name")).toHaveTextContent("Second belt");
    fireEvent.click(screen.getByRole("button", { name: "Whole world" }));
    expect(screen.getByTestId("world-map")).toHaveAttribute("data-view", "overview");
    fireEvent.click(screen.getByRole("button", { name: "Meet another" }));
    expect(screen.getByTestId("world-map")).toHaveAttribute("data-view", "following");
    expect(explorer).toHaveAttribute("data-world-source", "preview");
    expect(screen.getByRole("link", { name: "Create my first character" })).toHaveAttribute("href", "#create");
  });

  it("resets selection on a new world and handles an empty world without invented participants", async () => {
    const view = mount();
    await screen.findByTestId("canvas-ready");
    fireEvent.click(within(screen.getByRole("group", { name: "Meet a creation" })).getByRole("button", { name: /Luna/ }));
    snapshot = { ...snapshot, season: "another-world", entities: [], chronicle: [] };
    view.rerender(<WorldPreview locale="en" copy={worldCopy}><svg aria-label="Poster" /></WorldPreview>);
    expect(screen.getByText("The world is waiting for its next creation.")).toBeVisible();
    expect(screen.getByText("Nothing worth recording yet.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Meet another" })).toBeDisabled();
    expect(screen.queryByRole("group", { name: "Meet a creation" })).not.toBeInTheDocument();
  });
});
