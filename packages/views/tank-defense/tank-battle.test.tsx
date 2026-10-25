import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import type { StorageAdapter } from "@auro/core/types";
import { TankDefenseGame } from "@auro/core/tank-defense";
import { renderWithI18n } from "../test/i18n";
import { TankBattle } from "./tank-battle";
import * as painter from "./painter";

function records() {
  const values = new Map<string, string>();
  const storage: StorageAdapter = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
  return { storage, values };
}
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });

describe("tank battle operations", () => {

  it("offers all six maps in arcade modes and returns to an unlocked campaign map", () => {
    const { storage } = records(); renderWithI18n(<TankBattle storage={storage} storageKey="fixture" />);
    expect(screen.getByRole("button", { name: /Last Citadel/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /90-second blitz/ }));
    expect(screen.getByRole("button", { name: /Last Citadel/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Last Citadel/ }));
    expect(screen.getByRole("heading", { name: "Last Citadel" })).toBeInTheDocument();
    expect(screen.getByTestId("tank-battlefield")).toHaveAttribute("data-mode", "blitz");
    expect(screen.getByRole("timer")).toHaveTextContent("90s left");
    fireEvent.click(screen.getByRole("button", { name: /Campaign/ }));
    expect(screen.getByRole("heading", { name: "Brick Front" })).toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });

  it("keeps mode and map changes disabled throughout a battle, including pause", () => {
    const { storage } = records(); renderWithI18n(<TankBattle storage={storage} storageKey="fixture" />);
    fireEvent.click(screen.getByRole("button", { name: /Endless defense/ }));
    fireEvent.click(screen.getByRole("button", { name: /Supply Depot/ }));
    expect(screen.getByText("Conveyor")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start defense" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByTestId("tank-battlefield")).toHaveAttribute("data-paused", "true");
    expect(screen.getByRole("button", { name: /Campaign/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Brick Front/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    expect(screen.getByTestId("tank-battlefield")).toHaveAttribute("data-phase", "ready");
    expect(screen.getByRole("button", { name: /Campaign/ })).toBeEnabled();
  });

  it("defaults to casual, remembers the chosen difficulty and carries it across modes", () => {
    const { storage, values } = records();
    const view = renderWithI18n(<TankBattle storage={storage} storageKey="fixture" />);
    expect(screen.getByTestId("tank-battlefield")).toHaveAttribute("data-difficulty", "casual");
    expect(screen.getByTestId("tank-battlefield")).toHaveAttribute("data-lives", "5");
    expect(screen.getByTestId("tank-battlefield")).toHaveAttribute("data-player-hp", "2");
    fireEvent.click(screen.getByRole("button", { name: "Standard" }));
    expect(screen.getByTestId("tank-battlefield")).toHaveAttribute("data-lives", "3");
    expect(screen.getByTestId("tank-battlefield")).toHaveAttribute("data-base-hp", "1");
    expect(JSON.parse(values.get("fixture")!).difficulty).toBe("standard");
    fireEvent.click(screen.getByRole("button", { name: /90-second blitz/ }));
    expect(screen.getByTestId("tank-battlefield")).toHaveAttribute("data-difficulty", "standard");
    view.unmount();
    renderWithI18n(<TankBattle storage={storage} storageKey="fixture" />);
    expect(screen.getByRole("button", { name: "Standard" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Start defense" }));
    expect(screen.getByRole("button", { name: "Casual" })).toBeDisabled();
  });

  it("keeps the content pane scroll position when starting or replacing a battle", () => {
    const { storage } = records(); const view = renderWithI18n(<TankBattle storage={storage} storageKey="fixture" />);
    const pane = view.container.querySelector<HTMLElement>(".tank-defense-app")!;
    let scrollTop = 240;
    Object.defineProperty(pane, "scrollTop", { configurable: true, get: () => scrollTop, set: value => { scrollTop = Math.min(Math.max(value, 0), 800); } });
    fireEvent.click(screen.getByRole("button", { name: /90-second blitz/ }));
    expect(pane.scrollTop).toBe(240);
    fireEvent.click(screen.getByRole("button", { name: "Start defense" }));
    expect(pane.scrollTop).toBe(240);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Resume" })[0]!);
    expect(pane.scrollTop).toBe(240);
  });

  it("reports a denied fullscreen request without replacing the current battle", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "requestFullscreen");
    const request = vi.fn().mockRejectedValue(new Error("Denied"));
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: request });
    try {
      const { storage } = records(); renderWithI18n(<TankBattle storage={storage} storageKey="fixture" />);
      fireEvent.click(screen.getByRole("button", { name: "Start defense" }));
      fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not enter full screen");
      expect(screen.getByTestId("tank-battlefield")).toHaveAttribute("data-phase", "running");
      expect(screen.getByTestId("tank-defense-page")).toHaveAttribute("data-fullscreen", "false");
    } finally {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, "requestFullscreen", descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
    }
  });

});

describe("tank battlefield keyboard input", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
    vi.spyOn(painter, "paintTankBattle").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("consumes space on stage completion without advancing or carrying fire into the next stage", () => {
    vi.spyOn(TankDefenseGame.prototype, "step").mockImplementationOnce(function (this: TankDefenseGame) {
      this.phase = "cleared"; this.kills = 12; this.score = 6550; this.clearInput();
    });
    const { storage } = records(); renderWithI18n(<TankBattle storage={storage} storageKey="fixture" />);
    const battlefield = screen.getByTestId("tank-battlefield");
    fireEvent.click(screen.getByRole("button", { name: "Start defense" }));
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole("heading", { name: "Stage defended" })).toBeInTheDocument();
    expect(screen.getByText("12 tanks defeated · 6550 points")).toBeInTheDocument();
    expect(battlefield).toHaveFocus();

    for (const repeat of [false, true]) {
      const space = new KeyboardEvent("keydown", { code: "Space", key: " ", repeat, bubbles: true, cancelable: true });
      fireEvent(battlefield, space);
      expect(space.defaultPrevented).toBe(true);
    }
    act(() => vi.advanceTimersByTime(100));
    expect(battlefield).toHaveAttribute("data-phase", "cleared");
    expect(battlefield).toHaveAttribute("data-shots", "0");
    expect(screen.getByRole("heading", { name: "Brick Front" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next stage" }));
    act(() => vi.advanceTimersByTime(100));
    expect(battlefield).toHaveAttribute("data-phase", "running");
    expect(battlefield).toHaveAttribute("data-shots", "0");
    expect(screen.getByRole("heading", { name: "Frozen Crossing" })).toBeInTheDocument();
    fireEvent.keyUp(battlefield, { code: "Space", key: " " });
    fireEvent.keyDown(battlefield, { code: "Space", key: " " });
    fireEvent.keyUp(battlefield, { code: "Space", key: " " });
    act(() => vi.advanceTimersByTime(100));
    expect(Number(battlefield.getAttribute("data-shots"))).toBeGreaterThan(0);
  });

  it("consumes game controls while ready or paused, keeping button and outside keyboard behavior available", () => {
    const { storage } = records(); renderWithI18n(<TankBattle storage={storage} storageKey="fixture" />);
    const battlefield = screen.getByTestId("tank-battlefield");
    battlefield.focus();
    expect(fireEvent.keyDown(battlefield, { code: "Space", key: " " })).toBe(false);
    expect(battlefield).toHaveAttribute("data-phase", "ready");
    fireEvent.click(screen.getByRole("button", { name: "Start defense" }));
    fireEvent.keyDown(battlefield, { code: "KeyP", key: "p" });
    expect(battlefield).toHaveAttribute("data-paused", "true");
    expect(fireEvent.keyDown(battlefield, { code: "Space", key: " " })).toBe(false);
    expect(fireEvent.keyDown(battlefield, { code: "ArrowDown", key: "ArrowDown" })).toBe(false);
    act(() => vi.advanceTimersByTime(100));
    expect(battlefield).toHaveAttribute("data-paused", "true");
    expect(battlefield).toHaveAttribute("data-shots", "0");

    const resume = screen.getAllByRole("button", { name: "Resume" })[0]!;
    resume.focus();
    expect(fireEvent.keyDown(resume, { code: "Space", key: " " })).toBe(true);
    act(() => resume.blur());
    expect(fireEvent.keyDown(document.body, { code: "Space", key: " " })).toBe(true);
  });
});
