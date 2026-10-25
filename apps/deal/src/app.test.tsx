import { afterEach, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DealApp } from "./app";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});
function mount() {
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={query}>
      <DealApp />
    </QueryClientProvider>,
  );
}
it("does not enable a new game when the model is unconfigured", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          '{"mode":"llm","ready":false,"scenario_version":"the-debt@1"}',
        ),
      ),
  );
  mount();
  expect(await screen.findByText(/AI 尚未配置/)).toBeVisible();
  expect(screen.getByRole("button", { name: "坐到桌前" })).toBeDisabled();
});
it("labels practice mode clearly and enables the independent entrance", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          '{"mode":"scripted","ready":true,"scenario_version":"the-debt@1"}',
        ),
      ),
  );
  mount();
  expect(await screen.findByText("规则试玩")).toBeVisible();
  expect(screen.getByRole("button", { name: "坐到桌前" })).toBeEnabled();
  expect(screen.queryByText("工作区")).not.toBeInTheDocument();
});
