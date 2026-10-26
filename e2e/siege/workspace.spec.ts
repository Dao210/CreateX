import { test, expect } from "./fixtures";
import { siegePreferencesKey } from "../../packages/core/siege/preferences";

test("uses the workspace shell and isolates campaign records across real workspaces", async ({ page, api, game }) => {
  await page.goto(`/${game.slug}/chat`);
  const entry = page.getByRole("link", { name: "涂鸦攻城", exact: true });
  await expect(entry).toHaveAttribute("href", game.workshopHref);
  await entry.click();
  await expect(page.getByTestId("siege-page")).toBeVisible();
  await expect(entry).toHaveAttribute("data-active", "");
  await expect(page).toHaveTitle(/涂鸦攻城/);
  await page.getByLabel("炮管长度数值", { exact: true }).fill("3.20");
  await page.getByLabel("炮管长度数值", { exact: true }).press("Enter");
  await page.waitForTimeout(500);
  const second = await api.createWorkspace("Siege QA second", `siege-second-${Date.now().toString(36)}`);
  try {
    const secondKey = siegePreferencesKey(game.userId, second.id);
    await page.evaluate(({ first, other }) => {
      localStorage.setItem(`${first}:siege-campaign-progress`, JSON.stringify({ version: 1, stars: [3,0,0,0,0,0,0,0], sound: false, selectedLevel: 2 }));
      localStorage.setItem(`${other}:siege-campaign-progress`, JSON.stringify({ version: 1, stars: [0,0,0,0,0,0,0,0], sound: true, selectedLevel: 1 }));
    }, { first: game.namespace, other: secondKey });
    await page.getByRole("link", { name: "林地闯关", exact: true }).click();
    await expect(page.getByRole("heading", { name: "箱子后面", exact: true })).toBeVisible();
    await page.goto(`/${second.slug}/siege`);
    await expect(page.getByLabel("炮管长度数值", { exact: true })).toHaveValue("2.20");
    await page.getByRole("link", { name: "林地闯关", exact: true }).click();
    await expect(page.getByRole("heading", { name: "第一座炮台", exact: true })).toBeVisible();
    await page.goto(game.campaignHref);
    await expect(page.getByRole("heading", { name: "箱子后面", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "坦克守城", exact: true })).toBeVisible();
  } finally {
    api.setWorkspaceId(second.id); api.setWorkspaceSlug(second.slug); await api.deleteWorkspace();
    api.setWorkspaceId(game.workspaceId); api.setWorkspaceSlug(game.slug);
  }
});
