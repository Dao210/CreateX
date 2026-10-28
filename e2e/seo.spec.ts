import { expect, test } from "@playwright/test";

const origin = "https://weavea.world";
const locales = ["en", "zh-Hans", "ja", "ko"] as const;

test.describe("search engine HTML", () => {
  test.use({ javaScriptEnabled: false, userAgent: "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)" });

  for (const locale of ["en", "zh-Hans"] as const) {
    for (const path of ["/", "/about"] as const) {
      test(`${path} serves complete ${locale} SEO without JavaScript`, async ({ page, context, baseURL }) => {
        await context.addCookies([{ name: "auro-locale", value: locale === "en" ? "zh-Hans" : "en", url: baseURL! }]);
        await page.setExtraHTTPHeaders({ "Accept-Language": locale === "en" ? "zh-CN" : "en-US" });
        const response = await page.goto(`${path}?lang=${locale}&utm_source=seo-test`);
        expect(response?.status()).toBe(200);
        const canonical = `${origin}${path}?lang=${locale}`;
        await expect(page.locator("html")).toHaveAttribute("lang", locale === "en" ? "en" : "zh-CN");
        await expect(page.locator("head title")).toHaveCount(1);
        const title = await page.title();
        expect(title).toContain(locale === "en" ? "Weave a World" : "织个世界");
        await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute("href", canonical);
        for (const language of locales) {
          await expect(page.locator(`head link[rel="alternate"][hreflang="${language}"]`)).toHaveAttribute("href", `${origin}${path}?lang=${language}`);
        }
        const defaultHref = await page.locator('head link[hreflang="x-default"]').getAttribute("href");
        expect(new URL(defaultHref!).href).toBe(new URL(`${origin}${path}`).href);
        const description = await page.locator('head meta[name="description"]').getAttribute("content");
        expect(description).toContain(locale === "en" ? "Weave a World" : "织个世界");
        await expect(page.locator('head meta[name="robots"]')).toHaveAttribute("content", "index, follow");
        await expect(page.locator('head meta[property="og:url"]')).toHaveAttribute("content", canonical);
        await expect(page.locator('head meta[property="og:locale"]')).toHaveAttribute("content", locale === "en" ? "en_US" : "zh_CN");
        await expect(page.locator('head meta[property="og:title"]')).toHaveAttribute("content", title);
        await expect(page.locator('head meta[property="og:description"]')).toHaveAttribute("content", description!);
        await expect(page.locator('head meta[name="twitter:description"]')).toHaveAttribute("content", description!);
        await expect(page.locator('head meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
        await expect(page.locator('head meta[property="og:image"]')).toHaveAttribute("content", `${origin}/images/weave-a-world-social.png`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const data = JSON.parse(await page.locator('script[type="application/ld+json"]').innerText());
        expect(data["@graph"]).toContainEqual(expect.objectContaining({
          "@type": path === "/" ? "WebPage" : "AboutPage", url: canonical,
          inLanguage: locale, description, name: title,
        }));
        expect(data["@graph"]).toContainEqual(expect.objectContaining({ "@type": "VideoGame" }));
      });
    }
  }

  test("French preferences receive correctly labeled English marketing content", async ({ page }) => {
    await page.goto("/?lang=fr");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute("href", `${origin}/?lang=en`);
    await expect(page.locator('footer a[aria-current="page"]')).toHaveAttribute("hrefLang", "en");
  });

  test("account and inherited product pages remain excluded from indexing", async ({ page }) => {
    for (const path of ["/login", "/privacy", "/homepage", "/admin"]) {
      await page.goto(`${path}?lang=zh-Hans`);
      await expect(page.locator('head meta[name="robots"]')).toHaveAttribute("content", /\bnoindex\b/);
    }
  });

  test("missing pages return a real 404 with noindex", async ({ page }) => {
    const response = await page.goto("/about/missing?lang=zh-Hans");
    expect(response?.status()).toBe(404);
    expect(await page.locator('meta[name="robots"][content*="noindex"]').count()).toBeGreaterThan(0);
  });
});

test("discovery endpoints advertise only canonical public pages and reciprocal languages", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  const xml = await response.text();
  expect(response.headers()["content-type"]).toContain("xml");
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  expect(new Set(urls).size).toBe(8);
  for (const path of ["/", "/about"]) {
    for (const locale of locales) expect(urls).toContain(`${origin}${path}?lang=${locale}`);
  }
  expect(xml).toContain('hreflang="zh-Hans"');
  expect(xml).not.toContain("<lastmod>");
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  const rules = await robots.text();
  expect(rules).toContain(`Sitemap: ${origin}/sitemap.xml`);
  expect(rules).toContain("Disallow: /api/");
  expect(rules).not.toMatch(/Disallow: \/(?:login|about|agents|settings|auth)/);
  const image = await request.get("/images/weave-a-world-social.png");
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toContain("image/png");
});
