// @vitest-environment node
import { describe, expect, it } from "vitest";
import { searchVerification } from "./search-verification";

describe("search console verification", () => {
  it("emits only configured, nonblank verification tokens under the correct provider names", () => {
    expect(searchVerification({ GOOGLE_SITE_VERIFICATION: " google-token ", BING_SITE_VERIFICATION: "bing-token", BAIDU_SITE_VERIFICATION: "baidu-token" })).toEqual({
      google: "google-token",
      other: { "msvalidate.01": "bing-token", "baidu-site-verification": "baidu-token" },
    });
    expect(searchVerification({ GOOGLE_SITE_VERIFICATION: "  ", BING_SITE_VERIFICATION: "", BAIDU_SITE_VERIFICATION: "\n" })).toEqual({ other: {} });
    expect(searchVerification({})).toEqual({ other: {} });
  });
});
