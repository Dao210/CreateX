// @vitest-environment node
import { describe, expect, it } from "vitest";
import { publicPageMetadata, gameStructuredData } from "./seo";
import { localizedHref } from "./marketing-urls";
import sitemap from "../app/sitemap";
import robots from "../app/robots";

describe("game search identity", () => {
  it.each(["en", "zh-Hans"] as const)("gives %s its own canonical and reciprocal language links", (locale) => {
    for (const path of ["/", "/about"] as const) {
      const metadata = publicPageMetadata(path, locale);
      expect(metadata.alternates?.canonical).toBe(`${path}?lang=${locale}`);
      expect(metadata.alternates?.languages).toMatchObject({
        en: `https://weavea.world${path}?lang=en`,
        "zh-Hans": `https://weavea.world${path}?lang=zh-Hans`,
        "x-default": `https://weavea.world${path}`,
      });
      expect(metadata.robots).toMatchObject({ index: true, follow: true });
      expect(JSON.stringify(metadata)).not.toMatch(/auro\.ai|REACH|Project Management/);
    }
  });

  it("uses the supplied Chinese identity and game category", () => {
    const metadata = publicPageMetadata("/", "zh-Hans");
    expect(metadata.title).toEqual({ absolute: "织个世界 — 创造型冒险与虚拟文明模拟游戏" });
    expect(metadata.description).toContain("创造生命，编织世界");
    expect(metadata.openGraph).toMatchObject({ siteName: "Weave a World", locale: "zh_CN" });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("describes a game and both brand names without invented commercial claims", () => {
    const data = gameStructuredData("en");
    expect(data["@graph"]).toEqual(expect.arrayContaining([
      expect.objectContaining({ "@type": "WebSite", name: "Weave a World", alternateName: "织个世界" }),
      expect.objectContaining({ "@type": "VideoGame", applicationCategory: "GameApplication" }),
    ]));
    expect(JSON.stringify(data)).not.toMatch(/offers|aggregateRating|ProjectManagement|auro\.ai/);
  });

  it("lists only indexable game pages and language variants on the canonical domain", () => {
    const entries = sitemap();
    for (const entry of entries) {
      const url = new URL(entry.url);
      expect(url.origin).toBe("https://weavea.world");
      expect(["/", "/about"]).toContain(url.pathname);
      expect(entry.lastModified).toBeUndefined();
    }
    expect(entries.map((entry) => entry.url)).toContain("https://weavea.world/?lang=zh-Hans");
    expect(robots().sitemap).toBe("https://weavea.world/sitemap.xml");
  });

  it("preserves page anchors and query parameters in language links", () => {
    expect(localizedHref("/?ref=share#rules", "zh-Hans")).toBe("/?ref=share&lang=zh-Hans#rules");
  });
});
