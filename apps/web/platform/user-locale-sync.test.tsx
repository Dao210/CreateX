import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const route = vi.hoisted(() => ({
  pathname: null as string | null,
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => route.searchParams,
}));

import { useUserLocaleSyncEnabled } from "./user-locale-sync";

describe("useUserLocaleSyncEnabled", () => {
  beforeEach(() => {
    route.pathname = null;
    route.searchParams = new URLSearchParams();
  });

  it("waits for the callback to finish before resuming locale synchronization", () => {
    const { result, rerender } = renderHook(useUserLocaleSyncEnabled);
    expect(result.current).toBe(false);

    route.pathname = "/auth/callback";
    rerender();
    expect(result.current).toBe(false);

    route.pathname = "/onboarding";
    rerender();
    expect(result.current).toBe(true);
  });

  it("also pauses on a callback path with a trailing slash", () => {
    route.pathname = "/auth/callback/";

    const { result } = renderHook(useUserLocaleSyncEnabled);

    expect(result.current).toBe(false);
  });

  it.each(["en", "zh-Hans", "ja", "ko", "fr"])(
    "keeps an explicit %s language URL from triggering account locale reloads",
    (locale) => {
      route.pathname = "/privacy";
      route.searchParams = new URLSearchParams({ lang: locale });

      const { result } = renderHook(useUserLocaleSyncEnabled);

      expect(result.current).toBe(false);
    },
  );

  it.each(["", "invalid", "zh"])(
    "still synchronizes the account locale when lang=%s is not supported",
    (locale) => {
      route.pathname = "/privacy";
      route.searchParams = new URLSearchParams({ lang: locale });

      const { result } = renderHook(useUserLocaleSyncEnabled);

      expect(result.current).toBe(true);
    },
  );

  it("updates the account locale policy when only the query changes", () => {
    route.pathname = "/privacy";
    const { result, rerender } = renderHook(useUserLocaleSyncEnabled);
    expect(result.current).toBe(true);

    route.searchParams = new URLSearchParams("lang=en");
    rerender();
    expect(result.current).toBe(false);

    route.searchParams = new URLSearchParams("ref=footer");
    rerender();
    expect(result.current).toBe(true);
  });
});
