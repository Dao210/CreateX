import { test, expect } from "@playwright/test";
import { TestApiClient } from "./fixtures";

test.use({ viewport: { width: 1440, height: 980 }, actionTimeout: 10_000 });

test("world navigation, switching, and personal actions use the sidebar groups", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const run = `${Date.now().toString(36)}-${process.pid}`;
  const api = new TestApiClient();
  const worlds: Awaited<ReturnType<TestApiClient["createWorkspace"]>>[] = [];
  await api.login(`e2e-nav-${run}@auro.ai`, "导航测试");

  try {
    const first = await api.createWorkspace("青屿世界", `nav-first-${run}`);
    worlds.push(first);
    const second = await api.createWorkspace("星沙世界", `nav-second-${run}`);
    worlds.push(second);
    await api.markUserOnboarded();
    await page.context().addCookies([{ name: "auro-locale", value: "zh-Hans", url: baseURL! }]);
    await page.addInitScript(token => localStorage.setItem("auro_token", token!), api.getToken());
    await page.goto(`/${first.slug}/me`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "我的创作", exact: true })).toBeVisible({ timeout: 45_000 });

    const header = page.locator('[data-sidebar="header"]');
    const footer = page.locator('[data-sidebar="footer"]');
    await expect(header.getByRole("link", { name: first.name, exact: true })).toBeVisible();
    await expect(header.getByText(first.name, { exact: true })).toBeVisible();
    await expect(header.getByText("导航测试")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "探索" }).getByText("探索", { exact: true })).toBeVisible();
    await expect(footer.locator('[data-sidebar="menu-button"]')).toHaveText([
      /导航测试/,
      "帮助",
      "退出登录",
    ]);

    await header.getByRole("link", { name: "世界消息" }).click();
    await expect(page).toHaveURL(`/${first.slug}/inbox`);
    await expect(page.getByRole("heading", { name: "世界消息", exact: true })).toBeVisible({ timeout: 30_000 });

    await header.getByRole("link", { name: first.name, exact: true }).click();
    await expect(page).toHaveURL(`/${first.slug}/settings?tab=workspace`);
    await expect(page.getByRole("heading", { name: "世界资料" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "切换世界" }).click();
    await expect(page.getByText("当前世界", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: second.name, exact: true }).click();
    await expect(page).toHaveURL(`/${second.slug}/me`);
    await expect(header.getByRole("link", { name: second.name, exact: true })).toBeVisible();

    await footer.getByRole("link", { name: /导航测试.*账号设置/ }).click();
    await expect(page).toHaveURL(`/${second.slug}/settings?tab=profile`);
    await footer.getByRole("button", { name: "帮助" }).click();
    await expect(page.getByRole("menuitem", { name: "反馈" })).toBeVisible();
    await page.keyboard.press("Escape");
    await footer.getByRole("button", { name: "退出登录" }).click();
    const confirm = page.getByRole("alertdialog", { name: "退出登录" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "取消" }).click();
    await expect(confirm).toBeHidden();
    await expect(page).toHaveURL(`/${second.slug}/settings?tab=profile`);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${second.slug}/me`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "我的创作", exact: true })).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-sidebar="trigger"]').click();
    await expect(footer.getByText("个人账号", { exact: true })).toBeVisible();
    await header.getByRole("link", { name: second.name, exact: true }).click();
    await expect(page).toHaveURL(`/${second.slug}/settings?tab=workspace`);
    await expect(page.locator('[data-mobile="true"][data-sidebar="sidebar"]')).toBeHidden();
    await expect(page.getByRole("heading", { name: "世界资料" })).toBeVisible({ timeout: 30_000 });
  } finally {
    for (const world of worlds.reverse()) {
      api.setWorkspaceId(world.id);
      api.setWorkspaceSlug(world.slug);
      await api.deleteWorkspace();
    }
  }
});
