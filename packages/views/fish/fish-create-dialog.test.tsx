import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "../test/i18n";
import { FishCreateDialog } from "./fish-create-dialog";

vi.mock("@auro/core/api", () => ({ api: { getBaseUrl: () => "https://api.example.test" } }));
vi.mock("../navigation", () => ({ useNavigation: () => ({ pathname: "/acme/fish", searchParams: new URLSearchParams(), hash: "", replace: vi.fn(), getShareableUrl: (path: string) => `https://play.example.test${path}` }) }));
vi.mock("./fish-editor", () => ({ FishDesignForm: () => null }));
const writeText = vi.fn();
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

it("keeps the creative brief and publication choice in the copied task and resets obsolete feedback", async () => {
  const onSave = vi.fn();
  renderWithI18n(<FishCreateDialog workspace={{ id: "world", slug: "acme", name: "Acme" }} userId="user" onSave={onSave} pending={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Create a fish" }));
  expect(await screen.findByRole("button", { name: "Copy creation instructions" })).toHaveAccessibleDescription("On first use, you’ll be guided through sign-in and authorization, then creation continues.");
  fireEvent.change(await screen.findByRole("textbox", { name: "Fish name (optional)" }), { target: { value: "Pearl" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Describe your fish (optional)" }), { target: { value: "A flowing white tail" } });
  fireEvent.click(screen.getByRole("button", { name: "Copy creation instructions" }));
  await screen.findByRole("status");
  fireEvent.click(screen.getByRole("checkbox", { name: "Release into the Great Trench after creation" }));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByText("Save the creation and return a private preview link without publishing.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Copy creation instructions" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
  const text = writeText.mock.calls[1]![0] as string;
  expect(JSON.parse(text.split("\n\n")[1]!)).toMatchObject({
    workspace_id: "world", user_id: "user", setup_url: "https://play.example.test/.well-known/fish-mcp/setup.md",
    creation: { name: "Pearl", description: "A flowing white tail", destination: "preview" },
  });
  expect(onSave).not.toHaveBeenCalled();
});
