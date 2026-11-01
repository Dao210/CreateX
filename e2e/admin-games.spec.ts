import { test, expect } from "@playwright/test";
import { TestApiClient } from "./fixtures";

// This scenario changes global policies. Run only against an explicitly isolated
// managed environment whose AURO_ADMIN_EMAILS includes the fixture email.
test.skip(process.env.GAME_ADMIN_E2E !== "1", "Set GAME_ADMIN_E2E=1 against an isolated managed API/Web environment.");
test.use({ viewport: { width: 1440, height: 1000 } });
const apiBase = process.env.NEXT_PUBLIC_API_URL || `http://localhost:${process.env.PORT || "8080"}`;
const suffix = `${Date.now().toString(36)}-${process.pid}`;
type World = Awaited<ReturnType<TestApiClient["createWorkspace"]>>;
type Policy = { gameId: string; scope: string; defaultVisible: boolean; overrides: { workspaceId: string; access: string; visibility: string }[]; revision: number };
let admin: TestApiClient;
let outsider: TestApiClient;
let alpha: World;
let beta: World;
const worlds: World[] = [];
let baseline: Policy[] = [];

async function call(path: string, options: { method?: string; body?: unknown; world?: World; client?: TestApiClient } = {}) {
  const headers: Record<string, string> = { Authorization: `Bearer ${(options.client ?? admin).getToken()}`, "Content-Type": "application/json" };
  if (options.world) headers["X-Workspace-ID"] = options.world.id;
  return fetch(`${apiBase}${path}`, { method: options.method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
}
async function policies(): Promise<Policy[]> {
  const response = await call("/api/admin/games");expect(response.status).toBe(200);
  return (await response.json()).games.map((game: { policy: Policy }) => game.policy);
}
async function save(id: string, change: Partial<Policy>) {
  const current = (await policies()).find(item => item.gameId === id)!;
  const response = await call(`/api/admin/games/${id}/policy`, { method: "PUT", body: { scope: current.scope, defaultVisible: current.defaultVisible, overrides: current.overrides, ...change, expectedRevision: current.revision } });
  expect(response.status).toBe(200);return response.json();
}
async function effective(world: World) {
  const response = await call("/api/games", { world });expect(response.status).toBe(200);return (await response.json()).games;
}
test.beforeAll(async () => {
  admin = new TestApiClient();await admin.login(process.env.GAME_ADMIN_E2E_EMAIL || "game-admin-e2e@example.invalid", "Game admin QA");
  const access = await call("/api/admin/access");expect((await access.json()).isAdmin).toBe(true);
  baseline = await policies();
  alpha = await admin.createWorkspace("Game policy Alpha", `game-alpha-${suffix}`);worlds.push(alpha);
  beta = await admin.createWorkspace("Game policy Beta", `game-beta-${suffix}`);worlds.push(beta);
  await admin.markUserOnboarded();
  outsider = new TestApiClient();await outsider.login(`game-owner-${suffix}@example.invalid`, "World owner QA");
  await outsider.createWorkspace("Owner QA", `game-owner-${suffix}`);await outsider.markUserOnboarded();
});
test.afterAll(async () => {
  for (const policy of baseline) await save(policy.gameId, { scope: policy.scope, defaultVisible: policy.defaultVisible, overrides: policy.overrides });
  if (outsider) { await outsider.deleteWorkspace();await outsider.cleanup(); }
  for (const world of worlds) { admin.setWorkspaceId(world.id);admin.setWorkspaceSlug(world.slug);await admin.deleteWorkspace(); }
  await admin?.cleanup();
});

test("global policies, module routes, world inheritance, hidden access and server restrictions", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(180000);
  await page.context().addCookies([{ name: "auro-locale", value: "en", url: baseURL! }]);
  await page.addInitScript(token => localStorage.setItem("auro_token", token), admin.getToken()!);
  await page.goto("/admin");await expect(page.getByRole("heading", { name: "Game management", exact: true })).toBeVisible({ timeout: 45000 });
  await page.getByRole("link", { name: "MCP services", exact: true }).click();await expect(page).toHaveURL(/\/admin\/mcp$/);
  await page.reload();await expect(page.getByRole("heading", { name: "MCP services", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Game management", exact: true }).click();await expect(page).toHaveURL(/\/admin\/games$/);
  const defaultEntry = page.getByRole("switch", { name: "Show in sidebar by default" });
  if (await defaultEntry.isChecked()) await defaultEntry.click();
  await expect(page.getByRole("button", { name: "Save policy" })).toBeEnabled();await page.getByRole("button", { name: "Save policy" }).click();
  await expect.poll(async () => (await effective(alpha)).find((game: { gameId: string }) => game.gameId === "siege")).toMatchObject({ available: true, visible: false });
  await page.goto(`/${alpha.slug}/siege`);await expect(page.getByTestId("siege-page")).toBeVisible({ timeout: 45000 });
  await expect(page.locator('[data-sidebar="sidebar"]').getByRole("link", { name: "Siege", exact: true })).toHaveCount(0);
  await page.keyboard.press("Meta+k");await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByPlaceholder("Type a command or search...").fill("siege");await expect(page.getByRole("option", { name: "Siege" })).toBeVisible();await page.keyboard.press("Escape");

  await page.goto("/admin/games");
  await page.getByRole("combobox", { name: "Availability", exact: true }).selectOption("selected");
  await page.getByRole("searchbox", { name: "Find a world" }).fill(alpha.slug);
  await page.getByRole("button", { name: `Add exception for ${alpha.name}` }).click();
  await expect(page.getByRole("button", { name: "Save policy" })).toBeEnabled();await page.getByRole("button", { name: "Save policy" }).click();
  await expect.poll(async () => (await effective(beta)).find((game: { gameId: string }) => game.gameId === "siege").available).toBe(false);
  const later = await admin.createWorkspace("Created after policy", `game-later-${suffix}`);worlds.push(later);
  expect((await effective(later)).find((game: { gameId: string }) => game.gameId === "siege").available).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("admin-games-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("link", { name: "MCP services", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("admin-games-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: /Agent Life/ }).click();await expect(page.getByText("Not initialized", { exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "All worlds" })).toHaveCount(0);
  expect((await call("/api/life", { world: alpha })).status).toBe(403);

  await page.goto(`/${beta.slug}/siege`);await expect(page.getByText("This game is not open in the current world.")).toBeVisible();
  expect((await call("/api/siege/library", { world: beta })).status).toBe(403);
  expect((await call("/api/games", { world: alpha, client: outsider })).status).toBe(404);
  expect((await call("/api/admin/games", { client: outsider })).status).toBe(403);
  await save("tanks", { scope: "disabled" });
  for (const path of ["/api/tanks/v1/catalog", "/api/tanks/mcp"]) expect((await call(path, { world: alpha })).status).toBe(403);
  expect((await call("/api/game-progress/tanks", { method: "PUT", world: alpha, body: { best: 100, unlocked: 2 } })).status).toBe(403);
  const progress = await call("/api/game-progress", { world: alpha });expect((await progress.json()).tanks).toBeNull();
  const activity = await call("/api/admin/games/siege/activity");expect((await activity.json()).items.length).toBeGreaterThanOrEqual(2);
  await page.context().addCookies([{ name: "auro-locale", value: "zh-Hans", url: baseURL! }]);
  await page.goto("/admin/games");await expect(page.getByRole("heading", { name: "游戏管理", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("admin-games-desktop-zh.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("link", { name: "MCP 服务", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("admin-games-mobile-zh.png"), fullPage: true });
});
