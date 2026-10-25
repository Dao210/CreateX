import { test, expect } from "@playwright/test";
import { TestApiClient } from "./fixtures";

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`civilization loading fits ${viewport.width}px and automatically enters the workspace`, async ({ page, context, baseURL }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: viewport.width === 390 ? "dark" : "light" });
    await context.addCookies([{ name: "auro-locale", value: "zh-Hans", url: baseURL! }]);
    const api = new TestApiClient();
    await api.login(`civilization-shell-${viewport.width}-${Date.now()}@localhost`, "新文明测试");
    await page.addInitScript((token) => localStorage.setItem("auro_token", token!), api.getToken());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/me/onboarding/complete", async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({ completion_path: "workspace_ready" });
      await gate;
      await route.continue();
    });
    try {
      await page.goto("/onboarding");
      await expect(page.getByRole("heading", { name: "新文明", exact: true })).toBeVisible();
      await expect(page.getByRole("status")).toHaveText("正在进入工作区…", { timeout: 30000 });
      await expect(page.getByRole("textbox")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const headingBox = await page.getByRole("heading", { name: "新文明", exact: true }).boundingBox();
      expect(headingBox!.y + headingBox!.height).toBeLessThan(viewport.height);
      await page.screenshot({ path: testInfo.outputPath(`civilization-${viewport.width}.png`) });
      release();
      await expect(page).toHaveURL(/\/[^/]+\/issues$/, { timeout: 30000 });
    } finally {
      release();
      for (const workspace of await api.getWorkspaces()) {
        api.setWorkspaceId(workspace.id);
        await api.deleteWorkspace();
      }
    }
  });
}
