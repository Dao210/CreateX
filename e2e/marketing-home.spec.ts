import { expect, test } from "@playwright/test";
import media from "../apps/web/features/play/media.json" with { type: "json" };
const clipFor = (game: keyof typeof media, width: number) => width < 768 ? media[game].mobileVideo : media[game].video;

const languages = [
  { locale: "en", lang: "en", creation: "Create a tank.", experience: "Defend the castle.", about: "About Weave a World" },
  { locale: "zh-Hans", lang: "zh-CN", creation: "创造一辆坦克，", experience: "保卫城堡。", about: "关于织个世界" },
  { locale: "ja", lang: "ja-JP", creation: "戦車を創って、", experience: "城を守ろう。", about: "Weave a World について" },
  { locale: "ko", lang: "ko-KR", creation: "탱크를 만들고,", experience: "성을 지키세요.", about: "Weave a World 소개" },
];

test.beforeEach(async ({ page }) => {
  await page.route("**/www.googletagmanager.com/**", route => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route("**/api/config", route => route.fulfill({ json: {} }));
});

for (const { locale, lang, creation, experience, about } of languages) {
  test(`public gameplay copy and navigation: ${locale}`, async ({ page }) => {
    const errors: string[] = [], applicationRequests: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (/\/api\/(users|me|workspaces|reach)|\/ws(?:\?|$)|\.(glb|gltf)(?:\?|$)/.test(request.url())) applicationRequests.push(request.url()); });
    await page.goto(`/?lang=${locale}`);
    await expect(page.locator("html")).toHaveAttribute("lang", lang);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(creation);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(experience);
    await expect(page.locator('main video')).toHaveCount(1);
    await expect(page.locator('main canvas')).toHaveCount(0);
    await expect(page.locator("footer a[aria-current=page]")).toHaveAttribute("hrefLang", locale);
    expect(applicationRequests).toEqual([]); expect(errors).toEqual([]);
    await page.goto(`/about?lang=${locale}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(about);
    expect(applicationRequests).toEqual([]); expect(errors).toEqual([]);
  });
}

test("real posters, creation links and FAQ work without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    const clips: string[] = []; page.on("request", r => { if (r.url().includes(".mp4")) clips.push(r.url()); });
    await page.goto("/?lang=en");
    await expect(page.locator('img[src*="/media/gameplay/tank."]').first()).toBeVisible();
    await expect(page.locator('video')).toHaveAttribute("poster", media.tank.poster);
    await expect(page.locator('video')).toHaveAttribute("preload", "none");
    expect(clips).toEqual([]);
    await expect(page.locator('#create a')).toHaveCount(3);
    const faq = page.locator('section[aria-labelledby="play-faq"] details').first();
    await faq.locator("summary").click(); await expect(faq.locator("p")).toBeVisible();
    await page.locator("footer a[hrefLang=ja]").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ja-JP");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("城を守ろう。");
  } finally { await context.close(); }
});

for (const { locale } of languages) {
  test(`mobile content and menu fit: ${locale}`, async ({ page }) => {
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 }); await page.goto(`/?lang=${locale}`);
      expect(await page.locator("main").evaluate(main => main.scrollWidth), `${locale} at ${width}px`).toBeLessThanOrEqual(width);
      await page.locator("header summary").click();
      const bounds = await page.locator("header details nav").boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.locator("header summary").click();
      const targets = await page.getByRole("tab").evaluateAll(elements => elements.map(e => e.getBoundingClientRect().height));
      expect(targets.every(height => height >= 44)).toBe(true);
      await page.locator("#create").scrollIntoViewIfNeeded();
      expect(await page.locator("main").evaluate(main => main.scrollWidth)).toBeLessThanOrEqual(width);
    }
  });
}

test("selection synchronizes the heading, real recording, example and creation intent", async ({ page }) => {
  const clips: string[] = []; page.on("request", request => { if (request.url().includes(".mp4")) clips.push(new URL(request.url()).pathname); });
  await page.goto("/?lang=en");
  const choices = [
    { label: "Tank", id: "tank", heading: "Create a tank.", example: "Terra" },
    { label: "Fish", id: "fish", heading: "Create a fish.", example: "Azure sail" },
    { label: "Resident", id: "resident", heading: "Create a resident.", example: "Rowan" },
  ] as const;
  for (const choice of choices) {
    await page.getByRole("tab", { name: new RegExp(choice.label) }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(choice.heading);
    await expect(page.getByRole("tabpanel")).toContainText(choice.example);
    const href = await page.locator(`[data-analytics-cta="hero_create_${choice.id}"]`).getAttribute("href");
    expect(new URL(href!, "https://local.test").searchParams.get("next")).toBe(`/onboarding?creation=${choice.id}`);
    await expect.poll(() => page.locator("video").evaluate(video => video.currentSrc && new URL(video.currentSrc).pathname)).toBe(clipFor(choice.id, page.viewportSize()!.width));
  }
  expect([...new Set(clips)]).toEqual(choices.map(choice => clipFor(choice.id, page.viewportSize()!.width)));
  await page.getByRole("tab", { name: /Resident/ }).focus(); await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: /Fish/ })).toBeFocused();
  await expect(page.getByRole("tab", { name: /Fish/ })).toHaveAttribute("aria-selected", "true");
});

test("only the current recording loads and playback pauses offscreen", async ({ page }) => {
  const clips: string[] = []; page.on("request", r => { if (r.url().includes(".mp4")) clips.push(new URL(r.url()).pathname); });
  await page.goto("/?lang=en");
  const frame = page.getByTestId("gameplay-media"); await expect(frame).toHaveAttribute("data-playing", "true");
  expect([...new Set(clips)]).toEqual([clipFor("tank", page.viewportSize()!.width)]);
  await page.locator("#how-it-works").scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator("video").evaluate(video => video.paused)).toBe(true);
  await frame.scrollIntoViewIfNeeded(); await expect(frame).toHaveAttribute("data-playing", "true");
  await page.getByRole("button", { name: "Pause gameplay recording" }).click();
  await expect.poll(() => page.locator("video").evaluate(video => video.paused)).toBe(true);
});

for (const mode of ["reduced motion", "data saver"] as const) {
  test(`${mode} keeps the poster until the visitor chooses to play`, async ({ page }) => {
    const clips: string[] = []; page.on("request", r => { if (r.url().includes(".mp4")) clips.push(r.url()); });
    if (mode === "reduced motion") await page.emulateMedia({ reducedMotion: "reduce" });
    else await page.addInitScript(() => Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true }));
    await page.goto("/?lang=en");
    await expect(page.getByRole("tab", { name: /Tank/ })).toBeEnabled();
    expect(clips).toEqual([]);
    expect(await page.locator("video").evaluate(video => video.paused)).toBe(true);
    await expect(page.locator("video")).toHaveAttribute("poster", media.tank.poster);
    await page.getByRole("button", { name: "Play gameplay recording" }).click();
    await expect(page.getByTestId("gameplay-media")).toHaveAttribute("data-playing", "true");
  });
}

test("playback and pause work before hydration and survive the React handoff", async ({ page }) => {
  let release!: () => void;
  const hydration = new Promise<void>(resolve => { release = resolve; });
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error" && /hydrat|didn't match/i.test(message.text())) errors.push(message.text()); });
  await page.route("**/_next/static/chunks/**", async route => { await hydration; await route.continue(); });
  try {
    await page.goto("/?lang=en", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("tab", { name: /Tank/ })).toBeDisabled();
    await expect(page.getByTestId("gameplay-media")).toHaveAttribute("data-playing", "true");
    await expect.poll(() => page.evaluate(() => performance.getEntriesByName("auro-gameplay-first-frame").length)).toBe(1);
    await page.getByRole("button", { name: "Pause gameplay recording" }).click();
    expect(await page.locator("video").evaluate(video => video.paused)).toBe(true);
    release();
    await expect(page.getByRole("tab", { name: /Tank/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Play gameplay recording" })).toBeVisible();
    expect(await page.locator("video").evaluate(video => video.paused)).toBe(true);
    await page.getByRole("button", { name: "Play gameplay recording" }).click();
    await expect(page.getByTestId("gameplay-media")).toHaveAttribute("data-playing", "true");
    expect(errors).toEqual([]);
  } finally { release(); }
});

test("a failed recording preserves the poster and supports a manual retry", async ({ page }) => {
  let retry = false;
  await page.route("**/media/gameplay/*.mp4", route => retry ? route.continue() : route.abort());
  await page.goto("/?lang=en");
  await expect(page.getByRole("status")).toContainText("recording could not load");
  await expect(page.getByTestId("gameplay-media").locator("img")).toBeVisible();
  await expect(page.locator('[data-analytics-cta="hero_create_tank"]')).toBeVisible();
  retry = true;
  await page.getByRole("button", { name: "Play gameplay recording" }).click();
  await expect(page.getByTestId("gameplay-media")).toHaveAttribute("data-playing", "true");
  await expect(page.getByRole("status")).not.toBeVisible();
});

test("an autoplay refusal keeps manual playback available", async ({ page }) => {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    let refused = false;
    HTMLMediaElement.prototype.play = function () {
      if (!refused) { refused = true; return Promise.reject(new DOMException("Blocked by browser policy", "NotAllowedError")); }
      return play.call(this);
    };
  });
  await page.goto("/?lang=en");
  await expect(page.getByRole("tab", { name: /Tank/ })).toBeEnabled();
  await page.getByRole("button", { name: "Play gameplay recording" }).click();
  await expect(page.getByTestId("gameplay-media")).toHaveAttribute("data-playing", "true");
});

test("mobile navigation reaches the actual game choices", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/about?lang=en");
  await page.locator("header summary").click();
  await page.locator("header").getByRole("link", { name: "Choose a game", exact: true }).click();
  await expect(page).toHaveURL(/#games$/); await expect(page.getByRole("tablist")).toBeInViewport();
});

test("the public page scrolls naturally with only marketing styles loaded", async ({ page, browserName }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=en");
  await expect(page.locator(".landing-light")).toHaveCSS("overflow-y", "auto");
  if (browserName === "webkit") {
    // Playwright mobile WebKit does not implement wheel gestures.
    await page.locator(".landing-light").evaluate(element => { element.scrollTop = 700; });
  } else {
    await page.mouse.move(180, 500);
    await page.mouse.wheel(0, 700);
  }
  await expect.poll(() => page.locator(".landing-light").evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});

test("the selected creation reaches login with its destination intact", async ({ page }) => {
  await page.route("**/api/config", route => route.fulfill({ json: { allow_signup: true } }));
  await page.route("**/api/me", route => route.fulfill({ status: 401, json: { error: "not authenticated" } }));
  await page.goto("/?lang=en"); await page.getByRole("tab", { name: /Fish/ }).click();
  await page.locator('[data-analytics-cta="hero_create_fish"]').click();
  await expect(page.locator("input[type=email]")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("next")).toBe("/onboarding?creation=fish");
});

test("legacy hero artwork still loads from hashed WebP files", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ status: 401, json: { error: "not authenticated" } }));
  await page.goto("/homepage?lang=en");
  for (const name of ["landing-bg", "landing-hero"]) {
    const image = page.locator(`img[src*='${name}.']`);
    await expect(image).toHaveAttribute("src", /\/_next\/static\/media\/.+\.webp$/);
    await expect.poll(() => image.evaluate(e => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0)).toBe(true);
  }
});

test("the root 404 renders without application providers", async ({ page }) => {
  const response = await page.goto("/about/missing?lang=zh-Hans"); expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("页面未找到");
});
