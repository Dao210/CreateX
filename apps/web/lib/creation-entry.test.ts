// @vitest-environment node
import { describe, expect, it } from "vitest";
import { creationDestination, creationFromNextUrl, creationLoginHref, parseCreation } from "./creation-entry";

describe("marketing creation entry", () => {
  it.each(["tank", "fish", "resident"] as const)("preserves the %s intent through login", game => {
    const url = new URL(creationLoginHref("zh-Hans", game), "https://example.test");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("lang")).toBe("zh-Hans");
    expect(url.searchParams.get("next")).toBe(`/onboarding?creation=${game}`);
    expect(creationFromNextUrl(url.searchParams.get("next")!)).toBe(game);
    expect(parseCreation(game)).toBe(game);
  });
  it.each([null, "", "tanks", "https://evil.test", "../admin"])("ignores unsupported intent %s", value => expect(parseCreation(value)).toBeNull());
  it.each([undefined, "", "/invite/abc?creation=fish", "/onboarding?creation=tanks", "https://evil.test/onboarding?creation=fish", "//evil.test/onboarding?creation=fish", "/\\evil.test/onboarding?creation=fish"])("ignores unrelated or unsafe login destination %s", value => {
    expect(creationFromNextUrl(value)).toBeNull();
  });
  it("resolves the chosen world feature without losing the creation action", () => {
    expect(creationDestination("my world", "tank")).toBe("/my%20world/tanks?create=1");
    expect(creationDestination("bay", "fish")).toBe("/bay/fish?create=1");
    expect(creationDestination("town", "resident")).toBe("/town/life?create=1");
  });
});
