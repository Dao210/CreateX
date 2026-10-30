import { expect, test } from "@playwright/test";
import { json, mockWorkspaceRequests } from "./perf/fixtures/workspace-api";
import { USER_ID, WORKSPACE_ID, WORKSPACE_SLUG } from "./perf/fixtures/typing-under-live-runs";

// Browser/asset wiring only: synthetic API responses, no account or DB resources.
test("connection instructions and installation files work in the production Web UI", async ({ page, context, baseURL }, testInfo) => {
  const origin = new URL(baseURL!).origin;
  const diagnostics = { unknownRequests: [] as string[], external: [] as string[] };
  await context.addCookies([
    { name: "auro_logged_in", value: "1", url: origin },
    { name: "last_workspace_slug", value: WORKSPACE_SLUG, url: origin },
  ]);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await mockWorkspaceRequests(context, origin, diagnostics);
  await context.route("**/api/game-progress", async route => {
    if (route.request().method() === "OPTIONS") return route.fallback();
    return route.fulfill({ ...json({ workspaceId: WORKSPACE_ID, siege: null, tanks: null }), headers: { "access-control-allow-origin": origin, "access-control-allow-credentials": "true" } });
  });
  await context.routeWebSocket(url => url.pathname === "/ws", socket => { socket.onMessage(() => {}); });
  await page.goto(`/${WORKSPACE_SLUG}/tanks?lang=zh-Hans`);
  await page.getByRole("button", { name: "连接 Agent", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "手动配置" })).toHaveAttribute("aria-expanded", "false");
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  await dialog.getByRole("button", { name: "复制连接指令" }).click();
  await expect(dialog.getByRole("button", { name: "已复制", exact: true })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const data = JSON.parse(copied.slice(copied.indexOf("{\n")));
  expect(data).toMatchObject({ workspace_id: WORKSPACE_ID, user_id: USER_ID, app_url: origin });
  expect(data).not.toHaveProperty("token");
  const guide = await page.request.get(data.setup_url);
  expect(guide.status()).toBe(200);
  expect(await guide.text()).toContain("ready-to-register");
  const connector = await page.request.get(data.connector_url);
  expect(connector.status()).toBe(200);
  expect(await connector.text()).toContain("export async function install");
  await page.screenshot({ path: testInfo.outputPath("connection-desktop.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("connection-mobile.png") });
  await dialog.getByRole("button", { name: "手动配置" }).click();
  await expect(dialog.getByRole("textbox", { name: "CLI 执行文件" })).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  expect(box!.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("connection-manual-mobile.png") });
  expect(diagnostics.unknownRequests).toEqual([]);
});
