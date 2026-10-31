import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PLAYER_TANK } from "@auro/core/tank-defense";
import { TankPreview } from "./tank-preview";
import * as painter from "./painter";

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ clearRect: vi.fn(), setTransform: vi.fn(), resetTransform: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(painter, "paintTank").mockImplementation(() => {});
});

it("draws the saved blueprint with the battle renderer and the selected difficulty's starting form", () => {
  const blueprint = { ...PLAYER_TANK, appearance: { body: "#000000", accent: "#000000", pattern: "solid" as const } };
  const view = render(<TankPreview blueprint={blueprint} name="Black Overlord" power={1} />);
  expect(screen.getByRole("img", { name: "Black Overlord" })).toHaveAttribute("data-character-id", blueprint.id);
  expect(painter.paintTank).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ blueprint, direction: "up", team: "player", moving: false }), 0, { power: 1, reducedMotion: true });
  view.rerender(<TankPreview blueprint={blueprint} name="Black Overlord" power={0} />);
  expect(painter.paintTank).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ blueprint }), 0, { power: 0, reducedMotion: true });
});
