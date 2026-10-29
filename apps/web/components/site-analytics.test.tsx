import { StrictMode } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/", captureEvent: vi.fn(), initAnalytics: vi.fn(), captureSignupSource: vi.fn(), analyticsPath: vi.fn(() => "/safe") }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@auro/core/analytics", () => mocks);
import { SiteAnalytics } from "./site-analytics";

it("boots without application providers, captures one pageview in StrictMode, and wires explicit CTAs", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ posthog_key: "test-key", posthog_host: "/api/collect", analytics_environment: "dev" }) }));
  const tree = () => <StrictMode><SiteAnalytics /><button data-analytics-cta="header_play">Play</button></StrictMode>;
  const view = render(tree());
  await waitFor(() => expect(mocks.captureEvent).toHaveBeenCalledTimes(1));
  expect(mocks.initAnalytics).toHaveBeenCalledWith({ key: "test-key", host: "/api/collect", environment: "dev" });
  expect(mocks.captureSignupSource).toHaveBeenCalledOnce();
  expect(mocks.captureEvent).toHaveBeenCalledWith("$pageview", expect.objectContaining({ page: "/safe", $pathname: "/safe" }));
  fireEvent.click(view.getByRole("button", { name: "Play" }));
  await waitFor(() => expect(mocks.captureEvent).toHaveBeenCalledWith("cta_clicked", expect.objectContaining({ cta: "header_play", page: "/safe" }), { sendInstantly: true }));
  mocks.pathname = "/private/tanks";
  view.rerender(tree());
  await waitFor(() => expect(mocks.captureEvent.mock.calls.filter(([name]) => name === "$pageview")).toHaveLength(2));
  expect(mocks.analyticsPath).toHaveBeenCalledWith("/private/tanks");
  view.unmount();
  vi.unstubAllGlobals();
});
