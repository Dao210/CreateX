import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "../test/i18n";
import { TankMCPConnection } from "./tank-mcp-connection";

vi.mock("@auro/core/api", () => ({ api: { getBaseUrl: () => "https://api.example.test" } }));
vi.mock("../navigation", () => ({ useNavigation: () => ({ getShareableUrl: (path: string) => `https://play.example.test${path}` }) }));

const workspace = { id: "11111111-1111-4111-8111-111111111111", slug: "acme", name: "Acme" };
const userId = "22222222-2222-4222-8222-222222222222";
const writeText = vi.fn();
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

async function open() {
  renderWithI18n(<TankMCPConnection workspace={workspace} userId={userId} />);
  fireEvent.click(screen.getByRole("button", { name: "Connect Agent" }));
  return screen.findByRole("dialog");
}

it("offers one instruction-copy action without asking the user to select a client or find a CLI", async () => {
  await open();
  expect(screen.getByRole("button", { name: "Copy connection instructions" })).toBeVisible();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Copy connection instructions" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  const text = writeText.mock.calls[0]![0] as string;
  expect(text).toContain("do not create characters or game sessions");
  const context = JSON.parse(text.slice(text.indexOf("{\n")));
  expect(context).toMatchObject({
    setup_url: "https://play.example.test/.well-known/tanks-mcp/setup.md",
    connector_url: "https://play.example.test/.well-known/tanks-mcp/connect.mjs",
    server_url: "https://api.example.test",
    app_url: "https://play.example.test",
    workspace_id: workspace.id,
    workspace_name: "Acme",
    user_id: userId,
  });
  expect(context).not.toHaveProperty("token");
  expect(await screen.findByRole("button", { name: "Copied" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Paste the instructions");
});

it("reveals selectable instructions and a retry action when clipboard access fails", async () => {
  writeText.mockRejectedValueOnce(new Error("clipboard unavailable"));
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Copy connection instructions" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Copy failed");
  const fallback = screen.getByRole("textbox", { name: "Copy connection instructions" });
  expect(fallback).toHaveAttribute("readonly");
  expect((fallback as HTMLTextAreaElement).value).toContain(workspace.id);
  fireEvent.click(screen.getByRole("button", { name: "Copy connection instructions" }));
  expect(await screen.findByRole("button", { name: "Copied" })).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("keeps manual CLI configuration behind an explicit expandable control", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Manual configuration" }));
  const command = await screen.findByRole("textbox", { name: "CLI executable" });
  fireEvent.change(command, { target: { value: "/path with spaces/auro" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Agent client" }), { target: { value: "json" } });
  fireEvent.click(screen.getByRole("button", { name: "Copy configuration" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  expect(JSON.parse(writeText.mock.calls[0]![0]).mcpServers.auro_tanks.command).toBe("/path with spaces/auro");
  expect(screen.getByLabelText("Sign in to this connection profile")).toHaveTextContent("AURO_APP_URL='https://play.example.test'");
  expect(screen.getByRole("link", { name: "Installation and troubleshooting" })).toHaveAttribute("href", "https://play.example.test/.well-known/tanks-mcp/setup.md");
  expect(screen.getByRole("button", { name: "Copy connection instructions" })).toBeVisible();
});

it("presents the simplified Chinese flow", async () => {
  renderWithI18n(<TankMCPConnection workspace={workspace} userId={userId} />, { locale: "zh-Hans" });
  fireEvent.click(screen.getByRole("button", { name: "连接 Agent" }));
  expect(await screen.findByRole("button", { name: "复制连接指令" })).toBeVisible();
  expect(screen.getByText("首次连接时，可能需要登录游戏所用的账号。")).toBeVisible();
  expect(screen.getByRole("button", { name: "手动配置" })).toHaveAttribute("aria-expanded", "false");
});
