import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@auro/core/api";
import { newTown, seedResidents, type LifeSnapshot } from "@auro/core/agent-life";
import locale from "../locales/zh-Hans/life.json";
import { ResidentTalk } from "./town-forms";

vi.mock("@auro/core/api", async original => ({ ...await original<typeof import("@auro/core/api")>(), api: { submitTownCommand: vi.fn() } }));

vi.mock("../i18n", () => ({ useT: () => ({ t: (selector: (resource: typeof locale) => string, variables?: Record<string, string>) => {
  let text = selector(locale);
  for (const [key, value] of Object.entries(variables ?? {})) text = text.replaceAll(`{{${key}}}`, value);
  return text;
} }) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });
const wsId = "a11fe000-0000-4000-8000-000000000001";
function showTalk() {
  const agents = seedResidents(1), town = newTown(agents);
  town.model.mode = "llm"; town.model.state = "ready";
  const data: LifeSnapshot = { world: { id: wsId, workspaceId: wsId, tick: 0, tickMs: 2000, updatedAt: "2026-11-06T00:00:00Z" }, agents, resources: [], actions: [], events: [], eventCursor: 0, town };
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><ResidentTalk workspaceId={wsId} data={data} residentId={agents[0]!.id} /></QueryClientProvider>);
  return { input: screen.getByRole("textbox", { name: "和 Mika 聊聊" }), submit: screen.getByRole("button", { name: "发送" }) };
}
it("keeps a failed transport retry's identity and message", async () => {
  const write = vi.spyOn(api, "submitTownCommand").mockRejectedValueOnce(new Error("network"))
    .mockResolvedValue({ id: wsId, kind: "message" });
  const { input, submit } = showTalk();
  fireEvent.change(input, { target: { value: "你好" } }); fireEvent.click(submit);
  await screen.findByRole("alert");
  expect(input).toHaveValue("你好");
  fireEvent.click(submit);
  await waitFor(() => expect(input).toHaveValue(""));
  expect(write).toHaveBeenCalledTimes(2);
  expect(write.mock.calls[0]![1].requestId).toBe(write.mock.calls[1]![1].requestId);
});
it("starts a new intention when an acknowledged message is deliberately sent again", async () => {
  const write = vi.spyOn(api, "submitTownCommand").mockResolvedValue({ id: wsId, kind: "message" });
  const { input, submit } = showTalk();
  fireEvent.change(input, { target: { value: "你好" } }); fireEvent.click(submit);
  await waitFor(() => expect(input).toHaveValue(""));
  fireEvent.change(input, { target: { value: "你好" } }); fireEvent.click(submit);
  await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  expect(write.mock.calls[0]![1].requestId).not.toBe(write.mock.calls[1]![1].requestId);
});
