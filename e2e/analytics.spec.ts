import { test, expect, type Request } from "@playwright/test";
import { gunzipSync } from "node:zlib";

type CapturedEvent = { event: string; properties: Record<string, unknown> };

test.use({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36" });

function capturedEvents(request: Request): CapturedEvent[] {
  let body = request.postDataBuffer();
  if (!body) return [];
  if (body[0] === 31 && body[1] === 139) body = gunzipSync(body);
  let text = body.toString("utf8");
  if (!text.startsWith("{") && !text.startsWith("[")) {
    const data = new URLSearchParams(text).get("data");
    if (!data) return [];
    text = Buffer.from(data, "base64").toString("utf8");
  }
  const parsed = JSON.parse(text) as CapturedEvent | CapturedEvent[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

test("marketing sends explicit, scrubbed pageviews and CTA events through the real SDK", async ({ page }) => {
  const events: CapturedEvent[] = [];
  await page.route("**/www.googletagmanager.com/**", route => route.fulfill({ contentType: "application/javascript", body: "" }));
  // Exercise the SDK's human-visitor path; its automation filter otherwise drops events.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "userAgentData", { get: () => undefined });
  });
  // No accounts or database fixtures: the collector and public config are isolated.
  await page.route("**/api/config", route => route.fulfill({ json: {
    posthog_key: "phc_analytics_e2e", posthog_host: "https://collector.example.invalid", analytics_environment: "dev",
  } }));
  await page.route("https://collector.example.invalid/**", async route => {
    const request = route.request();
    if (request.method() === "POST" && /\/(e|capture|batch)\/?$/.test(new URL(request.url()).pathname)) {
      events.push(...capturedEvents(request));
    }
    await route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: request.url().includes(".js") ? "application/javascript" : "application/json", body: "{}" });
  });
  await page.goto("/?utm_source=analytics-qa&code=secret-token");
  await expect.poll(() => events.filter(event => event.event === "$pageview" && event.properties.page === "/").length, { timeout: 20000 }).toBe(1);
  await page.locator('[data-analytics-cta="hero_create_tank"]').click();
  await expect(page).toHaveURL(/\/login/);
  await expect.poll(() => events.some(event => event.event === "cta_clicked" && event.properties.cta === "hero_create_tank"), { timeout: 10000 }).toBe(true);
  await page.goto("/about?token=another-secret");
  await expect.poll(() => events.some(event => event.event === "$pageview" && event.properties.page === "/about"), { timeout: 20000 }).toBe(true);
  expect(JSON.stringify(events)).not.toContain("secret-token");
  expect(JSON.stringify(events)).not.toContain("another-secret");
  expect(events.some(event => event.event === "$autocapture")).toBe(false);
  expect(events.filter(event => event.event === "$pageview").every(event => event.properties.environment === "dev")).toBe(true);
});
