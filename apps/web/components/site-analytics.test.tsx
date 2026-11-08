import { StrictMode } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/", loadAnalytics: vi.fn(), captureEvent: vi.fn(), initAnalytics: vi.fn(), captureSignupSource: vi.fn(), analyticsPath: vi.fn(() => "/safe") }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.pathname = "/";
  vi.doMock("@auro/core/analytics", () => { mocks.loadAnalytics(); return mocks; });
});
afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); vi.unstubAllGlobals(); });

it("waits for video playback, but flushes an early CTA with its original attribution", async () => {
  window.history.replaceState({}, "", "/?utm_source=original&code=private");
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ posthog_key: "test-key" }) });
  vi.stubGlobal("fetch", fetch);
  const { SiteAnalytics } = await import("./site-analytics");
  const view = render(<><div data-gameplay="tank"><video /></div><SiteAnalytics /><button data-analytics-cta="hero_create_tank">Create</button></>);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Create" }));
  window.history.replaceState({}, "", "/login");
  await waitFor(() => expect(mocks.captureEvent).toHaveBeenCalledTimes(2));
  expect(mocks.captureSignupSource).toHaveBeenCalledWith(expect.objectContaining({ search: "?utm_source=original&code=private" }));
  expect(mocks.analyticsPath).toHaveBeenCalledWith("/");
  expect(mocks.analyticsPath).not.toHaveBeenCalledWith("/login");
});

it("does not download the analytics SDK when public configuration disables it", async () => {
  const json = vi.fn().mockResolvedValue({});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json }));
  const { SiteAnalytics } = await import("./site-analytics");
  render(<SiteAnalytics />);
  await waitFor(() => expect(json).toHaveBeenCalledOnce());
  expect(mocks.loadAnalytics).not.toHaveBeenCalled();
  expect(mocks.captureEvent).not.toHaveBeenCalled();
});

it("boots without application providers, captures one pageview in StrictMode, and wires explicit CTAs", async () => {
  const { SiteAnalytics } = await import("./site-analytics");
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
