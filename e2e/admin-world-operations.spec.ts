import { expect, test } from "@playwright/test";
import { TestApiClient } from "./fixtures";

test.skip(process.env.WORLD_OPS_E2E !== "1", "Run against an isolated managed environment with both fixture admins configured.");
test.use({ viewport: { width: 1360, height: 960 } });

const admin = new TestApiClient();
const second = new TestApiClient();
const owner = new TestApiClient();
const apiBase = process.env.NEXT_PUBLIC_API_URL || `http://localhost:${process.env.PORT || "8080"}`;
const suffix = `${Date.now().toString(36)}-${process.pid}`;
type World = Awaited<ReturnType<TestApiClient["createWorkspace"]>>;
const worlds: World[] = [];
let alpha: World;
let beta: World;

test.beforeAll(async () => {
  await admin.login("world-ops-e2e@example.invalid", "World Ops QA");
  await second.login("world-ops-second@example.invalid", "Second Ops QA");
  await owner.login(`world-ops-owner-${suffix}@example.invalid`, "World owner QA");
  alpha = await admin.createWorkspace(`World ops Alpha ${suffix}`, `world-ops-alpha-${suffix}`);
  worlds.push(alpha);
  beta = await admin.createWorkspace(`World ops Beta ${suffix}`, `world-ops-beta-${suffix}`);
  worlds.push(beta);
  await admin.markUserOnboarded();
});

test.afterAll(async () => {
  for (const world of worlds) {
    admin.setWorkspaceId(world.id);
    admin.setWorkspaceSlug(world.slug);
    await admin.deleteWorkspace();
  }
});

test("records a world visit, drills into that world, and follows up through closure", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const unauthorised = await fetch(`${apiBase}/api/admin/worlds`, {
    headers: { Authorization: `Bearer ${owner.getToken()}` },
  });
  expect(unauthorised.status).toBe(403);
  await page.context().addCookies([{ name: "auro-locale", value: "en", url: baseURL! }]);
  await page.addInitScript(token => localStorage.setItem("auro_token", token), admin.getToken()!);
  await page.bringToFront();
  const visit = page.waitForResponse(response => response.url().endsWith("/api/world-visit") && response.request().method() === "POST");
  await page.goto(`/${alpha.slug}/me`);
  expect((await visit).status()).toBe(204);

  await page.goto("/admin/worlds");
  await expect(page.getByRole("heading", { name: "World operations" })).toBeVisible();
  await expect.poll(() => page.locator(".admin-shell").evaluate(element => element.getBoundingClientRect().top)).toBe(0);
  await page.getByRole("button", { name: /Worlds with visits/ }).click();
  await expect(page).toHaveURL(/segment=visited/);
  await expect(page.getByRole("link", { name: alpha.name })).toBeVisible();
  await expect(page.getByRole("link", { name: beta.name })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("world-overview.png"), fullPage: true });
  await page.getByRole("link", { name: alpha.name }).click();
  await expect(page.getByRole("heading", { name: alpha.name })).toBeVisible();
  await page.getByRole("button", { name: "Start follow-up" }).click();
  let dialog = page.getByRole("dialog");
  const reason = dialog.getByLabel("Reason");
  await reason.focus();
  await reason.fill("Check first creation");
  await expect(reason).toHaveValue("Check first creation");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Check first creation")).toBeVisible();
  await page.getByRole("link", { name: "Back to worlds" }).click();
  await expect(page).toHaveURL(/segment=visited/);
  await page.getByRole("button", { name: "My open follow-ups", exact: true }).click();
  await expect(page.getByRole("link", { name: alpha.name })).toBeVisible();

  await page.getByRole("link", { name: alpha.name }).click();
  await page.getByRole("button", { name: "Edit follow-up" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Assignee").selectOption({ label: "Second Ops QA" });
  await dialog.getByLabel("Note").fill("Reproduced with a fixture");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Second Ops QA", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close follow-up" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Outcome").fill("Creation path confirmed");
  await dialog.getByRole("button", { name: "Close follow-up" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByText("Creation path confirmed")).toBeVisible();
  await expect(page.getByText("Reproduced with a fixture")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: alpha.name })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("world-detail-narrow.png"), fullPage: true });
  await page.getByRole("link", { name: "Back to worlds" }).click();
  await expect(page.getByText("No worlds match these filters.")).toBeVisible();
});
