import { expect, test } from "@playwright/test";

const languages = [
  { locale: "en", lang: "en", heading: "Create a Life. Weave a World.", about: "About Weave a World" },
  { locale: "zh-Hans", lang: "zh-CN", heading: "创造生命，编织世界", about: "关于织个世界" },
  { locale: "ja", lang: "ja-JP", heading: "生命を創り、世界を織りなす。", about: "Weave a World について" },
  { locale: "ko", lang: "ko-KR", heading: "생명을 만들고, 세계를 엮으세요.", about: "Weave a World 소개" },
];

for (const { locale, lang, heading, about } of languages) {
  test(`public marketing copy and navigation: ${locale}`, async ({ page }) => {
    const errors: string[] = [];
    const applicationRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (/\/api\/(config|users|me|workspaces)|\/ws(?:\?|$)/.test(request.url())) applicationRequests.push(request.url());
    });
    await page.route("**/api/reach/**", (route) => route.fulfill({ status: 503, body: "unavailable" }));
    await page.goto(`/?lang=${locale}`);
    await expect(page.locator("html")).toHaveAttribute("lang", lang);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.locator("footer a[aria-current=page]")).toHaveAttribute("hrefLang", locale);
    expect(applicationRequests).toEqual([]);
    expect(errors).toEqual([]);
    await page.goto(`/about?lang=${locale}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(about);
    await expect(page.locator("footer a[aria-current=page]")).toHaveAttribute("href", `/about?lang=${locale}`);
    expect(applicationRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("the first map and language navigation work without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto("/?lang=en");
  await expect(page.locator("svg[role=img]")).toBeVisible();
  expect(await page.locator("svg[role=img] path").count()).toBeGreaterThan(4);
  await page.locator("footer a[hrefLang=ja]").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja-JP");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("生命を創り、世界を織りなす。");
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Weave a World について");
  await context.close();
});

test("the map survives malformed data and a missing Canvas context", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => { HTMLCanvasElement.prototype.getContext = () => null; });
  await page.route("**/api/reach/**", (route) => route.fulfill({ json: { entities: null, chronicle: {} } }));
  await page.goto("/?lang=en");
  await expect(page.locator("svg[role=img]")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(languages[0]!.heading);
  await expect.poll(() => errors).toEqual([]);
});

test("mobile navigation opens and the page fits the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/reach/**", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto("/?lang=en");
  await page.locator("summary").click();
  await page.locator("details").getByRole("link", { name: "About Weave a World" }).click();
  await expect(page).toHaveURL(/\/about\?lang=en$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("the login entry still initializes application providers", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/config", (route) => route.fulfill({ json: { allow_signup: true } }));
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "not authenticated" } }));
  const config = page.waitForRequest("**/api/config");
  await page.goto("/?lang=en");
  await page.locator("header a[href='/login?lang=en']").click();
  await config;
  await expect(page.locator("input[type=email]")).toBeVisible();
  expect(errors).toEqual([]);
});

test("legacy hero artwork loads directly from hashed WebP files", async ({ page }) => {
  await page.route("**/api/config", (route) => route.fulfill({ json: { allow_signup: true } }));
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "not authenticated" } }));
  await page.goto("/homepage?lang=en");
  for (const name of ["landing-bg", "landing-hero"]) {
    const image = page.locator(`img[src*='${name}.']`);
    await expect(image).toHaveAttribute("src", /\/_next\/static\/media\/.+\.webp$/);
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
  }
});

test("the live map stops drawing offscreen and honors reduced motion", async ({ page }) => {
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.clearRect;
    Object.assign(window, { mapDraws: 0 });
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      (window as unknown as { mapDraws: number }).mapDraws++;
      return original.apply(this, args);
    };
  });
  await page.route("**/api/reach/state", (route) => route.fulfill({ json: {
    season: "test-season", beat: 1, version: 1, rulesVersion: "reach@1", digest: "test",
    rifts: [512], supplies: [], entities: [{ id: "test", name: "Test character", kind: "character", x: 900, y: 512, hp: 100, status: "alive", palette: ["#14161A", "#C8622D", "#E8E1D5"], silhouette: "broad" }], wrecks: [], chronicle: [],
  } }));
  await page.route("**/api/reach/season/current", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto("/?lang=en");
  const draws = () => page.evaluate(() => (window as unknown as { mapDraws: number }).mapDraws);
  await expect.poll(draws).toBeGreaterThan(2);
  await page.getByRole("heading", { name: "A world that runs on its own" }).scrollIntoViewIfNeeded();
  await expect(page.locator("canvas")).not.toBeInViewport();
  await expect(page.getByTestId("world-explorer")).toBeInViewport();
  await page.waitForTimeout(150);
  const hiddenDraws = await draws();
  await page.waitForTimeout(300);
  expect(await draws()).toBe(hiddenDraws);
  await page.locator("canvas").scrollIntoViewIfNeeded();
  await expect.poll(draws).toBeGreaterThan(hiddenDraws);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(150);
  const stillDraws = await draws();
  await page.waitForTimeout(300);
  expect(await draws()).toBe(stillDraws);
});

test("the root 404 renders without application providers", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("/about/missing?lang=zh-Hans");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("页面未找到");
  expect(errors).toEqual([]);
});
