import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "../test/i18n";
import { AIInstructionCopy } from "./ai-instruction-copy";

const writeText = vi.fn();
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

it("allows inspecting the complete request before copying", async () => {
  renderWithI18n(<AIInstructionCopy instructions="A complete task" label="Copy task" />);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View full instructions" }));
  expect(await screen.findByRole("textbox", { name: "Full instructions" })).toHaveValue("A complete task");
  expect(writeText).not.toHaveBeenCalled();
});

it("clears obsolete copy feedback and errors when the task changes", async () => {
  const { rerender } = renderWithI18n(<AIInstructionCopy instructions="Public fish" label="Copy task" />);
  fireEvent.click(screen.getByRole("button", { name: "Copy task" }));
  expect(await screen.findByRole("status")).toHaveTextContent("paste into a WorkBuddy or Codex conversation");
  rerender(<AIInstructionCopy instructions="Private fish" label="Copy task" />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  writeText.mockRejectedValueOnce(new Error("denied"));
  fireEvent.click(screen.getByRole("button", { name: "Copy task" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Select the text below");
  const fallback = await screen.findByRole("textbox", { name: "Full instructions" });
  expect(fallback).toHaveAttribute("readonly");
  expect(fallback).toHaveValue("Private fish");
  fireEvent.focus(fallback);
  expect((fallback as HTMLTextAreaElement).selectionEnd).toBe("Private fish".length);
  rerender(<AIInstructionCopy instructions="Another fish" label="Copy task" />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Copy task" }));
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("Another fish"));
  expect(await screen.findByRole("status")).toBeVisible();
});
