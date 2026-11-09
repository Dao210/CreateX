import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "../test/i18n";
import { AIConnectionReturn } from "./ai-connection-return";

const mocks = vi.hoisted(() => ({ search: "", replace: vi.fn(), copy: vi.fn() }));
vi.mock("../navigation", () => ({ useNavigation: () => ({ pathname: "/acme/fish", searchParams: new URLSearchParams(mocks.search), hash: "#view", replace: mocks.replace }) }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.copy.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.copy } });
});

it.each(["tank-connect", "fish-connect"])("offers original-chat recovery for %s without claiming success", async source => {
  mocks.search = `from=${source}&fish=chosen&revision=2`;
  renderWithI18n(<AIConnectionReturn source={source} instructions="Full scoped connection request" />);
  const region = screen.getByRole("region", { name: "Continue in your AI tool" });
  expect(region).toHaveTextContent("Return to the conversation where you started connecting");
  expect(region).toHaveTextContent("Copy the full original task");
  expect(region).not.toHaveTextContent(/authorization complete|tools are connected/i);
  fireEvent.click(screen.getByRole("button", { name: "Copy continuation instructions" }));
  await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith("Full scoped connection request"));
  expect(await screen.findByRole("status")).toHaveTextContent("Return to the original AI conversation");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss connection guidance" }));
  expect(mocks.replace).toHaveBeenCalledWith("/acme/fish?fish=chosen&revision=2#view");
});

it("ignores unrelated source parameters", () => {
  mocks.search = "from=connected&mcp=connected";
  renderWithI18n(<AIConnectionReturn source="fish-connect" instructions="Task" />);
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
});
