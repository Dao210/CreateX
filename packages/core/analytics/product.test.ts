// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseWithFallback } from "../api/schema";
import { AnalyticsPublicConfigSchema } from "./config";
import { analyticsPath, sanitizeAnalyticsProperties } from "./product";

describe("analytics privacy boundary", () => {
  it.each([
    ["/", "/"], ["/login?code=secret", "/login"],
    ["/acme-secret/tanks?session=private", "/workspace/tanks"],
    ["/acme-secret/siege/campaign#private", "/workspace/siege/campaign"],
    ["/acme/chat/private-id", "/workspace/chat"], ["/auth/callback?token=secret", "/auth"],
  ])("normalizes %s to %s", (path, expected) => expect(analyticsPath(path)).toBe(expected));

  it("scrubs SDK-generated first-touch URLs, referrers and person fields", () => {
    const properties = {
      email: "private@example.com", name: "Private", $title: "Private workspace",
      $current_url: "https://weavea.world/acme/tanks?session=secret",
      $pathname: "/acme/tanks",
      $referrer: "https://identity.example/callback?code=secret",
      $set_once: { $initial_current_url: "https://weavea.world/login?code=secret", email: "private@example.com" },
    };
    sanitizeAnalyticsProperties(properties);
    expect(properties).toEqual({
      $current_url: "https://weavea.world/workspace/tanks", $pathname: "/workspace/tanks", $referrer: "https://identity.example",
      $set_once: { $initial_current_url: "https://weavea.world/login" },
    });
  });

  it("accepts absent configuration and disables capture on malformed public responses", () => {
    expect(parseWithFallback({}, AnalyticsPublicConfigSchema, null, { endpoint: "test" })).toEqual({});
    expect(parseWithFallback({ posthog_key: 42 }, AnalyticsPublicConfigSchema, null, { endpoint: "test" })).toEqual({ posthog_key: undefined });
    expect(parseWithFallback(null, AnalyticsPublicConfigSchema, null, { endpoint: "test" })).toBeNull();
    expect(parseWithFallback({ posthog_key: null }, AnalyticsPublicConfigSchema, null, { endpoint: "test" })).toEqual({ posthog_key: undefined });
  });
});
